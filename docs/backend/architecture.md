# Personal Vault — System Architecture Specification

> **Normative Status & Precedence**  
> This document specifies the authoritative system architecture, runtime environments, component interactions, hosting infrastructure, operational quotas, and core design invariants for Personal Vault.  
>  
> - **Normative Source:** Derived directly from `personal-vault-prd-v3.md` v3.0 (2026-10-13) §2 (Firm product and architecture decisions), §6 (Recommended technology stack), §10 (Data model), §11 (API and synchronization protocol), §12 (Non-functional requirements), and §13 (Hosting and free-tier plan).  
> - **Precedence Rule:** `personal-vault-prd-v3.md` v3.0 is the sole normative authority. On any discrepancy between this document and the PRD, the **PRD WINS**.  
> - **Derivation Rule:** Derive strictly from PRD requirements without introducing novel architectural entities or speculative infrastructure. Any unresolved ambiguity is tracked in the Open Questions Register (`docs/product/acceptance.md`).

---

## 1. Executive Architectural Overview

Personal Vault is a single-owner, cross-platform personal information vault designed as a local-first, installable Progressive Web App (PWA). It provides fast capture, categorization, and local retrieval of links, notes, snippets, and occasional credentials across Windows, Android, iOS/iPadOS, and desktop/mobile web browsers.

```
+-----------------------------------------------------------------------------------+
| CLIENT DEVICE (Browser / PWA Runtime)                                             |
|                                                                                   |
|  +-----------------------------------------------------------------------------+  |
|  | User Interface (React 19 + TypeScript + Tailwind CSS + shadcn/ui)            |  |
|  | [Bilingual: ID + EN | Min Passphrase: 8 Chars | Auto Label: Device-XXXX]     |  |
|  +---------------------------------------+-------------------------------------+  |
|                                          |                                        |
|  +---------------------------------------v-------------------------------------+  |
|  | Vault & State Lifecycle Manager                                              |  |
|  | - Unlock / Lock State     - DEK in Memory Only   - Outbox Mutation Queue    |  |
|  +-------------------+-----------------------------------+---------------------+  |
|                      |                                   |                        |
|  +-------------------v---------------+   +---------------v---------------------+  |
|  | Ephemeral In-Memory Search Engine |   | Reviewed Cryptographic Engine       |  |
|  | MiniSearch (decrypted index)      |   | libsodium-wrappers-sumo (WASM)      |  |
|  | - Cleared on lock                 |   | - Argon2id KDF / XChaCha20 AEAD     |  |
|  | - Zero disk persistence           |   | - Ed25519 Signing / HKDF-SHA-256    |  |
|  | - Zero server transmission        |   | - FATAL BLOCKING ON LOAD FAILURE    |  |
|  +-----------------------------------+   +---------------+---------------------+  |
|                                                          |                        |
|  +-------------------------------------------------------v---------------------+  |
|  | Local Persistent Storage (IndexedDB via Dexie.js)                           |  |
|  | - records (ciphertext at rest)        - outbox (ciphertext mutations)       |  |
|  | - device_credentials (wrapped DEK)    - app_metadata (cursor, non-secrets)  |  |
|  +-------------------------------------------------------+---------------------+  |
+----------------------------------------------------------|------------------------+
                                                           | HTTPS Same-Origin
                                                           | /api/v1/*
                                                           | (PV-Device Ed25519)
+----------------------------------------------------------v------------------------+
| CLOUDFLARE EDGE PLATFORM (Single Pages Project on pages.dev)                       |
|                                                                                   |
|  +-----------------------------------------------------------------------------+  |
|  | Cloudflare Pages Static Delivery (CDN)                                      |  |
|  | - Serves PWA Shell, Web App Manifest, Static Assets, Service Worker        |  |
|  +-----------------------------------------------------------------------------+  |
|                                                                                   |
|  +-----------------------------------------------------------------------------+  |
|  | Cloudflare Pages Functions (Workers Runtime)                                |  |
|  | - Same-origin /api/v1/* Routing               - Request Size Validation     |  |
|  | - Token SHA-256 Authentication                - Ed25519 Signature Verifier  |  |
|  | - Application-Level Rate Limiter (App. B)     - CAS Revision & Cursor Sync  |  |
|  | * ZERO PLAINTEXT PROCESSING: All payloads remain opaque base64url ciphertext*  |  |
|  +---------------------------------------+-------------------------------------+  |
|                                          | SQL via Workers Binding                |
|  +---------------------------------------v-------------------------------------+  |
|  | Cloudflare D1 (Serverless Relational Database)                              |  |
|  | - vaults              - vault_records (max 384 KiB cipher)                  |  |
|  | - authorized_devices  - pairing_tickets (single active, 5-min TTL)          |  |
|  | - sync_changes (monotonic sequence cursor)                                  |  |
|  | * NO PLAINTEXT INDEXES: Content fields never indexed in SQL*                |  |
|  +-----------------------------------------------------------------------------+  |
+-----------------------------------------------------------------------------------+
```

