// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TestServer } from "../helpers/test-harness";
import { seedVault } from "../helpers/seed";
import { SyncApiClient } from "../../src/sync/client";
import { b64uEncodeSync, sha256Hex } from "../../src/crypto/encoding";
import { newVaultId, newRecordId, newMutationId } from "../../src/lib/ids";

/**
 * Gap 5 — TOKEN-ALONE NEGATIVES.
 * Acceptance criteria: "token alone decrypts nothing and cannot
 * mutate/pair/revoke/envelope-change". A VALID bearer token WITHOUT the
 * PV-Device Ed25519 signature must be rejected with 401 INVALID_SIGNATURE on
 * every mutating endpoint — and a valid signature computed over a DIFFERENT
 * body must also be rejected.
 */
describe("Token-Alone Negatives (no PV-Device signature)", { timeout: 60000 }, () => {
  let server: TestServer;
  let client: SyncApiClient;
  let tokenB64u: string;
  let deviceId: string;
  let sodium: any;
  let keypair: any;
  let creds: any;

  beforeEach(async () => {
    server = new TestServer();
    client = new SyncApiClient("", server.fetch.bind(server) as any);
    const seed = await seedVault(server);
    tokenB64u = seed.tokenB64u;
    deviceId = seed.deviceId;
    sodium = seed.sodium;
    keypair = seed.keypair;
    creds = seed.creds;
  });

  afterEach(() => {
    server.close();
  });

  const bearerOnly = () => ({ Authorization: `Bearer ${tokenB64u}` });

  function validBatchBody() {
    return JSON.stringify({
      mutations: [
        {
          mutation_id: newMutationId(),
          record_id: newRecordId(),
          expected_revision: 0,
          schema_version: 1,
          key_version: 1,
          is_tombstone: false,
          ciphertext: "token_alone_ct",
          nonce_b64u: "token_alone_nonce",
        },
      ],
    });
  }

  function validCryptoBody() {
    return JSON.stringify({
      expected_crypto_format_version: 1,
      expected_key_version: 99,
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
  }

  it("POST sync/batch with token alone -> 401 INVALID_SIGNATURE (no mutation)", async () => {
    const res = await server.fetch("/api/v1/sync/batch", {
      method: "POST",
      headers: { ...bearerOnly(), "Content-Type": "application/json" },
      body: validBatchBody(),
    });
    expect(res.status).toBe(401);
    const body: any = await res.json();
    expect(body.code).toBe("INVALID_SIGNATURE");
    expect(body.retryable).toBe(false);

    // Nothing was mutated server-side
    const count = await server.db
      .prepare(`SELECT COUNT(*) AS n FROM sync_changes`)
      .first<any>();
    expect(count?.n).toBe(0);
  });

  it("POST pairing-tickets with token alone -> 401 INVALID_SIGNATURE", async () => {
    const res = await server.fetch("/api/v1/pairing-tickets", {
      method: "POST",
      headers: { ...bearerOnly(), "Content-Type": "application/json" },
      body: JSON.stringify({ ticket_hash: "f".repeat(64) }),
    });
    expect(res.status).toBe(401);
    const body: any = await res.json();
    expect(body.code).toBe("INVALID_SIGNATURE");
  });

  it("POST devices/:id/revoke with token alone -> 401 INVALID_SIGNATURE (device NOT revoked)", async () => {
    const res = await server.fetch(`/api/v1/devices/${deviceId}/revoke`, {
      method: "POST",
      headers: { ...bearerOnly(), "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
    const body: any = await res.json();
    expect(body.code).toBe("INVALID_SIGNATURE");

    // Device is still active: an authed call gets past auth (404 oracle for
    // an unknown-but-well-formed vault proves the device was NOT revoked).
    const bootstrap = await client.getBootstrap(newVaultId(), creds).catch((e) => e);
    expect(bootstrap.code).toBe("VAULT_NOT_FOUND"); // auth passed, vault unknown
    expect(bootstrap.httpStatus).toBe(404);
  });

  it("PUT vault/crypto-metadata with token alone -> 401 INVALID_SIGNATURE", async () => {
    const res = await server.fetch("/api/v1/vault/crypto-metadata", {
      method: "PUT",
      headers: { ...bearerOnly(), "Content-Type": "application/json" },
      body: validCryptoBody(),
    });
    expect(res.status).toBe(401);
    const body: any = await res.json();
    expect(body.code).toBe("INVALID_SIGNATURE");
  });

  it("sanity: the SAME requests WITH a valid signature succeed (failure is the missing sig)", async () => {
    const ticket = await client.createPairingTicket("d".repeat(64), creds);
    expect(ticket.ticket_id).toBeTruthy();

    const batch = await client.postSyncBatch(
      [
        {
          mutation_id: newMutationId(),
          record_id: newRecordId(),
          expected_revision: 0,
          schema_version: 1,
          key_version: 1,
          is_tombstone: false,
          ciphertext: "signed_ct",
          nonce_b64u: "signed_nonce",
        },
      ],
      creds,
    );
    expect(batch.results).toHaveLength(1);
  });

  it("valid signature over a DIFFERENT body is rejected (sync/batch)", async () => {
    const ts = new Date().toISOString();
    const nonce = crypto.randomUUID();
    const bodySent = validBatchBody();
    const bodySigned = validBatchBody(); // different mutation_ids -> different bytes
    expect(bodySigned).not.toBe(bodySent);

    const digest = await sha256Hex(new TextEncoder().encode(bodySigned));
    const canonical = `POST\n/api/v1/sync/batch\n${ts}\n${nonce}\n${digest}`;
    const sig = b64uEncodeSync(
      sodium,
      sodium.crypto_sign_detached(
        new Uint8Array(new TextEncoder().encode(canonical)),
        new Uint8Array(keypair.privateKey),
      ),
    );

    const res = await server.fetch("/api/v1/sync/batch", {
      method: "POST",
      headers: {
        ...bearerOnly(),
        "Content-Type": "application/json",
        "PV-Device": `device_id="${deviceId}", timestamp="${ts}", nonce="${nonce}", signature="${sig}"`,
      },
      body: bodySent,
    });
    expect(res.status).toBe(401);
    const body: any = await res.json();
    expect(body.code).toBe("INVALID_SIGNATURE");
  });

  it("valid signature over a DIFFERENT body is rejected (pairing-tickets)", async () => {
    const ts = new Date().toISOString();
    const nonce = crypto.randomUUID();
    const bodySent = JSON.stringify({ ticket_hash: "1".repeat(64) });
    const bodySigned = JSON.stringify({ ticket_hash: "2".repeat(64) });

    const digest = await sha256Hex(new TextEncoder().encode(bodySigned));
    const canonical = `POST\n/api/v1/pairing-tickets\n${ts}\n${nonce}\n${digest}`;
    const sig = b64uEncodeSync(
      sodium,
      sodium.crypto_sign_detached(
        new Uint8Array(new TextEncoder().encode(canonical)),
        new Uint8Array(keypair.privateKey),
      ),
    );

    const res = await server.fetch("/api/v1/pairing-tickets", {
      method: "POST",
      headers: {
        ...bearerOnly(),
        "Content-Type": "application/json",
        "PV-Device": `device_id="${deviceId}", timestamp="${ts}", nonce="${nonce}", signature="${sig}"`,
      },
      body: bodySent,
    });
    expect(res.status).toBe(401);
    const body: any = await res.json();
    expect(body.code).toBe("INVALID_SIGNATURE");
  });

  it("signature for the wrong PATH is rejected (cross-endpoint replay)", async () => {
    const ts = new Date().toISOString();
    const nonce = crypto.randomUUID();
    const bodyText = JSON.stringify({ ticket_hash: "e".repeat(64) });

    // Sign for /api/v1/sync/batch but send to /api/v1/pairing-tickets
    const digest = await sha256Hex(new TextEncoder().encode(bodyText));
    const canonical = `POST\n/api/v1/sync/batch\n${ts}\n${nonce}\n${digest}`;
    const sig = b64uEncodeSync(
      sodium,
      sodium.crypto_sign_detached(
        new Uint8Array(new TextEncoder().encode(canonical)),
        new Uint8Array(keypair.privateKey),
      ),
    );

    const res = await server.fetch("/api/v1/pairing-tickets", {
      method: "POST",
      headers: {
        ...bearerOnly(),
        "Content-Type": "application/json",
        "PV-Device": `device_id="${deviceId}", timestamp="${ts}", nonce="${nonce}", signature="${sig}"`,
      },
      body: bodyText,
    });
    expect(res.status).toBe(401);
    const body: any = await res.json();
    expect(body.code).toBe("INVALID_SIGNATURE");
  });
});
