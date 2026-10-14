# Acceptance Criteria & Verification Trace

Normative references: `personal-vault-prd-v3.md` (v3.0) §§14, 15, 17, 20 (G1–G15).  
Code plans:
- `plan/foundations-schemas-contract.md` (`foundations`)
- `plan/crypto-local-vault.md` (`crypto`)
- `plan/cloud-sync-pairing.md` (`sync`)
- `plan/pwa-hardening-release.md` (`pwa`)

On any conflict, PRD v3 wins over plan files.

---

## 1. Milestone Gates (§15)

Release progress is gated on explicit exit criteria defined in PRD §15.

### Milestone 1 Gate: Schema & Contract Freeze First (§15 M1, G15)
- [ ] **Item and API schemas frozen prior to UI implementation** `[§15 M1, §20 G15]`: Record types (`link`, `note`, `snippet`, `credential`), envelope fields (Appendix D), size limits (256 KiB plaintext / 384 KiB ciphertext), and error codes (Appendix A) committed in `src/lib/schemas.ts`, `src/lib/errors.ts`, and `src/lib/limits.ts` before scaffolding UI forms or components.
- [ ] **Dexie and D1 migration definitions aligned** `[§15 M1, §10]`: Dexie schema (`src/db/dexie-schema.ts`) and D1 initial migration (`migrations/0001_init.sql`) contain zero plaintext content columns and include the partial unique index for single active pairing tickets.

### Milestone 3 Gate: API Contract Review & Freeze (§15 M3, G1)
- [ ] **Machine-readable API contract committed and frozen** `[§15 M3, §11, §20 G1]`: Complete contract (`openapi.yaml` / `docs/backend/api-spec.md`) covering all 9 endpoints in §11, all 18 Appendix A error codes with HTTP status mappings, request/response bodies, authentication schemes (`PV-Device`), and size limits.
- [ ] **No Milestone 4 work without contract review** `[§15 M3, §20 G1]`: Sync, conflict, and backup development blocked until contract is reviewed.
- [ ] **Contract-drift CI guard active** `[§14.5, §15 M3, §20 G1]`: CI workflow fails on any drift between frontend types and backend API contract.

---

## 2. MVP Acceptance Criteria (§14 Mapped by Owning Plan)

Every checkbox from PRD §14 is assigned to exactly one owning implementation plan. Total §14 criteria: 42.

### 2.1 Foundations: Schemas & API Contract (`foundations`)
*Owning plan: `plan/foundations-schemas-contract.md` (2 checkboxes)*

- [ ] **API error contract enforcement:** API errors use only Appendix A codes with the specified HTTP mappings; no SQL details, stack traces, or secret-bearing values. `[§14.5, Appendix A, §11, §15 M1/M3, §20 G4]`
  > TODO(question): Schema and contract mapping for all 18 codes and HTTP status codes are frozen in foundations (`src/lib/errors.ts`, `openapi.yaml`). Runtime suppression of SQL leaks and stack traces is implemented in Worker handlers under `sync`. Mapped to foundations as the authoritative contract owner.
- [ ] **OpenAPI / API-spec contract freeze:** OpenAPI/API-spec contract frozen at Milestone 3 gate; CI fails on frontend/backend contract drift. `[§14.5, §15 M3, §20 G1, §20 G15]`

---

### 2.2 Crypto & Local Vault Lifecycle (`crypto`)
*Owning plan: `plan/crypto-local-vault.md` (10 checkboxes)*

