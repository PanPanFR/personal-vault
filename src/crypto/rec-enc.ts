// XChaCha20-Poly1305 record encryption with AAD binding.
// Key: HKDF(DEK, "PV-V1/REC-ENC"). Fresh 24-byte nonce every encryption.
// Outbox staged payloads reuse the SAME subkey (identical plaintext bytes,
// same purpose — counted as PV-V1/REC-ENC regardless of stage).
import { ensureSodium } from "./wasm-guard";
import { constructRecordAAD } from "./aad";
import { b64uDecodeSync, b64uEncodeSync } from "./encoding";
import { CryptoError } from "./errors";
import { assertPlaintextSize } from "../lib/schemas";
import {
  CIPHERTEXT_RECORD_CAP_BYTES,
  PLAINTEXT_ITEM_CAP_BYTES,
} from "../lib/limits";
import { assertVersionSupported } from "../lib/versions";

export interface EncryptedRecord {
  ciphertext_b64u: string;
  nonce_b64u: string;
}

export async function encryptRecord(
  plaintextValue: unknown,
  recEncKey: Uint8Array,
  vaultId: string,
  recordId: string,
  schemaVersion: number,
  keyVersion: number,
): Promise<EncryptedRecord> {
  if (recEncKey.length !== 32) {
    throw new CryptoError("VALIDATION_ERROR", "REC-ENC key must be 32 bytes.");
  }
  assertVersionSupported("schema_version", schemaVersion);
  // Plaintext guard BEFORE encryption — must agree with server 256 KiB cap.
  const plainBytes = new TextEncoder().encode(JSON.stringify(plaintextValue));
  if (plainBytes.length > PLAINTEXT_ITEM_CAP_BYTES) {
    assertPlaintextSize(plaintextValue); // throws PlaintextTooLargeError
    throw new CryptoError("PAYLOAD_TOO_LARGE", "Plaintext exceeds 256 KiB.");
  }
  const sodium = await ensureSodium();
  const nonce = sodium.randombytes_buf(
    sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES,
  );
  const aad = constructRecordAAD(vaultId, recordId, schemaVersion, keyVersion);
  const cipher = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plainBytes,
    aad,
    null,
    nonce,
    recEncKey,
  );
  const ciphertext_b64u = b64uEncodeSync(sodium, cipher);
  if (ciphertext_b64u.length > CIPHERTEXT_RECORD_CAP_BYTES) {
    throw new CryptoError("PAYLOAD_TOO_LARGE", "Ciphertext exceeds 384 KiB cap.");
  }
  return { ciphertext_b64u, nonce_b64u: b64uEncodeSync(sodium, nonce) };
}

export async function decryptRecord<T = unknown>(
  ciphertext_b64u: string,
  nonce_b64u: string,
  recEncKey: Uint8Array,
  vaultId: string,
  recordId: string,
  schemaVersion: number,
  keyVersion: number,
): Promise<T> {
  if (recEncKey.length !== 32) {
    throw new CryptoError("VALIDATION_ERROR", "REC-ENC key must be 32 bytes.");
  }
  // Version guard: higher major => refuse, never write-back/downgrade.
  assertVersionSupported("schema_version", schemaVersion);
  assertVersionSupported("crypto_format_version", 1);
  const sodium = await ensureSodium();
  let cipher: Uint8Array;
  let nonce: Uint8Array;
  try {
    cipher = b64uDecodeSync(sodium, ciphertext_b64u);
    nonce = b64uDecodeSync(sodium, nonce_b64u);
  } catch {
    throw new CryptoError("VALIDATION_ERROR", "Ciphertext/nonce not valid base64url.");
  }
  if (nonce.length !== sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES) {
    throw new CryptoError("VALIDATION_ERROR", "Bad nonce length.");
  }
  const aad = constructRecordAAD(vaultId, recordId, schemaVersion, keyVersion);
  let plain: Uint8Array;
  try {
    plain = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      cipher,
      aad,
      nonce,
      recEncKey,
    );
  } catch {
    // Fail closed: MAC failure from tamper OR any AAD-field mismatch.
    // Never return partial plaintext.
    throw new CryptoError(
      "VALIDATION_ERROR",
      "Decryption failed (tamper or AAD mismatch).",
    );
  }
  try {
    return JSON.parse(new TextDecoder().decode(plain)) as T;
  } catch {
    throw new CryptoError("VALIDATION_ERROR", "Decrypted payload is not JSON.");
  }
}
