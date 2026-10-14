# Personal Vault — Security Model and Threat Analysis Specification

> **Normative Source & Precedence**  
> This specification defines the authoritative security model, threat boundaries, error taxonomy, rate-limiting policies, and security invariants for Personal Vault.  
> Derived directly from `personal-vault-prd-v3.md` v3.0 (2026-10-13) §2 (Architecture decisions), §5 (Platform limitations), §8 (Functional requirements FR-1 through FR-9), §9 (Security model and threat boundaries), §10 (Data model), §11 (API and synchronization protocol), Appendix A (Stable error codes), Appendix B (Application-level rate limits), Appendix C (Recovery-kit file), and Appendix D (Crypto/format versions).  
> **On any discrepancy or conflict between this document and the PRD, the PRD WINS.**  
> Any unresolved ambiguity is marked with a normative `> TODO(question): ...` annotation.

---

## 1. System Architecture & Trust Boundaries

*Citations: PRD §2 (Architecture decisions), §6 (Tech stack), §9 (Security model), §10 (Data model).*

Personal Vault implements a zero-trust, passwordless, device-centric architecture backed by a zero-knowledge cloud synchronization engine. The system is split across three trust domains separated by explicit trust boundaries.

```
+-----------------------------------------------------------------------------------+
| CLIENT TRUST BOUNDARY (Browser / PWA / Device Sandbox)                            |
|                                                                                   |
|  +-----------------------------------------------------------------------------+  |
|  | VOLATILE MEMORY (Unlocked State Only)                                       |  |
|  | - Master Passphrase (transient during KDF)                                  |  |
|  | - Data Encryption Key (DEK) & Derived Subkeys (HKDF)                       |  |
|  | - Ed25519 Device Signing Private Key                                        |  |
|  | - Plaintext Vault Records & MiniSearch In-Memory Index                      |  |
|  +-----------------------------------------------------------------------------+  |
|                                                                                   |
|  +-----------------------------------------------------------------------------+  |
|  | DURABLE LOCAL STORAGE (Dexie.js / IndexedDB) - Encrypted At Rest            |  |
|  | - `records`: Ciphertext payloads + Nonces + Revisions only                  |  |
|  | - `outbox`: Encrypted mutations awaiting sync                              |  |
|  | - `device_credentials`: Device token & Ed25519 private key encrypted under  |  |
|  |   DEK-derived local key (`PV-V1/LOCAL-CRED`)                                 |  |
|  | - `app_metadata`: Opaque IDs, versions, lock timeout, sync cursors         |  |
|  |   *NO plaintext items, NO master passphrase, NO recovery secret*            |  |
|  +-----------------------------------------------------------------------------+  |
+-----------------------------------------------------------------------------------+
                                         |
                                         | [Boundary: TLS 1.3 / HTTPS]
                                         | [Request Signing: Ed25519 over body digest + ts]
                                         | [Clock Window: ±5 Minutes]
                                         v
+-----------------------------------------------------------------------------------+
| TRANSPORT & EDGE BOUNDARY (Cloudflare Edge Network)                               |
| - TLS Termination & Strict HTTPS Enforcement                                     |
| - Security Headers Injection (CSP, nosniff, no-referrer, DENY)                    |
| - Origin Boundary: Same-origin `/api/v1/*` under Cloudflare Pages Functions       |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
| UNTRUSTED SERVER & STORAGE BOUNDARY (Cloudflare Workers / Pages Functions + D1)   |
|                                                                                   |
|  +-----------------------------------------------------------------------------+  |
|  | WORKERS COMPUTE RUNTIME                                                      |  |
|  | - Request schema validation & payload size gate (384 KiB / 1 MiB)           |  |
|  | - Device authentication (SHA-256 token hash lookup)                         |  |
|  | - Ed25519 signature verification against registered device public key       |  |
|  | - Replay prevention (clock skew check, single-use tickets)                  |  |
|  | - Application-level rate limiting (D1-backed counters)                      |  |
|  | *NO cryptographic decryption keys, NO plaintext processing, NO item search*  |  |
|  +-----------------------------------------------------------------------------+  |
|                                                                                   |
|  +-----------------------------------------------------------------------------+  |
|  | CLOUDFLARE D1 RELATIONAL STORAGE (SQLite at Edge)                            |  |
|  | - `vaults`: Argon2id envelopes, recovery envelopes, verifier hashes         |  |
|  | - `vault_records`: Ciphertext payloads (<= 384 KiB), nonces, revisions      |  |
|  | - `authorized_devices`: Token hashes, Ed25519 public keys, labels           |  |
|  | - `pairing_tickets`: Ticket hashes, 5-min TTL, atomic consumed timestamps   |  |
|  | - `sync_changes`: Append-only sequence numbers, record IDs, revisions       |  |
|  | *ZERO plaintext indexes; ZERO user credentials; ZERO search indexes*         |  |
|  +-----------------------------------------------------------------------------+  |
+-----------------------------------------------------------------------------------+
```

### 1.1 Client Boundary (Browser Sandbox & PWA)
- **Trusted Computing Base (TCB):** The client execution environment includes the host browser, OS memory space, the deployed application bundle, and the pinned `libsodium-wrappers-sumo` WebAssembly (WASM) binary.
- **Volatile vs. Rest States:** Decrypted vault items, plaintext field contents, plaintext search indices (`MiniSearch`), the Data Encryption Key (DEK), derived cryptographic subkeys, and decrypted device signing keys exist **strictly in volatile JavaScript memory while unlocked** (PRD §10). React component state, persistent contexts, and local storage mechanisms must never persist plaintext snapshots.
- **Local Persistence Boundary:** IndexedDB persistence (via Dexie.js) stores solely ciphertext payloads, envelope parameters, opaque identifiers, and encrypted device credentials. The master passphrase and recovery secret are never written to IndexedDB (PRD §10).
- **Physical & Memory Compromise Limits:** If the host device OS or browser is compromised by malware, root access, debugger attachment, or malicious browser extensions while unlocked, in-memory keys and decrypted records may be exfiltrated. Physical security of the unlocked device rests with the user (PRD §9).

### 1.2 Transport Boundary (HTTPS & Authenticated Edge)
- **Channel Security:** All communication with `/api/v1/*` routes requires HTTPS (TLS 1.3/1.2) terminated at the Cloudflare edge. Plain HTTP is rejected or redirected (PRD §9, §11).
- **Two-Tier Authentication:**
  1. *Read-Only Operations (`GET /bootstrap`, `GET /sync`):* Authenticated via high-entropy device bearer token transmitted in custom `Authorization: PV-Device ...` or bearer scheme.
  2. *Mutating Operations (`POST /sync/batch`, `POST /pairing-tickets`, `POST /revoke`, `PUT /crypto-metadata`):* Require both device token identification and an Ed25519 cryptographic signature generated by the registered device key, binding the HTTP method, request path, ISO timestamp within a ±5-minute window, unique mutation/request nonce, and SHA-256 body digest (PRD §8 FR-5, §9, §11).
- **Network Eavesdropping:** An attacker eavesdropping on transport sees only TLS-encrypted traffic. Even if TLS were terminated or intercepted by a malicious proxy, the attacker observes only encrypted payloads, token hashes, signatures, and opaque metadata, but zero vault plaintext.

### 1.3 Server & Storage Boundary (Cloudflare Pages Functions & D1)
- **Zero-Knowledge Server:** The server runtime (Cloudflare Workers) and database (Cloudflare D1) are completely untrusted with vault plaintext. The server never receives, derives, or stores master passphrases, recovery secrets, DEKs, or decrypted item payloads (PRD §9, §10).
- **Zero-Plaintext-Indexes Invariant:** D1 tables store only opaque IDs (`vault_id` ULID, `record_id` UUID, `device_id` UUID), monotonic sequence counters, integer revisions, cryptographic envelopes, base64url-encoded ciphertext, token hashes, and public keys. No plaintext columns or SQL indexes exist for titles, URLs, tags, content, notes, snippets, or search terms (PRD §10).
- **Compromise Boundary:** A total server-side breach—including full exfiltration of the D1 SQL database or compromised Cloudflare edge execution—exposes only ciphertext and envelope metadata. Offline decryption requires brute-forcing the Argon2id13 password envelope or factoring 256-bit keys, which is computationally infeasible when user passphrase requirements and PRD parameter floors are enforced.

---

## 2. Threat Analysis: Protected vs. Explicitly NOT Protected

*Citations: PRD §5 (PWA limitations), §8 (FR-1, FR-4, FR-5, FR-6), §9 (Security model and threat boundaries).*

### 2.1 Protected Against by Design (Normative PRD §9)

| Threat / Attack Vector | Mitigation & Technical Implementation | PRD Citation |
|---|---|---|
| **Passive database disclosure** | All item contents are encrypted with XChaCha20-Poly1305 before transmission. D1 stores solely ciphertext and key envelopes. Zero plaintext fields or search indexes exist server-side. | PRD §9, §10 |
| **Network interception & eavesdropping** | Transport Layer Security (TLS/HTTPS) enforced at edge. All API endpoints require authenticated tokens and signatures. Plain HTTP rejected. | PRD §9, §11 |
| **Simple device-token theft** | Possessing a device bearer token alone does not authorize mutations, new-device pairing, or device revocation. All sensitive mutations mandate an Ed25519 digital signature from the device private key. | PRD §8 (FR-5), §9 |
| **Ciphertext tampering & bit-flipping** | Authenticated Encryption with Associated Data (AEAD: XChaCha20-Poly1305) with 128-bit Poly1305 MAC. AAD binds `vault_id`, `record_id`, `schema_version`, `key_version`, and context `"record"`. Decryption fails closed on any alteration without returning partial plaintext. | PRD §8 (FR-1, FR-6), §9 |
| **Duplicate / replayed sync mutations** | Client-generated UUIDv4 `mutation_id` idempotency keys, optimistic concurrency control (`expected_revision`), timestamp freshness checks (±5-minute window), and signed body digests reject repeated operations as duplicate edits. | PRD §8 (FR-4), §9, §11 |
| **Server-side credential spoofing** | Server stores only `SHA-256(device_token)` and `SHA-256(ticket)`. Server compromise never yields raw usable bearer tokens or raw pairing codes. | PRD §8 (FR-5), §10 |
| **Brute-force credential guessing on API** | Strict application-level rate limits backed by D1 counters (Appendix B) return `429 RATE_LIMITED` with `Retry-After` on burst requests and attack patterns. | PRD §9, Appendix B |
| **WASM crypto downgrade / tampering** | Blocking failure policy: If the pinned `libsodium` WASM module fails to load or execute, the app shuts down all vault operations immediately. Zero fallback to unencrypted or weaker JS crypto. | PRD §2.11, §8 (FR-6), §9 |

### 2.2 Explicitly NOT Protected Against (Normative PRD §9)

The following attack vectors fall outside the system's threat boundary or represent accepted operational bounds:

1. **Active XSS or Malicious Frontend Code:**
   - *Threat:* If malicious JavaScript executes in the client context (via dependency supply chain attack, compromised Cloudflare Pages build, or injected script), the attacker can access decrypted vault data, master passphrases, and private keys while the vault is unlocked.
   - *Boundary:* The deployed frontend bundle, build pipeline, and hosting platform are part of the Trusted Computing Base (TCB). Mitigated by strict CSP, dependency pinning, subresource integrity/hashing, and zero external runtime CDNs, but XSS defeats client-side in-memory encryption (PRD §9).
2. **Compromised Host Device / Unlocked Physical Access:**
   - *Threat:* Malware, rootkits, keyloggers, screen scrapers, or an attacker with physical access to an unlocked device can read plaintext records and copy in-memory keys.
   - *Boundary:* The application cannot protect plaintext data against a compromised OS or an unlocked screen. Mitigated by configurable idle auto-lock (default 15 minutes, maximum 60 minutes), immediate lock on window blur/visibility change (optional), and clipboard auto-clearing after 30 seconds (PRD §8 FR-6, FR-8, §9).
3. **Offline Master Passphrase Brute-Force on Exfiltrated Database:**
   - *Threat:* An attacker who obtains an exfiltrated copy of the D1 database can extract the master-password key envelope and perform offline dictionary or brute-force attacks against the Argon2id13 key derivation.
   - *Boundary:* Encryption strength depends on user passphrase entropy. Mitigated by enforcing a strict Argon2id13 parameter floor (64 MiB memory, 3 iterations, parallelism 1) and minimum 8-character passphrase policy, but short or weak passphrases can be cracked offline if the database is leaked (PRD §8 FR-6, §9).
4. **Server Metadata Disclosure:**
   - *Threat:* The cloud provider, edge network, or database operator can observe structural and traffic metadata: vault IDs, record IDs, ciphertext byte lengths, revision histories, sync timestamps, mutation frequencies, and minimal device labels.
   - *Boundary:* The application does not implement oblivious RAM (ORAM) or fixed-size universal ciphertext padding. Metadata leakage is acknowledged and must be disclosed in the application privacy notices (PRD §9, §FR-9).
5. **Post-Revocation Data Erasure on Lost Devices:**
   - *Threat:* When an authorized device is revoked via the API, previously synchronized ciphertext and encrypted credentials stored locally in its IndexedDB cannot be remotely erased or wiped by the server.
   - *Boundary:* Revocation terminates future API sync and pairing authorization (`401 DEVICE_REVOKED`), but local offline copies persist until the user physically wipes the device or resets browser storage (PRD §9).
6. **Browser Storage Eviction & Clearing:**
   - *Threat:* Browsers may evict client-side IndexedDB databases under storage pressure, user clearing of site data, or WebKit's 7-day Intelligent Tracking Prevention (ITP) eviction rule on standalone/browser iOS web apps without home-screen installation.
   - *Boundary:* Local persistence is not guaranteed to be permanent. Users must retain their Recovery Kit (`personal-vault-recovery-kit.json`) and maintain regular encrypted exports to prevent permanent data loss (PRD §5, §8 FR-7, §9).

---

## 3. Metadata Disclosure & Server-Visible Surface

*Citations: PRD §8 (FR-9), §9 (Security model), §10 (Data model).*

Personal Vault guarantees zero-plaintext storage of item contents, credentials, and search queries. However, cloud synchronization requires exposing minimal structural and operational metadata to the server. The client UI must explicitly disclose these leakages in the settings and security panel (PRD §8 FR-9, §9).

### 3.1 Server-Visible Metadata vs. Encrypted Invariants

| Attribute / Field | Stored In Server D1 | Visible To Cloudflare / ISP | Cryptographic Protection | Threat Context & Leakage |
|---|---|---|---|---|
| **Vault Identifier (`vault_id`)** | Yes (`vaults.vault_id`) | Yes (URL path parameter) | Opaque ULID (26 Crockford Base32) | Identifies account container. Reveals no user identity or email. |
| **Record Identifiers (`record_id`)** | Yes (`vault_records.record_id`) | Yes (URL path parameter) | Opaque UUIDv4 (36 chars) | Randomly generated; reveals no item semantics, types, or names. |
| **Device Identifiers (`device_id`)** | Yes (`authorized_devices`) | Yes (Header / Request body) | Opaque UUIDv4 (36 chars) | Tracks authorized clients. |
| **Ciphertext Payload Sizes** | Yes (`LENGTH(ciphertext)`) | Yes (HTTP payload byte length) | Encrypted (XChaCha20-Poly1305) | Reveals approximate item size (within 0–384 KiB). May allow distinguishing large notes/attachments from short passwords. |
| **Record Revisions (`revision`)** | Yes (`vault_records.revision`) | Yes (JSON sync body) | Plaintext monotonic integer | Discloses mutation count and edit frequency of specific records. |
| **Global Change Sequence (`change_seq`)** | Yes (`sync_changes.seq`) | Yes (URL query parameter) | Plaintext monotonic integer | Discloses cumulative vault activity volume. |
| **Mutation Timestamps (`updated_at`)** | Yes (D1 server timestamp) | Yes (HTTP request timing) | Server-recorded UTC ISO-8601 | Reveals usage habits, active hours, and timezone patterns. |
| **Device Labels (`label`)** | Yes (`authorized_devices.label`) | Yes (JSON body on exchange) | Sanitized UTF-8 string | Reveals device OS/browser class (e.g. "Safari on iPhone", "Chrome on Linux"). |
| **Format & Schema Versions** | Yes (`schema_version`, etc.) | Yes (Plaintext triage columns) | Plaintext integer (`1`) | Reveals application version compatibility level. |
| **Deletion Indicators (Tombstones)** | Yes (`is_tombstone = 1`) | Yes (JSON sync response) | Boolean flag | Discloses that a record was deleted and the timestamp of deletion. |
| **Client IP Addresses** | No (Not stored in D1 schema) | Yes (Cloudflare edge routing) | Transient edge visibility | Used transiently for rate-limiting `POST /vaults` (3/IP/hr); not persisted in vault tables. |
| **Item Titles, URLs, Tags** | **NEVER** | **NEVER** | Encrypted inside XChaCha20 payload | Fully protected inside AEAD envelope. Zero server visibility. |
| **Usernames, Passwords, Notes** | **NEVER** | **NEVER** | Encrypted inside XChaCha20 payload | Fully protected inside AEAD envelope. Zero server visibility. |
| **Search Queries & Indexes** | **NEVER** | **NEVER** | Evaluated client-side in RAM | Zero server visibility. |
| **Master Passphrase & DEK** | **NEVER** | **NEVER** | Client-side memory only | Server holds only password-wrapped DEK envelope. |
| **Raw Recovery Secret** | **NEVER** | **NEVER** | Offline / User possession | Server holds only recovery-wrapped DEK + `recovery_auth_verifier` hash. |
| **Raw Device Tokens & Private Keys**| **NEVER** | **NEVER** | Token hashed (SHA-256); key stays on device | Server holds token hash and Ed25519 public key only. |

---

## 4. Ten Mandatory Security Requirements

*Citations: PRD §9 (Security requirements 1–10).*

The following ten requirements are normative and binding across client and server implementations:

```
+---------------------------------------------------------------------------------------------------+
| TEN MANDATORY SECURITY REQUIREMENTS (PRD §9)                                                      |
+----+----------------------------------------------------------------------------------------------+
| 1  | NO PLAINTEXT LOGGING: Zero secrets, decrypted items, passphrases, tokens in server/client logs|
| 2  | STRICT INPUT VALIDATION: Bounded payloads, schema validation, parameterized SQL, per-vault auth   |
| 3  | RESTRICTIVE HEADERS & CSP: Same-origin API, nosniff, no-referrer, frame DENY, zero runtime CDNs  |
| 4  | PINNED WASM CRYPTO CSP: Minimal 'wasm-unsafe-eval' scope, pinned binary hash checked in CI   |
| 5  | NO SERVER URL FETCHING: Strict client-side URL validation, HTML escaping, text-only notes     |
| 6  | ATOMIC PAIRING TICKETS: 5-minute TTL, single-active-ticket index, single-use atomic consumption   |
| 7  | APPLICATION RATE LIMITING: D1-backed counters, 429 RATE_LIMITED with Retry-After on Free tier  |
| 8  | DEPENDENCY HYGIENE: Pinned lockfile, vulnerability scanning, audited crypto/routing updates  |
| 9  | CRYPTO VERSION MIGRATIONS: Formal format versions (v1), forward-compatibility and tamper tests |
| 10 | NO FALSE AUDIT CLAIMS: Clear disclosure of personal-project status, internal test gate       |
+----+----------------------------------------------------------------------------------------------+
```

### 4.1 Requirement 1 — No Plaintext Vault Content or Secrets in Server Logs
- **Normative Rule:** No plaintext vault content, master passphrases, recovery secrets, raw device tokens, decrypted signing private keys, or decrypted item fields may appear in server logs, edge console logs, telemetry, error trackers, or HTTP response headers (PRD §9.1).
- **Error Sanitization:** All API error responses emit sanitized messages from Appendix A. Stack traces, raw SQL queries, parameter dumps, and database driver errors must be suppressed in production (PRD §11, Appendix A).
- **Client Diagnostics:** Client debug consoles must mask password values, note contents, and decrypted credentials before emitting diagnostic logs.

### 4.2 Requirement 2 — Strict Request Validation, Parameterized SQL & Bounded Payloads
- **Input Validation:** Request bodies must be validated against strict JSON schemas before database access. Malformed UUIDs, unexpected properties, or invalid enums trigger immediate `400 VALIDATION_ERROR` (PRD §9.2, Appendix A).
- **Database Hygiene:** All D1 queries must use parameterized SQL bindings (`db.prepare("...").bind(...)`). String concatenation for SQL queries is strictly prohibited (PRD §9.2).
- **Per-Vault Authorization:** Every API endpoint must enforce vault isolation: callers may access records, cursors, tickets, and devices belonging exclusively to the authenticated `vault_id` (PRD §9.2, §11).

### 4.3 Requirement 3 — Same-Origin Architecture, Restrictive Headers & No Remote CDNs
- **Hosting Model:** The API and frontend static assets share the same origin (`/api/v1/*` under Cloudflare Pages Functions). No cross-origin CORS headers are permitted for third-party origins (PRD §9.3, §11).
- **No Third-Party Runtime Dependencies:** All runtime code, fonts, icons, styling, and WebAssembly modules must be bundled locally into the production build. Zero external runtime CDN scripts or stylesheets are permitted (PRD §9.3).
- **Transport Security Headers:** Mandated on all responses (see Section 6).

### 4.4 Requirement 4 — Pinned WASM Crypto Build & Scoped CSP Permissions
- **WASM Policy:** The Content Security Policy must restrict script execution to `'self'`, permitting only the specific WASM execution capability required by the crypto engine (`script-src 'self' 'wasm-unsafe-eval'`) (PRD §9.4).
- **No Global Weakening:** CSP must not be weakened globally with `'unsafe-eval'`, `'unsafe-inline'` scripts, or wildcards to satisfy convenience libraries (PRD §9.4).
- **Hash Pinning in CI:** The SHA-256 hash of the compiled `libsodium` WASM binary must be pinned in configuration and verified against the build output during production CI checks (PRD §9.4, §14).

### 4.5 Requirement 5 — No Server-Side URL Fetching & Mandatory HTML Escaping
- **Zero Server Fetching:** The server must never fetch user-supplied URLs (e.g. for metadata preview, favicon extraction, or URL validation). URL formatting is validated purely via client-side regex/parser (PRD §8 FR-1, §9.5).
- **Safe Rendering:** User-entered text, notes, code snippets, and titles must be rendered as raw text or safely escaped DOM nodes. Rendering user input as unescaped executable HTML (`dangerouslySetInnerHTML`) is prohibited (PRD §9.5).

### 4.6 Requirement 6 — Atomic Pairing Ticket Validation, Expiry & Hash Storage
- **Ticket Generation:** Pairing tickets are 256-bit random tokens generated client-side by an unlocked authorized device (PRD §8 FR-5).
- **Hash-Only Persistence:** The server receives and stores only `ticket_hash = SHA-256(raw_ticket)`. The raw ticket code never touches server disk or logs (PRD §8 FR-5, §9.6, §10).
- **Single Active Ticket:** D1 enforces at most one unexpired, unconsumed pairing ticket per vault using a partial unique index (`WHERE consumed_at IS NULL AND expires_at > unixepoch()`) (PRD §8 FR-5, §10).
- **Atomic Single-Use:** Ticket exchange occurs in an atomic D1 transaction that validates hash match, verifies `expires_at > unixepoch()`, marks `consumed_at = unixepoch()`, registers the new device, and creates the device token in a single commit (PRD §8 FR-5, §9.6, §11).

### 4.7 Requirement 7 — Application-Level Abuse Protection on Free Tier
- **Worker-Level Enforcement:** Abuse protection is implemented via D1-backed counters in the Cloudflare Worker runtime without requiring paid Cloudflare Advanced Rate Limiting (PRD §9.7, Appendix B).
- **Behavior:** Rate limits operate on rolling 1-hour windows. When limits are exceeded, the API returns `429 RATE_LIMITED` accompanied by an HTTP `Retry-After: <seconds>` header (PRD §9.7, Appendix B).

### 4.8 Requirement 8 — Dependency Hygiene, Lockfiles & Security Reviews
- **Lockfile Integrity:** Dependencies must be locked with deterministic lockfiles (`pnpm-lock.yaml` or `package-lock.json`) and scanned with automated vulnerability audits (`pnpm audit` / `npm audit`) (PRD §9.8).
- **Manual Review Gate:** Any dependency update affecting cryptography (`libsodium-wrappers-sumo`), routing, HTML rendering, or network transport requires a dedicated security review before merge (PRD §9.8).

### 4.9 Requirement 9 — Formal Cryptographic Versioning & Backward Compatibility
- **Version Envelopes:** All key envelopes and record payloads include explicit version fields: `crypto_format_version = 1`, `kdf_version = 1`, `schema_version = 1`, `key_version = 1` (PRD §8 FR-1, FR-6, §9.9, Appendix D).
- **Migration Contract:** KDF parameters, key derivation context strings, nonce structures, and ciphertext framing must never be altered without a formal version bump and automated migration test suite (PRD §9.9, Appendix D).
- **Forward Compatibility:** Legacy clients encountering newer versions must cleanly fail closed with `409 VERSION_MISMATCH` or `400 CRYPTO_VERSION_UNSUPPORTED`, displaying an upgrade prompt (PRD Appendix A, Appendix D).

### 4.10 Requirement 10 — Transparent Security Posture & No False Audit Claims
- **Accurate Claims:** The application documentation, UI about screens, and public repositories must explicitly state that the system has not undergone independent third-party commercial security audits (PRD §9.10).
- **User Notice:** Users are advised that personal vaults should be tested and validated thoroughly before entrusting production root credentials (PRD §9.10).

---

## 5. Crypto-Module Blocking Failure Rule

*Citations: PRD §2 (Decision 11), §8 (FR-6 G14), §9 (Requirement 4), §14 (Acceptance criteria).*

The cryptographic subsystem enforces an absolute, non-negotiable blocking failure invariant:

```
[App Initialization]
        |
        v
[Load WASM libsodium] 
        |
        +---> [Success] ---> Proceed to Vault Unlock / Initialization
        |
        +---> [FAIL: Blocked WASM / CSP violation / Unsupported Browser]
                   |
                   v
              [FATAL BLOCKING HALT]
              - Render full-screen unsupported error
              - Refuse unlock, create, pair, recover, import, export
              - ZERO unencrypted fallback
              - ZERO fallback to pure JS crypto
              - Execution terminates
```

### 5.1 Failure Invariant Specifications
1. **Fatal Halting:** If the reviewed WebAssembly crypto module (`libsodium-wrappers-sumo`) fails to load, fails initialization, or throws an unhandled exception (due to strict browser sandbox settings, missing WASM support, or CSP restrictions), the application must enter a fatal halting state (PRD §2.11, §8 FR-6).
2. **Full-Screen UI Block:** The client must display a non-dismissible, full-screen error notification:
   > *"Browser Unsupported: The required WebAssembly cryptographic module could not be initialized securely. Vault operations are disabled to protect your data."*
3. **Prohibited Operations:** While in this state, the application strictly forbids:
   - Creating a new vault (`POST /api/v1/vaults`).
   - Unlocking an existing local vault.
   - Initializing device pairing or generating pairing tickets.
   - Executing account recovery using the recovery kit.
   - Importing or exporting unencrypted or encrypted vault backups.
   - Performing background synchronization.
4. **Zero Fallback Invariant:** Under no circumstances may the application silently fall back to:
   - Storing vault records unencrypted.
   - Transmitting plaintext records over the network.
   - An unreviewed, pure-JavaScript cryptographic polyfill or weaker hash/cipher algorithms.
5. **Pre-Authentication Gate:** The WASM load check occurs prior to presenting password entry prompts, preventing users from typing sensitive credentials into a broken execution environment (PRD §8 FR-6).

---

## 6. Content Security Policy (CSP) & Transport Security Headers

*Citations: PRD §9 (Requirements 3 & 4), §11 (API behaviors), §13 (Hosting).*

To mitigate cross-site scripting (XSS), clickjacking, MIME-confusion attacks, and cache leakage, all HTTP responses from Cloudflare Pages and the `/api/v1/*` Functions runtime must include strict security headers.

### 6.1 Normative HTTP Response Security Headers

```http
Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
X-Frame-Options: DENY
Cache-Control: no-store, no-cache, must-revalidate, private
Pragma: no-cache
X-Server-Time: 2026-10-13T12:00:00.000Z
```

### 6.2 Header Specification & Threat Rationale

| Header | Production Directive / Value | Threat Mitigated & Rationale | PRD Citation |
|---|---|---|---|
| `Content-Security-Policy` | `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'` | Prevents XSS, data exfiltration, unauthorized iframe embedding, and plugin execution. Limits script execution to local origin and permits WASM via `'wasm-unsafe-eval'` (or pinned binary hash). Disallows third-party network connections. | PRD §9 (Req 3, 4) |
| `X-Content-Type-Options` | `nosniff` | Prevents MIME-type confusion attacks where user-supplied content is executed as JavaScript or CSS. | PRD §9 (Req 3) |
| `Referrer-Policy` | `no-referrer` | Ensures no URL paths or query parameters are leaked to external origins during navigation. | PRD §9 (Req 3) |
| `X-Frame-Options` | `DENY` | Clickjacking prevention. Blocks rendering inside `<iframe>`, `<frame>`, `<embed>`, or `<object>` elements across all origins. | PRD §9 (Req 3) |
| `Cache-Control` | `no-store, no-cache, must-revalidate, private` | Mandatory on all `/api/v1/*` responses. Guarantees that intermediary proxies, edge caches, browser HTTP caches, and service worker caches never persist encrypted payloads or token responses to disk. | PRD §9, §11 |
| `Pragma` | `no-cache` | Legacy HTTP/1.0 backward compatibility for cache suppression. | PRD §9, §11 |
| `X-Server-Time` | `<ISO-8601-UTC-Timestamp>` (e.g. `2026-10-13T12:00:00.000Z`) | Mandatory on all API responses. Allows clients to detect local device clock drift and correct timestamp signing offsets within the required ±5-minute window. | PRD §11, Appendix A |

---

## 7. Operational Caps & Protocol Constraints

*Citations: PRD §8 (FR-1, FR-4, FR-5, FR-6), §10 (Data model), Appendix A (Error codes), Appendix B (Rate limits).*

To prevent denial-of-service (DoS), memory exhaustion on constrained mobile browsers, and D1 database row overflow, the system enforces frozen operational bounds.

```
+----------------------------------------------------------------------------------------------------+
| FROZEN OPERATIONAL CAPS & BOUNDS                                                                   |
+------------------------------------+--------------------------------+------------------------------+
| Parameter                          | Exact Bound                    | Enforcement Point            |
+------------------------------------+--------------------------------+------------------------------+
| Plaintext Item Size Cap            | 256 KiB (262,144 bytes)        | Client-side pre-encryption   |
| Ciphertext Record Envelope Ceiling | 384 KiB (393,216 bytes)        | D1 Schema & Worker Gateway   |
| Sync Batch Size Limit              | 50 mutations                   | Worker POST /sync/batch      |
| Sync Batch Body Limit              | 1 MiB (1,048,576 bytes)        | Worker POST /sync/batch      |
| Pairing Ticket Expiration (TTL)    | 5 minutes (300 seconds)        | Worker / D1 Expiry Check     |
| Request Signature Clock Skew       | ±5 minutes (±300 seconds)      | Worker Auth Verification     |
| Argon2id Memory Floor (Hard min)   | 64 MiB (65,536 KiB)            | Client Unlock & Import       |
| Argon2id Memory Ceiling (Hard max) | 512 MiB (524,288 KiB)          | Client Pre-Derivation Check  |
+------------------------------------+--------------------------------+------------------------------+
```

### 7.1 Detailed Boundary Rules
1. **Plaintext Item Cap (256 KiB):** Serialized UTF-8 JSON item data must not exceed 256 KiB before encryption. The client UI rejects oversized items immediately with an informative message. Truncation is forbidden (PRD §8 FR-1).
2. **Ciphertext Ceiling (384 KiB):** Encryption (XChaCha20-Poly1305 nonce, 16-byte MAC, JSON envelope) and base64url transport encoding expand payloads by ~33–40%. D1 and the Worker enforce a maximum row and payload limit of 384 KiB per record (PRD §8 FR-1 G10, §10).
3. **Sync Batch Caps (50 Mutations / 1 MiB Body):** A single `POST /api/v1/sync/batch` request may contain at most 50 mutations and must not exceed 1 MiB in total request body size, evaluated in ciphertext bytes (PRD §8 FR-4, §11). Oversized requests return `413 PAYLOAD_TOO_LARGE`.
4. **Pairing Ticket TTL (5 Minutes):** One-time pairing codes expire 300 seconds after creation. Expired tickets are rejected with `410 TICKET_EXPIRED`. Superseded or consumed tickets return `410 TICKET_CONSUMED` (PRD §8 FR-5, Appendix A).
5. **Clock Skew Toleration (±5 Minutes):** Timestamps in signed requests must match the Worker's clock within ±300 seconds. Out-of-window requests return `401 STALE_TIMESTAMP` (retryable once after clock re-sync via `X-Server-Time`) (PRD §8 FR-5, Appendix A).
6. **Argon2id13 Parameter Bounds:**
   - *Minimum Hard Floor:* 64 MiB (`65536` KiB), 3 iterations (`t=3`), parallelism 1 (`p=1`). Any envelope below this is rejected on unlock with `400 CRYPTO_VERSION_UNSUPPORTED` (PRD §8 FR-6, Appendix D).
   - *Recommended Desktop Target:* 128 MiB (`131072` KiB), 4 iterations (`t=4`), parallelism 1 (`p=1`) (PRD §8 FR-6).
   - *Mobile Fallback:* 64 MiB (`65536` KiB), 3 iterations (`t=3`), parallelism 1 (`p=1`) if recommended calibration exceeds 3 seconds (PRD §8 FR-6).
   - *Maximum Hard Ceiling (DoS Guard):* 512 MiB (`524288` KiB), 5 iterations (`t=5`), parallelism 4 (`p=4`). Envelopes exceeding any of these parameters are rejected immediately without attempting key derivation (PRD §8 FR-6).

---

## 8. Cryptographic Primitives, HKDF Context Labels & AAD Reference

*Citations: PRD §8 (FR-6), §10 (Data model), Appendix D (Crypto/format versions).*  
*Note: Detailed mathematical algorithms, derivation routines, and test vectors are normative in `docs/backend/crypto-spec.md`.*

### 8.1 Primary Cryptographic Algorithms

| Function | Algorithm / Primitive | Library / Specification | Security Parameters |
|---|---|---|---|
| **Symmetric Cipher** | XChaCha20-Poly1305 (AEAD) | `libsodium` (`crypto_aead_xchacha20poly1305_ietf_*`) | 256-bit key, 192-bit (24-byte) random nonce, 128-bit MAC |
| **Password KDF** | Argon2id13 | `libsodium` (`crypto_pwhash_*`) | Salt: 16 random bytes; Memory: 64–128 MiB; Iterations: 3–4 |
| **Subkey Derivation**| HKDF-SHA-256 | RFC 5869 / Web Crypto API | Expand from 256-bit parent key using fixed context strings |
| **Device Signatures**| Ed25519 (EdDSA) | `libsodium` (`crypto_sign_*`) | 256-bit public key, 512-bit signature |
| **Token & Ticket Hash**| SHA-256 | Web Crypto API (`crypto.subtle.digest`) | 256-bit output hash |

### 8.2 Fixed HKDF Context Labels (`v1` Prefix)
To prevent cross-protocol key reuse, subkeys are derived using HKDF-SHA-256 with immutable, versioned context strings (PRD §8 FR-6, Appendix D):

| Context Label String | Parent Key | Derived Key Purpose | Operational Scope |
|---|---|---|---|
| `"PV-V1/REC-ENC"` | Master DEK (32 bytes) | Record Encryption Key | Symmetric key for encrypting and decrypting vault item records |
| `"PV-V1/LOCAL-CRED"` | Master DEK (32 bytes) | Local Credentials Wrapping Key | Symmetric key encrypting device bearer token and Ed25519 signing key in IndexedDB |
| `"PV-V1/RECOVERY-WRAP"`| Recovery Secret (32 bytes)| Recovery DEK Wrapping Key | Key used to wrap the Master DEK inside the cloud recovery envelope |
| `"PV-V1/RECOVERY-AUTH"`| Recovery Secret (32 bytes)| Recovery Authorization Token | Secret token sent during recovery; hashed server-side as `SHA-256(...)` for authorization |

### 8.3 Additional Authenticated Data (AAD) Schema for Record Ciphertext
Every item ciphertext payload is bound to its database identity via Additional Authenticated Data. Any modification of metadata fields causes Poly1305 authentication failure and immediate rejection (PRD §8 FR-6, Appendix D):

$$\text{AAD} = \text{vault\_id} \parallel \text{record\_id} \parallel \text{schema\_version} \parallel \text{key\_version} \parallel \text{"record"}$$

- Encoded as concatenated UTF-8 string or byte representation:
  `"{vault_id}:{record_id}:{schema_version}:{key_version}:record"`
- If any component (such as `vault_id` or `record_id`) is mismatched during decryption, decryption fails closed, emitting an integrity violation without exposing plaintext (PRD §8 FR-6).

---

## 9. Appendix A — Normative Error Codes Catalog (18 Codes) & UI Category Mapping

*Citations: PRD §11 (API protocol), Appendix A (Stable error codes v3 — G4).*

All API errors return a standardized JSON envelope:
```json
{
  "code": "<CODE>",
  "message": "<human-readable-sanitized-description>",
  "retryable": true
}
```
- `message` is safe for UI presentation and contains **zero secrets, SQL syntax, or stack traces** (PRD Appendix A).
- Error codes are frozen. Adding or modifying error codes requires a formal contract revision.

### 9.1 Stable Error Codes Catalog (Exact 18 Codes)

| Error Code | HTTP Status | Retryable | UI Category | Meaning & Trigger Condition |
|---|---|---|---|---|
| `VALIDATION_ERROR` | `400 Bad Request` | `false` | Malformed data | Request body fails schema, type, or bounds validation. |
| `PAYLOAD_TOO_LARGE` | `413 Payload Too Large` | `false` | Malformed data | Record ciphertext > 384 KiB, batch > 50 mutations, or total body > 1 MiB. |
| `VAULT_NOT_FOUND` | `404 Not Found` | `false` | Conflict | Unknown `vault_id`. Uniform response whether vault never existed or caller is unauthorized (prevents enumeration oracles). |
| `DEVICE_UNAUTHORIZED` | `401 Unauthorized` | `false` | Authorization / revocation | Missing, malformed, or unknown device token; or recovery token mismatch. |
| `DEVICE_REVOKED` | `401 Unauthorized` | `false` | Authorization / revocation | Token belongs to an explicitly revoked device. UI halts sync and alerts user. |
| `INVALID_SIGNATURE` | `401 Unauthorized` | `false` | Authorization / revocation | Signature missing, malformed, wrong public key, or body-digest mismatch. |
| `STALE_TIMESTAMP` | `401 Unauthorized` | `true` | Rate-limited | Client timestamp deviates by more than ±5 minutes. Client re-syncs clock via `X-Server-Time` and retries once. |
| `REPLAY_DETECTED` | `409 Conflict` | `false` | Conflict | Reused `nonce` or `mutation_id` submitted with a differing request body. |
| `REVISION_CONFLICT` | `409 Conflict` | `false` | Conflict | `expected_revision` mismatch. Returns `server_revision` and latest server ciphertext for client resolution. |
| `VERSION_MISMATCH` | `409 Conflict` | `false` | Version mismatch | Envelope, schema, or crypto version higher than client supports. UI prompts app update. |
| `CRYPTO_VERSION_UNSUPPORTED`| `400 Bad Request` | `false` | Version mismatch | Envelope below Argon2id floor, above ceiling, or unknown KDF/crypto version. |
| `TICKET_INVALID` | `400 Bad Request` | `false` | Malformed data | Pairing ticket hash unknown or vault ID mismatch. |
| `TICKET_EXPIRED` | `410 Gone` | `false` | Conflict | Pairing ticket is past its 5-minute lifespan. |
| `TICKET_CONSUMED` | `410 Gone` | `false` | Conflict | Pairing ticket already exchanged or superseded by newer ticket. |
| `RATE_LIMITED` | `429 Too Many Requests` | `true` | Rate-limited | Application-level rate limit exceeded (Appendix B). Returns `Retry-After` header. |
| `QUOTA_EXHAUSTED` | `503 Service Unavailable`| `true` | Quota exhaustion | Cloudflare Workers or D1 free quota exhausted. UI shows "sync paused" and keeps local data. |
| `SYNC_CURSOR_INVALID` | `400 Bad Request` | `false` | Malformed data | Unknown, negative, or corrupted sync cursor. Client resets to durable cursor or `0`. |
| `INTERNAL_ERROR` | `500 Internal Server Error` | `true` | Network failure | Uncaught server exception. Logged server-side without secrets; client shows generic message. |

### 9.2 Seven UI Categories Partitioning & Handling

*Normative Rule: Every error code maps to exactly one UI category (PRD Appendix A).*

> TODO(question): PRD Appendix A lists `QUOTA_EXHAUSTED` under both "network failure (`INTERNAL_ERROR` retryable, `QUOTA_EXHAUSTED`)" and "quota exhaustion (`QUOTA_EXHAUSTED`)" despite asserting "every code maps to exactly one category". In this specification and `docs/backend/api-spec.md`, `QUOTA_EXHAUSTED` is assigned exclusively to the dedicated "Quota exhaustion" category (503 status, UI displays "sync paused", local storage maintained), while `INTERNAL_ERROR` is assigned exclusively to "Network failure".

```
+-------------------------------------------------------------------------------------------------------+
| SEVEN UI CATEGORIES PARTITIONING (18 CODES)                                                          |
+------------------------------+------------------------------------+-----------------------------------+
| UI Category                  | Assigned Error Codes               | Required Client UI Behavior       |
+------------------------------+------------------------------------+-----------------------------------+
| 1. Network failure           | `INTERNAL_ERROR`                   | Show generic connection warning;  |
|                              |                                    | exponential retry with backoff.   |
+------------------------------+------------------------------------+-----------------------------------+
| 2. Quota exhaustion          | `QUOTA_EXHAUSTED`                  | Display "Sync Paused (Quota Met)";|
|                              |                                    | maintain durable local operation. |
+------------------------------+------------------------------------+-----------------------------------+
| 3. Authorization / revocation| `DEVICE_UNAUTHORIZED`,             | Halt sync retries; notify user    |
|                              | `DEVICE_REVOKED`,                  | that device was revoked or        |
|                              | `INVALID_SIGNATURE`                | requires re-pairing.              |
+------------------------------+------------------------------------+-----------------------------------+
| 4. Malformed data            | `VALIDATION_ERROR`,                | Abort request; log local warning; |
|                              | `PAYLOAD_TOO_LARGE`,               | notify user of invalid data.      |
|                              | `SYNC_CURSOR_INVALID`,             |                                   |
|                              | `TICKET_INVALID`                   |                                   |
+------------------------------+------------------------------------+-----------------------------------+
| 5. Version mismatch          | `VERSION_MISMATCH`,                | Display non-dismissible prompt:   |
|                              | `CRYPTO_VERSION_UNSUPPORTED`       | "Please update Personal Vault".   |
+------------------------------+------------------------------------+-----------------------------------+
| 6. Conflict                  | `REVISION_CONFLICT`,               | Trigger three-way merge or alert  |
|                              | `REPLAY_DETECTED`,                 | user to expired/consumed code;    |
|                              | `TICKET_EXPIRED`,                  | show resolution dialog.           |
|                              | `TICKET_CONSUMED`,                 |                                   |
|                              | `VAULT_NOT_FOUND`                  |                                   |
+------------------------------+------------------------------------+-----------------------------------+
| 7. Rate-limited              | `RATE_LIMITED`,                    | Display "Rate limited, retry in N |
|                              | `STALE_TIMESTAMP` (retry 1x)       | seconds"; auto-retry after window.|
+------------------------------+------------------------------------+-----------------------------------+
```

---

## 10. Appendix B — Application-Level Rate Limits (7 Enforced Limits)

*Citations: PRD §9 (Requirement 7), Appendix B (Application-level rate limits v3 — G9).*

Rate limits are implemented directly in the Cloudflare Worker using D1-backed counters (`rate_limits` table or atomic transaction checks), ensuring full functionality on Cloudflare's Free tier without requiring enterprise addons.

### 10.1 Rate Limits Specification Table

| # | Protected Endpoint | Rate Limit Window | Enforcement Key | Security Rationale & Threat Mitigated |
|---|---|---|---|---|
| 1 | `POST /api/v1/vaults` | **3 per IP per hour** | Client IP (`CF-Connecting-IP`) | Vault creation is extremely rare. Prevents mass-creation abuse and D1 storage flooding. |
| 2 | `POST /api/v1/pairing-tickets` | **5 per device per hour** | `device_id` (Authenticated) | Ticket creation requires unlock + signature; limit allows retries while blocking ticket spam. |
| 3 | `POST /api/v1/pairing/exchange` | **10 per vault per hour** | `vault_id` (Unauthenticated) | Allows human typos on manual codes; blocks ticket brute-force (256-bit space + 5-min TTL makes guessing infeasible regardless). |
| 4 | `POST /api/v1/recovery/enroll-device` | **5 per vault per hour** *(doubling backoff after 3 failures)* | `vault_id` (Verifier auth) | Account recovery is sensitive; strictest user-facing limit blocks brute-force guessing of recovery secrets. |
| 5 | `POST /api/v1/sync/batch` | **120 per vault per hour** | `vault_id` (Authenticated) | Accommodates rapid edits and retry bursts (up to 6,000 item mutations/hr at 50/batch). Dampens sync loops. |
| 6 | `GET /api/v1/sync` | **300 per vault per hour** | `vault_id` (Authenticated) | Supports initial sync paging and frequent debounced sync checks. Blocks aggressive background polling. |
| 7 | `PUT /api/v1/vault/crypto-metadata` | **10 per vault per hour** | `vault_id` (Authenticated) | Envelope updates occur only during master password changes or key rotations. Blocks metadata churn. |

### 10.2 Rate-Limiting Operational Invariants
1. **Rolling Windows:** All counter windows are rolling 60-minute periods evaluated against current UTC time (PRD Appendix B).
2. **Failure Counting:** Failed requests (e.g. invalid signature, invalid ticket) count against the rate limit budget to throttle brute-force attempts (PRD Appendix B).
3. **Response Headers:** When any rate limit is triggered, the Worker returns:
   - HTTP Status: `429 Too Many Requests`
   - Header: `Retry-After: <seconds-until-window-expires>`
   - Body: `{"code": "RATE_LIMITED", "message": "Too many requests. Please wait N seconds.", "retryable": true}`
4. **Distinct UI Messaging:** The client UI must present rate limiting ("Rate limited, retry in N seconds") distinctly from quota exhaustion ("Sync paused") (PRD §9, Appendix B).

---

## 11. Security Audit, Verification & Traceability Matrix

*Citations: PRD §14 (MVP acceptance criteria), §17 (Definition of Done).*

| Security Control / Invariant | Validation Method & Test Harness | Milestone & Acceptance Citation |
|---|---|---|
| **Zero-Plaintext Invariant** | Inspect D1 schema migrations; query all D1 columns; verify absence of plaintext item fields. Automated test vector verifies server logs contain no decrypted payloads. | PRD §9 (Req 1, 2), §10, §14 |
| **WASM Blocking Halt** | Simulate WASM failure by disabling WebAssembly execution or injecting a failed loader in test harness. Confirm full-screen blocking error appears and no unlock/create actions proceed. | PRD §2.11, §8 (FR-6), §14 |
| **Tamper & AAD Rejection** | Test cases injecting flipped ciphertext bits, corrupted MACs, modified `vault_id`, altered `record_id`, or modified version numbers in AAD must fail closed. | PRD §8 (FR-6), §14 |
| **Single-Use Ticket & Expiry** | Automated test verifies pairing tickets expire after 300 seconds, cannot be consumed twice, and creating ticket B invalidates ticket A. | PRD §8 (FR-5), §14 |
| **Argon2id Floor & Ceiling** | Unit tests submit envelopes with 32 MiB memory (must reject with `CRYPTO_VERSION_UNSUPPORTED`) and 1024 MiB memory (must reject before derivation). | PRD §8 (FR-6), §14 |
| **Rate Limit Enforcement** | Submit rapid requests exceeding each Appendix B limit; verify `429 RATE_LIMITED` returned with valid `Retry-After`; verify recovery after cooldown. | PRD Appendix B, §14 |
| **Size Caps Enforcement** | Test 256 KiB plaintext accepted, 256 KiB + 1 byte rejected on client; test 384 KiB ciphertext accepted, > 384 KiB rejected by Worker with `413 PAYLOAD_TOO_LARGE`. | PRD §8 (FR-1), §14 |
| **Clock Skew Window** | Submit signed request with timestamp offset by +301 seconds; verify rejection with `401 STALE_TIMESTAMP`. Verify single auto-retry after clock correction. | PRD Appendix A, §14 |
| **Security Headers & CSP** | Audit production build response headers against Section 6 table; verify `'wasm-unsafe-eval'` is minimal and WASM binary hash matches lockfile. | PRD §9 (Req 3, 4), §14 |
