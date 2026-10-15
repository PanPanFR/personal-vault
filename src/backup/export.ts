import { type PersonalVaultDB } from "../db/dexie-schema";
import { exportFilename } from "../lib/limits";
import { type MasterEnvelope, type RecoveryEnvelope } from "../crypto/envelopes";

export interface VaultExportData {
  format: "personal-vault-export";
  format_version: 1;
  vault_id: string;
  exported_at: string;
  app_version: string;
  crypto_metadata: {
    crypto_format_version: number;
    key_version: number;
    master_envelope: MasterEnvelope;
    recovery_envelope: RecoveryEnvelope | null;
  };
  records: Array<{
    record_id: string;
    schema_version: number;
    key_version: number;
    revision: number;
    is_tombstone: boolean;
    ciphertext: string | null;
    nonce_b64u: string | null;
    updated_at: string;
  }>;
}

export async function exportEncryptedVault(args: {
  db: PersonalVaultDB;
  vaultId: string;
  masterEnvelope: MasterEnvelope;
  recoveryEnvelope?: RecoveryEnvelope | null;
  appVersion?: string;
}): Promise<{ json: string; filename: string; data: VaultExportData }> {
  const records = await args.db.records.toArray();

  const exportData: VaultExportData = {
    format: "personal-vault-export",
    format_version: 1,
    vault_id: args.vaultId,
    exported_at: new Date().toISOString(),
    app_version: args.appVersion ?? "1.0.0",
    crypto_metadata: {
      crypto_format_version: args.masterEnvelope.crypto_format_version,
      key_version: args.masterEnvelope.key_version,
      master_envelope: args.masterEnvelope,
      recovery_envelope: args.recoveryEnvelope ?? null,
    },
    records: records.map((r) => ({
      record_id: r.record_id,
      schema_version: r.schema_version,
      key_version: r.key_version,
      revision: r.server_revision || r.local_revision,
      is_tombstone: r.is_deleted,
      ciphertext: r.ciphertext,
      nonce_b64u: r.nonce,
      updated_at: r.updated_at,
    })),
  };

  const jsonStr = JSON.stringify(exportData, null, 2);
  const filename = exportFilename(new Date());

  return {
    json: jsonStr,
    filename,
    data: exportData,
  };
}
