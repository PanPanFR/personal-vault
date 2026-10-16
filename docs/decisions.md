# Architecture Decisions

Squashed record of decisions originally in ADRs 0001-0009 (dated 2026-10-13).

---

## 0001. Vite SPA over Next.js for Local-First PWA

- **Status:** Accepted
- **Date:** 2026-10-13
- **Source:** `personal-vault-prd-v3.md` §2 (Decision 1), §6 (Tech stack), §18 (Gap fix 7)

### Context

Personal Vault is a single-owner personal information vault built as an installable Progressive Web App (PWA) targeting Windows, Android, iOS/iPadOS, and desktop/mobile web browsers.

A primary technology choice is the frontend framework and bundler runtime. Modern web applications frequently default to full-stack frameworks like Next.js (with React Server Components, Server-Side Rendering, and dynamic Node.js/Edge server runtimes). We evaluated whether Next.js or a client-centric single-page application (SPA) built with Vite and React is the appropriate foundation for Personal Vault.

Key constraints:
1. **Client-Side Encryption:** All vault contents are encrypted client-side using WebAssembly (`libsodium-wrappers-sumo`). The server possesses no master passphrase or data encryption keys and cannot decrypt or render record content.
2. **Local-First & Offline Resilience:** The application must operate offline after initial bootstrap. The client reads, writes, searches, and manages records locally in IndexedDB (via Dexie.js).
3. **PWA Shell Caching:** Service worker caching must reliably serve the static app shell without hydration mismatches or complex server runtime synchronization.
4. **Hosting and Operational Costs:** The deployment target is Cloudflare Pages Free Tier with zero server maintenance overhead.

### Decision

We choose **Vite + React + TypeScript** as a pure client-side Single Page Application (SPA). We explicitly reject **Next.js** for this product.

Server-Side Rendering (SSR) and a dedicated Node.js server framework are unnecessary and counterproductive:
- The server has no access to decrypted plaintext and therefore cannot pre-render user content, dashboards, search views, or item details.
- Next.js adds substantial bundle size, complex hydration lifecycles, and coupling to Node/Edge server architectures that complicate pure offline PWA operation.
- Vite provides instantaneous hot module replacement (HMR), lightweight build outputs, standard ES modules, and seamless static deployment to Cloudflare Pages.

### Consequences

#### Positive
- **Architectural Simplicity:** Clean boundary between client-side state and edge API functions.
- **Zero SSR Overhead:** No hydration mismatches, no dual client/server rendering trees, no server memory consumption for rendering.
- **Pure Static Delivery:** The entire frontend builds into standard static HTML/CSS/JS assets served from Cloudflare's global edge CDN with aggressive caching.
- **Offline & PWA Alignment:** Service worker caching of a versioned static shell is deterministic, reliable, and straightforward.
- **Fast Build Times:** Vite with Rollup/ESBuild provides rapid local development and build pipelines that fit easily within Cloudflare Pages' 500 builds/month free limit.

#### Negative / Trade-offs
- **Initial Bundle Load:** All client logic (React, Tailwind, UI primitives, Dexie, MiniSearch, Libsodium WASM) must be downloaded before first paint. This is mitigated by PWA caching after initial install and keeping total uncompressed bundle size modest.
- **No Search Engine Optimization (SEO):** SPAs require client execution to render content. For a private personal vault protected by authentication, SEO is a non-goal (PRD §4).

---

## 0002. Cloudflare Pages Functions and D1 for Hosting and Storage

- **Status:** Accepted
- **Date:** 2026-10-13
- **Source:** `personal-vault-prd-v3.md` §2 (Decisions 2, 3, 8, 9), §6, §10, §13

### Context

Personal Vault requires an online synchronization backend to coordinate encrypted records, key envelopes, device registrations, and pairing tickets across a user's authorized devices.

Key operational requirements:
1. **Cost Ceiling:** Target $0/month operating cost using free tier quotas (PRD §2.9, §13).
2. **Minimal Operational Burden:** Serverless architecture without operating system patching, container orchestration, or persistent virtual machines (no VPS, Docker, Supabase, Redis).
3. **CORS and Origin Security:** Minimize cross-origin resource sharing (CORS) security risks and preflight latency.
4. **Relational Storage:** The sync model requires structured queries for opaque identifiers, revision tracking, append-only monotonic sequences (`change_seq`), and atomic compare-and-swap (CAS) transactions.

