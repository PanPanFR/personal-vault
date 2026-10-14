// Master + recovery envelope create/parse/unwrap.
// Field names frozen by foundations (src/lib/schemas.ts) — DO NOT RENAME.
// Master: 9 Appendix D fields. Recovery: 4 fields + verifier stored alongside.
import { ensureSodium } from "./wasm-guard";
import { deriveKEK, validateArgon2Params, type Argon2Params } from "./argon2";
import {
  deriveRecoveryAuthToken,
  deriveRecoveryWrapKey,
} from "./hkdf";
import { b64uDecodeSync, b64uEncodeSync, sha256Hex } from "./encoding";
import { CryptoError } from "./errors";
import {
  CRYPTO_FORMAT_VERSION,
  KDF_VERSION,
  KEY_VERSION,
} from "../lib/versions";
import {
  MasterEnvelopeSchema,
  RecoveryEnvelopeSchema,
} from "../lib/schemas";

export interface MasterEnvelope {
  crypto_format_version: 1;
  key_version: number;
  kdf_version: 1;
  argon2_m_kib: number;
  argon2_t: number;
  argon2_p: number;
  salt_b64u: string;
  nonce_b64u: string;
  wrapped_dek_b64u: string;
}

export interface RecoveryEnvelope {
  crypto_format_version: 1;
  key_version: number;
  nonce_b64u: string;
  wrapped_dek_b64u: string;
}

export function parseMasterEnvelope(value: unknown): MasterEnvelope {
  const parsed = MasterEnvelopeSchema.parse(value) as MasterEnvelope;
  if (parsed.kdf_version !== KDF_VERSION) {
    throw new CryptoError(
      parsed.kdf_version > KDF_VERSION
        ? "VERSION_MISMATCH"
        : "CRYPTO_VERSION_UNSUPPORTED",
      `kdf_version ${parsed.kdf_version} unsupported.`,
    );
  }
  if (parsed.crypto_format_version !== CRYPTO_FORMAT_VERSION) {
    throw new CryptoError(
      parsed.crypto_format_version > CRYPTO_FORMAT_VERSION
        ? "VERSION_MISMATCH"
        : "CRYPTO_VERSION_UNSUPPORTED",
      "crypto_format_version unsupported.",
    );
  }
  return parsed;
}

export function parseRecoveryEnvelope(value: unknown): RecoveryEnvelope {
  const parsed = RecoveryEnvelopeSchema.parse(value) as RecoveryEnvelope;
  if (parsed.crypto_format_version !== CRYPTO_FORMAT_VERSION) {
    throw new CryptoError(
      parsed.crypto_format_version > CRYPTO_FORMAT_VERSION
        ? "VERSION_MISMATCH"
        : "CRYPTO_VERSION_UNSUPPORTED",
      "recovery crypto_format_version unsupported.",
    );
  }
  return parsed;
}

/** Wrap DEK under passphrase-derived KEK. Fresh salt + nonce per call. */
export async function createMasterEnvelope(
  passphrase: string,
  dek: Uint8Array,
  params: Argon2Params,
  keyVersion: number = KEY_VERSION,
): Promise<MasterEnvelope> {
  if (dek.length !== 32) throw new CryptoError("VALIDATION_ERROR", "DEK must be 32 bytes.");
  validateArgon2Params(params.m_kib, params.t, params.p);
  const sodium = await ensureSodium();
  const salt = sodium.randombytes_buf(16);
  const kek = await deriveKEK(
    passphrase,
    new Uint8Array(salt),
    params,
  );
  try {
    const nonce = sodium.randombytes_buf(
      sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES,
    );
    const wrapped = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
      dek,
      null,
      null,
      nonce,
      kek,
    );
    return {
      crypto_format_version: CRYPTO_FORMAT_VERSION,
      key_version: keyVersion,
      kdf_version: KDF_VERSION,
      argon2_m_kib: params.m_kib,
      argon2_t: params.t,
      argon2_p: params.p,
      salt_b64u: b64uEncodeSync(sodium, salt),
      nonce_b64u: b64uEncodeSync(sodium, nonce),
      wrapped_dek_b64u: b64uEncodeSync(sodium, wrapped),
    };
  } finally {
    sodium.memzero(kek);
  }
}

