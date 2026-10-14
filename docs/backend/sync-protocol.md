# Personal Vault — Synchronization Protocol Specification

> **Normative Source Notice**  
> This document specifies the authoritative synchronization protocol, concurrency control, and conflict resolution mechanisms for Personal Vault.  
> Derived directly from `personal-vault-prd-v3.md` v3.0 (2026-10-13): specifically §8 (FR-3 Local-first persistence, FR-4 Encrypted cloud synchronization, FR-5 Device authorization), §10 (Data model), §11 (API and synchronization protocol), Appendix A (Stable error codes), Appendix B (Application-level rate limits), and Appendix D (Crypto/format versions).  
> **Precedence:** On any ambiguity or conflict between this document and the PRD, the **PRD WINS**. Any unresolved implementation ambiguity is tracked in the Open Questions Register (`docs/product/acceptance.md`).

---

## 1. Architectural Foundations & Invariants

*Citations: PRD §2 (Firm decisions), §8 (FR-1, FR-4, FR-5), §9 (Security model), §10 (Data model), §11 (API & sync protocol), Appendix D.*

Personal Vault uses a **local-first, zero-knowledge, encrypted cloud synchronization protocol**. The central Cloudflare Workers API and Cloudflare D1 database act as an untrusted, highly available relay and durable append-only change log.

```
+-----------------------------------------------------------------------------------+
| CLIENT DEVICE (Unlocked)                                                          |
|                                                                                   |
|  [ In-Memory Search / Decrypted Plaintext ]  (Cleared on lock / inactivity)       |
|                       ^                                                           |
|                       | Decrypt / Encrypt (DEK via XChaCha20-Poly1305)            |
|                       v                                                           |
|  [ IndexedDB: records ] <====== Dexie.js Transaction ======> [ IndexedDB: outbox ] |
|  (Encrypted ciphertext)                                      (Pending mutations)  |
+----------------------------------------+------------------------------------------+
                                         |
                       HTTPS Wire Sync   |  1. Pull: GET /api/v1/sync?cursor=N
                       (Ciphertext Only) |  2. Push: POST /api/v1/sync/batch
                                         v
+-----------------------------------------------------------------------------------+
| CLOUDFLARE EDGE (Untrusted Server)                                                |
|                                                                                   |
|  Workers API:                                                                     |
|    - Validates Bearer Token Hash & Ed25519 Request Signature                      |
|    - Checks Request Timestamp Skew (±5 minutes)                                   |
|    - Verifies Compare-And-Swap (CAS) Revisions                                    |
|    - Enforces Batch & Ciphertext Caps (50 mutations / 1 MiB / 384 KiB)            |
|                                                                                   |
|  Cloudflare D1 Storage:                                                           |
|    - vaults          (Encrypted key envelopes, change sequence)                   |
|    - vault_records   (Encrypted records, integer revisions, tombstone flags)      |
|    - sync_changes    (Append-only change log: monotonic change_seq)               |
+-----------------------------------------------------------------------------------+
```

### 1.1 The Zero-Plaintext Storage Invariant (PRD §FR-4, §9, §10)
- The API and D1 database store only opaque identifiers, integer revisions, monotonic cursors, cryptographic envelopes, and encrypted ciphertext blobs.
- Under no circumstances does the server receive or store plaintext item titles, URLs, descriptions, notes, snippets, usernames, passwords, tags, search queries, master passphrases, raw recovery secrets, or decrypted device private keys.
- Server-side indexes on item content are strictly prohibited. SQL indexes exist solely for vault-scoped cursor pagination, record lookups, and device authentication.

### 1.2 Frozen Protocol Identifiers (PRD §10, §FR-1, §FR-4, §FR-5, Appendix C)

