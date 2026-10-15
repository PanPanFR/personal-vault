import { TestServer } from "./test-harness";
import { ensureSodium } from "../../src/crypto/wasm-guard";
import { b64uEncodeSync, sha256Hex } from "../../src/crypto/encoding";
import { newVaultId, newDeviceId } from "../../src/lib/ids";

export interface SeededVault {
  sodium: any;
  vaultId: string;
  deviceId: string;
  rawToken: Uint8Array;
  tokenB64u: string;
  keypair: any;
  publicKeyB64u: string;
  creds: { deviceId: string; rawToken: Uint8Array; privateKey: Uint8Array };
}

export const MASTER_ENVELOPE_FIXTURE = {
  crypto_format_version: 1,
  key_version: 1,
  kdf_version: 1,
  argon2_m_kib: 65536,
  argon2_t: 3,
  argon2_p: 1,
  salt_b64u: "dB8g8jH_839aKdk_23kdPQ",
  nonce_b64u: "rB1Z6k_89qW1rB1Z6k_89qW1rB1Z6k_8",
  wrapped_dek_b64u:
    "kP0kP0kP0kP0kP0kP0kP0kP0kP0kP0kP0kP0kP0kP0kP0kP0kP0kP0kP0kP0kP0k",
};

export const RECOVERY_ENVELOPE_FIXTURE = {
  crypto_format_version: 1,
  key_version: 1,
  nonce_b64u: "mN3mN3mN3mN3mN3mN3mN3mN3mN3mN3mN",
  wrapped_dek_b64u:
    "qZ8qZ8qZ8qZ8qZ8qZ8qZ8qZ8qZ8qZ8qZ8qZ8qZ8qZ8qZ8qZ8qZ8qZ8qZ8qZ8qZ8q",
};

export function vaultCreatePayload(
  vaultId: string,
  device: {
    device_id: string;
    device_token_hash: string;
    device_public_key: string;
    label: string;
  },
) {
  return {
    vault_id: vaultId,
    crypto_format_version: 1,
    key_version: 1,
    schema_version: 1,
    master_envelope: { ...MASTER_ENVELOPE_FIXTURE },
    recovery_envelope: { ...RECOVERY_ENVELOPE_FIXTURE },
    recovery_auth_verifier: "e".repeat(64),
    device,
  };
}

/**
 * Verifier hex that matches a given recovery auth token, i.e. the value the
 * server stores for `POST /recovery/enroll-device` authorization.
 */
export async function recoveryVerifierFor(token: string): Promise<string> {
  return sha256Hex(new Uint8Array(new TextEncoder().encode(token)));
}

/** Creates a fresh vault + authorized device on the given server. Fast: no Argon2. */
export async function seedVault(
  server: TestServer,
  label = "Seed-Device",
  opts: { recoveryAuthToken?: string } = {},
): Promise<SeededVault & { recoveryAuthToken: string }> {
  const sodium = await ensureSodium();
  const vaultId = newVaultId();
  const deviceId = newDeviceId();
  const rawToken = sodium.randombytes_buf(32);
  const tokenB64u = b64uEncodeSync(sodium, rawToken);
  const tokenHash = await sha256Hex(
    new Uint8Array(new TextEncoder().encode(tokenB64u)),
  );
  const keypair = sodium.crypto_sign_keypair();
  const publicKeyB64u = b64uEncodeSync(sodium, keypair.publicKey);
  const recoveryAuthToken = opts.recoveryAuthToken ?? "seeded-recovery-token";

  const payload = vaultCreatePayload(vaultId, {
    device_id: deviceId,
    device_token_hash: tokenHash,
    device_public_key: publicKeyB64u,
    label,
  });
  (payload as any).recovery_auth_verifier =
    await recoveryVerifierFor(recoveryAuthToken);

  const res = await server.fetch("/api/v1/vaults", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (res.status !== 201) {
    throw new Error(`seedVault failed: ${res.status} ${await res.text()}`);
  }
  return {
    sodium,
    vaultId,
    deviceId,
    rawToken,
    tokenB64u,
    keypair,
    publicKeyB64u,
    creds: { deviceId, rawToken, privateKey: keypair.privateKey },
    recoveryAuthToken,
  };
}

/** Registers an extra authorized device directly in the mock DB (no pairing round-trip). */
export async function seedSecondDevice(
  server: TestServer,
  sodium: any,
  vaultId: string,
  label = "Seed-Device-2",
) {
  const deviceId = newDeviceId();
  const rawToken = sodium.randombytes_buf(32);
  const tokenB64u = b64uEncodeSync(sodium, rawToken);
  const tokenHash = await sha256Hex(
    new Uint8Array(new TextEncoder().encode(tokenB64u)),
  );
  const keypair = sodium.crypto_sign_keypair();
  const publicKeyB64u = b64uEncodeSync(sodium, keypair.publicKey);
  const now = new Date().toISOString();
  await server.db
    .prepare(
      `INSERT INTO authorized_devices (vault_id, device_id, token_hash, public_key, label, created_at, last_used_at, revoked_at, last_ack_cursor)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
    )
    .bind(vaultId, deviceId, tokenHash, publicKeyB64u, label, now, now)
    .run();
  return {
    deviceId,
    rawToken,
    tokenB64u,
    keypair,
    publicKeyB64u,
    creds: { deviceId, rawToken, privateKey: keypair.privateKey },
  };
}
