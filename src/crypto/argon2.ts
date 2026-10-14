// Argon2id calibration + KEK derivation (libsodium-wrappers-sumo).
// Normative table: crypto-spec §4.1. Floor/ceiling enforced BEFORE derivation.
import { ensureSodium } from "./wasm-guard";
import { CryptoError } from "./errors";
import { KDF_VERSION } from "../lib/versions";

export const ARGON2_MIN_M_KIB = 65536; // 64 MiB floor
export const ARGON2_MIN_T = 3;
export const ARGON2_MIN_P = 1;

export const ARGON2_REC_M_KIB = 131072; // 128 MiB recommended default
export const ARGON2_REC_T = 4;
export const ARGON2_REC_P = 1;

// Mobile fallback === floor profile (64 MiB/t3/p1), selected when
// Recommended benchmark exceeds 3 s. Human-confirmed auto-fallback.
export const ARGON2_MOBILE_M_KIB = 65536;
export const ARGON2_MOBILE_T = 3;
export const ARGON2_MOBILE_P = 1;

export const ARGON2_MAX_M_KIB = 524288; // 512 MiB ceiling
export const ARGON2_MAX_T = 5;
export const ARGON2_MAX_P = 4;

export const CALIBRATION_BUDGET_MS = 3000;
export const KEK_BYTES = 32;
export const SALT_BYTES = 16;

export interface Argon2Params {
  m_kib: number;
  t: number;
  p: number;
}

export const RECOMMENDED_PROFILE: Argon2Params = {
  m_kib: ARGON2_REC_M_KIB,
  t: ARGON2_REC_T,
  p: ARGON2_REC_P,
};

export const FALLBACK_PROFILE: Argon2Params = {
  m_kib: ARGON2_MOBILE_M_KIB,
  t: ARGON2_MOBILE_T,
  p: ARGON2_MOBILE_P,
};

/** Throw CRYPTO_VERSION_UNSUPPORTED when outside [floor, ceiling]. No derivation. */
export function validateArgon2Params(m: number, t: number, p: number): void {
  if (!Number.isInteger(m) || !Number.isInteger(t) || !Number.isInteger(p)) {
    throw new CryptoError("CRYPTO_VERSION_UNSUPPORTED", "Argon2id params must be integers.");
  }
  if (m < ARGON2_MIN_M_KIB || t < ARGON2_MIN_T || p < ARGON2_MIN_P) {
    throw new CryptoError(
      "CRYPTO_VERSION_UNSUPPORTED",
      "Argon2id parameters below minimum security floor.",
    );
  }
  if (m > ARGON2_MAX_M_KIB || t > ARGON2_MAX_T || p > ARGON2_MAX_P) {
    throw new CryptoError(
      "CRYPTO_VERSION_UNSUPPORTED",
      "Argon2id parameters exceed maximum allowable ceiling.",
    );
  }
}

export function assertKdfVersion(v: number): void {
  if (v !== KDF_VERSION) {
    throw new CryptoError(
      v > KDF_VERSION ? "VERSION_MISMATCH" : "CRYPTO_VERSION_UNSUPPORTED",
      `kdf_version ${v} unsupported (expected ${KDF_VERSION}).`,
    );
  }
}

export function newSalt(): Uint8Array {
  // CSPRNG directly; sodium not required for randomness shape, but use WebCrypto
  // when available so this works even in tests before sodium.ready.
  const out = new Uint8Array(SALT_BYTES);
  crypto.getRandomValues(out);
  return out;
}

/**
 * Derive 32-byte KEK via Argon2id13. Validates floor/ceiling first so a
 * malicious envelope can never force huge allocation.
 */
export async function deriveKEK(
  passphrase: string,
  salt: Uint8Array,
  params: Argon2Params,
): Promise<Uint8Array> {
  validateArgon2Params(params.m_kib, params.t, params.p);
  if (salt.length !== SALT_BYTES) {
    throw new CryptoError("VALIDATION_ERROR", `salt must be ${SALT_BYTES} bytes.`);
  }
  const sodium = await ensureSodium();
  const pwBytes = sodium.from_string(passphrase);
  try {
    const kek = sodium.crypto_pwhash(
      KEK_BYTES,
      pwBytes,
      salt,
      params.t, // opslimit
      params.m_kib * 1024, // memlimit bytes
      sodium.crypto_pwhash_ALG_ARGON2ID13,
    );
    return new Uint8Array(kek);
  } finally {
    sodium.memzero(pwBytes);
  }
}

export interface CalibrationResult extends Argon2Params {
  elapsedMs: number;
  usedFallback: boolean;
}

/**
 * Benchmark Recommended profile; step down to Mobile Fallback when >3 s.
 * `benchmark` is injectable so tests avoid real 128 MiB derivations.
 */
export async function calibrateArgon2(
  benchmark?: () => Promise<number>,
): Promise<CalibrationResult> {
  const run =
    benchmark ??
    (async () => {
      const sodium = await ensureSodium();
      const dummySalt = new Uint8Array(SALT_BYTES);
      sodium.randombytes_buf(dummySalt);
      const pw = sodium.from_string("pv-calibration-dummy");
      const started = Date.now();
      try {
        sodium.crypto_pwhash(
          KEK_BYTES,
          pw,
          dummySalt,
          ARGON2_REC_T,
          ARGON2_REC_M_KIB * 1024,
          sodium.crypto_pwhash_ALG_ARGON2ID13,
        );
      } finally {
        sodium.memzero(pw);
        sodium.memzero(dummySalt);
      }
      return Date.now() - started;
    });
  const elapsedMs = await run();
  if (elapsedMs <= CALIBRATION_BUDGET_MS) {
    return { ...RECOMMENDED_PROFILE, elapsedMs, usedFallback: false };
  }
  return { ...FALLBACK_PROFILE, elapsedMs, usedFallback: true };
}