| Identifier | Type | Representation | Generation & Invariant |
|---|---|---|---|
| `vault_id` | ULID | 26-character Crockford Base32 string | Generated client-side at vault initialization (e.g., `01J9Z8QK7M3V6P2R5T8W4Y6U1A`). Opaque; not an authentication secret alone. |
| `record_id` | UUIDv4 | 36-character canonical lowercase hex UUID | Generated client-side per item. Persists across all revisions until deletion. |
| `device_id` | UUIDv4 | 36-character canonical lowercase hex UUID | Generated client-side during device registration/pairing. Binds Ed25519 public key. |
| `mutation_id` | UUIDv4 | 36-character canonical lowercase hex UUID | Generated client-side per mutation in outbox. Enforces idempotent push operations. |
| Pairing Ticket | 256-bit entropy | Grouped Base32 string / QR payload | Ephemeral one-time pairing secret. 5-minute TTL; single-use atomic consumption. |
| Clock Skew Window | Duration | `±5 minutes` (300 seconds) | Acceptable client-to-server clock drift. Server emits `X-Server-Time` header. |

### 1.3 Size Limits & Capacity Budgets (PRD §FR-1, §FR-4, Appendix B)

| Metric | Bound | Scope | Enforcement Point |
|---|---|---|---|
| Plaintext Item Payload | **256 KiB** (262,144 bytes) | UTF-8 JSON per record | Client validates pre-encryption; rejects oversized input without truncation. |
| Ciphertext Record Envelope | **384 KiB** (393,216 bytes) | Base64url ciphertext string | API & D1 schema validation. Accommodates ~33–40% AEAD expansion. |
| Sync Batch Mutation Count | **50 mutations** | Per `POST /api/v1/sync/batch` | API validates array length <= 50; rejects with `413 PAYLOAD_TOO_LARGE`. |
| Sync Batch Request Body | **1 MiB** (1,048,576 bytes) | Total HTTP body ciphertext bytes | API validates Content-Length and parsed body; rejects with `413 PAYLOAD_TOO_LARGE`. |
| Batch Push Rate Limit | **120 requests / hr** | Per vault | Worker sliding window counter. Exceeding returns `429 RATE_LIMITED`. |
| Incremental Pull Rate Limit | **300 requests / hr** | Per vault | Worker sliding window counter. Clients must debounce and never poll aggressively. |

---

## 2. Concurrency Control & State Primitives

*Citations: PRD §FR-4 (Encrypted cloud synchronization), §10 (Data model), §11 (Sync algorithm & conflict rules).*

### 2.1 Revision-Based Optimistic Concurrency Control (OCC)
- Every record maintains a server-assigned monotonic integer `revision` starting at `1` upon initial creation.
- Every client mutation payload includes `expected_revision`:
  - For **new record creation**: `expected_revision = 0`.
  - For **record updates**: `expected_revision = current_local_revision` (the base revision on which changes were made).
  - For **record deletion (tombstone)**: `expected_revision = current_local_revision`.
- The server evaluates mutations via atomic **Compare-And-Swap (CAS)**:
  - If `expected_revision == current_db_revision`, the mutation commits, and the server increments `revision = revision + 1`.
  - If `expected_revision != current_db_revision`, the CAS check fails, and the server returns `409 Conflict` (`REVISION_CONFLICT`).
- **No Last-Write-Wins (LWW):** Blind overwrites of user content are strictly prohibited. Conflicting edits are detected at the CAS boundary and preserved for user review.

### 2.2 Append-Only Monotonic Sync Cursor (`change_seq`)
- The server maintains a strictly monotonic sequence counter `change_seq` (signed 64-bit integer, >= 0) per vault, recorded in the `sync_changes` table.
- Every successfully committed record creation, update, or deletion inserts a row into `sync_changes` with the next vault sequence number.
- Pagination is cursor-based: `GET /api/v1/sync?cursor=<last_seen_seq>&limit=50`.
- The cursor guarantees that clients fetch changes strictly greater than `cursor`. Because sequence numbers are immutable and append-only, pagination cannot skip updates or deliver duplicate events during concurrent writes.
- Initial sync starts at `cursor = 0`.

