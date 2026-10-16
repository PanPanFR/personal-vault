-- Personal Vault D1 initial schema (foundations freeze, contract v1).
-- Normative source: docs/data-model.md section 2.
-- No plaintext content indexes: opaque IDs, revisions, cursors, hashes, keys only.
-- Ciphertext cap per record: 384 KiB (393216 bytes) base64url string, enforced
--   in Worker validation with 413 PAYLOAD_TOO_LARGE (see docs/data-model.md,
--   "384 KiB ciphertext row fit (verified)": fits, no cap change).
PRAGMA foreign_keys = ON;

CREATE TABLE vaults (
  vault_id TEXT PRIMARY KEY,
  crypto_format_version INTEGER NOT NULL DEFAULT 1,
  kdf_version INTEGER NOT NULL DEFAULT 1,
  salt TEXT NOT NULL,
  kdf_m_kib INTEGER NOT NULL,
  kdf_t INTEGER NOT NULL,
  kdf_p INTEGER NOT NULL,
  master_nonce TEXT NOT NULL,
  master_wrapped_dek TEXT NOT NULL,
  master_key_version INTEGER NOT NULL DEFAULT 1,
  recovery_crypto_format_version INTEGER NOT NULL DEFAULT 1,
  recovery_key_version INTEGER NOT NULL DEFAULT 1,
  recovery_nonce TEXT NOT NULL,
  recovery_wrapped_dek TEXT NOT NULL,
  recovery_auth_verifier TEXT NOT NULL,
  current_change_seq INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE vault_records (
  vault_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  ciphertext TEXT,
  nonce TEXT,
  schema_version INTEGER NOT NULL DEFAULT 1,
  key_version INTEGER NOT NULL DEFAULT 1,
  revision INTEGER NOT NULL DEFAULT 1,
  change_seq INTEGER NOT NULL,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (vault_id, record_id),
  FOREIGN KEY (vault_id) REFERENCES vaults(vault_id) ON DELETE CASCADE
);

CREATE INDEX idx_vault_records_seq ON vault_records (vault_id, change_seq);

CREATE TABLE authorized_devices (
  vault_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  public_key TEXT NOT NULL,
  label TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  revoked_at TEXT,
  last_ack_cursor INTEGER,
  PRIMARY KEY (vault_id, device_id),
  FOREIGN KEY (vault_id) REFERENCES vaults(vault_id) ON DELETE CASCADE
);

CREATE INDEX idx_authorized_devices_token ON authorized_devices (token_hash);
CREATE INDEX idx_authorized_devices_vault ON authorized_devices (vault_id);

CREATE TABLE pairing_tickets (
  ticket_hash TEXT PRIMARY KEY,
  vault_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (vault_id) REFERENCES vaults(vault_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_pairing_tickets_single_active
  ON pairing_tickets (vault_id)
  WHERE consumed_at IS NULL;

CREATE TABLE sync_changes (
  vault_id TEXT NOT NULL,
  change_seq INTEGER NOT NULL,
  record_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  change_type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (vault_id, change_seq),
  FOREIGN KEY (vault_id) REFERENCES vaults(vault_id) ON DELETE CASCADE
);

CREATE INDEX idx_sync_changes_record ON sync_changes (vault_id, record_id);
