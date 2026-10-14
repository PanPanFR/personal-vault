// Recovery secret + Appendix C kit file + Base32 manual fallback.
// Kit filename frozen: personal-vault-recovery-kit.json (MIME application/json).
import { ensureSodium } from "./wasm-guard";
import { b64uDecodeSync, b64uEncodeSync, base32Grouped, base32ParseGrouped } from "./encoding";
import { CryptoError } from "./errors";
import { RECOVERY_KIT_FILENAME } from "../lib/limits";
import { isVaultId } from "../lib/ids";

export const RECOVERY_KIT_FORMAT = "personal-vault-recovery-kit" as const;
export const RECOVERY_KIT_VERSION = 1 as const;
export { RECOVERY_KIT_FILENAME };

const B64U_32_RE = /^[A-Za-z0-9_-]{43}$/;

export interface RecoveryKit {
  format: typeof RECOVERY_KIT_FORMAT;
  version: typeof RECOVERY_KIT_VERSION;
  vault_id: string;
  api_origin: string;
  recovery_secret: string; // 43-char unpadded base64url of 32 bytes
  created_at: string; // ISO-8601 UTC
  instructions: string;
}

export function defaultKitInstructions(apiOrigin: string): string {
  return (
    `Open ${apiOrigin}, choose Recover, enter vault_id and recovery_secret ` +
    `(or its base32 manual code). Keep this file offline — anyone with it can recover your vault.`
  );
}

export async function generateRecoverySecret(): Promise<Uint8Array> {
  const sodium = await ensureSodium();
  return new Uint8Array(sodium.randombytes_buf(32));
}

export async function recoverySecretToB64u(secret: Uint8Array): Promise<string> {
  if (secret.length !== 32) throw new CryptoError("VALIDATION_ERROR", "Recovery secret must be 32 bytes.");
  const sodium = await ensureSodium();
  return b64uEncodeSync(sodium, secret);
}

export async function recoverySecretFromB64u(s: string): Promise<Uint8Array> {
  if (!B64U_32_RE.test(s)) throw new CryptoError("VALIDATION_ERROR", "recovery_secret must be 43-char base64url.");
  const sodium = await ensureSodium();
  const bytes = b64uDecodeSync(sodium, s);
  if (bytes.length !== 32) throw new CryptoError("VALIDATION_ERROR", "recovery_secret must decode to 32 bytes.");
  return new Uint8Array(bytes);
}

/** Manual paper-backup code: grouped Base32 (13×4). Round-trips to same bytes. */
export function recoverySecretToBase32(secret: Uint8Array): string {
  if (secret.length !== 32) throw new CryptoError("VALIDATION_ERROR", "Recovery secret must be 32 bytes.");
  return base32Grouped(secret);
}

export function recoverySecretFromBase32(code: string): Uint8Array {
  let bytes: Uint8Array;
  try {
    bytes = base32ParseGrouped(code);
  } catch {
    throw new CryptoError("VALIDATION_ERROR", "Invalid base32 recovery code.");
  }
  if (bytes.length !== 32) throw new CryptoError("VALIDATION_ERROR", "Base32 code must decode to 32 bytes.");
  return bytes;
}

export async function buildRecoveryKit(args: {
  vault_id: string;
  api_origin: string;
  recoverySecret: Uint8Array;
  created_at?: string;
}): Promise<RecoveryKit> {
  if (!isVaultId(args.vault_id)) throw new CryptoError("VALIDATION_ERROR", "vault_id must be ULID.");
  let origin: URL;
  try {
    origin = new URL(args.api_origin);
  } catch {
    throw new CryptoError("VALIDATION_ERROR", "api_origin must be a URI.");
  }
  if (origin.protocol !== "https:" && origin.protocol !== "http:") {
    throw new CryptoError("VALIDATION_ERROR", "api_origin must be http(s).");
  }
  const created_at = args.created_at ?? new Date().toISOString();
  return {
    format: RECOVERY_KIT_FORMAT,
    version: RECOVERY_KIT_VERSION,
    vault_id: args.vault_id,
    api_origin: args.api_origin,
    recovery_secret: await recoverySecretToB64u(args.recoverySecret),
    created_at,
    instructions: defaultKitInstructions(args.api_origin),
  };
}

/** Strict Appendix C validation: exact fields, no additional properties. */
export function parseRecoveryKit(value: unknown): RecoveryKit {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CryptoError("VALIDATION_ERROR", "Recovery kit must be an object.");
  }
  const v = value as Record<string, unknown>;
  const allowed = new Set([
    "format",
    "version",
    "vault_id",
    "api_origin",
    "recovery_secret",
    "created_at",
    "instructions",
  ]);
  for (const k of Object.keys(v)) {
    if (!allowed.has(k)) throw new CryptoError("VALIDATION_ERROR", `Unknown kit field: ${k}.`);
  }
  for (const k of allowed) {
    if (!(k in v)) throw new CryptoError("VALIDATION_ERROR", `Missing kit field: ${k}.`);
  }
  if (v.format !== RECOVERY_KIT_FORMAT) throw new CryptoError("VALIDATION_ERROR", "Bad kit format.");
  if (v.version !== RECOVERY_KIT_VERSION) {
    throw new CryptoError(
      typeof v.version === "number" && v.version > RECOVERY_KIT_VERSION
        ? "VERSION_MISMATCH"
        : "CRYPTO_VERSION_UNSUPPORTED",
      "Unsupported kit version.",
    );
  }
  if (!isVaultId(v.vault_id)) throw new CryptoError("VALIDATION_ERROR", "vault_id must be ULID.");
  if (typeof v.api_origin !== "string") throw new CryptoError("VALIDATION_ERROR", "api_origin must be string.");
  try {
    new URL(v.api_origin);
  } catch {
    throw new CryptoError("VALIDATION_ERROR", "api_origin must be a URI.");
  }
  if (typeof v.recovery_secret !== "string" || !B64U_32_RE.test(v.recovery_secret)) {
    throw new CryptoError("VALIDATION_ERROR", "recovery_secret must be 43-char base64url.");
  }
  if (typeof v.created_at !== "string" || Number.isNaN(Date.parse(v.created_at))) {
    throw new CryptoError("VALIDATION_ERROR", "created_at must be ISO-8601.");
  }
  if (typeof v.instructions !== "string" || v.instructions.length === 0) {
    throw new CryptoError("VALIDATION_ERROR", "instructions must be non-empty.");
  }
  return value as RecoveryKit;
}

/** Byte-for-byte canonical serialization (key order per Appendix C). */
export function serializeRecoveryKit(kit: RecoveryKit): string {
  const ordered = {
    format: kit.format,
    version: kit.version,
    vault_id: kit.vault_id,
    api_origin: kit.api_origin,
    recovery_secret: kit.recovery_secret,
    created_at: kit.created_at,
    instructions: kit.instructions,
  };
  return JSON.stringify(ordered);
}
