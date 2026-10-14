# Implementation Plan: Cloud API, Pairing, Sync & Backups

## Objective

Build the same-origin Pages Functions API + D1 backend and the client sync/pairing/recovery/backup logic so two authorized devices converge without silent overwrites, plaintext never reaches the server, and all-devices-lost recovery works via kit.

## Scope

IN: all 9 endpoints (§11 table) per frozen `openapi.yaml`; SHA-256-hashed device tokens (raw once) + Ed25519 signatures binding method|path|timestamp|nonce-or-mutation-ID|body-SHA256 with ±5-min window, `X-Server-Time` on every response, idempotency/replay guards; 4-step pairing (ticket create → exchange → bootstrap+unlock → initial sync from cursor=0), 256-bit tickets, hash-only, 5-min expiry, single-active-ticket, atomic consume; bootstrap = master envelope + versions + `change_cursor` (no recovery envelope/device list); recovery enroll (`POST /api/v1/recovery/enroll-device`) 201 response returns `{ vault_id, device_id, device_token, recovery_envelope, created_at }` — this is the only path that delivers recovery_envelope (resolves PRD §FR-7 step 3 "downloads encrypted envelopes" plural, avoids exposing recovery material to regular-pairing devices); revocation immediate + idempotent; `crypto-metadata` atomic envelope replace + version check; sync algorithm §11 steps 1–10 (bounded pages, stable int cursor, Dexie-txn commit, `(record_id, revision, change_seq)` idempotent re-apply, CAS + `409 REVISION_CONFLICT` with server ciphertext, outbox durable until ack, 50-mutation/1-MiB-ciphertext-byte caps, no-store headers); conflict UI (Keep-local-as-new + Use-remote minimum; delete-vs-edit = manual choice per user decision; never LWW/resurrect silently); tombstones NULL-ciphertext retained (no MVP purge); App B rate limits with `429` + `Retry-After`; export/import (`personal-vault-export-YYYYMMDD.json`, preview + merge/restore choice, clean-device restore); quota-exhausted local-usable + sync-paused UX.
OUT: crypto primitives, lock/timeout, search index, PWA shell/SW, deploy. Those are siblings.

## Context

- Stack: one Cloudflare Pages project (static + Functions), D1 (dev + prod DBs separate), parameterized SQL, D1-backed rate counters (Free-plan compatible, no paid limiter), client Dexie outbox + sync engine.
- PRD: FR-4, FR-5, FR-7 (flow), §9 (headers/CSP/no-arbitrary-fetch), §10 (D1 tables), §11 (endpoints + algorithm + conflict rules), §13 (debounce, no polling), Appendices A/B.
- Consumes (read-only): foundations contract + schemas + error enum + migration v1; crypto plan's envelope/ciphertext helpers.
- User decisions: delete-vs-edit manual; auto device label + rename; pages.dev first.
- Technical defaults: custom `Authorization: PV-Device <device_id>.<ts>.<nonce>.<sig_b64u>` + body-digest check; int cursor; same `REC-ENC` subkey for outbox payloads.
- Jev verify: tier HIGH (`decision_risk` failure-impact 0.83, conf 0.66; `proceed` 0.27, `needs_human` 0.87 — below strict bar). **Needs human confirm:** signature wire format is custom (not HTTP Signatures) — confirm you accept a bespoke header (simpler, but non-standard). Proceeding with flag; builder must implement exactly the frozen header or issue a contract rev.

## Dependencies

- Requires: foundations frozen; crypto helpers (encrypt/decrypt/envelope parse) — stub with fixtures if crypto plan lags, conform on freeze.
- Blocks: `pwa-hardening-release` (needs working sync/pairing to test eviction, update, quota UX).

## Files / Areas Likely Affected

- `functions/api/v1/*` (NEW — 9 routes + auth middleware + rate-limit counters + size guards)
- `migrations/0002_*` (only if foundations v1 needs fixes; prefer zero new migrations — justify any)
- `src/sync/*` (NEW — cursor pager, outbox, batch sender, download-apply txn, conflict store)
- `src/pairing/*` (NEW — QR + manual base32 code, ticket create/exchange, bootstrap, initial sync)
- `src/devices/*`, `src/recovery/*`, `src/backup/*` (NEW — device list+revoke, enroll-device flow, export/import + preview)
- `src/components/SyncStatus*`, `src/components/ConflictDialog*` (NEW)
- `tests/sync/*`, `tests/api/*` (NEW — idempotency both directions, crash-between-write-and-cursor injection, pagination-no-skip, duplicate-mutation, quota-paused, per-endpoint 429-then-recover)

## Implementation Steps

