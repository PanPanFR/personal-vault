// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TestServer } from "../helpers/test-harness";
import { seedVault, seedSecondDevice, vaultCreatePayload } from "../helpers/seed";
import { SyncApiClient } from "../../src/sync/client";
import { newVaultId, newDeviceId, newRecordId, newMutationId } from "../../src/lib/ids";

/**
 * Gap 4 — RATE LIMIT 429-THEN-RECOVER MATRIX (api-spec Appendix B).
 *
 * Limits: vault create 3/IP/hr | pairing-tickets 5/device/hr |
 * pairing/exchange 10/vault/hr | recovery/enroll 5/vault/hr |
 * sync/batch 120/vault/hr | sync GET 300/vault/hr |
 * crypto-metadata 10/vault/hr.
 *
 * For each: request at limit+1 -> 429 RATE_LIMITED (retryable) with a numeric
 * Retry-After > 0; a DIFFERENT bucket key is unaffected (keying is right);
 * and after the window resets (simulated by clearing the scope's counter row
 * in the mock D1 — the fixed hourly window rolls over to a fresh counter in
 * prod) the endpoint recovers.
 */
describe("Rate Limit 429-Then-Recover Matrix", { timeout: 180000 }, () => {
  let server: TestServer;
  let client: SyncApiClient;
  let vaultId: string;
  let creds: any;
  let sodium: any;

  beforeEach(async () => {
    server = new TestServer();
    client = new SyncApiClient("", server.fetch.bind(server) as any);
    const seed = await seedVault(server);
    vaultId = seed.vaultId;
    creds = seed.creds;
    sodium = seed.sodium;
  });

  afterEach(() => {
    server.close();
  });

  async function resetWindow(scope: string, bucketKey: string) {
    // Simulates hourly-window rollover: the fixed window advances, so the
    // (scope, bucket_key, window_start) counter starts fresh. Done via direct
    // mock-DB manipulation — never via production code paths.
    await server.db
      .prepare(`DELETE FROM rate_limits WHERE scope = ? AND bucket_key = ?`)
      .bind(scope, bucketKey)
      .run();
  }

  function expectRateLimited(res: Response, body: any) {
    expect(res.status).toBe(429);
    expect(body.code).toBe("RATE_LIMITED");
    expect(body.retryable).toBe(true);
    const retryAfter = Number(res.headers.get("Retry-After"));
    expect(Number.isFinite(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThan(0);
  }

  it("vault create 3/IP/hr: 4th -> 429, other IP unaffected, recovers after window", async () => {
    const ip = "198.51.100.11";
    const payload = () =>
      JSON.stringify(
        vaultCreatePayload(newVaultId(), {
          device_id: newDeviceId(),
          device_token_hash: "b".repeat(64),
          device_public_key: "c".repeat(43),
          label: "Rate-Test",
        }),
      );
    const post = (ipHdr: string) =>
      server.fetch("/api/v1/vaults", {
        method: "POST",
        headers: { "Content-Type": "application/json", "CF-Connecting-IP": ipHdr },
        body: payload(),
      });

    expect((await post(ip)).status).toBe(201);
    expect((await post(ip)).status).toBe(201);
    expect((await post(ip)).status).toBe(201);

    const limited = await post(ip);
    expectRateLimited(limited, await limited.json());

    // Different IP bucket is NOT affected
    expect((await post("198.51.100.12")).status).toBe(201);

    // Recovers after the window
    await resetWindow("vault-create", ip);
    expect((await post(ip)).status).toBe(201);
  });

  it("pairing-tickets 5/device/hr: 6th -> 429, other device unaffected, recovers", async () => {
    const hashes = Array.from({ length: 6 }, (_, i) => `${i}`.repeat(64));
    for (let i = 0; i < 5; i++) {
      const res = await client.createPairingTicket(hashes[i], creds);
      expect(res.ticket_id).toBeTruthy();
    }
    await expect(client.createPairingTicket(hashes[5], creds)).rejects.toMatchObject({
      code: "RATE_LIMITED",
      httpStatus: 429,
    });

    // Retry-After header is numeric and > 0
    let retryAfter = 0;
    try {
      await client.createPairingTicket("9".repeat(64), creds);
    } catch (e: any) {
      retryAfter = e.retryAfter ?? 0;
    }
    expect(retryAfter).toBeGreaterThan(0);

    // A DIFFERENT device bucket is unaffected — register one directly.
    const other = await seedSecondDevice(server, sodium, vaultId);
    const otherClient = new SyncApiClient("", server.fetch.bind(server) as any);
    const ok = await otherClient.createPairingTicket("a".repeat(64), other.creds);
    expect(ok.ticket_id).toBeTruthy();

    // Recovers after the window
    await resetWindow("pairing-ticket-create", creds.deviceId);
    const after = await client.createPairingTicket("b".repeat(64), creds);
    expect(after.ticket_id).toBeTruthy();
  });

  it("pairing/exchange 10/vault/hr: 11th -> 429, other vault unaffected, recovers", async () => {
    const attempt = () =>
      client.exchangePairingTicket({
        vault_id: vaultId,
        ticket: "bogus-ticket-value",
        device_id: newDeviceId(),
        device_public_key: "c".repeat(43),
      });
    for (let i = 0; i < 10; i++) {
      await expect(attempt()).rejects.toMatchObject({
        code: "TICKET_INVALID",
        httpStatus: 400,
      });
    }
    // Failed requests count toward the limit (Appendix B): 11th is 429.
    let retryAfter = 0;
    try {
      await attempt();
    } catch (e: any) {
      expect(e.code).toBe("RATE_LIMITED");
      expect(e.httpStatus).toBe(429);
      retryAfter = e.retryAfter ?? 0;
    }
    expect(retryAfter).toBeGreaterThan(0);

    // Other vault bucket unaffected (still 400 TICKET_INVALID, not 429).
    const seed2 = await seedVault(server);
    const client2 = new SyncApiClient("", server.fetch.bind(server) as any);
    await expect(
      client2.exchangePairingTicket({
        vault_id: seed2.vaultId,
        ticket: "bogus-ticket-value",
        device_id: newDeviceId(),
        device_public_key: "c".repeat(43),
      }),
    ).rejects.toMatchObject({ code: "TICKET_INVALID", httpStatus: 400 });

    // Recovers after the window (back to 400 TICKET_INVALID, not 429).
    await resetWindow("pairing-exchange", vaultId);
    await expect(attempt()).rejects.toMatchObject({
      code: "TICKET_INVALID",
      httpStatus: 400,
    });
  });

  it("recovery/enroll: 5 valid attempts then 429; failures trigger doubling backoff earlier", async () => {
    // Appendix B row 4: 5 attempts/vault/hour, PLUS a doubling backoff once 3
    // consecutive attempts fail. Successful (valid-token) enrollments do not
    // accumulate failures, so the flat budget of 5 applies.
    await resetWindow("vault-create", "127.0.0.1");
    const seedV = await seedVault(server, "Enroll-Budget", {
      recoveryAuthToken: "valid-recovery-token",
    });
    const validToken = seedV.recoveryAuthToken;
    const enrollOk = () =>
      client.recoveryEnrollDevice({
        vault_id: seedV.vaultId,
        recovery_auth_token: validToken,
        device_id: newDeviceId(),
        device_public_key: "c".repeat(43),
      });

    for (let i = 0; i < 5; i++) {
      const res = await enrollOk();
      expect(res.vault_id).toBe(seedV.vaultId);
    }
    let retryAfter = 0;
    try {
      await enrollOk();
    } catch (e: any) {
      expect(e.code).toBe("RATE_LIMITED");
      expect(e.httpStatus).toBe(429);
      retryAfter = e.retryAfter ?? 0;
    }
    expect(retryAfter).toBeGreaterThan(0);

    // Backoff: after 3 consecutive wrong-token failures the effective budget
    // halves, so the 3rd failure already trips 429 instead of the 6th.
    await resetWindow("vault-create", "127.0.0.1");
    const seed3 = await seedVault(server);
    const bad = () =>
      client.recoveryEnrollDevice({
        vault_id: seed3.vaultId,
        recovery_auth_token: "wrong-token",
        device_id: newDeviceId(),
        device_public_key: "c".repeat(43),
      });
    await expect(bad()).rejects.toMatchObject({ httpStatus: 401 }); // fail 1
    await expect(bad()).rejects.toMatchObject({ httpStatus: 401 }); // fail 2
    await expect(bad()).rejects.toMatchObject({ httpStatus: 401 }); // fail 3 -> backoff engages
    await expect(bad()).rejects.toMatchObject({ httpStatus: 401 }); // fail 4
    // Budget is now halved, so this trips at the 5th attempt instead of the 6th.
    await expect(bad()).rejects.toMatchObject({
      code: "RATE_LIMITED",
      httpStatus: 429,
    });

    await resetWindow("vault-create", "127.0.0.1");
    const seed2 = await seedVault(server);
    const client2 = new SyncApiClient("", server.fetch.bind(server) as any);
    await expect(
      client2.recoveryEnrollDevice({
        vault_id: seed2.vaultId,
        recovery_auth_token: "wrong-token",
        device_id: newDeviceId(),
        device_public_key: "c".repeat(43),
      }),
    ).rejects.toMatchObject({ code: "DEVICE_UNAUTHORIZED", httpStatus: 401 });

    await resetWindow("vault-create", "127.0.0.1");
    await resetWindow("recovery-enroll", vaultId);
    await resetWindow("recovery-enroll", seedV.vaultId);
    await resetWindow("recovery-enroll-failures", seed3.vaultId);
    const res = await enrollOk();
    expect(res.vault_id).toBe(seedV.vaultId);
  });

  it("recovery/enroll: wrong token is rejected and counted as a failure", async () => {
    const attempt = () =>
      client.recoveryEnrollDevice({
        vault_id: vaultId,
        recovery_auth_token: "wrong-token",
        device_id: newDeviceId(),
        device_public_key: "c".repeat(43),
      });
    await expect(attempt()).rejects.toMatchObject({
      code: "DEVICE_UNAUTHORIZED",
      httpStatus: 401,
    });
  });

  it("sync/batch 120/vault/hr: 121st -> 429, other vault unaffected, recovers", async () => {
    const one = () =>
      client.postSyncBatch(
        [
          {
            mutation_id: newMutationId(),
            record_id: newRecordId(),
            expected_revision: 0,
            schema_version: 1,
            key_version: 1,
            is_tombstone: false,
            ciphertext: "rl_ct",
            nonce_b64u: "rl_nonce",
          },
        ],
        creds,
      );
    for (let i = 0; i < 120; i++) {
      const res = await one();
      expect(res.results).toHaveLength(1);
    }
    let retryAfter = 0;
    try {
      await one();
    } catch (e: any) {
      expect(e.code).toBe("RATE_LIMITED");
      expect(e.httpStatus).toBe(429);
      expect(e.retryable).toBe(true);
      retryAfter = e.retryAfter ?? 0;
    }
    expect(retryAfter).toBeGreaterThan(0);

    // Other vault bucket unaffected
    const seed2 = await seedVault(server);
    const ok = await new SyncApiClient("", server.fetch.bind(server) as any).postSyncBatch(
      [
        {
          mutation_id: newMutationId(),
          record_id: newRecordId(),
          expected_revision: 0,
          schema_version: 1,
          key_version: 1,
          is_tombstone: false,
          ciphertext: "other_ct",
          nonce_b64u: "other_nonce",
        },
      ],
      seed2.creds,
    );
    expect(ok.results).toHaveLength(1);

    // Recovers after the window
    await resetWindow("sync-push", vaultId);
    const after = await one();
    expect(after.results).toHaveLength(1);
  });

  it("sync GET 300/vault/hr: 301st -> 429, other vault unaffected, recovers", async () => {
    for (let i = 0; i < 300; i++) {
      const page = await client.getSync(0, 1, creds);
      expect(Array.isArray(page.changes)).toBe(true);
    }
    let retryAfter = 0;
    try {
      await client.getSync(0, 1, creds);
    } catch (e: any) {
      expect(e.code).toBe("RATE_LIMITED");
      expect(e.httpStatus).toBe(429);
      expect(e.retryable).toBe(true);
      retryAfter = e.retryAfter ?? 0;
    }
    expect(retryAfter).toBeGreaterThan(0);

    const seed2 = await seedVault(server);
    const page2 = await new SyncApiClient("", server.fetch.bind(server) as any).getSync(
      0,
      1,
      seed2.creds,
    );
    expect(Array.isArray(page2.changes)).toBe(true);

    await resetWindow("sync-pull", vaultId);
    const after = await client.getSync(0, 1, creds);
    expect(Array.isArray(after.changes)).toBe(true);
  });

  it("crypto-metadata 10/vault/hr: 11th -> 429, other vault unaffected, recovers", async () => {
    const body = () => ({
      expected_crypto_format_version: 1,
      expected_key_version: 99, // mismatch: 409, but still counts toward the limit
      master_envelope: {
        crypto_format_version: 1,
        key_version: 2,
        kdf_version: 1,
        argon2_m_kib: 65536,
        argon2_t: 3,
        argon2_p: 1,
        salt_b64u: "new_salt_16_bytes_b64u",
        nonce_b64u: "new_nonce_24_bytes_b64u_new_nonce",
        wrapped_dek_b64u:
          "new_wrapped_dek_32_bytes_b64u_new_wrapped_dek_32_bytes_b64u_new_wrapped",
      },
    });
    for (let i = 0; i < 10; i++) {
      await expect(client.updateCryptoMetadata(body(), creds)).rejects.toMatchObject({
        code: "VERSION_MISMATCH",
        httpStatus: 409,
      });
    }
    let retryAfter = 0;
    try {
      await client.updateCryptoMetadata(body(), creds);
    } catch (e: any) {
      expect(e.code).toBe("RATE_LIMITED");
      expect(e.httpStatus).toBe(429);
      retryAfter = e.retryAfter ?? 0;
    }
    expect(retryAfter).toBeGreaterThan(0);

    const seed2 = await seedVault(server);
    await expect(
      new SyncApiClient("", server.fetch.bind(server) as any).updateCryptoMetadata(
        body(),
        seed2.creds,
      ),
    ).rejects.toMatchObject({ code: "VERSION_MISMATCH", httpStatus: 409 });

    await resetWindow("crypto-metadata-update", vaultId);
    await expect(client.updateCryptoMetadata(body(), creds)).rejects.toMatchObject({
      code: "VERSION_MISMATCH",
      httpStatus: 409,
    });
  });
});