- [ ] **Blocked-WASM fatal gate:** Blocked-WASM test: with the crypto module prevented from loading, the app shows the unsupported-browser error and permits no vault operation. `[§14.1, §2(11), §FR-6, §9(4), §15 M2, §20 G14]`
- [ ] **Client-side encryption before persistence:** Vault records are encrypted before writing to IndexedDB or sending to the API. `[§14.2, §FR-1, §FR-6, §15 M2]`
- [ ] **Failed unlock protection:** Incorrect master passphrases fail to unlock; the app does not erase/replace data after a failed unlock. `[§14.2, §FR-6, §15 M2]`
- [ ] **Tamper and AAD validation:** Tampered ciphertext, wrong AAD, wrong vault ID, unsupported crypto version, and invalid nonce/ciphertext are rejected safely. `[§14.2, §FR-6, §15 M2]`
- [ ] **Fresh nonce and KDF separation:** Every encryption uses a fresh nonce; key derivation contexts and format versions are tested. `[§14.2, §FR-6, §15 M2]`
- [ ] **Argon2id floor and cap enforcement:** Argon2id minimum floor enforced: envelopes below Minimum profile rejected; envelopes above Maximum cap rejected without derivation. `[§14.2, §FR-6, §15 M2, §20 G2]`
- [ ] **Master-password change isolation:** Master-password change updates only the master envelope; recovery envelope still unwraps the DEK afterward. `[§14.2, §FR-6, §15 M2, §20 G8]`
- [ ] **Recovery-key rotation confirmation gate:** Recovery-key rotation requires the user to save/confirm the new recovery kit before invalidating the old recovery authorization. `[§14.2, §FR-7, §15 M2, §20 G7]`
- [ ] **Recovery kit format & confirmation:** Recovery-kit file matches Appendix C byte-for-byte (fields + base32 round-trip) and the save-confirmation gate cannot be skipped. `[§14.3, §FR-7, Appendix C, §15 M2, §20 G7]`
- [ ] **Zero-knowledge local search:** Local search works without sending plaintext queries or indexes to the server. `[§14.4, §FR-2, §9, §15 M2]`

---

### 2.3 Cloud API, Sync, Pairing & Backup (`sync`)
*Owning plan: `plan/cloud-sync-pairing.md` (21 checkboxes)*

- [ ] **Zero-plaintext server audit:** D1 inspection and Worker logs reveal no plaintext item fields, master passphrase, recovery secret, raw device token, decrypted signing key, or search query. `[§14.2, §9, §11, §15 M3]`
  > TODO(question): Verified at Milestone 3 exit gate against Pages Functions and D1. Depends on client encryption from `crypto` to guarantee no unencrypted payloads are ever submitted.