### Decision

We deploy the entire backend as **Cloudflare Pages Functions** (executing on the Cloudflare Workers edge runtime) backed by **Cloudflare D1** (serverless relational SQLite) within a single unified Cloudflare Pages project.

- The static SPA and the `/api/v1/*` API endpoints share the exact same origin (`https://<project>.pages.dev` or custom domain).
- Cloudflare D1 binds natively into Pages Functions environment bindings without external database connection pools or credentials.
- All mutating API handlers execute atomic SQL transactions against D1 to enforce compare-and-swap revisions and change sequence assignments.

### Consequences

#### Positive
- **Same-Origin Simplicity:** Deploying API functions alongside the static frontend eliminates CORS configuration, cross-site cookie/header complications, and separate deployment pipelines.
- **True $0/Month Operational Cost:** Fits comfortably within Cloudflare Free tier quotas:
  - Workers: 100,000 requests/day, 10 ms CPU time per invocation.
  - D1: 5,000,000 rows read/day, 100,000 rows written/day, 500 MB database storage.
  - Pages: 500 builds/month, 25 MiB asset limits.
- **Global Low-Latency Execution:** Pages Functions execute on Cloudflare's edge network close to the client device.
- **Relational Integrity:** D1 provides full SQLite SQL expressiveness, supporting composite indexes for cursor lookups, single-active-ticket partial indexes, and transactional revision checks.

#### Negative / Trade-offs
- **Workers 10 ms CPU Limit:** Handlers must remain strictly lightweight. Heavy cryptographic derivations (such as Argon2id KDF and AEAD encryption/decryption) must never run inside Workers; they execute exclusively on client hardware.
- **D1 Free Tier Daily Enforcement:** Cloudflare enforces hard daily row read and write quotas. Exceeding limits halts sync with `503 QUOTA_EXHAUSTED` until the daily reset. This is mitigated by local-first operation and buffering in the IndexedDB outbox.
- **Per-Invocation Query Budget:** D1 limits each Worker invocation to a maximum of 50 queries. Sync batches must use prepared batch statements or multi-row SQL statements to stay within this limit.

---

## 0003. Reviewed Libsodium WebAssembly and Fatal Crypto Load Failure

- **Status:** Accepted
- **Date:** 2026-10-13
- **Source:** `personal-vault-prd-v3.md` §2 (Decisions 5, 11), §6, §8 (FR-6), §9 (Req 4), Appendix D

### Context

Personal Vault requires a robust cryptographic foundation for:
1. **Password Key Derivation:** Argon2id (RFC 9106) to derive a Key Encryption Key (KEK) from the master passphrase, resisting GPU/ASIC offline brute-force attacks.
2. **Authenticated Symmetric Encryption:** XChaCha20-Poly1305 with 192-bit random nonces to eliminate nonce reuse hazards and provide authenticated associated data (AAD) binding.
3. **Asymmetric Request Signing:** Ed25519 (RFC 8032) to sign mutating API requests from authorized devices.
4. **Key Separation:** HKDF-SHA-256 (RFC 5869) to derive domain-separated subkeys for records, local credentials, and recovery.

The native browser Web Crypto API (`window.crypto.subtle`) lacks support for Argon2id and XChaCha20-Poly1305. Hand-rolling cryptographic primitives in JavaScript or stitching together multiple disparate, unreviewed npm packages introduces catastrophic security vulnerabilities, side-channel timing leaks, and maintenance hazards.

Additionally, user feedback and security hygiene mandate establishing a strict minimum length for the master passphrase.

### Decision

