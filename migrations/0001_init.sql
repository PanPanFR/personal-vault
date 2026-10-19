-- Personal Vault (simple) — plaintext, single password.
--
-- Fresh-start schema. The vault is a personal, single-user store: items are
-- plaintext JSON, the whole auth model is one password (a Worker secret) and
-- opaque session tokens kept here.

CREATE TABLE IF NOT EXISTS items (
  id         TEXT PRIMARY KEY,          -- ULID, client-generated
  payload    TEXT NOT NULL,             -- full item JSON as the client uses it
  updated_at TEXT NOT NULL              -- ISO-8601, mirrors payload.updated_at
);

CREATE INDEX IF NOT EXISTS idx_items_updated_at ON items (updated_at DESC);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,          -- 32 random bytes, hex
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