- [ ] **Four-step pairing sequence:** A second device completes the full §FR-5 four-step sequence with a one-time ticket that expires after five minutes and cannot be reused; creating a second ticket invalidates the first. `[§14.3, §FR-5, §15 M3, §20 G3]`
- [ ] **Passphrase requirement on paired device:** A paired device requires the master passphrase to decrypt vault content (token alone decrypts nothing). `[§14.3, §FR-5, §15 M3]`
- [ ] **Token theft mitigation:** A stolen device token alone cannot mutate/delete records, revoke other devices, change key envelopes, or pair a new device. `[§14.3, §FR-5, §9, §15 M3, §18(3)]`
- [ ] **Immediate device revocation:** A revoked device can no longer access API endpoints. `[§14.3, §FR-5, §11, §15 M3]`
- [ ] **All-devices-lost recovery flow:** With all original devices unavailable, the recovery kit can re-authorize a new device, unwrap the DEK client-side, and restore access. `[§14.3, §FR-7, §15 M3/M4, §18(1)]`
- [ ] **Recovery limitation disclosure:** Without both an available authorized device and valid recovery material, the UI accurately explains the recovery limitation. `[§14.3, §FR-7, §16]`
- [ ] **Durable offline mutations:** Offline create/edit/delete operations survive reload and remain pending until acknowledged. `[§14.4, §FR-4, §15 M4]`
- [ ] **Two-device synchronization:** Two-device edits synchronize without silent overwrites. `[§14.4, §FR-4, §11, §15 M4]`
- [ ] **Explicit conflict preservation:** Concurrent edits and delete-vs-edit conflicts preserve both versions until explicit resolution. `[§14.4, §FR-4, §11, §15 M4]`
- [ ] **Mutation idempotency:** Duplicate/retried mutation requests are idempotent. `[§14.4, §FR-4, §11, §15 M4]`
- [ ] **Crash-safe download apply:** Crash-between-write-and-cursor fault injection: re-applied download pages upsert without duplicates. `[§14.4, §FR-4, §11, §15 M4, §20 G6]`
- [ ] **Tombstone permanence:** Deletions do not reappear after sync. `[§14.4, §FR-4, §11, §15 M4]`
- [ ] **Quota resilience:** A failed sync or D1 quota limit does not discard local data or pending mutations. `[§14.4, §FR-4, §13, §15 M4]`
- [ ] **Stable cursor pagination:** Cursor pagination does not skip events under concurrent updates. `[§14.4, §FR-4, §11, §15 M4]`
- [ ] **Encrypted export restore:** Encrypted export can be restored to a clean profile/device using the master passphrase or recovery secret. `[§14.4, §FR-4, §15 M4]`
- [ ] **Non-empty import safety:** Import into a non-empty vault never overwrites data silently. `[§14.4, §FR-4, §15 M4]`
- [ ] **Oversized payload rejection:** Oversized-record test: 256 KiB plaintext accepted, 256 KiB + 1 byte rejected identically on client and server; 384 KiB ciphertext ceiling respected. `[§14.4, §FR-1, §FR-4, §15 M3/M4, §20 G10]`
- [ ] **Boundary validation:** Request size, type, schema, and per-vault authorization are validated at every API boundary. `[§14.5, §9, §11, §15 M3]`
- [ ] **Pairing ticket security lifecycle:** Pairing tickets are 256-bit entropy, stored as hashes, expire, single-active-per-vault, and are consumed atomically once. `[§14.5, §FR-5, §10, §15 M3, §20 G3]`
- [ ] **Rate limit enforcement & recovery:** Rate-limit tests: each Appendix B limit returns `429 RATE_LIMITED` with `Retry-After` and recovers after the window. `[§14.5, Appendix B, §9, §15 M3, §20 G9]`

---

### 2.4 PWA, Hardening & Personal Release (`pwa`)
*Owning plan: `plan/pwa-hardening-release.md` (9 checkboxes)*

- [ ] **MVP item CRUD operations:** A user can create, view, edit, duplicate, search, favorite, archive, restore from archive, and delete all four MVP item types. `[§14.1, §FR-1, §15 M1/M6]`
  > TODO(question): PRD §15 Milestone 1 scheduled UI shell and item forms under M1, but foundations plan explicitly scoped out all UI. Checkbox 1 is mapped to PWA (which owns application shell integration, responsive styling, and final §14 acceptance sweep), with Crypto providing encrypted Dexie helpers and MiniSearch. Confirm whether item CRUD UI should be split or explicitly tracked under PWA.
- [ ] **Dashboard and responsive UI features:** Dashboard, Quick Add, category filters, tags, favorites, advanced search, keyboard navigation, and light/dark theme work at desktop and mobile widths. `[§14.1, §7, §12, §15 M1/M5]`
- [ ] **Target platform installation:** PWA installation and relaunch behavior are tested on Windows/desktop Chromium, Android, and real iOS/iPadOS Safari. `[§14.1, §5, §15 M5]`
- [ ] **Browser fallback usability:** If install is unavailable, the app remains usable in the browser. `[§14.1, §5, §15 M5]`
- [ ] **iOS ITP storage eviction recovery:** iOS eviction path tested: after simulated storage eviction, the app starts clean and offers pairing/recovery without corrupt state. `[§14.1, §5, §15 M5, §20 G11]`
- [ ] **Service worker consecutive-build update:** Service-worker update tested across two consecutive production builds without stale-shell/API mismatch. `[§14.1, §FR-3, §15 M5, §20 G12]`
- [ ] **Production security headers & CSP:** CSP and response security headers are verified against a production build, including the pinned WASM crypto hash. `[§14.5, §9(4), §15 M5, §20 G14]`
- [ ] **CI verification pipeline:** Dependency audit, lint, typecheck, unit tests, integration tests, and end-to-end flows pass in CI. `[§14.5, §15 M5, §17]`
- [ ] **Operational runbooks & documentation:** Setup, deployment, D1 migration, encrypted backup, recovery, and incident procedures are documented. `[§14.5, §15 M6]`