1. **Use `libsodium-wrappers-sumo`:** We adopt the reviewed, audited WebAssembly build of Libsodium (`libsodium-wrappers-sumo`) for all cryptographic primitives (Argon2id13, XChaCha20-Poly1305, Ed25519, HKDF-SHA-256). Hand-rolling cryptographic primitives is strictly prohibited.
2. **Enforce Minimum Master Passphrase Length:** The client strictly enforces a minimum passphrase length of **8 characters** at vault creation and password update.
3. **Fatal Blocking on Crypto Load Failure (PRD §2.11, G14):** If the Libsodium WebAssembly module fails to initialize (e.g., due to browser incompatibility, disabled WASM, or Content Security Policy restriction), the application **must halt immediately with a fatal full-screen error**. It must refuse vault creation, unlock, pairing, and export, and must **never** fall back to unencrypted storage or a weaker algorithm.
4. **Argon2id Bounds:** Enforce a hard minimum floor of `m=64 MiB`, `t=3`, `p=1` on unlock, and a maximum DoS cap of `m=512 MiB`, `t=5`, `p=4`.

### Consequences

#### Positive
- **Audited Security:** Libsodium is an industry-standard, battle-tested cryptographic library implemented in constant time to prevent side-channel timing attacks.
- **Large Nonces:** XChaCha20's 192-bit nonce allows safe, stateless random nonce generation without counter state synchronization across devices.
- **Fail-Closed Safety:** If the cryptographic environment is hostile or compromised, the fatal blocking guard prevents plaintext exposure or unencrypted operations.
- **Strict Passphrase Hygiene:** The 8-character floor combined with Argon2id parameters provides a strong baseline defense against offline dictionary attacks.

#### Negative / Trade-offs
- **WASM Binary Overhead:** The `libsodium-wrappers-sumo` package adds ~300–400 KiB to the initial application bundle download (cached by the service worker after install).
- **CSP Configuration:** Deploying WebAssembly requires configuring the Content Security Policy to include `script-src 'wasm-unsafe-eval'` (or equivalent narrow directive for the pinned WASM build; PRD §9.4).
- **Device Calibration:** Argon2id memory and iteration costs require calibration (Recommended 128 MiB/t=4/p=1, stepping down to Mobile fallback 64 MiB/t=3/p=1 if calibration exceeds 3 seconds) to ensure unlock performance on constrained mobile hardware.

---

## 0004. MiniSearch Ephemeral In-Memory Indexing for Local Search

- **Status:** Accepted
- **Date:** 2026-10-13
- **Source:** `personal-vault-prd-v3.md` §2 (Decision 6), §6, §8 (FR-2), §12

### Context

Personal Vault requires fast, comprehensive search across links, notes, snippets, and credentials. Users must be able to search titles, URLs, descriptions, notes, snippet code, usernames/emails, and tags, supporting structured filters (`type:`, `tag:`, `is:favorite`, `is:archived`, date ranges, and quoted phrases).

The application is constrained by two critical architectural principles:
1. **Zero Server Plaintext:** The server never receives search queries, search terms, or unencrypted content. Server-side search (e.g. Elasticsearch, Meilisearch, or D1 `LIKE` queries) is strictly prohibited.
2. **Encrypted Rest Storage:** IndexedDB stores records as ciphertext blobs. Querying IndexedDB directly on ciphertext is impossible without decrypting every record individually on each keystroke, which would cause severe performance degradation for 5,000 records.
3. **No Plaintext Persistence:** Persisting a decrypted search index to disk (in IndexedDB, Cache API, or localStorage) would violate the threat model and expose vault content to offline disk inspection without master passphrase derivation.

### Decision

We use **MiniSearch** (or an equivalent lightweight client-side search library) to construct an **ephemeral in-memory full-text index** when the vault is unlocked.

- The index is built exclusively in volatile JavaScript application memory immediately after the master passphrase unwraps the Data Encryption Key (DEK) and local records are decrypted.
- The index indexes titles, URLs, notes, snippets, usernames/emails, tags, and timestamps in memory.
- As records are created, updated, or deleted, the in-memory index is incrementally updated.
- **Immediate Discard on Lock:** When the user locks the vault (manually or via inactivity timeout), the entire MiniSearch index and all decrypted records are discarded from memory and garbage collected.
- **Zero Disk and Network Leaks:** Neither the index nor search queries are ever persisted to storage or transmitted across the network.

### Consequences

