# 0004. MiniSearch Ephemeral In-Memory Indexing for Local Search

- **Status:** Accepted
- **Date:** 2026-10-13
- **Authoritative Source:** `personal-vault-prd-v3.md` §2 (Decision 6), §6 (Recommended technology stack), §8 (FR-2), §12 (Non-functional requirements)

---

## Context

Personal Vault requires fast, comprehensive search across links, notes, snippets, and credentials. Users must be able to search titles, URLs, descriptions, notes, snippet code, usernames/emails, and tags, supporting structured filters (`type:`, `tag:`, `is:favorite`, `is:archived`, date ranges, and quoted phrases).

The application is constrained by two critical architectural principles:
1. **Zero Server Plaintext:** The server never receives search queries, search terms, or unencrypted content. Server-side search (e.g. Elasticsearch, Meilisearch, or D1 `LIKE` queries) is strictly prohibited.
2. **Encrypted Rest Storage:** IndexedDB stores records as ciphertext blobs. Querying IndexedDB directly on ciphertext is impossible without decrypting every record individually on each keystroke, which would cause severe performance degradation for 5,000 records.
3. **No Plaintext Persistence:** Persisting a decrypted search index to disk (in IndexedDB, Cache API, or localStorage) would violate the threat model and expose vault content to offline disk inspection without master passphrase derivation.

---

## Decision

We use **MiniSearch** (or an equivalent lightweight client-side search library) to construct an **ephemeral in-memory full-text index** when the vault is unlocked.

- The index is built exclusively in volatile JavaScript application memory immediately after the master passphrase unwraps the Data Encryption Key (DEK) and local records are decrypted.
- The index indexes titles, URLs, notes, snippets, usernames/emails, tags, and timestamps in memory.
- As records are created, updated, or deleted, the in-memory index is incrementally updated.
- **Immediate Discard on Lock:** When the user locks the vault (manually or via inactivity timeout), the entire MiniSearch index and all decrypted records are discarded from memory and garbage collected.
- **Zero Disk and Network Leaks:** Neither the index nor search queries are ever persisted to storage or transmitted across the network.

---

## Consequences

### Positive
- **High Performance:** MiniSearch provides sub-millisecond query evaluation, easily achieving the target of <200 ms p95 search latency across 5,000 items (PRD §3, §12).
- **Expressive Query Syntax:** Enables native support for prefix matching, fuzzy search, and structured filters (`type:link`, `tag:"work"`, `is:favorite`, `updated:...`).
- **Complete Confidentiality:** Search terms never leak to Cloudflare Pages Functions, D1, or edge logs.
- **Clean Threat Boundary:** Disk storage remains 100% encrypted ciphertext at all times.

### Negative / Trade-offs
- **Unlock Latency:** Decrypting and indexing 5,000 small text records during vault unlock incurs an initial processing cost (typically 100–300 ms on modern hardware). This must be optimized and measured during performance testing.
- **Memory Footprint:** The in-memory index and decrypted record objects consume browser RAM while unlocked (estimated 5–15 MB for 5,000 records).
- **No Background Indexing:** Search is strictly unavailable while the vault is locked; the index must be rebuilt on each subsequent unlock.

---

## PRD Citations
- PRD §2.6: *"Search: MiniSearch or an equivalent in-memory index. Decrypt only while the vault is unlocked; never upload search terms or indexes."*
- PRD §8 (FR-2): Global and advanced search requirements, supported query syntax, and index lifecycle.
- PRD §12: Performance NFR (<200 ms p95 on 5,000 records).