### 2.3 Idempotency Keys (`mutation_id`) & Replay Defense
- Every change generated on a client is assigned a unique `mutation_id` (UUIDv4) upon being queued in the IndexedDB `outbox`.
- If a network partition or timeout occurs after the server commits a batch but before the client receives the `200 OK` response, the client retries the batch with the exact same `mutation_id`s.
- **Identical Retry:** Submitting an identical mutation with the same `mutation_id` and matching payload must return the original success response rather than generating a new revision or triggering a conflict.
- **Replay Detection:** Submitting a reused `mutation_id` with a different payload constitutes an invalid replay and returns `409 Conflict` with code `REPLAY_DETECTED` (PRD Appendix A).

> Open question Q5: see Open Questions Register in `docs/product/acceptance.md`.

---

## 3. Tombstones & Deletion Lifecycle

*Citations: PRD §FR-4 (line 207), §10 (D1 tables), §11 (lines 472, 481–486).*

### 3.1 Tombstone Representation
Deletions in Personal Vault are explicit tombstone records. They represent the permanent removal of record content while preserving version history to propagate deletion across all authorized devices.

- **Wire & Storage Payload:**
  - `is_tombstone`: `true`
  - `ciphertext`: `null` (or empty string; no plaintext or residual encrypted content remains)
  - `nonce_b64u`: `null`
  - `schema_version`: `1` (or current active schema version)
  - `key_version`: `1` (or current active key version)
  - `revision`: Incremented by 1 via standard CAS logic
  - `updated_at`: Current server commit timestamp (ISO-8601 UTC)

### 3.2 "Deleted Never Returns" Invariant
- A record that has been marked as a tombstone on the server must never be silently resurrected by a stale or offline client.
- When an authorized device downloads a tombstone change event, it marks the local record as a tombstone in IndexedDB and removes the item from the decrypted search index.
- If an offline client modifies a record that was concurrently deleted on the server, the mutation submission will trigger a CAS revision conflict (see §6.3). The conflict resolution flow preserves the edited version and presents the conflict to the user; it never silently deletes the edit or silently resurrects the record without user confirmation.

### 3.3 MVP Tombstone Retention Policy
- **No Garbage Collection in MVP:** Tombstones are retained indefinitely in D1 and IndexedDB throughout MVP v1.
- PRD §FR-4 line 207 and §11 line 485 explicitly mandate:
  > "Keep tombstones in the MVP. Tombstone garbage collection is post-MVP and requires a tested policy for inactive/revoked devices and old backups."

---

## 4. End-to-End Synchronization Algorithm

*Citations: PRD §11 (Sync algorithm, steps 1–10), §FR-4, §FR-5, §FR-6, Appendix A.*

The synchronization cycle is divided into a **Pull Phase** (downloading remote changes) followed by a **Push Phase** (submitting local outbox mutations).

```
                      THE 10-STEP SYNC ALGORITHM
                      
   +-------------------------------------------------------------+
   | Step 1: User Unlocks Vault (Argon2id -> KEK -> DEK unwrap)   |
   +------------------------------+------------------------------+
                                  |
                                  v
+-------------------------------------------------------------------+
| PULL PHASE (Download Remote Changes)                              |
|                                                                   |
| Step 2: Client calls GET /api/v1/sync?cursor=<last_durable_cursor> |
|                                                                   |
| Step 3: Client applies changes to IndexedDB records store         |
|         (Idempotent upsert keyed by record_id, rev, change_seq)    |
|         Advances last_durable_cursor in Dexie transaction         |
|                                                                   |
| Step 4: Client decrypts records and updates in-memory search      |
+---------------------------------+---------------------------------+
                                  |
                                  v
+-------------------------------------------------------------------+
| PUSH PHASE (Upload Pending Outbox Mutations)                      |
|                                                                   |
| Step 5: Client gathers outbox mutations (max 50 or 1 MiB body)    |
|         Generates Ed25519 signature over HTTP request             |
|         Calls POST /api/v1/sync/batch                             |
|                                                                   |
| Step 6: Worker verifies token hash, signature, timestamp, bounds  |
|                                                                   |
| Step 7: Worker executes atomic CAS checks in D1:                  |
|         - If expected_revision == current_revision:               |
|             Commit records, bump revision, insert sync_changes.   |
|         - If expected_revision != current_revision:               |
|             Roll back, return 409 REVISION_CONFLICT + server state|
|                                                                   |
| Step 8: Client receives 200 OK: removes ACKed outbox mutations    |
+---------------------------------+---------------------------------+
                                  |
        +-------------------------+-------------------------+
        |                                                   |
 (On 409 Conflict)                                   (On Success)
        v                                                   v
+------------------------------------+    +------------------------------------+
| Step 9: Conflict Handling          |    | Step 10: Commit Cursor & Ensure    |
| - Preserve local & remote versions |    |          Bidirectional Idempotency |
| - User selects resolution action   |    +------------------------------------+
+------------------------------------+
```