#### Positive
- **High Performance:** MiniSearch provides sub-millisecond query evaluation, easily achieving the target of <200 ms p95 search latency across 5,000 items (PRD §3, §12).
- **Expressive Query Syntax:** Enables native support for prefix matching, fuzzy search, and structured filters (`type:link`, `tag:"work"`, `is:favorite`, `updated:...`).
- **Complete Confidentiality:** Search terms never leak to Cloudflare Pages Functions, D1, or edge logs.
- **Clean Threat Boundary:** Disk storage remains 100% encrypted ciphertext at all times.

#### Negative / Trade-offs
- **Unlock Latency:** Decrypting and indexing 5,000 small text records during vault unlock incurs an initial processing cost (typically 100–300 ms on modern hardware).
- **Memory Footprint:** The in-memory index and decrypted record objects consume browser RAM while unlocked (estimated 5–15 MB for 5,000 records).
- **No Background Indexing:** Search is strictly unavailable while the vault is locked; the index must be rebuilt on each subsequent unlock.

---

## 0005. Revision-Based Optimistic Concurrency Sync over Distributed Frameworks

- **Status:** Accepted
- **Date:** 2026-10-13
- **Source:** `personal-vault-prd-v3.md` §2 (Decision 7), §8 (FR-4), §11, §16

### Context

Personal Vault allows users to create, update, and delete vault records across multiple authorized devices. A synchronization protocol is required to propagate changes reliably through Cloudflare edge infrastructure.

We evaluated whether to integrate a distributed synchronization framework or CRDT library (e.g. Yjs, Automerge, PouchDB/CouchDB, WatermelonDB, ElectricSQL) versus implementing a direct, protocol-level revision and cursor mechanism.

Considerations:
1. **Zero-Plaintext Invariant:** The sync server receives only opaque ciphertext blobs (`vault_records.ciphertext`). CRDTs and collaborative frameworks typically operate on structured plaintext object graphs or character-by-character operation streams. Applying CRDTs over opaque encrypted blobs adds immense complexity without providing automated merging benefits.
2. **Single-Owner Pattern:** The user edits records on one device at a time, or occasionally across two devices. Concurrent simultaneous edits to the same field are rare; true real-time collaborative editing (Google Docs style) is an explicit non-goal (PRD §4).
3. **Bundle Size & Dependencies:** Distributed sync engines introduce heavy client-side bundles and often mandate dedicated WebSocket servers, stateful sync backends, or specific database extensions incompatible with Cloudflare D1.

### Decision

We implement a **custom revision-based optimistic concurrency protocol** backed by Cloudflare D1 and Dexie.js, omitting distributed sync frameworks for the MVP:

1. **Per-Record Revisions:** Each record tracks a monotonic integer `revision` (starting at `1`).
2. **Append-Only Change Cursor:** The server maintains an append-only change log (`sync_changes`) with a monotonic sequence `seq`. Clients pull remote changes using a durable cursor.
3. **Optimistic Concurrency & Compare-and-Swap (CAS):** When submitting mutations (`POST /api/v1/sync/batch`), clients supply `expected_revision`. The server validates `expected_revision == current_revision`. If mismatched, the server rejects the edit with `409 REVISION_CONFLICT` and returns the latest server revision and ciphertext.
4. **Idempotency Keys:** Every mutation includes a client-generated `mutation_id` (UUIDv4) to guarantee idempotent processing during network retries.
5. **Tombstones for Deletion:** Deletions write a tombstone record with `is_tombstone = true` and `NULL` ciphertext. Tombstones are retained indefinitely in MVP to prevent deleted items from resurrecting.
6. **Explicit Conflict Resolution:** Conflicting edits never silently overwrite (no Last-Write-Wins). The client preserves both local and remote versions and presents the user with explicit choices: **Keep local as a new item** or **Use remote version**. Concurrent delete-vs-edit conflicts present an explicit manual resolution dialog.
7. **Idempotent Download Apply (G6):** Downloaded change pages are applied idempotently keyed by `(record_id, revision, change_seq)`.

### Consequences

