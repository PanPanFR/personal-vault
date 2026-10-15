export interface SyncChange {
  change_seq: number;
  record_id: string;
  revision: number;
  schema_version: number;
  key_version: number;
  is_tombstone: boolean;
  ciphertext: string | null;
  nonce_b64u: string | null;
  updated_at: string;
}

export interface SyncPageResponse {
  changes: SyncChange[];
  next_cursor: number;
  has_more: boolean;
}

export interface MutationPayload {
  mutation_id: string;
  record_id: string;
  expected_revision: number;
  schema_version: number;
  key_version: number;
  is_tombstone: boolean;
  ciphertext: string | null;
  nonce_b64u: string | null;
}

export interface SyncBatchResult {
  mutation_id: string;
  record_id: string;
  revision: number;
  change_seq: number;
  status: "applied";
}

export interface SyncBatchResponse {
  results: SyncBatchResult[];
  new_cursor: number;
}

export interface RevisionConflictPayload {
  code: "REVISION_CONFLICT";
  message: string;
  retryable: false;
  record_id: string;
  expected_revision: number;
  server_revision: number;
  server_change_seq: number;
  server_schema_version: number;
  server_key_version: number;
  is_tombstone: boolean;
  server_ciphertext: string | null;
  server_nonce_b64u: string | null;
}

export type SyncStatusState =
  | "idle"
  | "syncing"
  | "paused_quota"
  | "rate_limited"
  | "conflict"
  | "offline"
  | "error";

export interface SyncEngineStatus {
  state: SyncStatusState;
  pendingCount: number;
  lastSyncTime: string | null;
  lastError: string | null;
  retryAfterSeconds?: number;
}