---

### 2.5 Mapping Verification Summary

| Owning Plan | Source File | Checkbox Count | Criteria IDs / Scope |
|---|---|:---:|---|
| **Foundations** | `plan/foundations-schemas-contract.md` | **2** | §14.5 (Error codes contract, API contract freeze & drift CI) |
| **Crypto** | `plan/crypto-local-vault.md` | **10** | §14.1 (Blocked-WASM), §14.2 (Encryption, unlock fail, tamper/AAD, fresh nonce, Argon2id, master change, recovery rotation), §14.3 (Recovery kit format), §14.4 (Zero-knowledge search) |
| **Sync** | `plan/cloud-sync-pairing.md` | **21** | §14.2 (No plaintext in D1/logs), §14.3 (Pairing sequence, passphrase required, token theft, revoke, all-lost recovery, recovery limitation), §14.4 (Offline mutations, 2-device sync, conflict preserve, idempotency, crash safety, tombstones, quota fail, pagination, export restore, non-empty import, oversized test), §14.5 (Boundary validation, ticket entropy/lifecycle, rate limits) |
| **PWA** | `plan/pwa-hardening-release.md` | **9** | §14.1 (Item CRUD, dashboard/theme/layout, PWA install/relaunch, browser fallback, iOS eviction, SW update), §14.5 (CSP/headers, CI pipeline, runbooks & documentation) |
| **Total** | | **42** | **100% mapped (0 unmapped, 0 double-mapped)** |

---

## 3. Definition of Done (§17)

Per PRD §17, MVP completion requires passing all items below before real credentials may be stored:

- [ ] **All §14 acceptance criteria passing on target platforms** `[§17]`: Verified on desktop Chromium, Android, and iOS/iPadOS Safari.
- [ ] **Local-first operational autonomy** `[§17, §1]`: App functions completely offline after initial bootstrap, preserving all data and queuing pending mutations in IndexedDB.
- [ ] **Two-device synchronization verified** `[§17, §FR-4]`: Bidirectional sync succeeds without silent overwrites; concurrent edits produce manual resolution UI.
- [ ] **Pairing and revocation lifecycle verified** `[§17, §FR-5]`: 4-step ticket exchange establishes authorized second device; revocation immediately terminates API access.
- [ ] **Encrypted backup restore verified** `[§17, §FR-4]`: Encrypted JSON export successfully restores to clean device via master passphrase and via recovery secret.
- [ ] **All-devices-lost recovery verified** `[§17, §FR-7, §18(1)]`: With all original devices inaccessible, a new device is enrolled via recovery kit and restores complete vault access without data loss.
- [ ] **Real credential gate enforced** `[§17]`: Soak period with non-critical test data executed; no production credentials stored until key lifecycle, sync, and recovery tests pass.
- [ ] **Product principle compliance** `[§17]`: Remains lightweight, local-first, privacy-focused, and operational within Cloudflare free-tier quotas without compromising cryptographic integrity.

---

## 4. Gap Fixes Verification Trace (PRD §20 G1–G15)

Traceability matrix linking every PRD v2.0 → v3.0 gap fix to its normative requirement, owning plan, and verification mechanism:

