// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type PersonalVaultDB } from "../../src/db/dexie-schema";
import { exportEncryptedVault } from "../../src/backup/export";
import {
  validateExportJson,
  previewExport,
  restoreToCleanDevice,
  importIntoExistingVault,
} from "../../src/backup/import";
import { createVault } from "../../src/vault/lifecycle";
import { getSession, isUnlocked } from "../../src/vault/session";
import { newRecordId } from "../../src/lib/ids";

describe("Encrypted Backup & Portability Contract", { timeout: 20000 }, () => {
  let db: PersonalVaultDB;
  let cleanDb: PersonalVaultDB;

  beforeEach(() => {
    db = createDb(`test-export-db-${crypto.randomUUID()}`);
    cleanDb = createDb(`test-clean-db-${crypto.randomUUID()}`);
  });

  afterEach(async () => {
    await db.delete();
    await cleanDb.delete();
  });

  it("exports encrypted-only JSON: zero plaintext, zero recovery secrets, zero tokens", async () => {
    const passphrase = "Test-Password-123!";
    const created = await createVault({
      passphrase,
      apiOrigin: "https://personal-vault.pages.dev",
      calibrate: async () => 10,
    });

    const r1 = newRecordId();
    const r2 = newRecordId();
    await db.records.put({
      record_id: r1,
      ciphertext: "U2FsdGVkX1_ct_one",
      nonce: "nonce_1",
      schema_version: 1,
      key_version: 1,
      local_revision: 1,
      server_revision: 1,
      sync_state: "synced",
      is_deleted: false,
      updated_at: new Date().toISOString(),
    });

    await db.records.put({
      record_id: r2,
      ciphertext: null,
      nonce: null,
      schema_version: 1,
      key_version: 1,
      local_revision: 2,
      server_revision: 2,
      sync_state: "synced",
      is_deleted: true, // tombstone
      updated_at: new Date().toISOString(),
    });

    const exportResult = await exportEncryptedVault({
      db,
      vaultId: created.vaultId,
      masterEnvelope: created.masterEnvelope,
      recoveryEnvelope: created.recoveryEnvelope,
    });

    expect(exportResult.filename).toMatch(/^personal-vault-export-\d{8}\.json$/);
    const data = exportResult.data;
    expect(data.format).toBe("personal-vault-export");
    expect(data.format_version).toBe(1);
    expect(data.vault_id).toBe(created.vaultId);
    expect(data.records).toHaveLength(2);

    // Negative assertions: zero plaintext, zero secrets
    const rawJson = exportResult.json;
    expect(rawJson).not.toContain("rawToken");
    expect(rawJson).not.toContain("privateKey");
    expect(rawJson).not.toContain("device_token");
    expect(rawJson).not.toContain("recovery_secret");
    expect(rawJson).not.toContain(passphrase);
  });

  it("restores clean device using master passphrase", async () => {
    const passphrase = "Master-Passphrase-2026!";
    const created = await createVault({
      passphrase,
      apiOrigin: "https://personal-vault.pages.dev",
      calibrate: async () => 10,
    });

    const rId = newRecordId();
    await db.records.put({
      record_id: rId,
      ciphertext: "secret_ciphertext_payload",
      nonce: "nonce_val",
      schema_version: 1,
      key_version: 1,
      local_revision: 1,
      server_revision: 1,
      sync_state: "synced",
      is_deleted: false,
      updated_at: new Date().toISOString(),
    });

    const exportResult = await exportEncryptedVault({
      db,
      vaultId: created.vaultId,
      masterEnvelope: created.masterEnvelope,
      recoveryEnvelope: created.recoveryEnvelope,
    });

    // Validate payload
    const validated = validateExportJson(JSON.parse(exportResult.json));

    // Restore to clean device with passphrase
    const restoreRes = await restoreToCleanDevice({
      db: cleanDb,
      data: validated,
      passphrase,
    });

    expect(restoreRes.vaultId).toBe(created.vaultId);
    expect(restoreRes.recordCount).toBe(1);

    const restoredRec = await cleanDb.records.get(rId);
    expect(restoredRec?.ciphertext).toBe("secret_ciphertext_payload");
    expect(isUnlocked()).toBe(true);
    expect(getSession()?.vaultId).toBe(created.vaultId);
  });

  it("restores clean device using recovery secret", async () => {
    const passphrase = "Original-Passphrase!";
    const created = await createVault({
      passphrase,
      apiOrigin: "https://personal-vault.pages.dev",
      calibrate: async () => 10,
    });

    const rId = newRecordId();
    await db.records.put({
      record_id: rId,
      ciphertext: "rec_recoverable_ct",
      nonce: "rec_nonce",
      schema_version: 1,
      key_version: 1,
      local_revision: 1,
      server_revision: 1,
      sync_state: "synced",
      is_deleted: false,
      updated_at: new Date().toISOString(),
    });

    const exportResult = await exportEncryptedVault({
      db,
      vaultId: created.vaultId,
      masterEnvelope: created.masterEnvelope,
      recoveryEnvelope: created.recoveryEnvelope,
    });

    const validated = validateExportJson(JSON.parse(exportResult.json));

    // Restore using recoverySecret (without entering passphrase!)
    const restoreRes = await restoreToCleanDevice({
      db: cleanDb,
      data: validated,
      recoverySecret: created.recoverySecret,
    });

    expect(restoreRes.vaultId).toBe(created.vaultId);
    const restoredRec = await cleanDb.records.get(rId);
    expect(restoredRec?.ciphertext).toBe("rec_recoverable_ct");
    expect(isUnlocked()).toBe(true);
  });

  it("import into existing vault: preview detects conflicts, merge preserves both versions", async () => {
    const passphrase = "Passphrase-Merge-Test";
    const created = await createVault({
      passphrase,
      apiOrigin: "https://personal-vault.pages.dev",
      calibrate: async () => 10,
    });

    const recordId = newRecordId();

    // Export contains record at rev 1
    const exportData = {
      format: "personal-vault-export" as const,
      format_version: 1 as const,
      vault_id: created.vaultId,
      exported_at: new Date().toISOString(),
      app_version: "1.0.0",
      crypto_metadata: {
        crypto_format_version: 1,
        key_version: 1,
        master_envelope: created.masterEnvelope,
        recovery_envelope: created.recoveryEnvelope,
      },
      records: [
        {
          record_id: recordId,
          schema_version: 1,
          key_version: 1,
          revision: 1,
          is_tombstone: false,
          ciphertext: "imported_version_ct",
          nonce_b64u: "nonce_import",
          updated_at: new Date().toISOString(),
        },
      ],
    };

    // Existing vault has uncommitted local edit on same record (conflict!)
    await db.records.put({
      record_id: recordId,
      ciphertext: "local_uncommitted_ct",
      nonce: "nonce_local",
      schema_version: 1,
      key_version: 1,
      local_revision: 2,
      server_revision: 1,
      sync_state: "pending",
      is_deleted: false,
      updated_at: new Date().toISOString(),
    });

    // Preview
    const preview = await previewExport(db, exportData);
    expect(preview.conflicts).toBe(1);
    expect(preview.isCleanDevice).toBe(false);

    // Merge import
    await importIntoExistingVault({
      db,
      data: exportData,
      mode: "merge",
    });

    // Original record_id adopted imported version
    const orig = await db.records.get(recordId);
    expect(orig?.ciphertext).toBe("imported_version_ct");

    // Conflicting local edit was preserved as a fresh pending item!
    const allRecords = await db.records.toArray();
    expect(allRecords).toHaveLength(2);
    const preservedLocal = allRecords.find((r) => r.ciphertext === "local_uncommitted_ct");
    expect(preservedLocal).toBeTruthy();
    expect(preservedLocal?.record_id).not.toBe(recordId);
    expect(preservedLocal?.sync_state).toBe("pending");
  });
});
