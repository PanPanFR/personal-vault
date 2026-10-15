// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TestServer } from "../helpers/test-harness";
import { SyncApiClient } from "../../src/sync/client";
import { ensureSodium } from "../../src/crypto/wasm-guard";
import { b64uEncodeSync, sha256Hex } from "../../src/crypto/encoding";
import { newVaultId, newDeviceId } from "../../src/lib/ids";

describe("API Endpoints & Lifecycle Contract", () => {
  let server: TestServer;
  let client: SyncApiClient;
  let sodium: any;

  let vaultId: string;
  let deviceId: string;
  let rawToken: Uint8Array;
  let tokenB64u: string;
  let tokenHash: string;
  let keypair: any;
  let publicKeyB64u: string;
  let recoveryVerifier: string;

  beforeEach(async () => {
    server = new TestServer();
    client = new SyncApiClient("", server.fetch.bind(server) as any);
    sodium = await ensureSodium();

    vaultId = newVaultId();
    deviceId = newDeviceId();
    rawToken = sodium.randombytes_buf(32);
    tokenB64u = b64uEncodeSync(sodium, rawToken);
    tokenHash = await sha256Hex(new Uint8Array(new TextEncoder().encode(tokenB64u)));
    keypair = sodium.crypto_sign_keypair();
    publicKeyB64u = b64uEncodeSync(sodium, keypair.publicKey);
    recoveryVerifier = "c".repeat(64);

    await server.fetch("/api/v1/vaults", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vault_id: vaultId,
        crypto_format_version: 1,
        key_version: 1,
        schema_version: 1,
        master_envelope: {
          crypto_format_version: 1,
          key_version: 1,
          kdf_version: 1,
          argon2_m_kib: 65536,
          argon2_t: 3,
          argon2_p: 1,
          salt_b64u: "dB8g8jH_839aKdk_23kdPQ",
          nonce_b64u: "rB1Z6k_89qW1rB1Z6k_89qW1rB1Z6k_8",
          wrapped_dek_b64u: "kP0kP0kP0kP0kP0kP0kP0kP0kP0kP0kP0kP0kP0kP0kP0kP0kP0kP0kP0kP0kP0k",
        },
        recovery_envelope: {
          crypto_format_version: 1,
          key_version: 1,
          nonce_b64u: "mN3mN3mN3mN3mN3mN3mN3mN3mN3mN3mN",
          wrapped_dek_b64u: "qZ8qZ8qZ8qZ8qZ8qZ8qZ8qZ8qZ8qZ8qZ8qZ8qZ8qZ8qZ8qZ8qZ8qZ8qZ8qZ8qZ8q",
        },
        recovery_auth_verifier: recoveryVerifier,
        device: {
          device_id: deviceId,
          device_token_hash: tokenHash,
          device_public_key: publicKeyB64u,
          label: "Device-Init",
        },
      }),
    });
  });

  afterEach(() => {
    server.close();
  });

  it("enforces rate limits on vault creation (3/IP/hour) returning 429 RATE_LIMITED + Retry-After", async () => {
    const validPayload = (vId: string) => ({
      vault_id: vId,
      crypto_format_version: 1,
      key_version: 1,
      schema_version: 1,
      master_envelope: {
        crypto_format_version: 1,
        key_version: 1,
        kdf_version: 1,
        argon2_m_kib: 65536,
        argon2_t: 3,
        argon2_p: 1,
        salt_b64u: "dB8g8jH_839aKdk_23kdPQ",
        nonce_b64u: "rB1Z6k_89qW1rB1Z6k_89qW1rB1Z6k_8",
        wrapped_dek_b64u: "kP0kP0kP0kP0kP0kP0kP0kP0kP0kP0kP0kP0kP0kP0kP0kP0kP0kP0kP0kP0kP0k",
      },
      recovery_envelope: {
        crypto_format_version: 1,
        key_version: 1,
        nonce_b64u: "mN3mN3mN3mN3mN3mN3mN3mN3mN3mN3mN",
        wrapped_dek_b64u: "qZ8qZ8qZ8qZ8qZ8qZ8qZ8qZ8qZ8qZ8qZ8qZ8qZ8qZ8qZ8qZ8qZ8qZ8qZ8qZ8qZ8q",
      },
      recovery_auth_verifier: "a".repeat(64),
      device: {
        device_id: newDeviceId(),
        device_token_hash: "b".repeat(64),
        device_public_key: "c".repeat(43),
        label: "Device-Test",
      },
    });

    const ip = "192.0.2.99";
    // 1st request
    const r1 = await server.fetch("/api/v1/vaults", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
      body: JSON.stringify(validPayload(newVaultId())),
    });
    expect(r1.status).toBe(201);

    // 2nd request
    const r2 = await server.fetch("/api/v1/vaults", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
      body: JSON.stringify(validPayload(newVaultId())),
    });
    expect(r2.status).toBe(201);

    // 3rd request
    const r3 = await server.fetch("/api/v1/vaults", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
      body: JSON.stringify(validPayload(newVaultId())),
    });
    expect(r3.status).toBe(201);

    // 4th request -> must be 429 RATE_LIMITED
    const r4 = await server.fetch("/api/v1/vaults", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
      body: JSON.stringify(validPayload(newVaultId())),
    });

    expect(r4.status).toBe(429);
    const body: any = await r4.json();
    expect(body.code).toBe("RATE_LIMITED");
    expect(body.retryable).toBe(true);
    expect(r4.headers.get("Retry-After")).toBeTruthy();
    expect(Number(r4.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("ensures bootstrap response NEVER leaks recovery envelope, verifier, or device list", async () => {
    const creds = { deviceId, rawToken, privateKey: keypair.privateKey };
    const bootstrap = await client.getBootstrap(vaultId, creds);

    expect(bootstrap.vault_id).toBe(vaultId);
    expect(bootstrap.master_envelope).toBeTruthy();
    expect(bootstrap.change_cursor).toBe(0);

    // Negative assertions per PRD §11 & plan
    expect((bootstrap as any).recovery_envelope).toBeUndefined();
    expect((bootstrap as any).recovery_auth_verifier).toBeUndefined();
    expect((bootstrap as any).devices).toBeUndefined();
  });

  it("completes full pairing sequence: create ticket, invalidate prior, atomic exchange, single-use", async () => {
    const creds = { deviceId, rawToken, privateKey: keypair.privateKey };

    // 1. Create first ticket
    const ticket1Bytes = sodium.randombytes_buf(32);
    const ticket1B64u = b64uEncodeSync(sodium, ticket1Bytes);
    const hash1 = await sha256Hex(ticket1Bytes);

    const ticketRes1 = await client.createPairingTicket(hash1, creds);
    expect(ticketRes1.ticket_id).toBeTruthy();
    expect(ticketRes1.expires_at).toBeTruthy();

    // 2. Create second ticket -> invalidates first (single active invariant)
    const ticket2Bytes = sodium.randombytes_buf(32);
    const ticket2B64u = b64uEncodeSync(sodium, ticket2Bytes);
    const hash2 = await sha256Hex(ticket2Bytes);

    const ticketRes2 = await client.createPairingTicket(hash2, creds);
    expect(ticketRes2.ticket_id).toBeTruthy();

    // Device B credentials
    const devBKeypair = sodium.crypto_sign_keypair();
    const devBId = newDeviceId();
    const devBPublicKeyB64u = b64uEncodeSync(sodium, devBKeypair.publicKey);

    // 3. Attempt to exchange ticket 1 -> must fail with 410 TICKET_CONSUMED (superseded)
    await expect(
      client.exchangePairingTicket({
        vault_id: vaultId,
        ticket: ticket1B64u,
        device_id: devBId,
        device_public_key: devBPublicKeyB64u,
      }),
    ).rejects.toMatchObject({
      code: "TICKET_CONSUMED",
      httpStatus: 410,
    });

    // 4. Exchange ticket 2 -> succeeds with 201 Created and returns device_token ONCE
    const exchangeRes = await client.exchangePairingTicket({
      vault_id: vaultId,
      ticket: ticket2B64u,
      device_id: devBId,
      device_public_key: devBPublicKeyB64u,
      label: "Device-B",
    });

    expect(exchangeRes.vault_id).toBe(vaultId);
    expect(exchangeRes.device_id).toBe(devBId);
    expect(exchangeRes.device_token).toBeTruthy();

    // 5. Re-exchanging ticket 2 -> must fail with 410 TICKET_CONSUMED (single use)
    await expect(
      client.exchangePairingTicket({
        vault_id: vaultId,
        ticket: ticket2B64u,
        device_id: newDeviceId(),
        device_public_key: devBPublicKeyB64u,
      }),
    ).rejects.toMatchObject({
      code: "TICKET_CONSUMED",
      httpStatus: 410,
    });

    // 6. Device B can now authenticate to bootstrap using its received device_token
    const rawDevBToken = new Uint8Array(
      atob(exchangeRes.device_token.replace(/-/g, "+").replace(/_/g, "/"))
        .split("")
        .map((c) => c.charCodeAt(0)),
    );
    const devBCreds = {
      deviceId: devBId,
      rawToken: rawDevBToken,
      privateKey: devBKeypair.privateKey,
    };

    const bBootstrap = await client.getBootstrap(vaultId, devBCreds);
    expect(bBootstrap.vault_id).toBe(vaultId);
  });

  it("device revocation is idempotent and takes effect immediately", async () => {
    const creds = { deviceId, rawToken, privateKey: keypair.privateKey };

    // Register a secondary device
    const secKeypair = sodium.crypto_sign_keypair();
    const secDeviceId = newDeviceId();
    const secPublicKeyB64u = b64uEncodeSync(sodium, secKeypair.publicKey);

    // Create ticket & exchange
    const ticketBytes = sodium.randombytes_buf(32);
    const ticketB64u = b64uEncodeSync(sodium, ticketBytes);
    const hash = await sha256Hex(ticketBytes);
    await client.createPairingTicket(hash, creds);

    const exchange = await client.exchangePairingTicket({
      vault_id: vaultId,
      ticket: ticketB64u,
      device_id: secDeviceId,
      device_public_key: secPublicKeyB64u,
    });

    // Revoke secondary device from primary device
    const revRes1 = await client.revokeDevice(secDeviceId, creds);
    expect(revRes1.status).toBe("revoked");
    expect(revRes1.device_id).toBe(secDeviceId);

    // Second revoke call must be idempotent (200 OK)
    const revRes2 = await client.revokeDevice(secDeviceId, creds);
    expect(revRes2.status).toBe("revoked");

    // Secondary device must now be blocked on all endpoints
    const secTokenBytes = new Uint8Array(
      atob(exchange.device_token.replace(/-/g, "+").replace(/_/g, "/"))
        .split("")
        .map((c) => c.charCodeAt(0)),
    );
    const secCreds = {
      deviceId: secDeviceId,
      rawToken: secTokenBytes,
      privateKey: secKeypair.privateKey,
    };

    await expect(client.getBootstrap(vaultId, secCreds)).rejects.toMatchObject({
      code: "DEVICE_REVOKED",
      httpStatus: 401,
    });
  });

  it("updates crypto-metadata atomically and enforces key version checks", async () => {
    const creds = { deviceId, rawToken, privateKey: keypair.privateKey };

    // Version mismatch: expected_key_version != 1
    await expect(
      client.updateCryptoMetadata(
        {
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
            wrapped_dek_b64u: "new_wrapped_dek_32_bytes_b64u_new_wrapped_dek_32_bytes_b64u_new_wrapped",
          },
        },
        creds,
      ),
    ).rejects.toMatchObject({
      code: "VERSION_MISMATCH",
      httpStatus: 409,
    });

    // Valid update
    const updateRes = await client.updateCryptoMetadata(
      {
        expected_crypto_format_version: 1,
        expected_key_version: 1,
        master_envelope: {
          crypto_format_version: 1,
          key_version: 2,
          kdf_version: 1,
          argon2_m_kib: 65536,
          argon2_t: 3,
          argon2_p: 1,
          salt_b64u: "new_salt_16_bytes_b64u",
          nonce_b64u: "new_nonce_24_bytes_b64u_new_nonce",
          wrapped_dek_b64u: "new_wrapped_dek_32_bytes_b64u_new_wrapped_dek_32_bytes_b64u_new_wrapped",
        },
      },
      creds,
    );

    expect(updateRes.vault_id).toBe(vaultId);
    expect(updateRes.key_version).toBe(2);
  });

  it("recovery enrolls device with valid recovery token and returns recovery_envelope directly", async () => {
    // 1. Wrong recovery token -> 401 DEVICE_UNAUTHORIZED
    const newDevKeypair = sodium.crypto_sign_keypair();
    const newDevId = newDeviceId();
    const newDevPubB64u = b64uEncodeSync(sodium, newDevKeypair.publicKey);

    await expect(
      client.recoveryEnrollDevice({
        vault_id: vaultId,
        recovery_auth_token: "wrong-token",
        device_id: newDevId,
        device_public_key: newDevPubB64u,
      }),
    ).rejects.toMatchObject({
      code: "DEVICE_UNAUTHORIZED",
      httpStatus: 401,
    });

    // 2. Correct recovery token (matching SHA-256 verifier)
    // In beforeEach, recoveryVerifier was set to "c".repeat(64)
    // Let's create a known recovery auth token whose SHA-256 matches:
    const rawAuthToken = "secret-auth-token-123";
    const verifierHex = await sha256Hex(new Uint8Array(new TextEncoder().encode(rawAuthToken)));

    // Update vault verifier to match
    await server.db
      .prepare(`UPDATE vaults SET recovery_auth_verifier = ? WHERE vault_id = ?`)
      .bind(verifierHex, vaultId)
      .run();

    const enrollRes = await client.recoveryEnrollDevice({
      vault_id: vaultId,
      recovery_auth_token: rawAuthToken,
      device_id: newDevId,
      device_public_key: newDevPubB64u,
      label: "Recovered-Laptop",
    });

    expect(enrollRes.vault_id).toBe(vaultId);
    expect(enrollRes.device_id).toBe(newDevId);
    expect(enrollRes.device_token).toBeTruthy();
    expect(enrollRes.recovery_envelope).toBeTruthy();
    expect(enrollRes.recovery_envelope.wrapped_dek_b64u).toBeTruthy();
  });
});
