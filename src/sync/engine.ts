import { type PersonalVaultDB } from "../db/dexie-schema";
import { SyncApiClient, type DeviceCredentials, ApiError } from "./client";
import { OutboxManager } from "./outbox";
import { applyRemoteChanges } from "./download-apply";
import { ConflictStore } from "./conflict-store";
import { type SyncEngineStatus, type SyncStatusState } from "./types";

export type StatusListener = (status: SyncEngineStatus) => void;

export class SyncEngine {
  private db: PersonalVaultDB;
  private client: SyncApiClient;
  private outbox: OutboxManager;
  public conflicts: ConflictStore;

  private state: SyncStatusState = "idle";
  private lastError: string | null = null;
  private retryAfterSeconds?: number;
  private listeners: Set<StatusListener> = new Set();
  private isRunning = false;

  constructor(db: PersonalVaultDB, client: SyncApiClient) {
    this.db = db;
    this.client = client;
    this.outbox = new OutboxManager(db);
    this.conflicts = new ConflictStore(db);
  }

  public subscribe(listener: StatusListener): () => void {
    this.listeners.add(listener);
    listener(this.getStatusSync());
    return () => this.listeners.delete(listener);
  }

  public async getStatus(): Promise<SyncEngineStatus> {
    const pendingCount = await this.outbox.getPendingCount();
    const syncMeta = await this.db.app_metadata.get("sync");
    return {
      state: this.state,
      pendingCount,
      lastSyncTime: syncMeta?.last_sync_time ?? null,
      lastError: this.lastError,
      retryAfterSeconds: this.retryAfterSeconds,
    };
  }

  private getStatusSync(): SyncEngineStatus {
    return {
      state: this.state,
      pendingCount: 0,
      lastSyncTime: null,
      lastError: this.lastError,
      retryAfterSeconds: this.retryAfterSeconds,
    };
  }

  private async notifyListeners(): Promise<void> {
    const status = await this.getStatus();
    for (const l of this.listeners) {
      l(status);
    }
  }

  /**
   * Run one complete synchronization cycle (Pull + Push).
   */
  public async sync(credentials: DeviceCredentials): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    this.state = "syncing";
    this.lastError = null;
    await this.notifyListeners();

    try {
      // 1. PULL PHASE
      await this.pullPhase(credentials);

      // 2. PUSH PHASE
      await this.pushPhase(credentials);

      if (this.conflicts.getConflicts().length > 0) {
        this.state = "conflict";
      } else {
        this.state = "idle";
      }
    } catch (err: any) {
      this.handleSyncError(err);
    } finally {
      this.isRunning = false;
      await this.notifyListeners();
    }
  }

  private async pullPhase(credentials: DeviceCredentials): Promise<void> {
    let hasMore = true;
    while (hasMore) {
      const syncMeta = await this.db.app_metadata.get("sync");
      const cursor = syncMeta?.last_sync_cursor ?? 0;

      const page = await this.client.getSync(cursor, 50, credentials);
      if (page.changes.length > 0) {
        await applyRemoteChanges(this.db, page.changes, page.next_cursor);
      }
      hasMore = page.has_more;
    }
  }

  private async pushPhase(credentials: DeviceCredentials): Promise<void> {
    while (true) {
      const { outboxRows, mutations } = await this.outbox.prepareNextBatch();
      if (mutations.length === 0) {
        break;
      }

      const mutationIds = mutations.map((m) => m.mutation_id);
      await this.outbox.markInFlight(mutationIds);

      try {
        const response = await this.client.postSyncBatch(mutations, credentials);
        await this.outbox.acknowledgeBatch(response.results);
      } catch (err: any) {
        if (err instanceof ApiError && err.code === "REVISION_CONFLICT") {
          const conflictData = err.data;
          const conflictingRow = outboxRows.find(
            (r) => r.record_id === conflictData.record_id,
          );
          this.conflicts.registerCasConflict(
            conflictData,
            conflictingRow ? conflictingRow.encrypted_payload : null,
            conflictingRow ? conflictingRow.nonce : null,
          );
          await this.outbox.resetInFlight(mutationIds, "REVISION_CONFLICT");
          throw err;
        }

        if (err instanceof ApiError && !err.retryable) {
          await this.outbox.markFailed(mutationIds, String(err.code));
        } else {
          await this.outbox.resetInFlight(mutationIds, String(err.code ?? err));
        }
        throw err;
      }
    }
  }

  private handleSyncError(err: any): void {
    if (err instanceof ApiError) {
      if (err.code === "QUOTA_EXHAUSTED") {
        this.state = "paused_quota";
        this.lastError = "Cloudflare free-tier quota exhausted. Cloud sync paused.";
        return;
      }
      if (err.code === "RATE_LIMITED") {
        this.state = "rate_limited";
        this.retryAfterSeconds = err.retryAfter ?? 60;
        this.lastError = `Rate limited. Please wait ${this.retryAfterSeconds} seconds.`;
        return;
      }
      if (err.code === "REVISION_CONFLICT") {
        this.state = "conflict";
        this.lastError = "Revision conflict detected. User resolution required.";
        return;
      }
      if (err.code === "DEVICE_REVOKED") {
        this.state = "error";
        this.lastError = "The authenticated device has been revoked.";
        return;
      }
    }

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      this.state = "offline";
      this.lastError = "Network offline.";
      return;
    }

    this.state = "error";
    this.lastError = err?.message ?? String(err);
  }
}