### Step 1: Vault Unlock & Local Credential Initialization
- The user enters the master passphrase.
- The client derives the KEK using Argon2id13 with the envelope parameters stored in `app_metadata`.
- The client unwraps the DEK using XChaCha20-Poly1305.
- The client derives the local credential key (`PV-V1/LOCAL-CRED`) via HKDF-SHA-256 and decrypts the device bearer token and Ed25519 private signing key from the `device_credentials` IndexedDB store into memory.
- The in-memory search index is initialized.

### Step 2: Fetch Remote Changes Page (`GET /api/v1/sync`)
- Client reads `last_sync_cursor` from `app_metadata` (defaults to `0` on first sync).
- Client issues request:
  ```http
  GET /api/v1/sync?cursor=42&limit=50 HTTP/1.1
  Host: <api-origin>
  Authorization: Bearer <device_bearer_token>
  ```
- Cloudflare Worker verifies the device token hash against `authorized_devices`. If valid, it queries `sync_changes` joined with `vault_records` for changes where `change_seq > 42` ordered by `change_seq ASC LIMIT 50`.
- Server responds with `200 OK` containing `changes`, `next_cursor`, and `has_more`.

### Step 3: Idempotent Local Storage & Cursor Advance (PRD §FR-4, G6)
- The client receives the page of changes (ciphertext records and tombstones).
- Within a single Dexie.js transaction:
  1. For each change, the client upserts into the `records` store keyed by `record_id`.
  2. If the change is a tombstone (`is_tombstone: true`), the local record is marked deleted/tombstoned.
  3. The client updates `last_sync_cursor = next_cursor` in `app_metadata`.
- **Idempotency Guarantee:** Applying changes is keyed by `(record_id, revision, change_seq)`. If the client crashes before committing the cursor, re-fetching and re-applying the same page performs a safe upsert without duplication or corruption.
- If `has_more == true`, repeat Steps 2–3 until all remote change pages are consumed.

### Step 4: Decrypt Records & Refresh In-Memory Search Index
- For each updated or created record, the client decrypts the payload using the DEK and XChaCha20-Poly1305.
- The client validates that the AAD matches:
  `vault_id || record_id || schema_version || key_version || "record"`.
- If AAD verification succeeds, the decrypted fields (title, URL, notes, snippets, tags) are ingested into the in-memory search index.
- If AAD verification fails, decryption fails closed; the record is marked corrupted in memory and never indexed.

### Step 5: Batch Outbox Mutation Preparation & Request Signing
- The client inspects the IndexedDB `outbox` for pending mutations.
- The client slices an upload batch conforming to protocol caps:
  - At most **50 mutations**.
  - Total request body size must not exceed **1 MiB** (counted in ciphertext bytes).
  - Individual record ciphertext must not exceed **384 KiB**.
- The client generates an Ed25519 request signature over the HTTP method, path, UTC timestamp, request nonce, and SHA-256 body digest:
  ```
  SigPayload = "POST" || "\n" ||
               "/api/v1/sync/batch" || "\n" ||
               TimestampISO || "\n" ||
               NonceHex || "\n" ||
               SHA256Hex(RequestBody)
  ```
- Client dispatches `POST /api/v1/sync/batch` with `Authorization: Bearer <token>` and `PV-Device: device_id="...", timestamp="...", nonce="...", signature="..."`.

