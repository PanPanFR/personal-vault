import { type PersonalVaultDB } from "../db/dexie-schema";
import { type SyncChange } from "./types";

export interface ApplyResult {
  appliedCount: number;
  conflicts: SyncChange[];
}

/**
 * Idempotently applies a downloaded changes page to Dexie within a single transaction.
 * Idempotency invariant: keyed by (record_id, revision, change_seq), safe on re-apply.
 */
export async function applyRemoteChanges(
  db: PersonalVaultDB,
  changes: SyncChange[],
  nextCursor: number,
): Promise<ApplyResult> {
  const conflicts: SyncChange[] = [];
  let appliedCount = 0;

  await db.transaction("rw", [db.records, db.app_metadata], async () => {
    for (const c of changes) {
      const local = await db.records.get(c.record_id);

      if (local && local.sync_state === "pending" && local.server_revision !== c.revision) {
        // Local has uncommitted changes made on an older revision: conflict!
        conflicts.push(c);
        await db.records.put({
          ...local,
          sync_state: "conflict",
        });
        continue;
      }

      // Monotonic revision guard. A stale or reordered page must never move a
      // record backwards, and a tombstone must never be resurrected by an
      // older non-tombstone revision ("deleted never returns", sync-protocol
      // section 3.2). Tombstone wins ties so a delete is never undone.
      if (local && c.revision < local.server_revision) {
        continue;
      }
      if (local && c.revision === local.server_revision && local.is_deleted && !c.is_tombstone) {
        continue;
      }

      // Safe deterministic upsert
      await db.records.put({
        record_id: c.record_id,
        ciphertext: c.ciphertext,
        nonce: c.nonce_b64u,
        schema_version: c.schema_version,
        key_version: c.key_version,
        local_revision: c.revision,
        server_revision: c.revision,
        sync_state: "synced",
        is_deleted: c.is_tombstone,
        updated_at: c.updated_at,
      });
      appliedCount += 1;
    }

    // Advance cursor atomically in same transaction
    const syncMeta = await db.app_metadata.get("sync");
    await db.app_metadata.put({
      ...(syncMeta || {}),
      key: "sync",
      last_sync_cursor: nextCursor,
      last_sync_time: new Date().toISOString(),
    });
  });

  return { appliedCount, conflicts };
}
