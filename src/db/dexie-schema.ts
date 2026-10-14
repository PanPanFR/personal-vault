import Dexie, { type Table } from "dexie";

export interface RecordRow {
  record_id: string;
  ciphertext: string | null;
  nonce: string | null;
  schema_version: number;
  key_version: number;
  local_revision: number;
  server_revision: number;
  sync_state: "synced" | "pending" | "conflict";
  is_deleted: boolean;
  updated_at: string;
}
export interface OutboxRow {
  mutation_id: string;
  record_id: string;
  expected_base_revision: number;
  action: "upsert" | "delete";
  encrypted_payload: string | null;
  nonce: string | null;
  schema_version: number;
  key_version: number;
  created_at: string;
  retry_state: "pending" | "in_flight" | "failed";
  retry_count: number;
  error_code: string | null;
}
export interface DeviceCredentialsRow {
  device_id: string;
  encrypted_device_token: string;
  encrypted_private_key: string;
  nonce: string;
  public_key: string;
  label: string;
}
export interface AppMetadataRow {
  key: string;
  vault_id?: string;
  schema_version?: number;
  crypto_format_version?: number;
  last_sync_cursor?: number;
  last_sync_time?: string | null;
  lock_timeout_minutes?: number;
  theme?: "system" | "light" | "dark";
}

export class PersonalVaultDB extends Dexie {
  records!: Table<RecordRow, string>;
  outbox!: Table<OutboxRow, string>;
  device_credentials!: Table<DeviceCredentialsRow, string>;
  app_metadata!: Table<AppMetadataRow, string>;

  constructor(name = "personal-vault") {
    super(name);
    this.version(1).stores({
      records: "record_id, local_revision, server_revision, sync_state, updated_at",
      outbox: "mutation_id, record_id, created_at, retry_state, error_code",
      device_credentials: "device_id",
      app_metadata: "key",
    });
  }
}

export function createDb(name?: string): PersonalVaultDB {
  return new PersonalVaultDB(name);
}