### Step 6: Worker Request Verification & Boundary Enforcement
- Worker inspects headers and verifies:
  1. **Bearer Token:** Computes `SHA-256(raw_token)` and looks up `authorized_devices`. Ensures device exists and `revoked_at IS NULL`.
  2. **Clock Skew:** Verifies `|server_now - timestamp| <= 5 minutes`. If skewed, returns `401 STALE_TIMESTAMP`.
  3. **Signature:** Verifies the Ed25519 signature against the device's registered public key and the computed SHA-256 body digest. If invalid, returns `401 INVALID_SIGNATURE`.
  4. **Payload Caps:** Verifies `mutations.length <= 50`, `body_bytes <= 1 MiB`, and each `ciphertext <= 384 KiB`. If violated, returns `413 PAYLOAD_TOO_LARGE`.
  5. **Rate Limits:** Verifies rolling hourly batch budget (120 req/hr). If exceeded, returns `429 RATE_LIMITED`.

### Step 7: Atomic Compare-And-Swap (CAS) in D1
- Within an atomic D1 transaction, the Worker processes each mutation in the batch:
  1. Queries the current record in `vault_records` for `record_id`.
  2. Verifies `expected_revision`:
     - If record does not exist: requires `expected_revision == 0`.
     - If record exists: requires `expected_revision == current_revision`.
  3. **On Revision Mismatch:** Transaction rolls back immediately. Worker returns `409 Conflict` with code `REVISION_CONFLICT` containing the conflicting record's current server revision, ciphertext, and envelope metadata (see §6.2).
  4. **On CAS Match:**
     - Upserts into `vault_records` with `revision = expected_revision + 1`, new ciphertext/tombstone, and server timestamp.
     - Increments the vault's sequence counter.
     - Inserts an append-only row into `sync_changes` with the new `change_seq`.

### Step 8: Client Acknowledgment & Outbox Drainage
- Upon receiving `200 OK` from `POST /api/v1/sync/batch`:
  ```json
  {
    "results": [
      {
        "mutation_id": "e6a2b8e3-0d3e-4b67-891a-7b3c2e1d0f5a",
        "record_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
        "revision": 2,
        "change_seq": 45,
        "status": "applied"
      }
    ],
    "new_cursor": 45
  }
  ```
- In an atomic Dexie transaction:
  1. The client deletes acknowledged mutations from the `outbox` store matching the returned `mutation_id`s.
  2. The client updates the local record's `last_known_server_revision` and sync state to `synced`.
- Unacknowledged mutations remain durable in the outbox.

### Step 9: Conflict Handling & User Resolution
- If the batch returns `409 REVISION_CONFLICT`, the client extracts the server's conflicting state.
- Both versions are preserved locally: the client retains the uncommitted local edit in the outbox and stores the remote version as conflicting.
- The UI presents the conflict resolution interface (see §6 for resolution rules).

### Step 10: Cursor Commitment & Bidirectional Idempotency
- The client commits any updated cursor value.
- Re-executing pull requests or re-submitting previously processed mutation batches is completely safe:
  - Download apply is idempotent via `(record_id, revision, change_seq)` upserts.
  - Upload mutations are idempotent via `mutation_id` deduplication.

> Open question Q7: see Open Questions Register in `docs/product/acceptance.md`.

> Open question Q7: see Open Questions Register in `docs/product/acceptance.md`.

---

## 5. Wire Payloads & Schema Contracts

*Citations: PRD §11 (Endpoint behaviors), Appendix A (Error codes), Appendix B (Rate limits).*

### 5.1 Remote Changes Pull: `GET /api/v1/sync`

#### Request
```http
GET /api/v1/sync?cursor=42&limit=50 HTTP/1.1
Host: vault.example.com
Authorization: Bearer a8f9...32_bytes_base64url...
Accept: application/json
```