### 1.1 The Local-First, Zero-Plaintext Paradigm
1. **Local-First Availability:** Once authorized and initially synchronized, the vault operates entirely offline. Decryption, reading, editing, searching, and deleting execute against local IndexedDB storage. Pending mutations are queued durably in an encrypted outbox.
2. **Zero-Plaintext Invariant:** Vault contents (titles, URLs, tags, notes, code snippets, credentials) are encrypted client-side using authenticated encryption (XChaCha20-Poly1305 with Associated Data) before storage in IndexedDB or transmission over the network. Plaintext is never transmitted to, inspected by, or stored in Cloudflare Pages Functions or Cloudflare D1.
3. **No External Infrastructure:** The architecture requires no Node.js application server, Next.js runtime, Supabase instance, Redis cache, VPS, or third-party authentication provider (PRD §2.8).

---

## 2. Firm Architectural Decisions (PRD §2)

The eleven architectural principles established in PRD §2 are frozen for the MVP and govern all subsystem designs:

| # | Architectural Principle | Specification & Boundary | PRD Citation |
|---|---|---|---|
| **1** | **Frontend Runtime** | **Vite + React + TypeScript SPA.** Next.js is explicitly rejected. Server-Side Rendering (SSR) and server framework complexity provide zero value for a client-side encrypted local-first PWA where the server cannot render user data. | PRD §2.1 |
| **2** | **Hosting & Same-Origin API** | **Cloudflare Pages + Pages Functions.** A single Cloudflare Pages project serves the static PWA frontend and handles same-origin `/api/v1/*` requests via Pages Functions running on the Workers edge runtime. Eliminates CORS complexity and secondary hosting deployments. | PRD §2.2 |
| **3** | **Cloud Storage** | **Cloudflare D1.** Relational SQLite-compatible edge database storing exclusively ciphertext, opaque identifiers, revisions, cursors, key envelopes, and device authentication hashes. | PRD §2.3 |
| **4** | **Local Storage** | **IndexedDB via Dexie.js.** Vault records and pending-sync outbox mutations are persisted as ciphertext at rest. Decrypted records exist solely in volatile memory while the vault is unlocked. | PRD §2.4 |
| **5** | **Reviewed Cryptography** | **`libsodium-wrappers-sumo` (WebAssembly).** Argon2id13 for password KDF, XChaCha20-Poly1305 for AEAD encryption, Ed25519 for request signing, and HKDF-SHA-256 for domain separation. Hand-rolling cryptographic primitives is strictly prohibited. | PRD §2.5 |
| **6** | **In-Memory Search** | **MiniSearch.** In-memory full-text search index built upon vault unlock and discarded from memory on lock. Search terms and indexes are never persisted to disk or sent to the server. | PRD §2.6 |
| **7** | **Synchronization Protocol** | **Revision-based Optimistic Concurrency.** Append-only change log, monotonic per-vault cursor, idempotent mutations, tombstones for deletions, and explicit conflict resolution. Distributed sync frameworks (CRDTs, CouchDB) are omitted for MVP. | PRD §2.7 |
| **8** | **Zero External Infrastructure** | **No Additional Paid or Third-Party Services.** No Supabase, Firebase, Redis, VPS, Docker containers, or third-party identity providers. | PRD §2.8 |
| **9** | **Cost Target** | **$0/month within Cloudflare Free Tier.** Architecture is optimized to operate strictly within Cloudflare Free quotas for Workers, D1, and Pages. | PRD §2.9 |
| **10** | **Security Claims** | **Client-Side Encrypted, Not Password-Manager Grade.** Marketed as a client-side encrypted personal vault where the backend receives no plaintext. Zero-knowledge guarantees or independent audit claims are prohibited without third-party review. | PRD §2.10 |
| **11** | **Fatal Crypto Failure Invariant** | **Blocking Fatal Error.** If the WebAssembly crypto module fails to load (blocked WASM, CSP violation, unsupported browser), the application halts immediately with a blocking error. Silent downgrade or fallback to unencrypted operation is strictly prohibited. | PRD §2.11, §FR-6 (G14) |