/** Unwrap DEK with passphrase. Wrong passphrase fails closed, never wipes. */
export async function unwrapMasterEnvelope(
  passphrase: string,
  envelope: MasterEnvelope,
): Promise<Uint8Array> {
  const env = parseMasterEnvelope(envelope);
  validateArgon2Params(env.argon2_m_kib, env.argon2_t, env.argon2_p);
  const sodium = await ensureSodium();
  const salt = b64uDecodeSync(sodium, env.salt_b64u);
  if (salt.length !== 16) throw new CryptoError("VALIDATION_ERROR", "Bad salt length.");
  const kek = await deriveKEK(
    passphrase,
    new Uint8Array(salt),
    { m_kib: env.argon2_m_kib, t: env.argon2_t, p: env.argon2_p },
  );
  try {
    const nonce = b64uDecodeSync(sodium, env.nonce_b64u);
    const wrapped = b64uDecodeSync(sodium, env.wrapped_dek_b64u);
    try {
      const dek = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
        null,
        wrapped,
        null,
        nonce,
        kek,
      );
      return new Uint8Array(dek);
    } catch {
      throw new CryptoError(
        "VALIDATION_ERROR",
        "Wrong passphrase or tampered envelope.",
      );
    }
  } finally {
    sodium.memzero(kek);
  }
}

export interface RecoveryBundle {
  envelope: RecoveryEnvelope;
  /** Lowercase hex SHA-256(auth token). Server stores this verifier only. */
  recovery_auth_verifier: string;
}

/** Wrap DEK under recovery secret. Raw secret/keys never leave the client. */
export async function createRecoveryEnvelope(
  dek: Uint8Array,
  recoverySecret: Uint8Array,
  keyVersion: number = KEY_VERSION,
): Promise<RecoveryBundle> {
  if (dek.length !== 32 || recoverySecret.length !== 32) {
    throw new CryptoError("VALIDATION_ERROR", "DEK and recovery secret must be 32 bytes.");
  }
  const sodium = await ensureSodium();
  const wrapKey = await deriveRecoveryWrapKey(recoverySecret);
  const authToken = await deriveRecoveryAuthToken(recoverySecret);
  try {
    const nonce = sodium.randombytes_buf(
      sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES,
    );
    const wrapped = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
      dek,
      null,
      null,
      nonce,
      wrapKey,
    );
    const verifier = (await sha256Hex(authToken)).toLowerCase();
    return {
      envelope: {
        crypto_format_version: CRYPTO_FORMAT_VERSION,
        key_version: keyVersion,
        nonce_b64u: b64uEncodeSync(sodium, nonce),
        wrapped_dek_b64u: b64uEncodeSync(sodium, wrapped),
      },
      recovery_auth_verifier: verifier,
    };
  } finally {
    sodium.memzero(wrapKey);
    sodium.memzero(authToken);
  }
}

/** Unwrap DEK with recovery secret (all-devices-lost flow). */
export async function unwrapRecoveryEnvelope(
  recoverySecret: Uint8Array,
  envelope: RecoveryEnvelope,
): Promise<Uint8Array> {
  const env = parseRecoveryEnvelope(envelope);
  if (recoverySecret.length !== 32) {
    throw new CryptoError("VALIDATION_ERROR", "Recovery secret must be 32 bytes.");
  }
  const sodium = await ensureSodium();
  const wrapKey = await deriveRecoveryWrapKey(recoverySecret);
  try {
    const nonce = b64uDecodeSync(sodium, env.nonce_b64u);
    const wrapped = b64uDecodeSync(sodium, env.wrapped_dek_b64u);
    try {
      const dek = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
        null,
        wrapped,
        null,
        nonce,
        wrapKey,
      );
      return new Uint8Array(dek);
    } catch {
      throw new CryptoError("VALIDATION_ERROR", "Bad recovery secret or tampered envelope.");
    }
  } finally {
    sodium.memzero(wrapKey);
  }
}
