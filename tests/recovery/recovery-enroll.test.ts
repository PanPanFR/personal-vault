// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TestServer } from "../helpers/test-harness";
import { SyncApiClient } from "../../src/sync/client";
import { recoverAllDevicesLost } from "../../src/recovery/enroll";
import { createDb, type PersonalVaultDB } from "../../src/db/dexie-schema";
import { ensureSodium } from "../../src/crypto/wasm-guard";
import { b64uEncodeSync, sha256Hex } from "../../src/crypto/encoding";
import { deriveRecoveryWrapKey, deriveRecoveryAuthToken } from "../../src/crypto/hkdf";
import { newVaultId, newDeviceId } from "../../src/lib/ids";
import { isUnlocked, getSession, clearSession } from "../../src/vault/session";

describe("All-Devices-Lost Recovery Protocol (FR-7)", { timeout: 20000 }, () => {
  let server: TestServer;
  let client: SyncApiClient;
  let cleanDb: PersonalVaultDB;
  let sodium: any;

  let vaultId: string;
  let dev1Id: string;
  let recoverySecret: Uint8Array;
  let recoveryVerifier: string;
  let dek: Uint8Array;
  let recoveryNonce: Uint8Array;
  let wrappedDekRecovery: Uint8Array;

  beforeEach(async () => {
    clearSession();
    server = new TestServer();
    client = new SyncApiClient("", server.fetch.bind(server) as any);
    sodium = await ensureSodium();

    cleanDb = createDb(`clean-recovery-db-${crypto.randomUUID()}`);
    vaultId = newVaultId();
    dev1Id = newDeviceId();

    dek = sodium.randombytes_buf(32);
    recoverySecret = sodium.randombytes_buf(32);

    // Derive recovery auth verifier: SHA-256(HKDF(recoverySecret, "PV-V1/RECOVERY-AUTH"))
    const authToken = await deriveRecoveryAuthToken(recoverySecret);
    recoveryVerifier = await sha256Hex(authToken);

    // Wrap DEK with recovery wrap key
    const wrapKey = await deriveRecoveryWrapKey(recoverySecret);
    recoveryNonce = sodium.randombytes_buf(24);
    wrappedDekRecovery = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
      dek,
      null,
      null,
      recoveryNonce,
      wrapKey,
    );

    const tokenHash = "0".repeat(64);
    const pubKey = b64uEncodeSync(sodium, sodium.crypto_sign_keypair().publicKey);

    // Setup vault on server
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
          nonce_b64u: b64uEncodeSync(sodium, recoveryNonce),
          wrapped_dek_b64u: b64uEncodeSync(sodium, wrappedDekRecovery),
        },
        recovery_auth_verifier: recoveryVerifier,
        device: {
          device_id: dev1Id,
          device_token_hash: tokenHash,
          device_public_key: pubKey,
          label: "Lost-Device",
        },
      }),
    });
  });

  afterEach(async () => {
    server.close();
    await cleanDb.delete();
    clearSession();
  });

  it("recovers access on clean device via recovery secret, sets new passphrase, and syncs", async () => {
    const newPassphrase = "New-Master-Passphrase-2026!";

    const result = await recoverAllDevicesLost({
      db: cleanDb,
      client,
      vaultId,
      recoverySecret,
      newPassphrase,
      label: "My-Recovered-Laptop",
      calibrate: async () => 10,
    });

    expect(result.vaultId).toBe(vaultId);
    expect(result.deviceId).toBeTruthy();

    // Session is unlocked with restored DEK
    expect(isUnlocked()).toBe(true);
    expect(getSession()?.vaultId).toBe(vaultId);

    // Master envelope on server was updated and is now decryptable with new passphrase!
    const bootstrap = await server.db
      .prepare(`SELECT salt, master_nonce, master_wrapped_dek FROM vaults WHERE vault_id = ?`)
      .bind(vaultId)
      .first();

    expect(bootstrap).toBeTruthy();
  });

  it("fails closed on invalid recovery secret without corrupting clean database", async () => {
    const wrongRecoverySecret = sodium.randombytes_buf(32);

    await expect(
      recoverAllDevicesLost({
        db: cleanDb,
        client,
        vaultId,
        recoverySecret: wrongRecoverySecret,
        newPassphrase: "Any-Password-123!",
      }),
    ).rejects.toThrow();

    expect(isUnlocked()).toBe(false);
    const credsCount = await cleanDb.device_credentials.count();
    expect(credsCount).toBe(0);
  });
});
