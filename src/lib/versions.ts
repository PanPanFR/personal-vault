export const SCHEMA_VERSION = 1 as const;
export const CRYPTO_FORMAT_VERSION = 1 as const;
export const KDF_VERSION = 1 as const;
export const KEY_VERSION = 1 as const;

export type VersionName =
  | "schema_version"
  | "crypto_format_version"
  | "kdf_version"
  | "key_version";

const MAX_SUPPORTED: Record<VersionName, number> = {
  schema_version: 1,
  crypto_format_version: 1,
  kdf_version: 1,
  key_version: 1,
};

export function assertVersionSupported(name: VersionName, found: number): void {
  const supported = MAX_SUPPORTED[name];
  if (typeof found !== "number" || !Number.isInteger(found) || found < 1) {
    throw new Error(`INVALID_VERSION: ${name}=${found}`);
  }
  if (found > supported) {
    throw new Error(`VERSION_MISMATCH: ${name} ${found} > ${supported} (please update the app)`);
  }
}

export function assertNoDowngrade(name: VersionName, next: number, current: number): void {
  if (next < current) {
    throw new Error(`VERSION_DOWNGRADE: ${name} ${next} < ${current}`);
  }
  assertVersionSupported(name, next);
}
