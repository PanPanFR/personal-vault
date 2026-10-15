import { type PersonalVaultDB, type OutboxRow } from "../db/dexie-schema";
import { type MutationPayload, type SyncBatchResult } from "./types";

const MAX_BATCH_MUTATIONS = 50;
const MAX_BATCH_BYTES = 1024 * 1024; // 1 MiB

export class OutboxManager {
  private db: PersonalVaultDB;

  constructor(db: PersonalVaultDB) {
    this.db = db;
  }

  public async getPendingCount(): Promise<number> {
    return this.db.outbox
      .where("retry_state")
      .anyOf(["pending", "in_flight"])
      .count();
  }

  /**
   * Slices the next batch conforming to protocol caps:
   * at most 50 mutations and at most 1 MiB total ciphertext payload.
   */
  public async prepareNextBatch(): Promise<{
    outboxRows: OutboxRow[];
    mutations: MutationPayload[];
  }> {
    const pending = await this.db.outbox
      .where("retry_state")
      .anyOf(["pending", "in_flight"])
      .sortBy("created_at");

    const selectedRows: OutboxRow[] = [];
    const selectedMutations: MutationPayload[] = [];
    let totalBytes = 0;

    for (const row of pending) {
      if (selectedMutations.length >= MAX_BATCH_MUTATIONS) {
        break;
      }

      const ctBytes = row.encrypted_payload ? row.encrypted_payload.length : 0;
      if (totalBytes + ctBytes > MAX_BATCH_BYTES && selectedMutations.length > 0) {
        break;
      }

      totalBytes += ctBytes;
      selectedRows.push(row);
      selectedMutations.push({
        mutation_id: row.mutation_id,
        record_id: row.record_id,
        expected_revision: row.expected_base_revision,
        schema_version: row.schema_version,
        key_version: row.key_version,
        is_tombstone: row.action === "delete",
        ciphertext: row.encrypted_payload,
        nonce_b64u: row.nonce,
      });
    }

    return { outboxRows: selectedRows, mutations: selectedMutations };
  }

  /**
   * Mark rows in-flight before network push.
   */
  public async markInFlight(mutationIds: string[]): Promise<void> {
    await this.db.transaction("rw", this.db.outbox, async () => {
      for (const id of mutationIds) {
        const row = await this.db.outbox.get(id);
        if (row) {
          await this.db.outbox.put({
            ...row,
            retry_state: "in_flight",
            retry_count: row.retry_count + 1,
          });
        }
      }
    });
  }

  /**
   * Atomically remove acknowledged mutations and mark corresponding records synced.
   */
  public async acknowledgeBatch(results: SyncBatchResult[]): Promise<void> {
    await this.db.transaction("rw", [this.db.outbox, this.db.records], async () => {
      for (const res of results) {
        await this.db.outbox.delete(res.mutation_id);

        const rec = await this.db.records.get(res.record_id);
        if (rec) {
          await this.db.records.put({
            ...rec,
            server_revision: res.revision,
            local_revision: res.revision,
            sync_state: "synced",
          });
        }
      }
    });
  }

  /**
   * Reset in-flight mutations back to pending on retryable failure.
   */
  public async resetInFlight(mutationIds: string[], errorCode?: string): Promise<void> {
    await this.db.transaction("rw", this.db.outbox, async () => {
      for (const id of mutationIds) {
        const row = await this.db.outbox.get(id);
        if (row) {
          await this.db.outbox.put({
            ...row,
            retry_state: "pending",
            error_code: errorCode ?? row.error_code,
          });
        }
      }
    });
  }

  /**
   * Mark permanently failed mutations.
   */
  public async markFailed(mutationIds: string[], errorCode: string): Promise<void> {
    await this.db.transaction("rw", this.db.outbox, async () => {
      for (const id of mutationIds) {
        const row = await this.db.outbox.get(id);
        if (row) {
          await this.db.outbox.put({
            ...row,
            retry_state: "failed",
            error_code: errorCode,
          });
        }
      }
    });
  }
}
