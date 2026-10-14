// HKDF-SHA-256 (RFC 5869) over libsodium's reviewed HMAC-SHA-256.
// libsodium-wrappers-sumo 0.7.15 exposes no hkdf expand/extract helper, only
// HMAC + SHA-256 — so expand/extract are composed here, never hand-rolled.
//
// Extract salt convention (open Q4): RFC 5869 §2.2 default — when no salt is
// bound, use a string of HashLen zeros. For SHA-256 that is 32 zero bytes,
// which also satisfies HMAC's 32-byte key requirement. IKM is always a
// uniform 256-bit root (DEK or recovery secret); vault salt_b64u is NOT mixed
// in. Documented so a future kdf_version bump can change it explicitly.
import { ensureSodium } from "./wasm-guard";

export const HKDF_LABEL_REC_ENC = "PV-V1/REC-ENC" as const;
export const HKDF_LABEL_LOCAL_CRED = "PV-V1/LOCAL-CRED" as const;
export const HKDF_LABEL_RECOVERY_WRAP = "PV-V1/RECOVERY-WRAP" as const;
export const HKDF_LABEL_RECOVERY_AUTH = "PV-V1/RECOVERY-AUTH" as const;

export type HkdfLabel =
  | typeof HKDF_LABEL_REC_ENC
  | typeof HKDF_LABEL_LOCAL_CRED
  | typeof HKDF_LABEL_RECOVERY_WRAP
  | typeof HKDF_LABEL_RECOVERY_AUTH;

const HASH_LEN = 32;
const ZERO_SALT = new Uint8Array(HASH_LEN); // 32 zeros

type Sodium = Awaited<ReturnType<typeof ensureSodium>>;

function hmac(sodium: Sodium, key: Uint8Array, message: Uint8Array): Uint8Array {
  return new Uint8Array(sodium.crypto_auth_hmacsha256(message, key));
}

/** HKDF-Extract(salt=32 zeros, IKM). */
export function hkdfExtractSync(
  sodium: Sodium,
  ikm: Uint8Array,
  salt: Uint8Array = ZERO_SALT,
): Uint8Array {
  if (ikm.length !== 32) throw new Error("HKDF IKM must be 32 bytes.");
  return hmac(sodium, salt, ikm);
}

/** HKDF-Expand(PRK, info, L). Supports L <= 255*HashLen; we need 32. */
export function hkdfExpandSync(
  sodium: Sodium,
  prk: Uint8Array,
  info: string,
  length: number,
): Uint8Array {
  if (prk.length !== HASH_LEN) throw new Error("HKDF PRK must be 32 bytes.");
  if (length <= 0 || length > 255 * HASH_LEN) throw new Error("HKDF bad length.");
  const infoBytes = new TextEncoder().encode(info);
  const n = Math.ceil(length / HASH_LEN);
  const okm = new Uint8Array(n * HASH_LEN);
  let prev: Uint8Array = new Uint8Array(0);
  for (let i = 1; i <= n; i++) {
    const msg = new Uint8Array(prev.length + infoBytes.length + 1);
    msg.set(prev, 0);
    msg.set(infoBytes, prev.length);
    msg[msg.length - 1] = i;
    const ti = hmac(sodium, prk, msg);
    okm.set(ti, (i - 1) * HASH_LEN);
    prev = ti;
  }
  const out = new Uint8Array(length);
  out.set(okm.subarray(0, length));
  return out;
}

/** Full HKDF-SHA-256 with default zero salt. */
export function hkdfSync(
  sodium: Sodium,
  ikm: Uint8Array,
  info: string,
  length = 32,
): Uint8Array {
  return hkdfExpandSync(sodium, hkdfExtractSync(sodium, ikm), info, length);
}

export async function hkdf(
  ikm: Uint8Array,
  info: HkdfLabel | string,
  length = 32,
): Promise<Uint8Array> {
  const sodium = await ensureSodium();
  return hkdfSync(sodium, ikm, info, length);
}

/** Derive the 4 domain-separated subkeys. Each caller gets a fresh copy. */
export async function deriveRecordKey(dek: Uint8Array): Promise<Uint8Array> {
  return hkdf(dek, HKDF_LABEL_REC_ENC, 32);
}

export async function deriveLocalCredKey(dek: Uint8Array): Promise<Uint8Array> {
  return hkdf(dek, HKDF_LABEL_LOCAL_CRED, 32);
}

export async function deriveRecoveryWrapKey(
  recoverySecret: Uint8Array,
): Promise<Uint8Array> {
  return hkdf(recoverySecret, HKDF_LABEL_RECOVERY_WRAP, 32);
}

export async function deriveRecoveryAuthToken(
  recoverySecret: Uint8Array,
): Promise<Uint8Array> {
  return hkdf(recoverySecret, HKDF_LABEL_RECOVERY_AUTH, 32);
}
