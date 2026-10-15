import { type PersonalVaultDB } from "../db/dexie-schema";
import { type VaultExportData } from "./export";
import { unwrapMasterEnvelope, unwrapRecoveryEnvelope } from "../crypto/envelopes";
import { deriveLocalCredKey, deriveRecordKey } from "../crypto/hkdf";
import { setSession } from "../vault/session";
import { CIPHERTEXT_RECORD_CAP_BYTES } from "../lib/limits";
import { newRecordId, newMutationId } from "../lib/ids";

export interface ImportPreview {
  vaultId: string;
  totalRecords: number;
  toAdd: number;
  toUpdate: number;
  conflicts: number;
  isCleanDevice: boolean;
}

export function validateExportJson(raw: unknown): VaultExportData {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid export: must be a JSON object.");
  }
  const data = raw as any;
  if (data.format !== "personal-vault-export") {
    throw new Error(`Invalid format: expected 'personal-vault-export', got '${data.format}'`);
  }
  if (data.format_version !== 1) {
    throw new Error(`Unsupported format_version: ${data.format_version}`);
  }
  if (typeof data.vault_id !== "string" || !data.vault_id) {
    throw new Error("Invalid vault_id in export file.");
  }
  if (!data.crypto_metadata?.master_envelope) {
    throw new Error("Missing master_envelope in export file.");
  }
  if (!Array.isArray(data.records)) {
    throw new Error("records must be an array.");
  }

  for (const r of data.records) {
    if (!r.record_id) throw new Error("Record missing record_id.");
    if (typeof r.is_tombstone !== "boolean") throw new Error("Record missing is_tombstone boolean.");
    if (!r.is_tombstone && typeof r.ciphertext === "string") {
      if (r.ciphertext.length > CIPHERTEXT_RECORD_CAP_BYTES) {
        throw new Error(`Record ${r.record_id} exceeds 384 KiB ciphertext cap.`);
      }
    }
  }

  return data as VaultExportData;
}

export async function previewExport(
  db: PersonalVaultDB,
  data: VaultExportData,
): Promise<ImportPreview> {
  const localRecords = await db.records.toArray();
  const isCleanDevice = localRecords.length === 0;

  const localMap = new Map(localRecords.map((r) => [r.record_id, r]));
  let toAdd = 0;
  let toUpdate = 0;
  let conflicts = 0;

  for (const r of data.records) {
    const local = localMap.get(r.record_id);
    if (!local) {
      toAdd += 1;
    } else {
      if (local.sync_state === "pending" || local.server_revision !== r.revision) {
        conflicts += 1;
      } else {
        toUpdate += 1;
      }
    }
  }

  return {
    vaultId: data.vault_id,
    totalRecords: data.records.length,
    toAdd,
    toUpdate,
    conflicts,
    isCleanDevice,
  };
}

export async function restoreToCleanDevice(args: {
  db: PersonalVaultDB;
  data: VaultExportData;
  passphrase?: string;
  recoverySecret?: Uint8Array;
}): Promise<{ vaultId: string; recordCount: number }> {
  let dek: Uint8Array;

  if (args.passphrase) {
    dek = await unwrapMasterEnvelope(
      args.passphrase,
      args.data.crypto_metadata.master_envelope,
    );
  } else if (args.recoverySecret && args.data.crypto_metadata.recovery_envelope) {
    dek = await unwrapRecoveryEnvelope(
      args.recoverySecret,
      args.data.crypto_metadata.recovery_envelope,
    );
  } else {
    throw new Error("Must provide either master passphrase or recovery secret to restore.");
  }

  try {
    const localCredKey = await deriveLocalCredKey(dek);
    const recEncKey = await deriveRecordKey(dek);

    await args.db.transaction("rw", [args.db.records, args.db.app_metadata], async () => {
      await args.db.records.clear();

      for (const r of args.data.records) {
        await args.db.records.put({
          record_id: r.record_id,
          ciphertext: r.ciphertext,
          nonce: r.nonce_b64u,
          schema_version: r.schema_version,
          key_version: r.key_version,
          local_revision: r.revision,
          server_revision: r.revision,
          sync_state: "synced",
          is_deleted: r.is_tombstone,
          updated_at: r.updated_at,
        });
      }

      await args.db.app_metadata.put({
        key: "vault",
        vault_id: args.data.vault_id,
        schema_version: 1,
        crypto_format_version: args.data.crypto_metadata.crypto_format_version,
      });

      await args.db.app_metadata.put({
        key: "sync",
        last_sync_cursor: 0,
        last_sync_time: new Date().toISOString(),
      });
    });

    setSession({
      vaultId: args.data.vault_id,
      dek: dek.slice(),
      recEncKey,
      localCredKey,
      keyVersion: args.data.crypto_metadata.key_version,
      deviceToken: null,
      devicePrivateKey: null,
      lockTimeoutMinutes: 5,
      lastActivityMs: Date.now(),
    });

    return {
      vaultId: args.data.vault_id,
      recordCount: args.data.records.length,
    };
  } finally {
    dek.fill(0);
  }
}

export async function importIntoExistingVault(args: {
  db: PersonalVaultDB;
  data: VaultExportData;
  mode: "merge" | "overwrite";
}): Promise<{ importedCount: number }> {
  let importedCount = 0;
  const nowIso = new Date().toISOString();

  await args.db.transaction("rw", [args.db.records, args.db.outbox], async () => {
    if (args.mode === "overwrite") {
      await args.db.records.clear();
      await args.db.outbox.clear();

      for (const r of args.data.records) {
        await args.db.records.put({
          record_id: r.record_id,
          ciphertext: r.ciphertext,
          nonce: r.nonce_b64u,
          schema_version: r.schema_version,
          key_version: r.key_version,
          local_revision: r.revision,
          server_revision: r.revision,
          sync_state: "synced",
          is_deleted: r.is_tombstone,
          updated_at: r.updated_at,
        });
        importedCount += 1;
      }
    } else {
      // Merge mode: preserve conflicting local changes
      for (const r of args.data.records) {
        const local = await args.db.records.get(r.record_id);

        if (local && local.sync_state === "pending") {
          // Keep local as fresh record
          const freshId = newRecordId();
          await args.db.records.put({
            record_id: freshId,
            ciphertext: local.ciphertext,
            nonce: local.nonce,
            schema_version: local.schema_version,
            key_version: local.key_version,
            local_revision: 1,
            server_revision: 0,
            sync_state: "pending",
            is_deleted: local.is_deleted,
            updated_at: nowIso,
          });

          await args.db.outbox.put({
            mutation_id: newMutationId(),
            record_id: freshId,
            expected_base_revision: 0,
            action: local.is_deleted ? "delete" : "upsert",
            encrypted_payload: local.ciphertext,
            nonce: local.nonce,
            schema_version: local.schema_version,
            key_version: local.key_version,
            created_at: nowIso,
            retry_state: "pending",
            retry_count: 0,
            error_code: null,
          });
        }

        // Apply imported record to original record_id
        await args.db.records.put({
          record_id: r.record_id,
          ciphertext: r.ciphertext,
          nonce: r.nonce_b64u,
          schema_version: r.schema_version,
          key_version: r.key_version,
          local_revision: r.revision,
          server_revision: r.revision,
          sync_state: "synced",
          is_deleted: r.is_tombstone,
          updated_at: r.updated_at,
        });
        importedCount += 1;
      }
    }
  });

  return { importedCount };
}