#### Response `200 OK`
```json
{
  "changes": [
    {
      "change_seq": 43,
      "record_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
      "revision": 1,
      "schema_version": 1,
      "key_version": 1,
      "is_tombstone": false,
      "ciphertext": "U2FsdGVkX1+vupppZksvRf5pq5g5XjFRIipRRM0NZGs...",
      "nonce_b64u": "dGhpcy1pcy1hLTI0LWJ5dGUtbm9uY2U",
      "updated_at": "2026-10-13T12:05:00.000Z"
    },
    {
      "change_seq": 44,
      "record_id": "4a2b9184-25e2-4f36-9e1e-28b3a72013f9",
      "revision": 4,
      "schema_version": 1,
      "key_version": 1,
      "is_tombstone": true,
      "ciphertext": null,
      "nonce_b64u": null,
      "updated_at": "2026-10-13T12:06:00.000Z"
    }
  ],
  "next_cursor": 44,
  "has_more": false
}
```

### 5.2 Batch Mutations Push: `POST /api/v1/sync/batch`

#### Request
```http
POST /api/v1/sync/batch HTTP/1.1
Host: vault.example.com
Content-Type: application/json; charset=utf-8
Authorization: Bearer a8f9...32_bytes_base64url...
PV-Device: device_id="550e8400-e29b-41d4-a716-446655440000", timestamp="2026-10-13T12:06:30.000Z", nonce="f81d4fae-7dec-11d0-a765-00a0c91e6bf6", signature="K8zN...ed25519_sig_b64u..."

{
  "mutations": [
    {
      "mutation_id": "e6a2b8e3-0d3e-4b67-891a-7b3c2e1d0f5a",
      "record_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
      "expected_revision": 1,
      "schema_version": 1,
      "key_version": 1,
      "is_tombstone": false,
      "ciphertext": "U2FsdGVkX1+vupppZksvRf5pq5g5XjFRIipRRM0NZGs...",
      "nonce_b64u": "dGhpcy1pcy1hLTI0LWJ5dGUtbm9uY2U"
    },
    {
      "mutation_id": "c1f7a4b9-8e2d-4567-9abc-123456789abc",
      "record_id": "4a2b9184-25e2-4f36-9e1e-28b3a72013f9",
      "expected_revision": 3,
      "schema_version": 1,
      "key_version": 1,
      "is_tombstone": true,
      "ciphertext": null,
      "nonce_b64u": null
    }
  ]
}
```

#### Response `200 OK`
```json
{
  "results": [
    {
      "mutation_id": "e6a2b8e3-0d3e-4b67-891a-7b3c2e1d0f5a",
      "record_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
      "revision": 2,
      "change_seq": 45,
      "status": "applied"
    },
    {
      "mutation_id": "c1f7a4b9-8e2d-4567-9abc-123456789abc",
      "record_id": "4a2b9184-25e2-4f36-9e1e-28b3a72013f9",
      "revision": 4,
      "change_seq": 46,
      "status": "applied"
    }
  ],
  "new_cursor": 46
}
```

---

## 6. Conflict Handling Rules & Resolution Matrix

*Citations: PRD §11 (Conflict handling rules, lines 475, 478–486), Appendix A (`REVISION_CONFLICT`).*

### 6.1 Conflict Principles
1. **Never Last-Write-Wins (LWW):** The system never overwrites user content automatically based on timestamps or arrival order.
2. **Preserve Both Versions:** When a conflict is detected, both the local uncommitted edit and the server version remain intact until the user explicitly resolves the conflict.
3. **No Silent Resurrection or Eradication:** A deletion conflicting with a local modification must never silently destroy the edit or resurrect the item without user intervention.

### 6.2 CAS Conflict Response Payload (`409 REVISION_CONFLICT`)
When an `expected_revision` mismatch occurs during CAS verification in `POST /api/v1/sync/batch`, the server halts and returns:

```http
HTTP/1.1 409 Conflict
Content-Type: application/json; charset=utf-8
X-Server-Time: 2026-10-13T12:07:00.000Z

{
  "code": "REVISION_CONFLICT",
  "message": "The record was updated on another device. Revision mismatch.",
  "retryable": false,
  "record_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "expected_revision": 1,
  "server_revision": 2,
  "server_change_seq": 45,
  "server_schema_version": 1,
  "server_key_version": 1,
  "is_tombstone": false,
  "server_ciphertext": "U2FsdGVkX1+vupppZksvRf5pq5g5XjFRIipRRM0NZGs...",
  "server_nonce_b64u": "dGhpcy1pcy1hLTI0LWJ5dGUtbm9uY2U"
}
```