#### Positive
- **Minimal Footprint:** Zero third-party sync runtime dependencies; negligible bundle size impact.
- **Strict Zero-Plaintext Alignment:** The server operates strictly on opaque ciphertext blobs, timestamps, and sequence integers without needing knowledge of record contents.
- **Deterministic Edge Execution:** The protocol maps directly to standard SQLite transactions in Cloudflare D1.
- **Resilient Recovery:** Disconnects, retries, and quota interruptions cannot corrupt local state or silently discard queued edits.

#### Negative / Trade-offs
- **No Automatic Field-Level Merging:** If two devices edit different fields of the same record concurrently, the system flags a revision conflict rather than automatically combining the fields. For a personal vault with 5,000 items, this is an acceptable and safe trade-off.
- **Tombstone Retention:** MVP does not garbage-collect tombstones; tombstone cleanup is deferred to post-MVP.

---

## 0006. Two-Tier Device Authentication and Custom Ed25519 Request Signing

- **Status:** Accepted
- **Date:** 2026-10-13
- **Source:** `personal-vault-prd-v3.md` §2 (Decision 2), §8 (FR-5), §9 (Req 2, 3), §10, §11, §18

### Context

Personal Vault has no user accounts, email logins, or central identity provider. Authorization is anchored directly in individual user devices explicitly authorized by the vault owner.

In a naive bearer token architecture, a client presents an opaque bearer token on every request. However, if a device bearer token is intercepted in transit, extracted from client memory, or leaked, an attacker could silently inject forged records, delete items, alter the master cryptographic envelope (`PUT /api/v1/vault/crypto-metadata`), generate pairing tickets, or revoke legitimate devices.

We required an authentication architecture that defends against bearer token theft while avoiding external identity dependencies (Auth0, Firebase, Supabase, OAuth).

### Decision

We implement a **two-tier device authorization model** combining high-entropy bearer tokens with cryptographic **Ed25519 request signatures**:

1. **256-bit Device Bearer Token:**
   - Generated client-side (or server-side during exchange/recovery) with 256 bits of cryptographic entropy.
   - The server stores **only** the SHA-256 hash (`device_token_hash`). Raw tokens are never stored or logged on the server.
   - The client stores the token encrypted locally in IndexedDB under a DEK-derived key (`PV-V1/LOCAL-CRED`).
2. **Ed25519 Device Keypair:**
   - Each device generates a persistent Ed25519 signing keypair during enrollment.
   - The public key is stored in D1 (`authorized_devices.device_public_key`).
   - The private key is stored encrypted locally under the DEK (`PV-V1/LOCAL-CRED`).
3. **Two Authorization Tiers:**
   - **Tier 1 (Read-Only):** `GET /api/v1/vaults/:vaultId/bootstrap` and `GET /api/v1/sync` require a valid device bearer token in `Authorization: Bearer <token>`.
   - **Tier 2 (Mutating & Administrative):** `POST /api/v1/sync/batch`, `POST /api/v1/pairing-tickets`, `POST /api/v1/devices/:deviceId/revoke`, and `PUT /api/v1/vault/crypto-metadata` require **both** the bearer token and an Ed25519 cryptographic signature.
4. **Signature Specification (`PV-Device` Header):**
   - Mutating requests supply the signature in a custom header:
     `PV-Device: device_id="<UUID>", timestamp="<ISO-8601-UTC>", nonce="<UUID>", signature="<base64url-sig>"`
   - The signature signs the canonical string:
     `METHOD\nPATH\nTIMESTAMP\nNONCE\nSHA256(BODY)`
   - The server validates that `timestamp` is within ±5 minutes of server time and enforces replay protection on nonces.
   - Every API response includes `X-Server-Time: <ISO-8601-UTC>` to allow clients to correct clock skew.
5. **Automatic Device Labeling:**
   - When a device is registered or paired, it automatically receives a label formatted as **`Device-XXXX`** (where `XXXX` is a random 4-character hex or alphanumeric string).
   - The user can rename the device in Settings at any time (synced via signed endpoint `POST /api/v1/devices/:deviceId/label`).

### Consequences

#### Positive
- **Defense in Depth Against Token Theft:** An attacker possessing only a stolen device bearer token cannot alter, delete, or inject records, cannot generate pairing tickets, and cannot revoke devices.
- **Zero External Auth Dependencies:** Operates without third-party authentication services, recurring fees, or external network calls.
- **Replay Protection:** Request nonces and the strict ±5-minute timestamp window prevent replay attacks.
- **User Device Hygiene:** Automatic `Device-XXXX` labeling provides immediate identification in the device management UI without forcing manual text input during setup.

