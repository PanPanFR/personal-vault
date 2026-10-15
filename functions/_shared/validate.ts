export function validateMasterEnvelope(e: any): string | null {
  if (!e || typeof e !== "object") return "Master envelope must be an object";
  if (e.crypto_format_version !== 1) return "Unsupported crypto_format_version";
  if (e.kdf_version !== 1) return "Unsupported kdf_version";
  if (!Number.isInteger(e.key_version) || e.key_version < 1) return "Invalid key_version";

  const m = e.argon2_m_kib;
  const t = e.argon2_t;
  const p = e.argon2_p;

  if (!Number.isInteger(m) || m < 65536 || m > 524288) {
    return "argon2_m_kib outside allowed bounds [65536, 524288]";
  }
  if (!Number.isInteger(t) || t < 3 || t > 5) {
    return "argon2_t outside allowed bounds [3, 5]";
  }
  if (!Number.isInteger(p) || p < 1 || p > 4) {
    return "argon2_p outside allowed bounds [1, 4]";
  }

  if (typeof e.salt_b64u !== "string" || e.salt_b64u.length === 0) {
    return "salt_b64u must be a non-empty string";
  }
  if (typeof e.nonce_b64u !== "string" || e.nonce_b64u.length === 0) {
    return "nonce_b64u must be a non-empty string";
  }
  if (typeof e.wrapped_dek_b64u !== "string" || e.wrapped_dek_b64u.length === 0) {
    return "wrapped_dek_b64u must be a non-empty string";
  }

  return null;
}

export function validateRecoveryEnvelope(e: any): string | null {
  if (!e || typeof e !== "object") return "Recovery envelope must be an object";
  if (e.crypto_format_version !== 1) return "Unsupported crypto_format_version";
  if (!Number.isInteger(e.key_version) || e.key_version < 1) return "Invalid key_version";
  if (typeof e.nonce_b64u !== "string" || e.nonce_b64u.length === 0) {
    return "nonce_b64u must be a non-empty string";
  }
  if (typeof e.wrapped_dek_b64u !== "string" || e.wrapped_dek_b64u.length === 0) {
    return "wrapped_dek_b64u must be a non-empty string";
  }
  return null;
}
