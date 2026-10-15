// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TestServer } from "../helpers/test-harness";
import { SyncApiClient } from "../../src/sync/client";
import { ensureSodium } from "../../src/crypto/wasm-guard";
import { b64uEncodeSync, sha256Hex } from "../../src/crypto/encoding";
import { newVaultId, newDeviceId } from "../../src/lib/ids";

describe("API Authentication & Security Matrix", () => {
  let server: TestServer;
  let client: SyncApiClient;
  let sodium: any;

  let vaultId: string;
  let deviceId: string;
  let rawToken: Uint8Array;
  let keypair: any;
  let tokenHash: string;
  let publicKeyB64u: string;

  beforeEach(async () => {
    server = new TestServer();
    client = new SyncApiClient("", server.fetch.bind(server) as any);
    sodium = await ensureSodium();

    vaultId = newVaultId();
    deviceId = newDeviceId();
    rawToken = sodium.randombytes_buf(32);
    const tokenB64u = b64uEncodeSync(sodium, rawToken);
    tokenHash = await sha256Hex(new Uint8Array(new TextEncoder().encode(tokenB64u)));
    keypair = sodium.crypto_sign_keypair();
    publicKeyB64u = b64uEncodeSync(sodium, keypair.publicKey);

    // Create a vault with this device
    const res = await server.fetch("/api/v1/vaults", {
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
        recovery_auth_verifier: "a".repeat(64),
        device: {
          device_id: deviceId,
          device_token_hash: tokenHash,
          device_public_key: publicKeyB64u,
          label: "Primary Device",
        },
      }),
    });

    expect(res.status).toBe(201);
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    expect(res.headers.get("X-Server-Time")).toBeTruthy();
  });

  afterEach(() => {
    server.close();
  });

  it("rejects read endpoint when Authorization header is missing (401 DEVICE_UNAUTHORIZED)", async () => {
    const res = await server.fetch(`/api/v1/vaults/${vaultId}/bootstrap`);
    expect(res.status).toBe(401);
    const body: any = await res.json();
    expect(body.code).toBe("DEVICE_UNAUTHORIZED");
    expect(body.retryable).toBe(false);
  });

  it("rejects unknown device bearer token (401 DEVICE_UNAUTHORIZED)", async () => {
    const fakeToken = b64uEncodeSync(sodium, sodium.randombytes_buf(32));
    const res = await server.fetch(`/api/v1/vaults/${vaultId}/bootstrap`, {
      headers: { Authorization: `Bearer ${fakeToken}` },
    });
    expect(res.status).toBe(401);
    const body: any = await res.json();
    expect(body.code).toBe("DEVICE_UNAUTHORIZED");
  });

  it("rejects mutating endpoint without PV-Device header (401 INVALID_SIGNATURE)", async () => {
    const tokenB64u = b64uEncodeSync(sodium, rawToken);
    const res = await server.fetch("/api/v1/pairing-tickets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenB64u}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ticket_hash: "f".repeat(64) }),
    });
    expect(res.status).toBe(401);
    const body: any = await res.json();
    expect(body.code).toBe("INVALID_SIGNATURE");
  });

  it("rejects PV-Device header when device_id mismatches bearer token (401 DEVICE_UNAUTHORIZED)", async () => {
    const tokenB64u = b64uEncodeSync(sodium, rawToken);
    const wrongDeviceId = newDeviceId();
    const ts = new Date().toISOString();
    const nonce = crypto.randomUUID();
    const sig = b64uEncodeSync(sodium, new Uint8Array(64));

    const res = await server.fetch("/api/v1/pairing-tickets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenB64u}`,
        "PV-Device": `device_id="${wrongDeviceId}", timestamp="${ts}", nonce="${nonce}", signature="${sig}"`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ticket_hash: "f".repeat(64) }),
    });
    expect(res.status).toBe(401);
    const body: any = await res.json();
    expect(body.code).toBe("DEVICE_UNAUTHORIZED");
  });

  it("rejects bad Ed25519 signature (401 INVALID_SIGNATURE)", async () => {
    const tokenB64u = b64uEncodeSync(sodium, rawToken);
    const ts = new Date().toISOString();
    const nonce = crypto.randomUUID();
    const badSig = b64uEncodeSync(sodium, new Uint8Array(64));

    const res = await server.fetch("/api/v1/pairing-tickets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenB64u}`,
        "PV-Device": `device_id="${deviceId}", timestamp="${ts}", nonce="${nonce}", signature="${badSig}"`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ticket_hash: "f".repeat(64) }),
    });
    expect(res.status).toBe(401);
    const body: any = await res.json();
    expect(body.code).toBe("INVALID_SIGNATURE");
  });

  it("rejects stale timestamp (> 5 minutes skew) with 401 STALE_TIMESTAMP and emits X-Server-Time", async () => {
    const creds = { deviceId, rawToken, privateKey: keypair.privateKey };
    // Skew local client time by 10 minutes into the past
    const staleTs = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const nonce = crypto.randomUUID();
    const bodyText = JSON.stringify({ ticket_hash: "f".repeat(64) });
    const bodyDigest = await sha256Hex(new TextEncoder().encode(bodyText));

    const canonical = `POST\n/api/v1/pairing-tickets\n${staleTs}\n${nonce}\n${bodyDigest}`;
    const sig = b64uEncodeSync(sodium, sodium.crypto_sign_detached(new Uint8Array(new TextEncoder().encode(canonical)), new Uint8Array(keypair.privateKey)));
    const tokenB64u = b64uEncodeSync(sodium, rawToken);

    const res = await server.fetch("/api/v1/pairing-tickets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenB64u}`,
        "PV-Device": `device_id="${deviceId}", timestamp="${staleTs}", nonce="${nonce}", signature="${sig}"`,
        "Content-Type": "application/json",
      },
      body: bodyText,
    });

    expect(res.status).toBe(401);
    const body: any = await res.json();
    expect(body.code).toBe("STALE_TIMESTAMP");
    expect(body.retryable).toBe(true);
    expect(res.headers.get("X-Server-Time")).toBeTruthy();
  });

  it("detects nonce replay with differing body (409 REPLAY_DETECTED)", async () => {
    const creds = { deviceId, rawToken, privateKey: keypair.privateKey };
    const ts = new Date().toISOString();
    const nonce = crypto.randomUUID();
    const tokenB64u = b64uEncodeSync(sodium, rawToken);

    // First request
    const body1 = JSON.stringify({ ticket_hash: "1".repeat(64) });
    const digest1 = await sha256Hex(new TextEncoder().encode(body1));
    const canonical1 = `POST\n/api/v1/pairing-tickets\n${ts}\n${nonce}\n${digest1}`;
    const sig1 = b64uEncodeSync(sodium, sodium.crypto_sign_detached(new Uint8Array(new TextEncoder().encode(canonical1)), new Uint8Array(keypair.privateKey)));

    const res1 = await server.fetch("/api/v1/pairing-tickets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenB64u}`,
        "PV-Device": `device_id="${deviceId}", timestamp="${ts}", nonce="${nonce}", signature="${sig1}"`,
        "Content-Type": "application/json",
      },
      body: body1,
    });
    expect(res1.status).toBe(201);

    // Second request with SAME nonce but DIFFERENT body
    const body2 = JSON.stringify({ ticket_hash: "2".repeat(64) });
    const digest2 = await sha256Hex(new Uint8Array(new TextEncoder().encode(body2)));
    const canonical2 = `POST\n/api/v1/pairing-tickets\n${ts}\n${nonce}\n${digest2}`;
    const sig2 = b64uEncodeSync(sodium, sodium.crypto_sign_detached(new Uint8Array(new TextEncoder().encode(canonical2)), new Uint8Array(keypair.privateKey)));

    const res2 = await server.fetch("/api/v1/pairing-tickets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenB64u}`,
        "PV-Device": `device_id="${deviceId}", timestamp="${ts}", nonce="${nonce}", signature="${sig2}"`,
        "Content-Type": "application/json",
      },
      body: body2,
    });
    expect(res2.status).toBe(409);
    const errBody: any = await res2.json();
    expect(errBody.code).toBe("REPLAY_DETECTED");
  });

  it("enforces immediate rejection on revoked device (401 DEVICE_REVOKED)", async () => {
    const creds = { deviceId, rawToken, privateKey: keypair.privateKey };

    // Self-revoke
    const revokeRes = await client.revokeDevice(deviceId, creds);
    expect(revokeRes.status).toBe("revoked");

    // Immediately subsequent calls must fail with 401 DEVICE_REVOKED
    await expect(client.getBootstrap(vaultId, creds)).rejects.toMatchObject({
      code: "DEVICE_REVOKED",
      httpStatus: 401,
    });
    await expect(client.getSync(0, 50, creds)).rejects.toMatchObject({
      code: "DEVICE_REVOKED",
      httpStatus: 401,
    });
  });

  it("enforces VAULT_NOT_FOUND oracle rule on unknown vault or cross-vault access", async () => {
    const creds = { deviceId, rawToken, privateKey: keypair.privateKey };
    const otherVaultId = newVaultId();

    await expect(client.getBootstrap(otherVaultId, creds)).rejects.toMatchObject({
      code: "VAULT_NOT_FOUND",
      httpStatus: 404,
    });
  });
});
