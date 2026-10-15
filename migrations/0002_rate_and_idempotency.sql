-- Personal Vault D1 rate limits and idempotency tables.
-- Justification: PRD Appendix B mandates application-level rate limits on 7 endpoints
-- (vault creation, pairing-tickets, pairing-exchange, recovery-enroll, sync batch,
-- sync get, crypto-metadata) implemented via D1-backed sliding counter tables on
-- the Cloudflare free tier without paid rate-limiting add-ons. PRD §11 lines 483, 715
-- also require nonce replay detection and idempotent mutation batch retry.

CREATE TABLE IF NOT EXISTS rate_limits (
  scope TEXT NOT NULL,
  bucket_key TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (scope, bucket_key, window_start)
);

CREATE TABLE IF NOT EXISTS request_nonces (
  device_id TEXT NOT NULL,
  nonce TEXT NOT NULL,
  body_digest TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (device_id, nonce)
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  mutation_id TEXT PRIMARY KEY,
  vault_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  change_seq INTEGER NOT NULL,
  payload_digest TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- ticket_id is part of the frozen POST /pairing-tickets 201 contract
-- (openapi PairingTicketResponse) but had no column in migration 0001, so the
-- handler could only fabricate a value it never stored. Add it as a nullable
-- column plus a lookup index: existing rows stay valid, and new tickets get a
-- durable, auditable identifier.
ALTER TABLE pairing_tickets ADD COLUMN ticket_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_pairing_tickets_ticket_id
  ON pairing_tickets (ticket_id) WHERE ticket_id IS NOT NULL;
