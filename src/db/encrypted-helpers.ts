// Encrypted IndexedDB helpers — ciphertext-only at rest. Dexie schema is
// owned by foundations (src/db/dexie-schema.ts); this module adds read/write
// helpers only and never edits the schema.
//
// Rules enforced here:
// - records/outbox payloads are XChaCha ciphertext via PV-V1/REC-ENC.
// - device token + Ed25519 private key are wrapped via PV-V1/LOCAL-CRED.
// - NEVER write plaintext titles/URLs/tags/passwords, passphrase, recovery
//   secret, raw token, private key, or queries to IDB, Cache, logs, URLs,
//   history, or localStorage. localStorage holds only the lock-epoch int.
import { ensureSodium } from "../crypto/wasm-guard";
import { b64uDecodeSync, b64uEncodeSync } from "../crypto/encoding";
import { encryptRecord, decryptRecord } from "../crypto/rec-enc";
import { CryptoError } from "../crypto/errors";
import type { PersonalVaultDB } from "./dexie-schema";

export interface SaveRecordArgs {
  record_id: string;
  plaintext: unknown;
  schema_version: number;
  updated_at: string;
}

export async function saveEncryptedRecord(
  db: PersonalVaultDB,
  args: SaveRecordArgs & {
    vaultId: string;
    recEncKey: Uint8Array;
    keyVersion: number;
    localRevision: number;
    serverRevision: number;
    syncState: "synced" | "pending" | "conflict";
    isDeleted: boolean;
  },
): Promise<void> {
  const { ciphertext_b64u, nonce_b64u } = await encryptRecord(
    args.plaintext,
    args.recEncKey,
    args.vaultId,
    args.record_id,
    args.schema_version,
    args.keyVersion,
  );
  await db.records.put({
    record_id: args.record_id,
    ciphertext: ciphertext_b64u,
    nonce: nonce_b64u,
    schema_version: args.schema_version,
    key_version: args.keyVersion,
    local_revision: args.localRevision,
    server_revision: args.serverRevision,
    sync_state: args.syncState,
    is_deleted: args.isDeleted,
    updated_at: args.updated_at,
  });
}

export async function loadDecryptedRecord<T = unknown>(
  db: PersonalVaultDB,
  record_id: string,
  vaultId: string,
  recEncKey: Uint8Array,
): Promise<T> {
  const row = await db.records.get(record_id);
  if (!row || row.ciphertext == null || row.nonce == null) {
    throw new CryptoError("VALIDATION_ERROR", "Record missing or tombstoned.");
  }
  return decryptRecord<T>(
    row.ciphertext,
    row.nonce,
    recEncKey,
    vaultId,
    row.record_id,
    row.schema_version,
    row.key_version,
  );
}

/** Stage an outbox mutation — SAME REC-ENC subkey, no new purpose. */
export async function stageEncryptedOutbox(args: {
  db: PersonalVaultDB;
  mutation_id: string;
  record_id: string;
  expected_base_revision: number;
  action: "upsert" | "delete";
  plaintext: unknown | null;
  vaultId: string;
  recEncKey: Uint8Array;
  schema_version: number;
  keyVersion: number;
}): Promise<void> {
  let encrypted_payload: string | null = null;
  let nonce: string | null = null;
  if (args.action === "upsert") {
    if (args.plaintext == null) {
      throw new CryptoError("VALIDATION_ERROR", "Upsert needs plaintext.");
    }
    const enc = await encryptRecord(
      args.plaintext,
      args.recEncKey,
      args.vaultId,
      args.record_id,
      args.schema_version,
      args.keyVersion,
    );
    encrypted_payload = enc.ciphertext_b64u;
    nonce = enc.nonce_b64u;
  }
  await args.db.outbox.put({
    mutation_id: args.mutation_id,
    record_id: args.record_id,
    expected_base_revision: args.expected_base_revision,
    action: args.action,
    encrypted_payload,
    nonce,
    schema_version: args.schema_version,
    key_version: args.keyVersion,
    created_at: new Date().toISOString(),
    retry_state: "pending",
    retry_count: 0,
    error_code: null,
  });
}