---

## 3. Technology Stack Reference (PRD §6)

| Architectural Layer | Selected Technology | Version / Profile | System Responsibility |
|---|---|---|---|
| **Frontend Application** | React 19 + TypeScript | Latest stable | Single Page Application (SPA), state management, vault operations |
| **Build Tooling** | Vite | Latest stable | Fast development server, optimized ES module production bundling |
| **Styling & Components** | Tailwind CSS + shadcn/ui | Radix UI primitives | Responsive mobile-first UI, accessible primitives, light/dark theme |
| **Static CDN Hosting** | Cloudflare Pages | Edge distribution | Static PWA asset hosting, TLS termination, HTTP caching headers |
| **Serverless Edge API** | Cloudflare Pages Functions | Workers runtime | Same-origin `/api/v1/*` endpoints, signature verification, rate limiting |
| **Cloud Relational DB** | Cloudflare D1 | Serverless SQLite | Stores ciphertext, key envelopes, device registrations, sync cursors |
| **Client Database** | IndexedDB + Dexie.js | Latest stable | Encrypted local record store, durable outbox queue, local metadata |
| **Cryptographic Engine** | `libsodium-wrappers-sumo` | WebAssembly build | Argon2id13, XChaCha20-Poly1305, Ed25519, HKDF-SHA-256 |
| **Full-Text Search** | MiniSearch | In-memory | Ephemeral in-memory indexing of decrypted records during unlock |
| **Offline & PWA** | Web App Manifest + SW | Custom Service Worker | PWA installation, app-shell caching, versioned cache lifecycle |
| **Unit & Integration Test**| Vitest | Fast Vite-native test | Cryptographic test vectors, Dexie stores, schema validation |
| **End-to-End Test** | Playwright | Multi-browser headless | Cross-browser e2e flows, PWA installation, fault-injection tests |
| **Source Control & CI** | GitHub Actions | Git repository | Code repository, migration tracking, automated contract-drift CI |

---

## 4. Subsystem Interactions & Data Flows

### 4.1 Vault Unlock and Local Initialization
```
User enters Master Passphrase (min 8 chars)
  │
  ▼
Client loads `app_metadata` & `vaults` envelope from Dexie / API
  │
  ▼
Argon2id13 Derivation: Passphrase + Salt + KDF parameters (m, t, p) ──► KEK
  │
  ▼
XChaCha20-Poly1305 Decrypt: Wrapped DEK envelope + KEK ──► Data Encryption Key (DEK)
  │
  ▼
HKDF-SHA-256 Subkey Derivations from DEK:
  ├── PV-V1/REC-ENC      ──► Record Encryption Key
  └── PV-V1/LOCAL-CRED   ──► Local Credential Unwrap Key
  │
  ▼
Decrypt Local Device Credentials in Dexie:
  ├── Device Bearer Token (held in memory)
  └── Ed25519 Device Private Key (held in memory)
  │
  ▼
Decrypt Cached Records in Dexie (`records` store)
  │
  ▼
Build In-Memory MiniSearch Index (ephemeral, held in volatile memory)
  │
  ▼
Dashboard Active & Searchable (<200 ms p95 query latency)
```

### 4.2 Local Mutation and Outbox Persistence
```
User Creates / Edits / Deletes Item in UI
  │
  ▼
Client validates Plaintext Payload (≤ 256 KiB)
  │
  ▼
Generate Fresh 192-bit Nonce + Encrypt via XChaCha20-Poly1305:
  AAD = vault_id || record_id || schema_version || key_version || "record"
  Ciphertext ceiling enforced: ≤ 384 KiB
  │
  ▼
Atomic Dexie Transaction:
  ├── Write ciphertext to `records` store (local revision incremented)
  └── Append mutation to `outbox` store (mutation_id UUIDv4, expected_revision)
  │
  ▼
Update In-Memory MiniSearch Index
  │
  ▼
Trigger Debounced Sync Engine (if online)
```

