import { type PersonalVaultDB } from "../db/dexie-schema";
import { newRecordId, newMutationId } from "../lib/ids";
import { type RevisionConflictPayload } from "./types";

export interface ConflictedItem {
  record_id: string;
  localRevision: number;
  serverRevision: number;
  localCiphertext: string | null;
  localNonce: string | null;
  serverCiphertext: string | null;
  serverNonce: string | null;
  isServerTombstone: boolean;
  isLocalTombstone: boolean;
  schemaVersion: number;
  keyVersion: number;
}

export class ConflictStore {
  private db: PersonalVaultDB;
  private pendingConflicts: Map<string, ConflictedItem> = new Map();

  constructor(db: PersonalVaultDB) {
    this.db = db;
  }

  public registerCasConflict(conflict: RevisionConflictPayload, localCiphertext: string | null, localNonce: string | null): void {
    this.pendingConflicts.set(conflict.record_id, {
      record_id: conflict.record_id,
      localRevision: conflict.expected_revision,
      serverRevision: conflict.server_revision,
      localCiphertext,
      localNonce,
      serverCiphertext: conflict.server_ciphertext,
      serverNonce: conflict.server_nonce_b64u,
      isServerTombstone: conflict.is_tombstone,
      isLocalTombstone: localCiphertext === null,
      schemaVersion: conflict.server_schema_version,
      keyVersion: conflict.server_key_version,
    });
  }

  public getConflicts(): ConflictedItem[] {
    return Array.from(this.pendingConflicts.values());
  }

  public getConflict(recordId: string): ConflictedItem | undefined {
    return this.pendingConflicts.get(recordId);
  }

  /**
   * Option 1: Keep local as a new item.
   * Creates a fresh record_id for local content (expected_revision = 0),
   * and adopts server version for original record_id.
   */
  public async resolveKeepLocalAsNew(recordId: string): Promise<{ newRecordId: string }> {
    const c = this.pendingConflicts.get(recordId);
    if (!c) throw new Error(`No conflict found for record ${recordId}`);

    const freshRecordId = newRecordId();
    const freshMutationId = newMutationId();
    const nowIso = new Date().toISOString();

    await this.db.transaction("rw", [this.db.records, this.db.outbox], async () => {
      // 1. Remove old outbox entry for original record
      await this.db.outbox.where("record_id").equals(recordId).delete();

      // 2. Put local content under newRecordId
      await this.db.records.put({
        record_id: freshRecordId,
        ciphertext: c.localCiphertext,
        nonce: c.localNonce,
        schema_version: c.schemaVersion,
        key_version: c.keyVersion,
        local_revision: 1,
        server_revision: 0,
        sync_state: "pending",
        is_deleted: c.isLocalTombstone,
        updated_at: nowIso,
      });

      // 3. Queue outbox mutation for new record
      await this.db.outbox.put({
        mutation_id: freshMutationId,
        record_id: freshRecordId,
        expected_base_revision: 0,
        action: c.isLocalTombstone ? "delete" : "upsert",
        encrypted_payload: c.localCiphertext,
        nonce: c.localNonce,
        schema_version: c.schemaVersion,
        key_version: c.keyVersion,
        created_at: nowIso,
        retry_state: "pending",
        retry_count: 0,
        error_code: null,
      });

      // 4. Adopt server state for original record
      await this.db.records.put({
        record_id: recordId,
        ciphertext: c.serverCiphertext,
        nonce: c.serverNonce,
        schema_version: c.schemaVersion,
        key_version: c.keyVersion,
        local_revision: c.serverRevision,
        server_revision: c.serverRevision,
        sync_state: "synced",
        is_deleted: c.isServerTombstone,
        updated_at: nowIso,
      });
    });

    this.pendingConflicts.delete(recordId);
    return { newRecordId: freshRecordId };
  }

  /**
   * Option 2: Use remote version.
   * Discards local outbox entry, overwrites local item with server version.
   */
  public async resolveUseRemote(recordId: string): Promise<void> {
    const c = this.pendingConflicts.get(recordId);
    if (!c) throw new Error(`No conflict found for record ${recordId}`);

    const nowIso = new Date().toISOString();

    await this.db.transaction("rw", [this.db.records, this.db.outbox], async () => {
      // Discard uncommitted local mutation
      await this.db.outbox.where("record_id").equals(recordId).delete();

      // Adopt remote version
      await this.db.records.put({
        record_id: recordId,
        ciphertext: c.serverCiphertext,
        nonce: c.serverNonce,
        schema_version: c.schemaVersion,
        key_version: c.keyVersion,
        local_revision: c.serverRevision,
        server_revision: c.serverRevision,
        sync_state: "synced",
        is_deleted: c.isServerTombstone,
        updated_at: nowIso,
      });
    });

    this.pendingConflicts.delete(recordId);
  }
}