#### Negative / Trade-offs
- **Worker Verification CPU:** The Worker must execute Ed25519 signature verification on all mutating requests (completes well within the 10 ms CPU budget).
- **Client Key Management:** The client must securely store and handle the Ed25519 private key in IndexedDB (encrypted under DEK).

---

## 0007. ULID for Vault Identifiers and UUIDv4 for Records and Entities

- **Status:** Accepted
- **Date:** 2026-10-13
- **Source:** `personal-vault-prd-v3.md` §8 (FR-1, FR-4, FR-5), §10, Appendix C

### Context

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

### Decision

We adopt a split identifier strategy:
1. **`vault_id` uses ULID (Universally Unique Lexicographically Sortable Identifier):**
   - 26-character Crockford Base32 string (e.g. `01J9Z8QK7M3V6P2R5T8W4Y6U1A`).
   - Opaque, URL-safe, case-insensitive, and excludes easily confused characters (`I`, `L`, `O`, `U`).
   - Compact and transcription-friendly for QR codes and recovery kit JSON files.
2. **`record_id`, `device_id`, `mutation_id`, and `ticket_id` use RFC 4122 UUIDv4:**
   - 36-character canonical lowercase hex string with hyphens (e.g. `550e8400-e29b-41d4-a716-446655440000`).
   - Provides 122 bits of cryptographic randomness.
   - Universally supported by SQLite/D1, IndexedDB, and standard libraries without custom encoding requirements.

### Consequences

#### Positive
- **Human-Friendly Recovery Identifiers:** The 26-character Crockford Base32 `vault_id` is significantly cleaner and less error-prone when typed manually during an all-devices-lost recovery flow than a 36-character hyphenated UUID.
- **Decentralized Generation:** Clients generate `record_id` and `mutation_id` autonomously during offline operations with zero risk of collision.
- **Database Index Optimization:** ULIDs are lexicographically sortable by creation timestamp, optimizing B-tree index locality for the `vaults` table in Cloudflare D1.
- **Zero Enumeration Risk:** Both ULID and UUIDv4 prevent sequential ID enumeration attacks.

#### Negative / Trade-offs
- **Two Identifier Formats:** The codebase and schema handle two different string formats (`ULID` for vaults, `UUIDv4` for records/devices). This is addressed through strict type validation schemas (Zod).
- **Client Dependency:** Requires bundling lightweight generators/validators for ULID and UUIDv4 in the client.

---

## 0008. Bilingual Interface (Indonesian and English) with Device Locale Fallback

- **Status:** Accepted
- **Date:** 2026-10-13
- **Source:** User decisions (2026-10-13); `personal-vault-prd-v3.md` §7, §8 (FR-9)

### Context

Personal Vault is designed as a personal information vault utilized in bilingual environments, specifically requiring support for Indonesian (*Bahasa Indonesia*, `id`) and English (`en`).

Key considerations:
1. **Critical User Flows:** Critical operations—such as vault creation, master passphrase setup, recovery kit confirmation, device pairing, and conflict resolution—carry significant security consequences. Misunderstanding technical instructions or security warnings due to language barriers can lead to unrecoverable data loss.
2. **Performance & Bundle Size:** Heavy internationalization frameworks (such as full-featured i18next bundles with remote backend loaders) add unnecessary runtime overhead and complexity to a lightweight PWA.
3. **User Content Neutrality:** Vault content itself (titles, notes, snippets, URLs, tags) is user-authored UTF-8 plaintext stored as encrypted binary blobs. The localization system only affects application shell strings, dialogs, buttons, validation errors, and guidance copy.

### Decision

We implement a **lightweight bilingual architecture supporting Indonesian (`id`) and English (`en`)**:

