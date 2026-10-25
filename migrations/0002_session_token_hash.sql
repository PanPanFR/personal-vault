-- Store only the SHA-256 hash of a session token.
--
-- A database dump must not hand out live sessions. The previous table held the
-- raw token, so its rows cannot be converted without the original tokens:
-- rebuilding the table intentionally invalidates every existing session and
-- forces one re-login.
CREATE TABLE sessions_next (
  token_hash TEXT PRIMARY KEY,          -- SHA-256 hex of the cookie token
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

DROP TABLE sessions;
ALTER TABLE sessions_next RENAME TO sessions;

CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions (expires_at);