### 4.3 Cloud Synchronization Flow (`/api/v1/*`)
```
Sync Engine Triggered (App Open, Online Mutation, Manual Sync, or Foreground Interval)
  │
  ▼
Step 1: PULL REMOTE CHANGES (`GET /api/v1/sync?cursor=<last_cursor>&limit=100`)
  ├── Client includes `Authorization: Bearer <device_token>`
  ├── Worker validates token hash against `authorized_devices` in D1
  ├── D1 queries `sync_changes` where `seq > cursor`
  └── Worker returns change batch + new cursor
  │
  ▼
Step 2: IDEMPOTENT DOWNLOAD APPLY
  ├── Keyed by (record_id, revision, change_seq)
  ├── Upsert downloaded ciphertext into Dexie `records` store
  ├── Decrypt records in memory & update MiniSearch index
  └── Transactionally commit new cursor to Dexie `app_metadata`
  │
  ▼
Step 3: PUSH OUTBOX MUTATIONS (`POST /api/v1/sync/batch`)
  ├── Batch up to 50 mutations or 1 MiB ciphertext payload
  ├── Sign request with Ed25519: `PV-Device` header
  ├── Worker verifies token hash + Ed25519 signature + timestamp ±5m
  ├── D1 executes atomic CAS: checks expected_revision per record
  │     ├── Match: Commit record ciphertext, append `sync_changes`, return success
  │     └── Mismatch: Return 409 REVISION_CONFLICT with server revision & ciphertext
  └── Client marks acknowledged mutations as synced and clears outbox
```

---

## 5. Hosting Architecture & Free-Tier Quota Engineering (PRD §13)

Personal Vault is engineered to operate reliably on the Cloudflare Free Tier ($0/month). To avoid unexpected service pauses or API rejections, the architecture strictly conforms to the operational boundaries documented in PRD §13 (verified 2026-10-13):

### 5.1 Cloudflare Free Quota Matrix

| Platform Subsystem | Free Tier Quota Limit | System Architectural Response |
|---|---|---|
| **Cloudflare Workers** (Pages Functions) | **100,000 requests/day** | No continuous polling; requests debounced; batching up to 50 mutations per call. |
| **Workers CPU Time** | **10 ms CPU time / invocation** | All heavy cryptographic operations (Argon2id KDF, AEAD encryption/decryption) run on client hardware; Worker only validates token hashes, signatures, and executes SQL. |
| **Cloudflare D1 Reads** | **5,000,000 rows read/day** | Indexed cursor lookups (`sync_changes`); client tracks durable cursor to avoid re-reading old rows. |
| **Cloudflare D1 Writes** | **100,000 rows written/day** | Outbox mutations batched; single-active-ticket enforcement; client debounces rapid typing edits. |
| **Cloudflare D1 Storage** | **500 MB / database (5 GB total)** | Plaintext limit 256 KiB, ciphertext cap 384 KiB; no attachments, media, or large blobs; strict MVP scope. |
| **D1 Queries / Invocation** | **Max 50 queries / Worker invocation** | Batch sync uses prepared batch statements or multi-row transactions within the 50-query budget. |
| **Cloudflare Pages** | **500 builds/month, 25 MiB asset cap** | Optimized Vite build; versioned assets; minimal dependencies. |

### 5.2 Quota Exhaustion & Error Containment
On September 1, 2026, Cloudflare implemented strict daily limit enforcement on D1 Free tier. When daily read or write row limits are exhausted, D1 returns a quota error until the daily reset window:
- **Zero Data Loss:** Local vault operations, viewing, editing, and searching remain 100% functional. Mutations remain safely buffered in the local IndexedDB `outbox`.
- **API Error Contract:** Worker intercepts D1 quota failures and responds with `503 QUOTA_EXHAUSTED` (`retryable: true`).
- **UI State Announcement:** The UI transitions the sync status indicator to **"Sync Paused (Quota Exhausted)"** and instructs the user that cloud synchronization will resume automatically after the quota resets.

### 5.3 Database Environment Separation
- Development and production D1 databases are strictly isolated in configuration (`wrangler.toml` / Cloudflare dashboard bindings).
- Destructive testing and schema migrations are never executed against production databases.

---

## 6. Synchronization Trigger Architecture

To stay comfortably within the 100,000 requests/day Workers limit and 5M D1 read limit, continuous background polling is strictly prohibited (PRD §13, lines 520). The synchronization engine fires exclusively on four deterministic triggers:

| Trigger Event | Trigger Mechanism | Operational Behavior |
|---|---|---|
| **1. Vault Unlock / App Open** | Automatic on unlock | Triggers immediate bidirectional sync: pulls remote changes since local cursor, then flushes pending outbox mutations. |
| **2. Post-Mutation Online** | Debounced (e.g. 1–2 sec) | When a user creates, edits, or deletes an item while online, mutations are saved to Dexie and queued. Sync engine debounces burst edits and flushes the outbox in a single batch. |
| **3. Explicit User Action** | Manual click on "Sync Now" | User initiates sync via dashboard or Settings. Immediately polls for remote changes and retries any failed outbox mutations. |
| **4. Foreground Periodic** | Conservative interval | While the app is actively in the foreground and unlocked, a conservative periodic timer (e.g., 5–15 minutes) checks for remote changes. Suspended immediately when tab is hidden or vault is locked. |