### 6.3 Conflict Resolution Matrix

| Local Intent | Server State | Conflict Condition | Protocol Behavior & UI Resolution Options |
|---|---|---|---|
| **Edit / Update** | **Remote Edit** | `server_rev > expected_rev` | Both ciphertext versions preserved locally. UI presents side-by-side diff: <br>1. **Keep local as a new item:** Creates fresh `record_id` (UUIDv4) with local content, queues as `expected_revision = 0`. Server version adopted for original `record_id`. <br>2. **Use remote version:** Discards local uncommitted mutation, overwrites local item with server ciphertext at `server_rev`. <br>3. **Local merge:** (Optional if non-overlapping; PRD §11 mandates: if merge risks data loss, omit rather than guess). |
| **Edit / Update** | **Remote Tombstone** | `server_rev > expected_rev` AND `server.is_tombstone = true` | Remote device deleted the record while local device edited it offline. <br>1. **Keep local as a new item (Recommended):** Creates new `record_id` with local edit content; leaves original record tombstoned on server. Prevents data loss without resurrecting old item. <br>2. **Accept remote delete:** Discards local outbox edit, applies tombstone locally. |
| **Delete (Tombstone)** | **Remote Edit** | `server_rev > expected_rev` AND `local.is_tombstone = true` | Local device deleted item based on stale revision, but remote device added new content. <br>1. **Preserve remote edit (Recommended):** Drop local delete from outbox; accept remote updated record. <br>2. **Confirm deletion:** Re-submits delete with updated `expected_revision = server_rev`. |
| **Delete (Tombstone)** | **Remote Tombstone** | `server_rev > expected_rev` AND both are tombstones | Idempotent convergence. Local delete mutation is discarded from outbox; record remains tombstoned. No user prompt required. |

---

## 7. Crash Safety & Outbox Durability

*Citations: PRD §FR-3 (Local-first persistence), §FR-4 (Idempotent download apply v3 — G6), §12 (NFR: Reliability).*

### 7.1 No Silent Discard of Outbox
- All user edits and deletions are written transactionally to the local IndexedDB `records` store and `outbox` store **before** any network transmission occurs.
- If the browser closes, crashes, loses power, or drops network connectivity during upload, pending mutations remain safely stored in the `outbox`.
- Outbox entries are deleted **only** after the server returns an explicit `200 OK` acknowledgment containing matching `mutation_id`s.
- Network errors (`INTERNAL_ERROR`, `QUOTA_EXHAUSTED`, HTTP connection failures) preserve all outbox items and initiate exponential backoff with jitter.

### 7.2 Idempotent Download Apply (PRD §FR-4, G6)
- The client persists incoming remote changes and advances its cursor in a single Dexie.js transaction where supported.
- **Crash Fault Boundary:** If the application crashes between writing downloaded records to IndexedDB and committing the updated sync cursor to `app_metadata`:
  1. On the next sync cycle, the client re-requests the exact same change page using its un-advanced durable cursor.
  2. The client re-applies all downloaded records.
  3. Because local record writes are keyed by `(record_id, revision, change_seq)`, re-applying an already written record performs a deterministic upsert.
  4. State is never duplicated, corrupted, or left in a partial state.
- **Testing Requirement:** The test suite must include automated fault-injection verifying recovery from crashes between record writes and cursor commits (PRD §FR-4, G6).

---

## 8. Standard Error Envelope & Synchronization Errors

*Citations: PRD Appendix A (Stable error codes, normative).*

### 8.1 Error Envelope Format
All error responses emitted by the sync API conform to the uniform envelope:

```json
{
  "code": "<FROZEN_ERROR_CODE>",
  "message": "<human-readable string>",
  "retryable": true | false
}
```

The `message` string contains no secrets, database error codes, SQL fragments, or stack traces, and is safe for direct display in the UI.

### 8.2 Sync Protocol Error Handling Matrix