/** Wrap arbitrary local bytes (token / private key) under LOCAL-CRED. */
export async function wrapLocalBytes(
  raw: Uint8Array,
  localCredKey: Uint8Array,
): Promise<{ wrapped_b64u: string; nonce_b64u: string }> {
  if (localCredKey.length !== 32) {
    throw new CryptoError("VALIDATION_ERROR", "LOCAL-CRED key must be 32 bytes.");
  }
  const sodium = await ensureSodium();
  const nonce = sodium.randombytes_buf(
    sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES,
  );
  const wrapped = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    raw,
    null,
    null,
    nonce,
    localCredKey,
  );
  return {
    wrapped_b64u: b64uEncodeSync(sodium, wrapped),
    nonce_b64u: b64uEncodeSync(sodium, nonce),
  };
}

export async function unwrapLocalBytes(
  wrapped_b64u: string,
  nonce_b64u: string,
  localCredKey: Uint8Array,
): Promise<Uint8Array> {
  if (localCredKey.length !== 32) {
    throw new CryptoError("VALIDATION_ERROR", "LOCAL-CRED key must be 32 bytes.");
  }
  const sodium = await ensureSodium();
  const wrapped = b64uDecodeSync(sodium, wrapped_b64u);
  const nonce = b64uDecodeSync(sodium, nonce_b64u);
  try {
    const raw = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      wrapped,
      null,
      nonce,
      localCredKey,
    );
    return new Uint8Array(raw);
  } catch {
    throw new CryptoError("VALIDATION_ERROR", "Local credential unwrap failed.");
  }
}

/** Persist device credentials — encrypted at rest, public key + label plain. */
export async function saveDeviceCredentials(args: {
  db: PersonalVaultDB;
  device_id: string;
  rawToken: Uint8Array;
  rawPrivateKey: Uint8Array;
  publicKeyB64u: string;
  label: string;
  localCredKey: Uint8Array;
}): Promise<void> {
  const sodium = await ensureSodium();
  // One nonce for both wraps would reuse a nonce under the same key — use two.
  const tokenWrap = await wrapLocalBytes(args.rawToken, args.localCredKey);
  const keyWrap = await wrapLocalBytes(args.rawPrivateKey, args.localCredKey);
  // Store concatenated wraps: token wrap + key wrap share the row nonce slot?
  // Schema has a single `nonce` column — store token nonce there and prefix the
  // private-key nonce inside encrypted_private_key as `${nonce}.${wrapped}`.
  // Both nonces stay fresh and unique.
  void sodium;
  await args.db.device_credentials.put({
    device_id: args.device_id,
    encrypted_device_token: tokenWrap.wrapped_b64u,
    encrypted_private_key: `${keyWrap.nonce_b64u}.${keyWrap.wrapped_b64u}`,
    nonce: tokenWrap.nonce_b64u,
    public_key: args.publicKeyB64u,
    label: args.label,
  });
}

export async function loadDeviceToken(
  db: PersonalVaultDB,
  device_id: string,
  localCredKey: Uint8Array,
): Promise<Uint8Array> {
  const row = await db.device_credentials.get(device_id);
  if (!row) throw new CryptoError("VALIDATION_ERROR", "Unknown device.");
  return unwrapLocalBytes(row.encrypted_device_token, row.nonce, localCredKey);
}

export async function loadDevicePrivateKey(
  db: PersonalVaultDB,
  device_id: string,
  localCredKey: Uint8Array,
): Promise<Uint8Array> {
  const row = await db.device_credentials.get(device_id);
  if (!row) throw new CryptoError("VALIDATION_ERROR", "Unknown device.");
  const dot = row.encrypted_private_key.indexOf(".");
  if (dot < 0) throw new CryptoError("VALIDATION_ERROR", "Bad private-key wrap.");
  const nonce = row.encrypted_private_key.slice(0, dot);
  const wrapped = row.encrypted_private_key.slice(dot + 1);
  return unwrapLocalBytes(wrapped, nonce, localCredKey);
}