1. **Locale Detection & Fallback:**
   - On initial launch, the application inspects the device environment (`navigator.language` / `navigator.languages`).
   - If the detected locale begins with `en` (e.g., `en-US`, `en-GB`), English is selected.
   - If the detected locale begins with `id` (e.g., `id-ID`), Indonesian is selected.
   - If the detected locale is neither or cannot be determined, the application **falls back to Indonesian (`id`)**.
2. **User Preference Override:**
   - The user can explicitly override the active language at any time in **Settings** (FR-9). The preference is persisted in the local Dexie `app_metadata` store.
3. **Implementation Mechanism:**
   - Bundled static dictionary files (`src/locales/id.json` and `src/locales/en.json`) loaded directly with the application.
   - Translation helper provides type-safe key lookup with string interpolation without heavy external dependencies.
   - Stable error codes from PRD Appendix A map cleanly to localized user-facing descriptions in both languages.

### Consequences

#### Positive
- **Clear Guidance on High-Stakes Flows:** Critical security warnings are delivered clearly in the user's primary language.
- **Zero Latency:** Translation dictionaries are bundled with the app shell and cached by the service worker, enabling instant offline rendering without asynchronous language pack network fetches.
- **Deterministic Fallback:** Explicit fallback to Indonesian aligns with user profile requirements while accommodating standard English browser environments.

#### Negative / Trade-offs
- **Maintenance Overhead:** Every new UI feature, validation rule, or error message must be authored and verified in both Indonesian and English dictionaries before release.
- **Scope Limit:** Additional languages beyond Indonesian and English are excluded from the MVP.

---

## 0009. Cloudflare Pages Subdomain First Deployment Strategy

- **Status:** Accepted
- **Date:** 2026-10-13
- **Source:** User decisions (2026-10-13); `personal-vault-prd-v3.md` §2 (Decisions 8, 9), §13, Appendix C

### Context

Personal Vault targets a $0/month operating cost within Cloudflare Free tier quotas (PRD §2.9).

A production web application requires a secure, publicly accessible HTTPS domain to support:
1. **PWA Installation:** Web browsers require a secure origin (HTTPS) to register Service Workers and prompt for PWA installation.
2. **Cryptographic APIs:** Web Crypto and WebAssembly features require a secure context (`isSecureContext === true`).
3. **Recovery Kit Identifier:** The `api_origin` field inside `personal-vault-recovery-kit.json` (PRD Appendix C) must reference an exact, reachable HTTPS origin so an owner can re-locate their cloud vault when all previous devices are lost.

Setting up a custom top-level domain (e.g. `vault.example.com`) incurs domain registration fees (conflicting with the $0/month target) or requires managing DNS zone delegations and domain expiration dates.

### Decision

We adopt a **`pages.dev` first** deployment strategy:

1. **Deploy to Default Subdomain:** The production application deploys directly to Cloudflare Pages' managed default subdomain:
   `https://<project-name>.pages.dev`
2. **Predictable Recovery Origin:** The recovery kit file automatically records this origin as `api_origin`:
   `"api_origin": "https://<project-name>.pages.dev"`
3. **Defer Custom Domains:** Custom domain configuration is strictly optional and deferred to post-MVP. Cloudflare Pages natively supports binding custom apex domains or subdomains at any point via dashboard configuration with zero code or schema modifications.

### Consequences

#### Positive
- **Guaranteed $0/Month Budget:** No domain purchase, renewal, or registrar privacy fees.
- **Instant Automatic TLS:** Cloudflare Pages automatically provisions and renews managed wildcard TLS certificates for `*.pages.dev` with modern cipher suites and HTTP/2/3.
- **Zero DNS Operational Friction:** Eliminates manual CNAME, A-record, or nameserver configuration during setup.
- **Stable Origin for CSP:** Simplifies Content Security Policy (CSP) headers and Service Worker cache scoping.

#### Negative / Trade-offs
- **Fixed Subdomain Naming:** The project name chosen in the Cloudflare Pages dashboard dictates the public URL (`https://<project-name>.pages.dev`). Changing the project name alters the URL and would invalidate `api_origin` entries stored in existing recovery kits.
- **Shared Top-Level Domain:** The `.pages.dev` domain is shared with other Cloudflare Pages users, which requires diligent application-level origin isolation (enforced by the vault's single-tenant client-side encryption and strict same-origin API structure).