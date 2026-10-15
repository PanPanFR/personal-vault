// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TestServer } from "../helpers/test-harness";
import { SyncApiClient } from "../../src/sync/client";
import { createPairingTicketFlow, parsePairingInput } from "../../src/pairing/ticket";
import { pairDeviceB } from "../../src/pairing/exchange";
import { createDb, type PersonalVaultDB } from "../../src/db/dexie-schema";
import { ensureSodium } from "../../src/crypto/wasm-guard";
import { b64uEncodeSync, sha256Hex } from "../../src/crypto/encoding";
import { newVaultId, newDeviceId } from "../../src/lib/ids";
import { isUnlocked, getSession, clearSession } from "../../src/vault/session";

describe("Device Pairing Protocol (FR-5 4-Step Sequence)", { timeout: 20000 }, () => {
  let server: TestServer;
  let client: SyncApiClient;
  let dev1Db: PersonalVaultDB;
  let dev2Db: PersonalVaultDB;
  let sodium: any;

  let vaultId: string;
  let dev1Id: string;
  let dev1Creds: any;
  const masterPassphrase = "Master-Vault-Secret-123!";

  beforeEach(async () => {
    clearSession();
    server = new TestServer();
    client = new SyncApiClient("", server.fetch.bind(server) as any);
    sodium = await ensureSodium();

    dev1Db = createDb(`dev1-db-${crypto.randomUUID()}`);
    dev2Db = createDb(`dev2-db-${crypto.randomUUID()}`);

    vaultId = newVaultId();
    dev1Id = newDeviceId();
    const rawToken = sodium.randombytes_buf(32);
    const tokenB64u = b64uEncodeSync(sodium, rawToken);
    const tokenHash = await sha256Hex(new Uint8Array(new TextEncoder().encode(tokenB64u)));
    const kp = sodium.crypto_sign_keypair();
    const pubKey = b64uEncodeSync(sodium, kp.publicKey);

    dev1Creds = {
      deviceId: dev1Id,
      rawToken,
      privateKey: kp.privateKey,
    };

    // Create vault on server
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
        recovery_auth_verifier: "f".repeat(64),
        device: {
          device_id: dev1Id,
          device_token_hash: tokenHash,
          device_public_key: pubKey,
          label: "Device-A",
        },
      }),
    });
  });

  afterEach(async () => {
    server.close();
    await dev1Db.delete();
    await dev2Db.delete();
    clearSession();
  });

  it("generates 256-bit pairing ticket, base32 manual code, and valid QR json", async () => {
    const ticketData = await createPairingTicketFlow({
      vaultId,
      apiOrigin: "https://personal-vault.pages.dev",
      client,
      credentials: dev1Creds,
    });

    expect(ticketData.ticket).toBeTruthy();
    expect(ticketData.ticketHash).toHaveLength(64);
    expect(ticketData.manualCode).toMatch(/^[A-Z2-7]{4}(-[A-Z2-7]{4}){12}$/);
    expect(ticketData.expiresAt).toBeTruthy();

    // QR parser round-trip
    const parsedQr = parsePairingInput(ticketData.qrJson);
    expect(parsedQr.vaultId).toBe(vaultId);
    expect(parsedQr.ticketB64u).toBe(ticketData.ticket);

    // Manual base32 code round-trip
    const parsedManual = parsePairingInput(ticketData.manualCode);
    expect(parsedManual.ticketB64u).toBe(ticketData.ticket);
  });

  it("completes full Device B pairing flow: exchange -> bootstrap -> unlock -> save creds -> sync", async () => {
    // 1. Device A creates ticket
    const ticketData = await createPairingTicketFlow({
      vaultId,
      apiOrigin: "https://personal-vault.pages.dev",
      client,
      credentials: dev1Creds,
    });

    // We need master envelope to be decryptable by masterPassphrase for this test:
    // Let's create a real master envelope wrapped with masterPassphrase:
    const dek = sodium.randombytes_buf(32);
    const salt = sodium.randombytes_buf(16);
    const pwBytes = sodium.from_string(masterPassphrase);
    const kek = sodium.crypto_pwhash(
      32,
      pwBytes,
      salt,
      3,
      65536 * 1024,
      sodium.crypto_pwhash_ALG_ARGON2ID13,
    );
    const nonce = sodium.randombytes_buf(24);
    const wrappedDek = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
      dek,
      null,
      null,
      nonce,
      kek,
    );

    const validMasterEnv = {
      crypto_format_version: 1,
      key_version: 1,
      kdf_version: 1,
      argon2_m_kib: 65536,
      argon2_t: 3,
      argon2_p: 1,
      salt_b64u: b64uEncodeSync(sodium, salt),
      nonce_b64u: b64uEncodeSync(sodium, nonce),
      wrapped_dek_b64u: b64uEncodeSync(sodium, wrappedDek),
    };

    // Update server master envelope
    await client.updateCryptoMetadata(
      {
        expected_crypto_format_version: 1,
        expected_key_version: 1,
        master_envelope: validMasterEnv,
      },
      dev1Creds,
    );

    // 2. Device B performs pairing with correct passphrase
    const pairResult = await pairDeviceB({
      db: dev2Db,
      client,
      vaultId,
      ticketB64u: ticketData.ticket,
      passphrase: masterPassphrase,
      label: "Device-B-Laptop",
    });

    expect(pairResult.vaultId).toBe(vaultId);
    expect(pairResult.deviceId).toBeTruthy();

    // Device B is now unlocked and has active session
    expect(isUnlocked()).toBe(true);
    expect(getSession()?.vaultId).toBe(vaultId);

    // Device B credentials stored encrypted in IndexedDB
    const devBCreds = await dev2Db.device_credentials.get(pairResult.deviceId);
    expect(devBCreds).toBeTruthy();
    expect(devBCreds?.label).toBe("Device-B-Laptop");
    expect(devBCreds?.encrypted_device_token).toBeTruthy();
  });

  it("Device B pairing fails closed on wrong passphrase without corrupting state", async () => {
    const ticketData = await createPairingTicketFlow({
      vaultId,
      apiOrigin: "https://personal-vault.pages.dev",
      client,
      credentials: dev1Creds,
    });

    await expect(
      pairDeviceB({
        db: dev2Db,
        client,
        vaultId,
        ticketB64u: ticketData.ticket,
        passphrase: "Wrong-Passphrase-999!",
      }),
    ).rejects.toThrow();

    // No credentials saved in IndexedDB
    const credCount = await dev2Db.device_credentials.count();
    expect(credCount).toBe(0);
    expect(isUnlocked()).toBe(false);
  });
});
