// Associated Authenticated Data binding — crypto-spec §7.2.
// AAD = vault_id || record_id || schema_version || key_version || "record"
// Raw UTF-8 concatenation, no separators. Fixed-length vault_id (26) and
// record_id (36) keep MVP v1 unambiguous.
export const RECORD_AAD_PURPOSE = "record" as const;

export function constructRecordAAD(
  vaultId: string,
  recordId: string,
  schemaVersion: number,
  keyVersion: number,
  purpose = RECORD_AAD_PURPOSE,
): Uint8Array {
  const s = `${vaultId}${recordId}${schemaVersion}${keyVersion}${purpose}`;
  return new TextEncoder().encode(s);
}

export function constructRecordAADString(
  vaultId: string,
  recordId: string,
  schemaVersion: number,
  keyVersion: number,
  purpose = RECORD_AAD_PURPOSE,
): string {
  return `${vaultId}${recordId}${schemaVersion}${keyVersion}${purpose}`;
}
