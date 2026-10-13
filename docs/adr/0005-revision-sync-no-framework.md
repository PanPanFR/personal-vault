# 0005. Revision-Based Optimistic Concurrency Sync over Distributed Frameworks

- **Status:** Accepted
- **Date:** 2026-10-13
- **Authoritative Source:** `personal-vault-prd-v3.md` §2 (Decision 7), §8 (FR-4), §11 (API and synchronization protocol), §16 (Risks and mitigations)

---

## Context

Personal Vault allows users to create, update, and delete vault records across multiple authorized devices. A synchronization protocol is required to propagate changes reliably through Cloudflare edge infrastructure.

We evaluated whether to integrate a distributed synchronization framework or CRDT library (e.g. Yjs, Automerge, PouchDB/CouchDB, WatermelonDB, ElectricSQL) versus implementing a direct, protocol-level revision and cursor mechanism.

Considerations:
1. **Zero-Plaintext Invariant:** The sync server receives only opaque ciphertext blobs (`vault_records.ciphertext`). CRDTs and collaborative frameworks typically operate on structured plaintext object graphs or character-by-character operation streams. Applying CRDTs over opaque encrypted blobs adds immense complexity without providing automated merging benefits.
2. **Single-Owner Pattern:** The user edits records on one device at a time, or occasionally across two devices. Concurrent simultaneous edits to the same field are rare; true real-time collaborative editing (Google Docs style) is an explicit non-goal (PRD §4).
3. **Bundle Size & Dependencies:** Distributed sync engines introduce heavy client-side bundles and often mandate dedicated WebSocket servers, stateful sync backends, or specific database extensions incompatible with Cloudflare D1.

---

## Decision

We implement a **custom revision-based optimistic concurrency protocol** backed by Cloudflare D1 and Dexie.js, omitting distributed sync frameworks for the MVP:

1. **Per-Record Revisions:** Each record tracks a monotonic integer `revision` (starting at `1`).
2. **Append-Only Change Cursor:** The server maintains an append-only change log (`sync_changes`) with a monotonic sequence `seq`. Clients pull remote changes using a durable cursor.
3. **Optimistic Concurrency & Compare-and-Swap (CAS):** When submitting mutations (`POST /api/v1/sync/batch`), clients supply `expected_revision`. The server validates `expected_revision == current_revision`. If mismatched, the server rejects the edit with `409 REVISION_CONFLICT` and returns the latest server revision and ciphertext.
4. **Idempotency Keys:** Every mutation includes a client-generated `mutation_id` (UUIDv4) to guarantee idempotent processing during network retries.
5. **Tombstones for Deletion:** Deletions write a tombstone record with `is_tombstone = true` and `NULL` ciphertext. Tombstones are retained indefinitely in MVP to prevent deleted items from resurrecting.
6. **Explicit Conflict Resolution:** Conflicting edits never silently overwrite (no Last-Write-Wins). The client preserves both local and remote versions and presents the user with explicit choices: **Keep local as a new item** or **Use remote version**. Concurrent delete-vs-edit conflicts present an explicit manual resolution dialog.
7. **Idempotent Download Apply (G6):** Downloaded change pages are applied idempotently keyed by `(record_id, revision, change_seq)`.

---

## Consequences

### Positive
- **Minimal Footprint:** Zero third-party sync runtime dependencies; negligible bundle size impact.
- **Strict Zero-Plaintext Alignment:** The server operates strictly on opaque ciphertext blobs, timestamps, and sequence integers without needing knowledge of record contents.
- **Deterministic Edge Execution:** The protocol maps directly to standard SQLite transactions in Cloudflare D1.
- **Resilient Recovery:** Disconnects, retries, and quota interruptions cannot corrupt local state or silently discard queued edits.

### Negative / Trade-offs
- **No Automatic Field-Level Merging:** If two devices edit different fields of the same record concurrently, the system flags a revision conflict rather than automatically combining the fields. For a personal vault with 5,000 items, this is an acceptable and safe trade-off.
- **Tombstone Retention:** MVP does not garbage-collect tombstones; tombstone cleanup is deferred to post-MVP.

---

## PRD Citations
- PRD §2.7: *"Sync: Revision-based optimistic concurrency, an append-only change cursor, idempotent mutations, tombstones, and explicit conflict resolution. Do not add a distributed sync framework for the MVP."*
- PRD §8 (FR-4): Encrypted cloud synchronization specifications, batch bounds (50 mutations / 1 MiB), and idempotent download apply.
- PRD §11: Sync algorithm (steps 1–10) and conflict handling rules.
- User Decision (2026-10-13): Delete-vs-edit conflicts resolved via explicit manual user dialog.