| Gap ID | Description | PRD v3 Normative Section | Owning Plan | Verification Location & Artifact |
|:---:|---|---|:---:|---|
| **G1** | API contract drift risk | §11, §15 M3 exit gate, §14.5 | `foundations` | `docs/backend/api-spec.md` & `openapi.yaml`; contract-drift CI step in CI workflow fails on mismatched types. |
| **G2** | Argon2id calibration baseline missing | §FR-6 (table), §14.2 | `crypto` | `tests/crypto/argon2.test.ts`; known-answer vectors for Min (64 MiB/t3/p1) and Recommended (128 MiB/t4/p1); floor/ceiling rejection assertions. |
| **G3** | New-device pairing bootstrap undefined | §FR-5 (4-step sequence), §10, §14.3 | `sync` | `tests/api/pairing.test.ts` & E2E harness; 256-bit ticket hash lookup, 5-min expiry, single-active-ticket constraint, atomic consumption. |
| **G4** | Stable API error codes undefined | Appendix A (18 codes), §11, §14.5 | `foundations` / `sync` | `src/lib/errors.ts` (18-code enum), `tests/api/errors.test.ts` ensuring exact HTTP status mappings and zero SQL/trace leakage in responses. |
| **G5** | Crypto & schema versioning rules missing | §FR-1, §10, Appendix D, §14.2 | `foundations` / `crypto` | `src/lib/versions.ts` constants (`schema_version=1`, `crypto_format_version=1`, `kdf_version=1`, `key_version=1`); downgrade-refusal unit tests. |
| **G6** | Download-apply idempotency & crash safety | §FR-4, §11, §14.4 | `sync` | `tests/sync/crash-recovery.test.ts`; fault-injection simulating crash between write and cursor commit; upsert idempotency on `(record_id, revision, change_seq)`. |
| **G7** | Recovery kit format undefined | §FR-7, Appendix C, §14.3 | `crypto` | `tests/crypto/recovery-kit.test.ts`; byte-for-byte schema check of `personal-vault-recovery-kit.json`, base32 round-trip, save-confirmation gate UI test. |
| **G8** | Password change recovery envelope scope | §FR-6, §14.2 | `crypto` | `tests/crypto/password-change.test.ts`; asserts master envelope replaced while recovery envelope remains unchanged and DEK unwrap succeeds. |
| **G9** | Application rate limits undefined | Appendix B (7 limits), §14.5 | `sync` | `tests/api/rate-limits.test.ts`; per-endpoint test returning `429 RATE_LIMITED` with `Retry-After` header and validating recovery after window. |
| **G10** | Ciphertext overhead and D1 row caps | §FR-1, §FR-4, §14.4 | `foundations` / `sync` | `tests/schemas/limits.test.ts` & `tests/api/size-limits.test.ts`; 256 KiB plain pass, 256 KiB + 1 byte reject; 384 KiB ciphertext ceiling enforced. |
| **G11** | iOS ITP 7-day storage eviction risk | §5, §14.1 | `pwa` | Playwright & manual iOS test; simulated storage purge starts clean, prompts pairing/recovery without corrupt state; persistent backup banner active until export. |
| **G12** | Service worker update lifecycle undefined | §FR-3, §14.1, §15 M5 | `pwa` | `tests/pwa/sw-update.test.ts`; two consecutive production builds test cache transition without serving stale shell against updated API. |
| **G13** | Device `last_seen` spoofing risk | §FR-5, §10, §14.3 | `sync` | `functions/api/v1/*` middleware sets `last_seen_at = CURRENT_TIMESTAMP` server-side; ignores any client-supplied timestamp; disclosed in Settings. |
| **G14** | WASM crypto load failure handling | §2(11), §FR-6, §9(4), §14.1 | `crypto` / `pwa` | `tests/crypto/wasm-guard.test.ts`; blocked WASM script load triggers fatal error screen, disables all vault operations; CSP checks hash in prod build. |
| **G15** | Milestone 1 schema-first ordering | §15 M1, §14.5 | `foundations` | Implementation sequence: `foundations-schemas-contract.md` merged before any UI or crypto implementation; CI enforces schemas as single source of truth. |
