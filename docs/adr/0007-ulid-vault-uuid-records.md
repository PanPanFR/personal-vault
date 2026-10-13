# 0007. ULID for Vault Identifiers and UUIDv4 for Records and Entities

- **Status:** Accepted
- **Date:** 2026-10-13
- **Authoritative Source:** `personal-vault-prd-v3.md` §8 (FR-1, FR-4, FR-5), §10 (Data model), Appendix C (Recovery-kit file)

---

## Context

Personal Vault requires globally unique, opaque identifiers across several domain entities:
- Vaults (`vault_id`)
- Records (`record_id`)
- Authorized devices (`device_id`)
- Sync mutations (`mutation_id`)
- One-time pairing tickets (`ticket_id`)

Key requirements:
1. **Offline Autonomy:** Clients must generate identifiers locally while offline without communicating with a centralized database sequence or server ID generator.
2. **Collision Resistance:** Generated identifiers must have sufficient cryptographic entropy to eliminate the risk of collision across distributed devices.
3. **Usability in Recovery Materials:** The `vault_id` must be displayed in QR codes, manual entry forms, and the plaintext `personal-vault-recovery-kit.json` file. A compact, human-transcribable, unambiguous character set is desirable.
4. **Opaque and Non-Sequential:** Identifiers must not reveal business metrics, user counts, or allow enumeration attacks.

---

## Decision

We adopt a split identifier strategy:
1. **`vault_id` uses ULID (Universally Unique Lexicographically Sortable Identifier):**
   - 26-character Crockford Base32 string (e.g. `01J9Z8QK7M3V6P2R5T8W4Y6U1A`).
   - Opaque, URL-safe, case-insensitive, and excludes easily confused characters (`I`, `L`, `O`, `U`).
   - Compact and transcription-friendly for QR codes and recovery kit JSON files.
2. **`record_id`, `device_id`, `mutation_id`, and `ticket_id` use RFC 4122 UUIDv4:**
   - 36-character canonical lowercase hex string with hyphens (e.g. `550e8400-e29b-41d4-a716-446655440000`).
   - Provides 122 bits of cryptographic randomness.
   - Universally supported by SQLite/D1, IndexedDB, and standard libraries without custom encoding requirements.

---

## Consequences

### Positive
- **Human-Friendly Recovery Identifiers:** The 26-character Crockford Base32 `vault_id` is significantly cleaner and less error-prone when typed manually during an all-devices-lost recovery flow than a 36-character hyphenated UUID.
- **Decentralized Generation:** Clients generate `record_id` and `mutation_id` autonomously during offline operations with zero risk of collision.
- **Database Index Optimization:** ULIDs are lexicographically sortable by creation timestamp, optimizing B-tree index locality for the `vaults` table in Cloudflare D1.
- **Zero Enumeration Risk:** Both ULID and UUIDv4 prevent sequential ID enumeration attacks.

### Negative / Trade-offs
- **Two Identifier Formats:** The codebase and schema handle two different string formats (`ULID` for vaults, `UUIDv4` for records/devices). This is addressed through strict type validation schemas (Zod).
- **Client Dependency:** Requires bundling lightweight generators/validators for ULID and UUIDv4 in the client.

---

## PRD Citations
- PRD §8 (FR-1): Opaque random record IDs generated client-side.
- PRD §8 (FR-4): Client-generated mutation IDs.
- PRD §8 (FR-5): Random vault ID and device ID specifications.
- PRD §10: D1 tables and IndexedDB store definitions specifying `vault_id`, `record_id`, `device_id`, and `mutation_id`.
- PRD Appendix C: `personal-vault-recovery-kit.json` format specifying `vault_id: "<ulid-or-uuid-opaque>"`.