---

## 7. Operational Constraints & Frozen Invariants

### 7.1 Cryptographic & Schema Versions (Appendix D)
- `schema_version = 1`: Authoritative inside encrypted payload; plaintext column in D1/IndexedDB for triage only.
- `crypto_format_version = 1`: Master and recovery key envelope format version.
- `kdf_version = 1`: Argon2id parameter profile set version.
- `key_version = 1`: Data Encryption Key (DEK) generation counter.

### 7.2 Size Caps & Overhead Budget (FR-1, FR-4, G10)
- **Serialized Plaintext Cap:** **256 KiB** (262,144 bytes) per item before encryption.
- **Ciphertext Ceiling:** **384 KiB** (393,216 bytes) per record envelope. Accounts for ~33–40% expansion from XChaCha20-Poly1305 MAC, nonce, and base64url transport encoding.
- **Sync Batch Cap:** Max **50 mutations** or **1 MiB** (1,048,576 bytes) request body (counted in ciphertext bytes).

### 7.3 Canonical Identifiers (PRD §10)
- `vault_id`: 26-character Crockford Base32 **ULID** (opaque, sortable, user-friendly in recovery kits).
- `record_id`: Canonical RFC 4122 **UUIDv4** (36 characters).
- `device_id`: Canonical RFC 4122 **UUIDv4** (36 characters).
- `mutation_id`: Canonical RFC 4122 **UUIDv4** (36 characters, client-generated idempotency key).
- `ticket_id`: Canonical RFC 4122 **UUIDv4** (36 characters, server-generated pairing ticket identifier).

### 7.4 User Configuration Decisions (Frozen 2026-10-13)
- **Master Passphrase Minimum Length:** **8 characters** (enforced by client validation at vault creation and password change).
- **Internationalization (i18n):** **Bilingual Indonesian (`id`) + English (`en`)**. Automatically detects client environment (`navigator.language`); defaults to Indonesian (`id`) if language is unrecognized or unavailable; manual toggle in Settings.
- **Hosting Domain Strategy:** **`pages.dev` first** (`https://<project-name>.pages.dev`). Custom domains are optional and deferred to post-MVP.
- **Device Labeling:** Automatic generation of default label matching pattern **`Device-XXXX`** (where `XXXX` is a random 4-character hex or alphanumeric string), with full user rename capability in Settings.

---

## 8. Security & Threat Architecture Summary (PRD §9)

### 8.1 Trust Boundaries & Protection Guarantees
- **Database Compromise:** If Cloudflare D1 is dumped, the attacker obtains only base64url ciphertext, Argon2id salts, KDF parameters, wrapped DEK envelopes, and token hashes. Plaintext items, passwords, notes, and search indexes are not compromised.
- **Bearer Token Leakage:** A compromised device bearer token allows only read-only retrieval of encrypted blobs (`GET /api/v1/sync` and bootstrap). All mutating endpoints, pairing ticket generation, key updates, and device revocations require an Ed25519 signature from the device private key, which is encrypted under the DEK at rest.
- **Tampering & Forgery:** All records use authenticated encryption (AEAD) with Associated Data binding `vault_id || record_id || schema_version || key_version || "record"`. Any tampering or record transplantation causes decryption failure.

### 8.2 Disclosed Metadata Leakage
The user is informed in Settings and onboarding that server-side metadata is inherently visible to Cloudflare edge infrastructure:
- Vault ID, Record IDs, and device labels.
- Ciphertext byte lengths (revealing approximate size of notes/snippets).
- Revision numbers and timestamps of synchronization events.
- Device `last-seen` timestamps (recorded by server on each authenticated request; PRD §FR-5, G13).

---

## 9. Collected Architectural Ambiguities & TODOs

> Open question Q7: see Open Questions Register in `docs/product/acceptance.md`.

> Open question Q7: see Open Questions Register in `docs/product/acceptance.md`.
> Open question Q7: see Open Questions Register in `docs/product/acceptance.md`.
> Open question Q5: see Open Questions Register in `docs/product/acceptance.md`.
> Open question Q1: see Open Questions Register in `docs/product/acceptance.md`.
> Open question Q7: see Open Questions Register in `docs/product/acceptance.md`.