1. Implement auth middleware (token-hash lookup, revocation check, signature verify incl. digest + window + nonce replay table, `X-Server-Time` header) + `VAULT_NOT_FOUND`-as-404 oracle rule.
2. Implement vault create + bootstrap + `crypto-metadata` (validation, size caps, version checks, atomic writes, no-plaintext-logging audit).
3. Implement pairing tickets + exchange (hash-only, expiry, single-active invalidation, atomic consume, raw-token-once) + revocation (idempotent, immediate) + recovery enroll (strictest limits, auth-token-only) exactly per FR-5 4-step sequence.
4. Implement sync endpoints (`GET sync` bounded pages + stable cursor; `POST sync/batch` token+sig + idempotency + CAS + atomic record+tombstone+change-event write + `409` payload) + App B D1 counters on all 7 limited routes.
5. Implement client sync engine (unlock → page → Dexie-txn apply → index → outbox send → ack-prune → cursor commit; crash-safe re-apply upsert; 50/1-MiB batching; backoff+jitter; retryable-vs-permanent split; pending count/last-sync/last-error/retry UI; never "synced" before ack).
6. Implement conflict UI (Keep-local-as-new with new UUID, Use-remote, delete-vs-edit manual dialog preserving editable version; merge omitted if lossy).
7. Implement export/import (encrypted-only, validate-then-preview, non-empty-vault explicit confirm, clean-device restore tested) + quota-paused mode (local usable, outbox durable).

## Acceptance Criteria

- [ ] Second device completes full 4-step pairing; ticket expires 5 min, single-use, second-ticket invalidates first; token alone decrypts nothing and cannot mutate/pair/revoke/envelope-change (negative tests).
- [ ] Revoked device gets `DEVICE_REVOKED` immediately on all endpoints.
- [ ] All-devices-lost recovery via kit restores access (enroll → bootstrap → new passphrase → resync) without wiping on failure.
- [ ] Two-device edits converge with no silent overwrite; delete-vs-edit shows manual dialog; duplicates/retries idempotent; tombstones never resurrect; pagination never skips under concurrent writes.
- [ ] Crash-between-write-and-cursor re-apply upserts cleanly (fault-injection test).
- [ ] Every App B limit returns `429 RATE_LIMITED` + `Retry-After` then recovers; UI distinguishes rate-limited from quota-exhausted.
- [ ] Oversized-record test: 256 KiB plaintext accepted, 256 KiB + 1 byte rejected identically on client and server; 384 KiB ciphertext ceiling respected; D1 row-size gate passes (verify 384 KiB fits row — lower cap + API + UI together if not).
- [ ] Export restores to clean profile via passphrase AND via recovery secret; import to non-empty never silently overwrites.

## Verification / Tests

- API: auth matrix (no-token/revoked/bad-sig/stale-ts/replay/conflict/version/cursor-invalid), size caps, per-endpoint rate-limit windows, no-plaintext-in-D1/logs assertions.
- Sync: two-client harness (concurrent edit, delete-vs-edit, retry storm, pagination under write load, quota-503 injection).
- E2E: pair → edit both → sync → conflict resolve → revoke → recover-all-lost → export/restore.

## Git (branch: feature/cloud-sync-pairing)

- Base: `main`. Builder creates branch, commits, opens PR. No self-merge.

## Integration Notes (merge order vs sibling plans, likely file overlaps)

- Merge order: **4th**, after foundations + ui-shell + crypto (needs all; may scaffold against fixtures earlier). Full order: docs-split → foundations → ui-shell → crypto → sync → pwa-release.
- Sibling overlaps: owns `functions/`, `src/sync|pairing|devices|recovery|backup/` exclusively — no other plan writes there. Reads `src/crypto/*` + contract read-only. If a D1 column is missing, request it via foundations contract rev (do not freelance a `0002` without review). `pwa-hardening-release` tests quota/eviction against this plan's sync-paused UX — freeze the `QUOTA_EXHAUSTED` vs `RATE_LIMITED` UI strings here.

## Delegation Strategy

| Step | Owner | Parallel batch | Why |
|------|-------|----------------|-----|
| 1 auth middleware | builder | — | Inline: security-critical core, needs full context |
| 2 vault+bootstrap+metadata | builder | — | Inline: same auth context as 1 |
| 3 pairing/exchange/revoke/enroll | builder | — | Inline: same device-trust context |
| 4 sync endpoints + rate limits | builder | A | Inline: API implementation, parallel to 5 |
| 5 client sync engine | builder | A | Separate `src/sync/*`, parallel to 4 |
| 6 conflict UI | designer | B | Dialog UX + a11y, after engine shapes settle |
| 7 export/import + quota UX | builder | B | Parallel to 6, separate `src/backup/*` |
| Sync/rate-limit test matrix | tester | — | Test suite (429 matrix, CAS, idempotency) after steps 4-5 |
| Auth+sync audit | reviewer | — | Read-only security review last (token-alone-negatives, log scan) |

Batch A = steps 4+5 together (builder owns both, disjoint dirs `functions/` vs `src/sync/`). Batch B = steps 6+7 together. Tester writes test suite after implementation (never writes prod API code). Reviewer read-only. Mechanical bulk work (e.g. applying `X-Server-Time`/no-store headers across routes) via one shell script inline, never split.