| Error Code | HTTP | Retryable | UI Category | Protocol & Client Recovery Action |
|---|---|---|---|---|
| `VALIDATION_ERROR` | 400 | `false` | Malformed data | Mutation payload malformed or missing fields. Halts sync; logs client bug. |
| `PAYLOAD_TOO_LARGE` | 413 | `false` | Malformed data | Batch exceeds 50 mutations / 1 MiB body, or single record > 384 KiB ciphertext. Halts batch; client splits batch or warns user. |
| `DEVICE_UNAUTHORIZED` | 401 | `false` | Authorization | Device bearer token unknown or corrupted. Client prompts user to re-pair. |
| `DEVICE_REVOKED` | 401 | `false` | Revocation | Device explicitly revoked. Client ceases all sync attempts immediately; displays "Device Revoked". |
| `INVALID_SIGNATURE` | 401 | `false` | Authorization | Ed25519 signature mismatch or body digest error. Client checks device signing key. |
| `STALE_TIMESTAMP` | 401 | `true` | Rate-limited / Skew | Client clock skewed by > ±5 minutes. Client parses server's `X-Server-Time` header, recalibrates offset, and retries once. |
| `VAULT_NOT_FOUND` | 404 | `false` | Not found | Vault ID unknown or caller unauthorized (no enumeration oracle). |
| `REPLAY_DETECTED` | 409 | `false` | Conflict | Reused `mutation_id` with altered payload. Client rejects mutation and regenerates fresh `mutation_id`. |
| `REVISION_CONFLICT` | 409 | `false` | Conflict | CAS revision mismatch. Client triggers conflict resolution (§6). |
| `RATE_LIMITED` | 429 | `true` | Rate-limited | Hourly limit exceeded (120 batch / 300 pull). Client pauses sync until `Retry-After` seconds elapse. |
| `QUOTA_EXHAUSTED` | 503 | `true` | Quota exhaustion | D1 free daily quota reached. Client displays "Sync paused (quota exhausted)", keeps local data intact, and retries later. |
| `SYNC_CURSOR_INVALID` | 400 | `false` | Malformed data | Cursor negative or invalid. Client resets cursor to `0` and triggers full re-pull. |
| `INTERNAL_ERROR` | 500 | `true` | Network / Server | Server error. Client applies bounded exponential backoff with jitter (1s, 2s, 4s, ... max 60s). |

---

## 9. Synchronization Triggers Summary

*Citations: PRD §FR-3, §FR-4, §11.*

Synchronization is event-driven and non-polling. The protocol is triggered under the following conditions:

1. **Vault Unlock:**  
   Immediately following passphrase entry and DEK derivation, the client runs an initial sync cycle (Pull Phase to catch up from `last_sync_cursor`, followed by Push Phase for any pending outbox mutations).
2. **Local Record Mutation:**  
   When a user creates, edits, or deletes an item while unlocked, the change is committed to the local `records` and `outbox` stores, and a debounced Push Phase is scheduled immediately.
3. **Network Reconnection:**  
   When the browser emits the `online` event (`window.addEventListener('online')`), the client initiates a full sync cycle to drain accumulated offline outbox mutations and pull changes.
4. **Manual Retry Action:**  
   The user explicitly clicks the "Retry Sync" button in the status UI after an error (such as rate limiting, network outage, or transient failure).
5. **Periodic / Foreground Sync:**  
   When the app transitions to the foreground, a check runs. Aggressive polling is strictly prohibited (PRD §13, Appendix B).

> **Architectural Boundary Note:**  
> Detailed PWA service-worker lifecycle events (`skipWaiting`, `clientsClaim`, Cache API isolation), background sync registrations, and UI state-machine transitions are documented in `docs/architecture/` and PWA documentation and are not duplicated here.

---

## 10. Implementation Ambiguities & Open Questions

The following open questions were identified during specification derivation from `personal-vault-prd-v3.md`:

> Open question Q7: see Open Questions Register in `docs/product/acceptance.md`.
> Open question Q7: see Open Questions Register in `docs/product/acceptance.md`.
> Open question Q5: see Open Questions Register in `docs/product/acceptance.md`.
