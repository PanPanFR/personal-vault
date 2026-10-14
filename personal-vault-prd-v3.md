# Personal Vault — Product Requirements Document

**Status:** Revised MVP specification  
**Version:** 3.0  
**Updated:** 2026-10-13  
**Supersedes:** v2.0 (2026-10-13)  
**Product type:** Single-owner, cross-platform personal vault  
**Decision:** Build a local-first installable PWA using Vite + React and Cloudflare Pages Functions + D1. Encrypt vault content in the client before it is persisted or uploaded.

> This document supersedes v2.0. It keeps the v2 lightweight, free-tier-first direction and applies 15 gap fixes (see §20): Argon2id parameters locked, machine-readable API contract gate, complete new-device pairing sequence, stable error-code enum, schema-versioning contract, idempotent cursor apply, recovery-kit file format, password-change envelope scope, application-level rate limits, ciphertext-overhead budget, iOS ITP note, service-worker update strategy, WASM-load fallback, last-seen provenance, and milestone ordering.

## 1. Product overview

Personal Vault is a lightweight, installable Progressive Web App (PWA) for saving and retrieving links, notes, snippets, and occasional credentials from Windows, Android, iOS/iPadOS, and modern browsers. It prioritizes fast capture, a polished dashboard, advanced local search, offline use, and encrypted sync between authorized devices.

This is a personal information vault, not a public multi-user SaaS and not a replacement for a mature password manager. There is no email login or public user directory. A vault is created on the client and authorized devices are added by secure pairing or by the recovery kit.

## 2. Firm product and architecture decisions

1. **Frontend:** Vite + React + TypeScript. Do not use Next.js for this product: server-side rendering and a separate server framework are not needed for a local-first PWA.
2. **Hosting/API:** One Cloudflare Pages project serves the static frontend and same-origin `/api/*` Pages Functions. Pages Functions run on Cloudflare's Workers runtime. This avoids a separate API deployment and minimizes CORS configuration.
3. **Database:** Cloudflare D1 stores ciphertext, opaque identifiers, revision/cursor metadata, encrypted key envelopes, and device-authentication metadata only.
4. **Local persistence:** IndexedDB through Dexie.js. Persist vault records and the pending-sync outbox as ciphertext, not plaintext.
5. **Cryptography:** Use a reviewed library such as `libsodium-wrappers-sumo` for Argon2id, XChaCha20-Poly1305, Ed25519, and supporting primitives. Do not implement cryptographic algorithms manually.
6. **Search:** MiniSearch or an equivalent in-memory index. Decrypt only while the vault is unlocked; never upload search terms or indexes.
7. **Sync:** Revision-based optimistic concurrency, an append-only change cursor, idempotent mutations, tombstones, and explicit conflict resolution. Do not add a distributed sync framework for the MVP.
8. **No additional infrastructure:** No Next.js, Supabase, Redis, VPS, paid auth provider, or separate backend framework in the MVP.
9. **Cost goal:** Target $0/month while usage remains within current Cloudflare Free quotas. This is a target, not an uptime or unlimited-usage guarantee.
10. **Security claim:** Describe the product as client-side encrypted and designed so the backend does not receive vault plaintext. Do not claim independent auditing, absolute zero-knowledge guarantees, or password-manager-grade security without appropriate review.
11. **Crypto failure is blocking (v3):** If the reviewed crypto/WASM module fails to load, the app must refuse vault creation and unlock with a clear error. It must never fall back to unencrypted operation or a weaker algorithm (see FR-6).

## 3. Goals and success measures

### Goals

- Use one responsive codebase on Windows, Android, iOS/iPadOS, and the web.
- Capture and retrieve links, notes, snippets, and occasional credentials.
- Provide a polished dashboard, Quick Add, favorites, tags, and advanced search.
- Work offline after initial setup and the relevant vault data have been downloaded to that device.
- Synchronize only encrypted record content and encrypted key envelopes through Cloudflare.
- Support secure device pairing, revocation, encrypted export/import, and a tested lost-device recovery path.
- Preserve unsynchronized changes through disconnects, retries, quota exhaustion, and application restarts.

### MVP success measures

- A vault with 5,000 small text records can be opened and searched on target devices without unacceptable delays.
- Common local searches complete within 200 ms at the 95th percentile on the agreed test dataset and reference devices. Treat this as a release target to validate, not a universal hardware guarantee.
- A change made on one authorized device reaches another authorized device after sync, without exposing plaintext to the API or D1.
- A new device can be paired with an existing device; the vault can also be recovered when every previous device is lost, provided the recovery kit is available.
- No acceptance test can silently discard a pending local change.

## 4. Non-goals

- Teams, collaboration, sharing, public registration, or multi-user organizations.
- Native App Store / Play Store applications in the MVP.
- Browser extensions, autofill, automatic password capture, or replacement of a dedicated password manager.
- Attachments, large files, OCR, AI features, analytics, advertising, or server-side plaintext search.
- Server-side URL fetching, automatic link previews that fetch arbitrary remote URLs, or scraping websites.
- Guaranteed free hosting forever, guaranteed browser storage retention, or guaranteed uninterrupted cloud availability.
- Full protection against a compromised device, active XSS, malicious frontend deployment, or malware running with the user's account privileges.

## 5. Target platforms and PWA limitations

- **Windows:** Installable through a supported Chromium-based browser; browser access remains available.
- **Android:** Installable through a supported browser; test on a real Android device.
- **iOS/iPadOS:** Add to Home Screen in Safari where supported; test on a real device for storage, relaunch, keyboard, clipboard, and lifecycle behavior.
- **Web:** Responsive use in current supported desktop and mobile browsers.

The product is a PWA, not a native application. In the MVP, do not promise native background sync, push notifications, OS keychain integration, biometric unlock, or identical behavior across browsers. Browser-managed storage can be evicted or cleared. Request persistent storage where supported, show backup reminders, and explain that encrypted export is the user's independent backup.

Offline behavior is available only after a device has completed setup and downloaded the necessary encrypted data. Creating a cloud vault, pairing a new device, or recovering a cloud vault requires network access. Offline edits are stored locally as encrypted data and are uploaded after the user unlocks the vault and connectivity returns.

### iOS storage eviction note (v3 — G11)

On iOS/iPadOS, Safari WebKit may evict IndexedDB/Cache storage after approximately 7 days without app use under Intelligent Tracking Prevention (ITP) and general storage pressure. The app must therefore (a) show the encrypted-export backup reminder more aggressively on iOS (e.g. persistent Settings banner until an export exists), (b) never present browser storage as a backup, and (c) test relaunch-after-eviction on a real device: after eviction the app must start clean, offer pairing or recovery-kit restore, and must not show a corrupt half-vault.

## 6. Recommended technology stack

| Layer | Technology | Responsibility |
|---|---|---|
| App | Vite + React + TypeScript | SPA, forms, app logic, client-side vault operations |
| Styling | Tailwind CSS + shadcn/ui | Responsive UI and reusable accessible components |
| Hosting | Cloudflare Pages | Static frontend delivery and HTTPS |
| API | Cloudflare Pages Functions (Workers runtime) | Same-origin `/api/*` endpoints, authorization, validation, sync orchestration |
| Database | Cloudflare D1 | Ciphertext, key envelopes, device metadata, revisions, cursors, tombstones |
| Local database | IndexedDB + Dexie.js | Encrypted local cache and durable pending-sync outbox |
| Crypto | `libsodium-wrappers-sumo` or equivalent reviewed library | Argon2id, XChaCha20-Poly1305, Ed25519, key derivation |
| Search | MiniSearch or equivalent | In-memory full-text index while unlocked |
| PWA | Web App Manifest + service worker | Installation and app-shell caching only |
| Tests | Vitest + Playwright; real-device manual checks | Unit, integration, regression, and cross-platform tests |
| Source control | GitHub | Version control and deployment workflow |

Pin dependencies, review crypto-related upgrades carefully, and document the exact library versions and crypto parameters used by each released schema version.

## 7. Information architecture and UX

### Primary navigation

- **All Items** — active records of all types.
- **Favorites** — records marked as favorites.
- **Links** — saved URLs.
- **Notes** — freeform notes and reference information.
- **Snippets** — commands, code, and reusable text.
- **Credentials** — occasional username/password records.
- **Tags** — filter and browse by tag.
- **Archive** — records hidden from the main active list.
- **Settings** — lock settings, sync state, authorized devices, backup/recovery, theme, and app information.

### Dashboard

The dashboard should include:

- Global search with keyboard shortcut `Ctrl/Cmd + K`.
- Quick Add for each supported item type.
- Recent items and favorites.
- Category shortcuts and tag filters.
- A clear sync state: synced, pending, offline, conflict, or error.
- Last successful sync time and an action to retry.
- Empty states that teach the user how to add the first item.

### Item interactions

- Create, view, edit, duplicate, favorite/unfavorite, archive/unarchive, and delete.
- Restore archived items. A deleted item is represented by a sync tombstone so it does not return from another device.
- Open a saved URL in a new tab using a safe external-link pattern.
- Copy individual fields and mask credential passwords by default.
- Require explicit action to reveal or copy sensitive fields.
- Confirm permanent local actions and show clear feedback after success/failure.
- Support keyboard navigation, visible focus, labels, sufficient contrast, and screen-reader-friendly state changes.

### Visual direction

Use a clean, polished, lightweight interface with clear hierarchy, restrained colors, useful whitespace, responsive cards/list views, subtle borders, and accessible contrast. Keep animations subtle and optional. Support light and dark themes if they do not delay security, recovery, or sync work. Optimize for capture and retrieval, not decoration.

## 8. Functional requirements

### FR-1 — Item management

Each item has a random opaque ID, encrypted type-specific payload, schema version, and local sync metadata.

MVP item types:

- **Link:** title, URL, description, notes, tags.
- **Note:** title, body, tags.
- **Snippet:** title, text/code content, optional language, tags.
- **Credential:** title, website/service, username/email, password, notes, tags.

Favorite and archive state, item type, titles, URLs, tags, content, and item timestamps belong inside the encrypted payload. Do not add custom user-defined fields to the MVP; reconsider after the standard item types and sync lifecycle are stable.

Validation must be type-specific. Validate URLs without fetching them from the server. Put a documented limit of **256 KiB of serialized plaintext per item**; reject oversized records before encryption/upload and explain the limit in the UI. Do not silently truncate content.

#### Ciphertext-overhead budget (v3 — G10)

The 256 KiB limit applies to serialized plaintext before encryption. After XChaCha20-Poly1305 encryption (nonce + MAC + envelope fields) and base64url-safe transport encoding, ciphertext is approximately 33–40% larger. The API and D1 schema must therefore accept up to **384 KiB of ciphertext per record**, and the sync-batch 1 MiB body cap counts ciphertext bytes, not plaintext bytes. Before release, validate the chosen encoding against the actual D1 row-size limit; if D1 enforces a smaller row cap than 384 KiB, lower the plaintext limit accordingly and update the UI string and API validation together — never let client and server disagree on the limit.

#### Record schema versioning contract (v3 — G5)

- `schema_version` starts at `1` for the MVP and `crypto_format_version` starts at `1`. Both are defined in §10 and Appendix D.
- `schema_version` is stored in two places: (a) inside the encrypted payload as the authoritative value, and (b) as a plaintext D1/IndexedDB column used only for filtering and migration triage — never for content indexing.
- Forward-compatibility rule: unknown fields inside the encrypted JSON payload must be preserved and ignored by older clients, never stripped.
- A client that encounters a higher major `schema_version` or `crypto_format_version` than it supports must refuse to open the affected record(s), show "please update the app", and must not write back or downgrade the version.
- Any change to field meaning, KDF parameters, key-derivation contexts, nonce formats, or ciphertext interpretation requires a version bump plus versioned migration fixtures and tests. See security requirement 9.

### FR-2 — Global and advanced search

Search operates only against decrypted records in memory while unlocked.

- Full-text search across titles, URLs, descriptions, notes, snippets, credential usernames/emails, and tags.
- Filters for type, tag, favorite, archive state, and date range.
- Sort by recently updated, recently created, or title.
- Keyboard shortcut `Ctrl/Cmd + K`; pressing Escape closes the search overlay.
- Support a small, documented query syntax for the MVP:
  - `type:link`, `type:note`, `type:snippet`, `type:credential`
  - `tag:work` and quoted tags such as `tag:"side project"`
  - `is:favorite`, `is:archived`
  - `created:YYYY-MM-DD..YYYY-MM-DD`
  - `updated:YYYY-MM-DD..YYYY-MM-DD`
  - Quoted phrases, such as `"cloudflare pages"`
- Combining operators narrows results using AND semantics. Invalid operators must be treated as visible query errors or ordinary text consistently; do not silently interpret invalid dates.
- Do not transmit plaintext queries, indexed content, decrypted titles, or tags to the server.
- Build the index in memory after unlock and clear it from application state on lock. Do not persist a plaintext search index.

### FR-3 — Local-first persistence and offline operation

- Persist encrypted records in IndexedDB using Dexie.js.
- Allow viewing, creating, editing, archiving, and deleting locally cached records while unlocked and offline.
- Persist an encrypted outbox of pending changes so an app restart does not discard work.
- Store no decrypted vault records or plaintext outbox entries in Cache API, service-worker caches, logs, URL query strings, browser history, or localStorage.
- Cache only the app shell and versioned static assets in the service worker. API responses containing vault data must use appropriate no-store cache headers and must not be service-worker cached.
- Request persistent storage where supported and show a reminder to export a backup. Handle `QuotaExceededError` and other storage failures visibly; do not claim browser storage is permanent.
- Keep the vault usable locally if Cloudflare or D1 is unavailable or a free quota is exceeded.

#### Service-worker update lifecycle (v3 — G12)

The service worker must use a versioned cache name per build. On a new deployment it must either activate immediately with `skipWaiting` + `clientsClaim` followed by a "reloaded to new version" notice, or show an explicit "Update available — reload" prompt. It must never serve a stale app shell against a newer API contract. On activation, delete all caches from previous versions. Verify update behavior with two consecutive production builds in acceptance testing.

### FR-4 — Encrypted cloud synchronization

- Upload ciphertext only. The API and D1 must not receive plaintext item fields, search terms, master passwords, raw recovery secrets, or decrypted device private keys.
- Fetch remote changes using a monotonically increasing per-vault sync cursor.
- Use opaque record IDs, integer record revisions, client-generated mutation IDs, expected/base revisions, and idempotent mutation handling.
- Store pending mutations durably until the server confirms them.
- Use an append-only change log or equivalent stable cursor mechanism so pagination cannot silently skip updates.
- Apply record updates and their associated sync-change events atomically.
- Enforce compare-and-swap revision checks. On mismatch, return a conflict response containing the latest encrypted server version and metadata required for the client to resolve it.
- Never silently overwrite a conflicting edit. Preserve both versions until the user chooses an action.
- Use tombstones for deletions. Keep tombstones until a safe retention policy is implemented; do not purge them in the MVP.
- Retry transient errors with bounded exponential backoff and jitter. Respect retryable vs permanent API errors.
- Limit each API sync batch to **50 mutations or 1 MiB of request body (ciphertext bytes), whichever comes first**. Paginate remote changes and bound response size. Reject oversized payloads.
- Display pending count, last successful sync time, last error, and a manual retry action. Never report “synced” until changes are acknowledged by the server.

#### Idempotent download apply (v3 — G6)

Applying a downloaded change page must be idempotent, keyed by `(record_id, revision, change_seq)`. The client commits downloaded records and the new cursor in a single Dexie transaction where possible; if the app crashes between writing records and committing the cursor, the next sync re-fetches the same page and re-applying it must upsert — never duplicate or corrupt state. Acceptance tests must include a crash-between-write-and-cursor fault-injection case.

### FR-5 — Device authorization and pairing

There is no email/account provider. A vault has one owner in the product sense, and the owner explicitly authorizes each device.

- Vault IDs are generated randomly on the client and are not authentication credentials by themselves.
- Generate a random 256-bit device bearer token for each device. Store only a SHA-256 hash of the high-entropy token on the server. The raw token must not be logged.
- Store the device token encrypted locally under a key derived from the vault data-encryption key (DEK). Sync requires the vault to be unlocked in the MVP; a locked device does not run background sync.
- Each device creates an Ed25519 signing keypair. Store the public key on the server and the private key encrypted locally under the DEK.
- Read-only API access requires a valid device token. Mutations, pairing-ticket creation, device revocation, and cryptographic metadata changes require both the device token and a valid signature from its registered device key. This prevents a stolen token alone from authorizing new devices or altering/deleting data.
- Signatures must bind the HTTP method, path, timestamp, request nonce or mutation ID, and SHA-256 digest of the exact request body. Enforce a short timestamp window and idempotency/replay protections.
- Device pairing is initiated from an already authorized, unlocked device. Create a cryptographically random one-time pairing code, store only its hash, expire it after **5 minutes**, and accept it once. Display the code as a QR code plus a manual fallback code. Do not use a short numeric PIN as the sole pairing secret.
- At most one unconsumed, unexpired pairing ticket may exist per vault. Creating a new ticket invalidates any previous unconsumed ticket for that vault.
- The new device generates its own keypair and exchanges the one-time pairing code for its device token and registration. The new device must still unlock the vault with the master password before it can decrypt records.
- Show authorized devices with a user-entered or minimal local label, creation time, last-seen time, and revoke action. Do not collect unnecessary device fingerprint data.
- Revocation must prevent future API access immediately after it is committed. Explain that revocation cannot erase ciphertext already downloaded by a previously authorized device.
- Recovery of a vault after all devices are lost is handled by FR-7, not by a permanent hidden administrator token or a hard-coded frontend secret.

#### Complete new-device pairing sequence (v3 — G3)

The v2 text left the new-device side underspecified. The normative sequence is:

1. **Ticket creation (device A, authorized + unlocked).** A calls `POST /api/v1/pairing-tickets` (token + signature). A generates 256 bits of entropy locally, sends only `ticket_hash = SHA-256(ticket)`, and keeps the raw ticket to display. The server stores the hash with a 5-minute expiry. A renders a QR code containing `{ vault_id, api_origin, ticket }` plus a manual fallback code (base32url encoding of the same ticket).
2. **Ticket exchange (device B, new).** B scans or types the ticket, generates its own Ed25519 keypair and `device_id` locally, then calls `POST /api/v1/pairing/exchange` with `{ vault_id, ticket, device_id, device_public_key, label }`. The server atomically checks hash match, expiry, and single-use (consume-on-success in the same transaction), registers B's public key, generates B's device bearer token server-side, stores only its SHA-256 hash, and returns the raw token **once** in the response body.
3. **Bootstrap + unlock (device B).** B holds the raw device token only in memory and immediately prompts for the master passphrase. B calls `GET /api/v1/vaults/:vaultId/bootstrap` with the device token, receives the encrypted master-key envelope and non-secret metadata, derives the KEK via Argon2id, unwraps the DEK, then re-encrypts the device token and Ed25519 private key under a DEK-derived local key before persisting to IndexedDB. B never persists the raw token or plaintext private key.
4. **Initial sync (device B).** B runs the §11 sync algorithm from `cursor=0`, populates IndexedDB with ciphertext, builds the in-memory search index, and shows the dashboard. The consumed ticket cannot be reused; a failed exchange before consumption leaves the ticket valid until expiry.

#### Last-seen provenance (v3 — G13)

The `last-seen` / `last-used` timestamp shown in the device list is recorded by the server on each authenticated request. It is never accepted from client input. It exists only so the owner can spot unused or stolen devices, and it is part of the disclosed server-visible metadata (§9).

### FR-6 — Master password, vault keys, and locking

#### Key model

- Generate a random 256-bit vault DEK using a cryptographically secure random generator.
- Derive a key-encryption key (KEK) from the master passphrase using Argon2id with a unique random salt and stored, versioned parameters (see parameter table below). Do not let untrusted server-provided parameters exceed strict client-enforced minimum/maximum bounds.
- Wrap the DEK with the master-password-derived KEK using XChaCha20-Poly1305. The server stores only this encrypted key envelope, its nonce, salt, KDF parameters, and format/version metadata.
- Use XChaCha20-Poly1305 for record encryption with a fresh random nonce for every encryption. Use authenticated associated data to bind ciphertext to the vault ID, record ID, schema version, key version, and purpose.
- Use HKDF-SHA-256 with fixed, versioned context labels to derive separate subkeys for separate purposes. Never reuse a key across cryptographic purposes just because the same DEK exists.
- Use constant-time comparisons where applicable and rely on the reviewed crypto library for primitive operations.
- The master passphrase is never sent to the server and is not a server login password. The server cannot perform password reset because it does not have the passphrase or DEK.

#### Argon2id parameters (v3 — G2, normative)

`libsodium-wrappers-sumo` exposes Argon2id13. The envelope stores `kdf_version = 1`, `m` (memory in KiB), `t` (iterations), `p` (parallelism), and `salt` (16 random bytes). The client enforces these bounds and behavior:

| Profile | `m` | `t` | `p` | Role |
|---|---|---|---|---|
| Minimum | 64 MiB (`65536` KiB) | 3 | 1 | Hard floor. Envelopes below this are rejected on unlock with `CRYPTO_VERSION_UNSUPPORTED`. |
| Recommended | 128 MiB (`131072` KiB) | 4 | 1 | Default target on desktop/laptop at setup. |
| Mobile fallback | 64 MiB (`65536` KiB) | 3 | 1 | Accepted automatically if the recommended calibration exceeds 3 s on the device. |
| Maximum cap | 512 MiB (`524288` KiB) | 5 | 4 | Hard ceiling. Server-provided or imported envelopes above any of these values are rejected without attempting derivation (DoS/abuse guard). |

Calibration procedure at vault creation: attempt Recommended; if derivation takes longer than 3 seconds on the creating device, step down to Mobile fallback and record the chosen parameters in the envelope. The exact chosen values ship with the envelope, so unlock cost is identical on all devices. Changing these defaults in a future release requires a `kdf_version` bump and migration fixtures. See Appendix D for the stored envelope fields.

HKDF-SHA-256 context labels (versioned, `v1` prefix) — minimum set: `PV-V1/REC-ENC` (record encryption), `PV-V1/LOCAL-CRED` (local device-token/key wrap), `PV-V1/RECOVERY-WRAP` (recovery DEK unwrap key), `PV-V1/RECOVERY-AUTH` (recovery authorization token). Labels are fixed byte strings; adding a purpose requires a new label, never reuse of an existing subkey.

AAD for record ciphertext (all required): `vault_id || record_id || schema_version || key_version || "record"`. Decryption with any mismatched AAD field must fail closed.

#### Crypto-module load failure (v3 — G14)

If the WASM crypto module fails to initialize (blocked WASM, CSP misconfiguration, unsupported browser), the app must render a blocking full-screen error stating the browser is unsupported and that no vault operation is available. It must not allow vault creation, unlock, pairing, recovery, or import/export, and must not silently fall back to any other implementation. CSP headers (§9) must already permit the pinned WASM build; a load failure is treated as fatal, not retryable behind user data entry.

#### Locking behavior

- The user can lock manually at any time.
- Default inactivity timeout: **5 minutes**, configurable to 1, 5, 15, or 30 minutes. On foreground/resume, check elapsed inactivity and lock if the timeout has passed; do not rely only on background timers.
- Locking clears decrypted records, the in-memory search index, DEK/subkeys, decrypted device token, and decrypted device signing key from application state as far as practical.
- Do not claim perfect memory erasure in JavaScript or guarantee protection from screenshots, browser extensions, OS-level malware, XSS, or a compromised device while unlocked.
- Wrong-password attempts must fail closed. Do not overwrite an existing local or cloud vault after an unlock failure.
- Master-password changes re-wrap the existing DEK under a new KDF salt/parameters; they do not by themselves re-encrypt all records. Explain that a password change does not retroactively protect old copies of backups or ciphertext already copied with the old wrapper.

#### Password-change envelope scope (v3 — G8, normative)

A master-password change updates **only** the master-key envelope (new salt, new KDF parameters, new nonce, same DEK re-wrapped). The recovery envelope is untouched because it wraps the same DEK under the independent recovery secret — recovery continues to work without any change. The server must atomically replace the master envelope and bump its version; the old master envelope is invalidated in the same transaction. The UI must state: (a) old encrypted exports remain decryptable with the old password, (b) already-downloaded ciphertext is unaffected, and (c) to fully cut off the old password, rotate the recovery kit as well and re-export backups.

### FR-7 — Recovery and encrypted backup

The recovery design must support recovery when **all previously authorized devices are lost**, not just when one device remains available.

#### Recovery kit

- Generate a random 256-bit recovery secret client-side.
- Use domain-separated HKDF derivations from that secret for (a) the key that unwraps the DEK and (b) a separate recovery authorization token. The recovery authorization token must not reveal or be usable as the recovery decryption key. Labels: `PV-V1/RECOVERY-WRAP` and `PV-V1/RECOVERY-AUTH`.
- Store only a hash/verifier of the high-entropy recovery authorization token on the server. Never send the raw recovery secret, recovery wrapping key, or DEK to the server.
- The recovery kit must include the vault ID, deployment/API origin, recovery secret, format/version, and plain-language instructions. Without the vault ID/origin, the user may not be able to locate the encrypted cloud vault when all devices are lost.
- The recovery kit is also the cloud re-authorization mechanism: because there is no email/account provider, **the master passphrase alone cannot register a new device after every authorized device is lost**. In that situation the recovery kit is required even if the master passphrase is remembered.
- Show the recovery secret only during setup/rotation, allow the user to copy it and download a recovery-kit file, and require a confirmation step before setup completes. Do not silently save it in the cloud or browser storage in plaintext.
- Explain during setup that losing the recovery kit while all authorized devices are unavailable prevents cloud recovery; losing both the master passphrase and recovery kit also prevents decryption of the encrypted content.

#### Recovery-kit file format (v3 — G7, normative)

The downloadable kit is a plaintext JSON file named `personal-vault-recovery-kit.json` (MIME `application/json`). Plaintext is intentional — the kit must be usable on a clean device with no prior keys — and the UI must warn accordingly ("anyone holding this file can recover your vault; store it offline"). Exact fields (see Appendix C for the example):

```json
{
  "format": "personal-vault-recovery-kit",
  "version": 1,
  "vault_id": "<ulid-or-uuid-opaque>",
  "api_origin": "https://<pages-project>.pages.dev",
  "recovery_secret": "<base64url-32-bytes>",
  "created_at": "<ISO-8601-UTC>",
  "instructions": "Open api_origin, choose Recover, enter vault_id + recovery_secret."
}
```

Setup and rotation both require an explicit "I saved the kit" confirmation (checkbox + re-typed word or re-pasted secret) before the vault is marked ready or the old recovery authorization is invalidated. The manual fallback representation of `recovery_secret` is base32 (grouped, human-copyable) and must round-trip to the same bytes as the JSON field.

#### Recovery flow

1. User opens the deployed app on a new device and enters the vault ID and recovery secret from the recovery kit.
2. Client derives the recovery authorization token (`PV-V1/RECOVERY-AUTH`) and uses it to authorize `POST /api/v1/recovery/enroll-device`. The server receives the derived authorization token only over HTTPS; it never receives the recovery secret or recovery wrapping key. Strict rate limits apply (Appendix B).
3. Client downloads encrypted envelopes and record ciphertext, then uses the recovery secret locally (`PV-V1/RECOVERY-WRAP`) to unwrap the DEK.
4. User sets a new master passphrase. The client creates a new master-key envelope and updates the recovery metadata as appropriate (new master envelope only; recovery envelope unchanged unless the user also rotates the kit).
5. The device is registered, the local signing private key and token are stored encrypted locally, and sync can resume.
6. If any stage fails, preserve the downloaded ciphertext and do not replace the local or cloud vault with an empty one.

#### Encrypted export/import

- Provide a user-initiated encrypted export containing the vault ID, format/schema versions, encrypted key envelopes, encrypted records, and sync-independent metadata needed for restore. Do not include raw recovery secret, raw device tokens, or decrypted item data.
- The backup must remain encrypted and restorable with the master passphrase or recovery secret.
- Import validates file type, size, schema version, record IDs, ciphertext format, and required envelope fields before any mutation. Provide a preview and a clear merge/restore choice.
- Never replace existing local/cloud data silently. For a restore into a non-empty vault, preserve conflicting versions or require explicit confirmation with an understandable warning.
- Test restore on a clean second browser/device before MVP release.
- Treat D1 sync storage as a synchronized copy, **not** as the user's independent backup.

### FR-8 — Credential and clipboard handling

- Mask password fields by default and require an explicit reveal/copy action.
- Never include credential values in logs, telemetry, crash reports, error messages, URLs, or analytics (analytics are not included in the MVP).
- Use the Clipboard API only after a direct user action. Best-effort clipboard clearing after a short interval may be implemented when supported, but the UI must state that apps, operating systems, and clipboard managers may retain copied content.
- Do not implement autofill or automatic password capture in the MVP.
- Clearly state in onboarding and Settings that this tool is for occasional personal credentials and is not a dedicated, independently audited password manager.

### FR-9 — Settings and data portability

Settings must provide:

- Lock timeout and theme.
- Current local/offline status, pending mutation count, last successful sync, and latest sync error.
- Authorized-device list and revocation.
- Encrypted export, import, recovery-kit rotation, and recovery guidance.
- App version, data format version, privacy/security notes, and current known limitations.

## 9. Security model and threat boundaries

### Protected against by design

- Passive database disclosure: stored content is ciphertext and key envelopes; plaintext fields and search indexes are not stored server-side.
- Network interception: HTTPS and authenticated API calls are required.
- Simple device-token theft: a token alone must not authorize mutations or new-device pairing because sensitive operations require a registered Ed25519 signature.
- Ciphertext tampering: authenticated encryption must reject invalid payloads rather than return partially decrypted content.
- Duplicate/replayed sync mutations: idempotency keys, expected revisions, timestamps, and signed requests prevent repeated operations from being applied as distinct edits.

### Not fully protected against

- Active XSS or malicious frontend code can access data while the vault is unlocked. The deployed frontend and its build/deployment chain are part of the trusted computing base.
- Malware or an attacker controlling an unlocked device can read plaintext and may use keys available to the application.
- An attacker who obtains the database can try offline guesses against the password-wrapped DEK. A strong master passphrase and appropriately calibrated Argon2id parameters are required (minimum floor enforced; see FR-6).
- Server metadata such as vault IDs, record IDs, ciphertext sizes, revisions, approximate change times, sync patterns, and device labels may remain visible. The app must disclose this metadata leakage.
- Revocation cannot erase copies of ciphertext already downloaded to a lost device.
- Browser data can be cleared or evicted. The recovery kit and encrypted export are necessary for resilient recovery.

### Security requirements

1. No plaintext vault content, master passphrase, recovery secret, raw device token, decrypted signing private key, or decrypted item data in server logs.
2. Strict request-size and schema validation; parameterized SQL; bounded payloads; and per-vault authorization on every endpoint.
3. Same-origin API routes where possible; restrictive CSP, no unnecessary third-party scripts, no remote runtime CDN dependencies, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and appropriate frame restrictions.
4. Apply a restrictive CSP compatible with the chosen WASM crypto build. Add only the minimum required WASM permission (`script-src 'wasm-unsafe-eval'` scoped as narrowly as the framework allows, or the equivalent for the pinned build); do not weaken the policy globally to make a dependency work. Pin the exact WASM binary hash and verify it in the production-build check.
5. Do not fetch arbitrary user URLs from the server. Escape user content and render snippets/notes as text, not executable HTML.
6. Validate pairing-ticket expiry and single use atomically. Store a hash of the ticket, not the raw code.
7. Use application-level abuse protection and endpoint limits per Appendix B (D1-backed counters, `429 RATE_LIMITED` with `Retry-After`). If platform-level rate limiting requires an upgrade, do not make it a mandatory paid dependency for basic operation — the Appendix B limits must work on the Free plan.
8. Pin and review dependencies; create a lockfile; scan dependencies; and review updates affecting cryptography, routing, or rendering.
9. Maintain crypto format versions and migration tests per FR-1 and Appendix D. Never change KDF parameters, key derivation contexts, nonce formats, or ciphertext interpretation without a compatible versioned migration.
10. Do not claim the app has been independently audited. Security-sensitive implementation must be reviewed and tested before storing important real credentials.

## 10. Data model

### Local IndexedDB stores

- **`records`**: opaque record ID, encrypted payload, nonce/envelope metadata, local revision, last-known server revision, local sync state, and local change metadata. Content fields stay encrypted at rest.
- **`outbox`**: mutation ID, record ID, expected base revision, encrypted payload/tombstone intent, creation order, retry state, and error classification. No plaintext item content.
- **`device_credentials`**: device token and private signing key encrypted under a DEK-derived local key; public key and non-sensitive device ID/label may be stored separately.
- **`app_metadata`**: vault ID, schema version, last sync cursor, lock preferences, and minimal local settings. Do not store the master passphrase or recovery secret here.

Decrypted vault records, search indexes, DEK/subkeys, and decrypted device credentials exist only in memory while unlocked. React state and client stores must not persist plaintext snapshots.

### D1 tables

**`vaults`**

- `vault_id` (random opaque primary key)
- cryptographic format/version (`crypto_format_version`, `kdf_version`)
- master-password key envelope (salt, KDF parameters, nonce, ciphertext)
- recovery-wrapped DEK envelope (nonce, ciphertext, format/version)
- recovery-authorization verifier (hash of a domain-separated high-entropy token)
- current change sequence and minimal timestamps

**`vault_records`**

- `vault_id`, `record_id`
- encrypted payload/ciphertext and nonce metadata (max 384 KiB ciphertext per §FR-1)
- schema version and key version (plaintext columns for triage only)
- integer revision
- current server change sequence
- server update timestamp and tombstone/deletion indicator

**`authorized_devices`**

- `vault_id`, `device_id`
- hash of high-entropy device token
- Ed25519 public key
- minimal device label
- created timestamp, server-recorded last-used timestamp, and revocation timestamp
- last acknowledged cursor if needed for diagnostics

**`pairing_tickets`**

- `vault_id`, hash of one-time ticket, expiry, consumed timestamp
- no plaintext item fields or long-lived raw pairing secrets
- partial unique index enforcing at most one unconsumed, unexpired ticket per vault

**`sync_changes`**

- per-vault monotonic sequence, record ID, revision, and minimal change type/metadata
- no titles, URLs, tags, content, passwords, or search terms

Use composite indexes for vault-scoped sync and record lookup, and indexes that make cursor paging efficient. Do not create plaintext server-side indexes for item fields. Validate that the implementation's exact schema and transaction patterns fit current D1 limits before release.

## 11. API and synchronization protocol

The API is same-origin under `/api/v1/*`. The machine-readable contract (`openapi.yaml` or `docs/backend/api-spec.md`) is normative: it must be committed, reviewed, and frozen as the Milestone 3 exit gate before any Milestone 4 sync work starts, and frontend/backend must not diverge from it afterward (see Milestone 3). Field names, status codes, and error codes in this PRD's appendices are binding on that contract.

### Required endpoint behaviors

| Endpoint | Purpose | Required protection |
|---|---|---|
| `POST /api/v1/vaults` | Create a vault and register the first device | HTTPS, strict validation, token hash only, size limits, abuse protection (App. B) |
| `GET /api/v1/vaults/:vaultId/bootstrap` | Fetch encrypted key envelopes and non-secret bootstrap metadata | Valid device token; no plaintext payloads |
| `GET /api/v1/sync?cursor=...` | Fetch remote changes page | Valid device token; bounded page size; stable cursor |
| `POST /api/v1/sync/batch` | Submit encrypted mutations | Valid token, device signature, idempotency IDs, expected revisions, atomic DB writes |
| `POST /api/v1/pairing-tickets` | Create pairing QR/manual code | Valid token plus device signature; single active ticket per vault; 5-min expiry |
| `POST /api/v1/pairing/exchange` | Exchange a one-time ticket for a new device registration | High-entropy ticket, expiry, single-use atomic consumption, new public key registration |
| `POST /api/v1/devices/:deviceId/revoke` | Revoke a device | Valid token plus device signature; idempotent; immediate rejection after commit |
| `PUT /api/v1/vault/crypto-metadata` | Update master/recovery key envelopes | Valid token plus device signature; version check; atomic update |
| `POST /api/v1/recovery/enroll-device` | Authorize a new device when all prior devices are lost | Recovery authorization token only; strict limits (App. B); never receive recovery decryption secret |

All errors use the stable machine-readable codes in Appendix A with the specified HTTP mappings. Do not return stack traces or SQL messages to clients. The UI maps every code to one of: network failure, quota exhaustion, authorization/revocation, malformed data, version mismatch, conflict, or rate-limited — plus a retry action where applicable.

### Sync algorithm

1. User unlocks the vault. The client derives/unwraps the DEK, decrypts local device credentials, and initializes the in-memory search index.
2. Client fetches a bounded page of change events after its last durable cursor.
3. Client downloads/stores ciphertext and tombstones in IndexedDB; updates the cursor transactionally only after the page is durably applied. Re-application of an already-applied page is a safe upsert (§FR-4).
4. Client decrypts validated local records and updates the in-memory search index.
5. Client sends outbox mutations with unique mutation IDs and expected server revisions, signed by the registered device key. Body counted in ciphertext bytes (50 mutations or 1 MiB max).
6. Worker verifies token hash, signature, request bounds, vault scope, idempotency, and expected revisions.
7. Worker atomically checks the expected revision, commits the new encrypted record/tombstone, and writes the change event. A revision mismatch returns `409` with code `REVISION_CONFLICT` plus the latest server ciphertext and revision.
8. Client marks only acknowledged mutations as synced and removes them from the outbox. Unacknowledged mutations remain durable.
9. After a conflict, preserve the local and remote versions. Offer **Keep local as a new item**, **Use remote version**, or a carefully designed local merge. The MVP must include the first two at minimum; if merge risks data loss, omit merge rather than guess.
10. Client commits the new cursor after the returned page has been applied. Repeated pages and duplicate mutation responses must be safe (idempotent both directions).

### Conflict handling rules

- No last-write-wins overwrite for user content.
- If a remote edit conflicts with a local edit, keep both ciphertext versions locally until the user resolves the conflict.
- If a delete conflicts with an edit, do not silently resurrect or erase the edited item. Present the conflict and preserve the editable version.
- Repeated mutation IDs return the original result where possible and must not create new revisions.
- Server-side change logs must be paginated with a stable monotonic sequence; cursor advancement must not cause missed updates.
- Keep tombstones in the MVP. Tombstone garbage collection is post-MVP and requires a tested policy for inactive/revoked devices and old backups.

## 12. Non-functional requirements

- **Performance:** Support 5,000 small text records; local search target below 200 ms p95 on agreed reference hardware after unlock.
- **Responsiveness:** Usable at common desktop, tablet, and mobile widths; avoid desktop-only navigation assumptions.
- **Offline:** Core item operations work offline after initial setup, data download, and unlock.
- **Reliability:** A failed request never removes a pending local mutation. Cursor updates are durable and atomic with local application of downloaded changes.
- **Accessibility:** Keyboard support, visible focus, labels, contrast, and clear status announcements.
- **Portability:** Encrypted export/import and recovery kit avoid dependence on a single browser profile.
- **Privacy:** No analytics, advertising, third-party tracking, or server-side plaintext search in the MVP.
- **Maintainability:** One TypeScript frontend, one Pages Functions API, and one D1 database; document API contracts and data migrations.
- **Data limits:** No attachments; item and batch size limits are explicit in the UI and API.
- **Operational simplicity:** Local use must survive cloud outages and free-quota exhaustion. Sync can pause, but local data and pending edits must remain accessible while unlocked.

## 13. Hosting and free-tier plan

### Deployment

- Deploy the Vite build and same-origin Pages Functions API in one Cloudflare Pages project.
- Bind D1 to the Pages Functions environment using environment-specific configuration.
- Start with the provider's `pages.dev` hostname; a custom domain is optional and may cost money.
- Separate development and production D1 databases. Never test destructive migrations on the only production vault.
- Keep schema migrations versioned in source control and verify backup/export before any migration that changes stored data.
- Ensure production API responses containing vault metadata or records are not cached by the CDN/service worker.

### Free-tier assumptions (checked 2026-10-13)

Quotas can change. Recheck official documentation before deployment and periodically afterward. The implementation must fail safely when a quota is reached.

- Cloudflare Workers Free currently lists **100,000 requests/day** and **10 ms CPU time per invocation**. Pages Functions count toward Workers usage. Keep API handlers lightweight; run Argon2id and record encryption on the client, not in the Worker. [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- D1 Free currently lists **5 million rows read/day**, **100,000 rows written/day**, **500 MB per database**, and **5 GB total storage** on the account. The Free plan also lists limits on database count and per-invocation D1 queries (currently 50 queries per Worker invocation). [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) · [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
- Cloudflare Pages Free currently lists **500 builds/month**, **20,000 files per site**, and **25 MiB per static asset**. [Pages limits](https://developers.cloudflare.com/pages/platform/limits/)
- D1 Free daily limit enforcement means a sync request may fail after a limit is exhausted until the limit resets. Local operations and the encrypted outbox must remain usable, and the UI must say that cloud sync is paused. [D1 limit enforcement notice](https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/)

Do not poll continuously. Sync on app open/unlock, after a local mutation when online, on an explicit user action, and on a conservative foreground interval while unlocked. Debounce bursts of edits and batch mutations to reduce request and row counts.

## 14. MVP acceptance criteria

Release is blocked unless the following are tested and passing:

### Product and platform

- [ ] A user can create, view, edit, duplicate, search, favorite, archive, restore from archive, and delete all four MVP item types.
- [ ] Dashboard, Quick Add, category filters, tags, favorites, advanced search, keyboard navigation, and light/dark theme work at desktop and mobile widths.
- [ ] PWA installation and relaunch behavior are tested on Windows/desktop Chromium, Android, and real iOS/iPadOS Safari.
- [ ] If install is unavailable, the app remains usable in the browser.
- [ ] iOS eviction path tested: after simulated storage eviction, the app starts clean and offers pairing/recovery without corrupt state.
- [ ] Service-worker update tested across two consecutive production builds without stale-shell/API mismatch.
- [ ] Blocked-WASM test: with the crypto module prevented from loading, the app shows the unsupported-browser error and permits no vault operation.

### Encryption and key lifecycle

- [ ] Vault records are encrypted before writing to IndexedDB or sending to the API.
- [ ] D1 inspection and Worker logs reveal no plaintext item fields, master passphrase, recovery secret, raw device token, decrypted signing key, or search query.
- [ ] Incorrect master passphrases fail to unlock; the app does not erase/replace data after a failed unlock.
- [ ] Tampered ciphertext, wrong AAD, wrong vault ID, unsupported crypto version, and invalid nonce/ciphertext are rejected safely.
- [ ] Every encryption uses a fresh nonce; key derivation contexts and format versions are tested.
- [ ] Argon2id minimum floor enforced: envelopes below Minimum profile rejected; envelopes above Maximum cap rejected without derivation.
- [ ] Master-password change updates only the master envelope; recovery envelope still unwraps the DEK afterward.
- [ ] Recovery-key rotation requires the user to save/confirm the new recovery kit before invalidating the old recovery authorization.

### Pairing, authorization, and recovery

- [ ] A second device completes the full §FR-5 four-step sequence with a one-time ticket that expires after five minutes and cannot be reused; creating a second ticket invalidates the first.
- [ ] A paired device requires the master passphrase to decrypt vault content (token alone decrypts nothing).
- [ ] A stolen device token alone cannot mutate/delete records, revoke other devices, change key envelopes, or pair a new device.
- [ ] A revoked device can no longer access API endpoints.
- [ ] With all original devices unavailable, the recovery kit can re-authorize a new device, unwrap the DEK client-side, and restore access.
- [ ] Recovery-kit file matches Appendix C byte-for-byte (fields + base32 round-trip) and the save-confirmation gate cannot be skipped.
- [ ] Without both an available authorized device and valid recovery material, the UI accurately explains the recovery limitation.

### Sync, offline, and backup

- [ ] Offline create/edit/delete operations survive reload and remain pending until acknowledged.
- [ ] Two-device edits synchronize without silent overwrites.
- [ ] Concurrent edits and delete-vs-edit conflicts preserve both versions until explicit resolution.
- [ ] Duplicate/retried mutation requests are idempotent.
- [ ] Crash-between-write-and-cursor fault injection: re-applied download pages upsert without duplicates.
- [ ] Deletions do not reappear after sync.
- [ ] A failed sync or D1 quota limit does not discard local data or pending mutations.
- [ ] Cursor pagination does not skip events under concurrent updates.
- [ ] Encrypted export can be restored to a clean profile/device using the master passphrase or recovery secret.
- [ ] Import into a non-empty vault never overwrites data silently.
- [ ] Local search works without sending plaintext queries or indexes to the server.
- [ ] Oversized-record test: 256 KiB plaintext accepted, 256 KiB + 1 byte rejected identically on client and server; 384 KiB ciphertext ceiling respected.

### Security and operations

- [ ] Request size, type, schema, and per-vault authorization are validated at every API boundary.
- [ ] Pairing tickets are 256-bit entropy, stored as hashes, expire, single-active-per-vault, and are consumed atomically once.
- [ ] API errors use only Appendix A codes with the specified HTTP mappings; no SQL details, stack traces, or secret-bearing values.
- [ ] Rate-limit tests: each Appendix B limit returns `429 RATE_LIMITED` with `Retry-After` and recovers after the window.
- [ ] CSP and response security headers are verified against a production build, including the pinned WASM crypto hash.
- [ ] Dependency audit, lint, typecheck, unit tests, integration tests, and end-to-end flows pass in CI.
- [ ] Setup, deployment, D1 migration, encrypted backup, recovery, and incident procedures are documented.
- [ ] OpenAPI/API-spec contract frozen at Milestone 3 gate; CI fails on frontend/backend contract drift.

## 15. Implementation milestones

### Milestone 1 — Item/API schemas first, then UI shell and local data model

1. **Define and freeze item schemas and API field names** (record types, envelope fields, error codes per Appendix A) before building UI — UI forms must follow the schema, not precede it.
2. Scaffold Vite, React, TypeScript, Tailwind, and shadcn/ui.
3. Implement navigation, dashboard, Quick Add, item forms, tags, favorites, archive, and responsive layouts.
4. Add Dexie schema and encrypted-payload-shaped test fixtures; avoid real credentials during UI development.

### Milestone 2 — Cryptography and local vault lifecycle

- Implement DEK creation, Argon2id key derivation (parameter table §FR-6), master envelope, authenticated encryption with AAD binding, lock/unlock, and in-memory search.
- Implement recovery secret/envelopes (domain-separated HKDF labels) and recovery-kit export/confirmation (Appendix C format).
- Encrypt local records, outbox, device token, and local private signing key at rest.
- Add crypto unit tests, cross-version fixtures (v1 envelope vectors), tamper/AAD tests, WASM-load-failure test, and Argon2id floor/ceiling tests.

### Milestone 3 — Cloud API, D1, and device authorization

- **Exit gate: commit and freeze the machine-readable API contract** (`openapi.yaml` or `docs/backend/api-spec.md` covering every endpoint in §11, all Appendix A codes with HTTP mappings, and size limits). No Milestone 4 work starts until the contract is reviewed.
- Create the Pages Functions API and D1 schema/migrations (§10, including single-active-ticket index).
- Implement vault creation, token hashing, Ed25519 signature validation, device pairing (full §FR-5 sequence), one-time tickets, recovery enrollment (with Appendix B limits), and revocation.
- Add bounded request handling, same-origin security headers, and stable API error contracts.
- Verify that server logs and D1 contain no plaintext vault data or raw secrets.

### Milestone 4 — Sync, conflicts, and backups

- Implement cursor paging, outbox, idempotency (both directions), compare-and-swap revisions, append-only change events, and tombstones.
- Implement conflict resolution and reliable handling of online/offline transitions, including idempotent download-apply and crash-recovery.
- Build encrypted export/import with preview and clean-device restore (ciphertext budget §FR-1).
- Test simultaneous edits, delete-vs-edit, retries, duplicate requests, pagination, quota errors, and interrupted restores.

### Milestone 5 — PWA, hardening, and cross-device validation

- Add manifest, icons, service worker with versioned caches and the §FR-3 update lifecycle, and install guidance.
- Verify that service worker and HTTP caches do not store plaintext API responses.
- Apply CSP/security headers (pinned WASM hash), dependency checks, endpoint abuse limits (Appendix B), accessibility checks, and production build verification.
- Test real target devices, especially iOS storage eviction (§5) and lifecycle behavior.

### Milestone 6 — Personal release

- Deploy the Pages project and D1 binding.
- Confirm free-tier usage and quota-exhaustion behavior.
- Test new-device pairing, revocation, recovery with all previous devices unavailable, encrypted export, and restore.
- Publish a concise threat-model/privacy page and setup/recovery guide.
- Start using the app with non-critical test data before storing important credentials.

## 16. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Master passphrase forgotten | Strong setup guidance, recovery kit, and verified all-devices-lost recovery flow |
| Recovery kit lost | Clear warnings, downloadable/copyable kit, confirmation before setup/rotation completes |
| Recovery kit's vault ID lost | Include vault ID and deployment/API origin in the kit |
| Stolen device while unlocked | Manual lock, inactivity timeout, encrypted local persistence; document limits |
| Device token stolen | Hash tokens server-side; require Ed25519 signatures for mutations and administrative actions; revoke device |
| XSS or malicious frontend build | Strict CSP, no unnecessary third-party scripts, dependency hygiene, output escaping, trusted deployment chain, security review |
| Concurrent edits | Optimistic concurrency and explicit conflict resolution; no silent last-write-wins |
| Offline changes lost | Durable encrypted outbox, stable cursors, idempotency, retry, and fault-injection tests |
| Browser storage evicted | Request persistent storage where supported; encrypted export and recovery kit; visible backup reminder |
| Cloudflare quota exhausted | Preserve local usability and queued edits; display sync-paused state and recovery guidance |
| D1 or API unavailable | Local-first operation; bounded retries and no destructive fallback |
| Weak master passphrase | Encourage long passphrases, calibrated Argon2id, and clear offline-guessing threat explanation |
| False confidence in encryption | Document metadata leakage, frontend trust boundary, and lack of independent audit |

## 17. Definition of done

The MVP is complete when all acceptance criteria pass on the target platforms, the app works locally after initial setup, sync completes between two authorized devices, pairing and revocation work, encrypted backups restore successfully, and the recovery kit can restore the vault when all prior devices are lost. No important real credential should be stored until recovery, sync, and key lifecycle tests have passed.

**Product principle:** Keep the product lightweight, local-first, privacy-focused, and free to operate within current quotas. Do not sacrifice encryption, sync integrity, or recoverability merely to reduce implementation effort.

## 18. Gap fixes compared with v1.0

This revision history is preserved from v2.0:

1. **All-devices-lost recovery:** Adds a recovery kit containing a vault locator and a recovery secret, plus a server authorization derivation that is separate from the key used to decrypt the vault.
2. **Pairing bootstrapping:** Defines vault creation, short-lived one-time pairing tickets, the new-device flow, and revocation.
3. **Token theft:** Adds per-device Ed25519 signatures so a copied bearer token alone cannot perform mutations or privileged operations.
4. **Key lifecycle:** Defines a random DEK, master-password envelope, recovery envelope, key derivation separation, associated data, versioning, and password-change behavior.
5. **Sync correctness:** Defines expected revisions, stable cursors, atomic writes, idempotency, tombstones, delete-vs-edit handling, and conflict outcomes.
6. **Local storage reality:** Clarifies that IndexedDB/PWA storage can be cleared or evicted and that browser storage is not a substitute for encrypted backup.
7. **Scope control:** Removes custom fields from the MVP, keeps the product as a PWA, and rules out Next.js/Supabase/Redis/VPS and native app releases.
8. **Advanced search:** Specifies supported filters and query syntax rather than leaving “advanced search” vague.
9. **Operational constraints:** Adds item/batch sizes, bounded sync behavior, API error contracts, current free-tier assumptions, and graceful quota exhaustion.
10. **Testable completion:** Converts security, recovery, sync, and cross-platform expectations into explicit acceptance criteria.

## 19. References for implementation

These references support the current platform constraints and security practices. They are not a substitute for testing the exact implementation.

- [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/) — current request and CPU quotas.
- [Cloudflare D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) — included reads, writes, and storage.
- [Cloudflare D1 limits](https://developers.cloudflare.com/d1/platform/limits/) — database, row, and query limits.
- [Cloudflare Pages limits](https://developers.cloudflare.com/pages/platform/limits/) — build and static-asset limits.
- [Cloudflare D1 free-tier limit enforcement notice](https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/) — behavior when daily row limits are exceeded.
- [OWASP Cryptographic Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html) — key generation, separation, storage, and lifecycle principles.
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) — password KDF guidance, including Argon2id.
- [OWASP HTML5 Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html) — browser storage and XSS risks.
- [MDN: Storage quotas and eviction criteria](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria) — storage persistence and eviction behavior across browsers.

## 20. Gap fixes v2.0 → v3.0 (15 items)

| ID | Gap in v2 | Fix in v3 |
|---|---|---|
| G1 | §11 said "exact response schemas should be committed" but defined none — frontend/backend drift risk. | §11 + Milestone 3: machine-readable contract (`openapi.yaml` / `docs/backend/api-spec.md`) is the normative Milestone 3 exit gate; §14 blocks release on contract-drift CI. |
| G2 | Argon2id "calibrate" with no baseline — implementer could pick weak params. | §FR-6: normative Minimum/Recommended/Mobile-fallback/Maximum-cap table, calibration procedure, floor/ceiling rejection rules, `kdf_version = 1`. |
| G3 | Pairing described only the authorized-device side; new-device bootstrap missing. | §FR-5: normative 4-step sequence (ticket creation → exchange → bootstrap+unlock → initial sync), single-active-ticket rule, raw-token-once handling. |
| G4 | "Stable machine-readable codes" required but no code defined. | Appendix A: frozen error-code enum with HTTP mappings + UI category mapping. |
| G5 | Crypto/schema versioning mentioned but version placement and migration rules undefined. | §FR-1 + §10 + App. D: `schema_version = 1` / `crypto_format_version = 1`, dual storage (encrypted + plaintext triage column), forward-compat and refuse-to-downgrade rules. |
| G6 | Cursor commit "transactionally" without crash-safety; only upload idempotency specified. | §FR-4 + §11: download-apply idempotency keyed by `(record_id, revision, change_seq)`, Dexie-transaction rule, crash fault-injection acceptance test. |
| G7 | Recovery-kit contents listed but file format undefined. | §FR-7 + Appendix C: normative `personal-vault-recovery-kit.json` fields, base32 fallback, offline-storage warning, save-confirmation gate. |
| G8 | Password change "re-wraps DEK" but recovery-envelope scope ambiguous. | §FR-6: password change touches master envelope only; recovery envelope unchanged; atomic replace + UI disclosure strings. |
| G9 | "Abuse protection" with no numbers. | Appendix B: per-endpoint D1-backed limits, `429 RATE_LIMITED` + `Retry-After`, Free-plan-compatible enforcement. |
| G10 | 256 KiB plaintext limit ignored encryption/transport overhead and D1 row cap. | §FR-1: ciphertext budget 384 KiB, batch cap counted in ciphertext bytes, pre-release D1 row-size validation gate. |
| G11 | iOS listed without ITP eviction reality. | §5 + §14: ~7-day eviction note, aggressive iOS backup banner, eviction-recovery acceptance test. |
| G12 | Service worker required without update lifecycle. | §FR-3 + §14 + M5: versioned caches, skipWaiting-or-prompt strategy, stale-shell/API mismatch test. |
| G13 | Device `last-seen` display without provenance (spoofing/fingerprinting question). | §FR-5 + §10: server-recorded, never client-provided; disclosed metadata. |
| G14 | WASM crypto dependency without load-failure behavior. | §2(11) + §FR-6 + §9(4) + §14: blocking fatal error, no fallback, pinned-hash CSP check, acceptance test. |
| G15 | Milestone 1 built UI before defining schemas. | M1 reordered: schema freeze is step 1, UI follows. |

## Appendix A — Stable error codes (v3 — G4, normative)

Every API error response is `{ "code": "<CODE>", "message": "<human-readable>", "retryable": true|false }`. `message` is UI-displayable and contains no secrets, SQL, or stack traces. Codes are frozen by the Milestone 3 contract; adding a code requires a minor contract revision.

| Code | HTTP | Retryable | Meaning / when returned |
|---|---|---|---|
| `VALIDATION_ERROR` | 400 | false | Request body fails schema/size validation. |
| `PAYLOAD_TOO_LARGE` | 413 | false | Body or single record exceeds size caps (§FR-1, §FR-4). |
| `VAULT_NOT_FOUND` | 404 | false | Unknown `vault_id`. Same response whether vault never existed or caller unauthorized (no enumeration oracle). |
| `DEVICE_UNAUTHORIZED` | 401 | false | Missing/unknown device token. |
| `DEVICE_REVOKED` | 401 | false | Token belongs to a revoked device. UI shows "device revoked" and stops retrying. |
| `INVALID_SIGNATURE` | 401 | false | Signature missing, malformed, wrong key, or body-digest mismatch on endpoints requiring signatures. |
| `STALE_TIMESTAMP` | 401 | true | Timestamp outside the ±5-minute window. Client re-syncs clock and retries once. |
| `REPLAY_DETECTED` | 409 | false | Reused nonce/mutation-ID with a different body (true replay). Identical-body retry returns the original success instead. |
| `REVISION_CONFLICT` | 409 | false | `expected_revision` mismatch. Response includes `server_revision` + server ciphertext. UI opens conflict resolution. |
| `VERSION_MISMATCH` | 409 | false | Envelope/schema/crypto version higher than client supports. UI shows "please update the app". |
| `CRYPTO_VERSION_UNSUPPORTED` | 400 | false | Envelope below Argon2id floor or above cap, or unknown `kdf_version`/`crypto_format_version`. |
| `TICKET_INVALID` | 400 | false | Ticket hash unknown or vault mismatch. |
| `TICKET_EXPIRED` | 410 | false | Ticket past 5-minute expiry. |
| `TICKET_CONSUMED` | 410 | false | Ticket already used or superseded by a newer ticket. |
| `RATE_LIMITED` | 429 | true | Appendix B limit hit. Response includes `Retry-After` header. |
| `QUOTA_EXHAUSTED` | 503 | true | Cloudflare/D1 free quota exhausted. UI shows "sync paused" and keeps local data. |
| `SYNC_CURSOR_INVALID` | 400 | false | Unknown or stale cursor. Client resets to last durable cursor or `0` with full re-pull. |
| `INTERNAL_ERROR` | 500 | true | Catch-all. Logged server-side without secrets; client shows generic message. |

UI mapping (every code maps to exactly one category): network failure (`INTERNAL_ERROR` retryable, `QUOTA_EXHAUSTED`), quota exhaustion (`QUOTA_EXHAUSTED`), authorization/revocation (`DEVICE_UNAUTHORIZED`, `DEVICE_REVOKED`, `INVALID_SIGNATURE`), malformed data (`VALIDATION_ERROR`, `PAYLOAD_TOO_LARGE`, `SYNC_CURSOR_INVALID`, `TICKET_INVALID`), version mismatch (`VERSION_MISMATCH`, `CRYPTO_VERSION_UNSUPPORTED`), conflict (`REVISION_CONFLICT`, `REPLAY_DETECTED`, `TICKET_EXPIRED`, `TICKET_CONSUMED`, `VAULT_NOT_FOUND`), rate-limited (`RATE_LIMITED`, `STALE_TIMESTAMP` with single retry).

## Appendix B — Application-level rate limits (v3 — G9, normative)

Enforced in the Worker with D1-backed counters (no paid product required). All windows are rolling. Failures count toward the limit. Exceeding any limit returns `429 RATE_LIMITED` with a `Retry-After` header in seconds.

| Endpoint | Limit | Rationale |
|---|---|---|
| `POST /api/v1/vaults` | 3 per IP per hour | Vault creation is rare; blocks mass-creation abuse. |
| `POST /api/v1/pairing-tickets` | 5 per device per hour | Ticket creation requires unlock + signature; 5 covers retries. |
| `POST /api/v1/pairing/exchange` | 10 per vault per hour | Allows typos on manual codes; blocks ticket brute-force (256-bit space + 5-min expiry makes guessing infeasible regardless). |
| `POST /api/v1/recovery/enroll-device` | 5 per vault per hour, doubling backoff after 3 failures | Recovery is rare and sensitive; strictest user-facing limit. |
| `POST /api/v1/sync/batch` | 120 per vault per hour | Covers burst editing + retry storms; legitimate use batches 50 mutations per call. |
| `GET /api/v1/sync` | 300 per vault per hour | Covers initial pull paging; clients must debounce (no polling) per §13. |
| `PUT /api/v1/vault/crypto-metadata` | 10 per vault per hour | Envelope updates are rare (password change, rotation). |

Acceptance: each limit is tested to return `429` then recover after the window; the UI surfaces "rate limited, retry in N seconds" distinctly from quota exhaustion.

## Appendix C — Recovery-kit file (v3 — G7, normative)

File name: `personal-vault-recovery-kit.json`. Encoding: UTF-8 JSON, no BOM. The `recovery_secret` is the 32 raw bytes base64url-encoded (no padding). Example (values illustrative):

```json
{
  "format": "personal-vault-recovery-kit",
  "version": 1,
  "vault_id": "01J9Z8QK7M3V6P2R5T8W4Y6U1A",
  "api_origin": "https://personal-vault.pages.dev",
  "recovery_secret": "dGhpcy1pcy1hbi1leGFtcGxlLTI1Ni1iaXQtc2VjcmV0ISE",
  "created_at": "2026-10-13T00:00:00Z",
  "instructions": "Open api_origin, choose Recover, enter vault_id and recovery_secret (or its base32 manual code). Keep this file offline."
}
```

Validation on import: `format` exact match, `version` supported, `vault_id` non-empty opaque string, `api_origin` HTTPS URL, `recovery_secret` decodes to exactly 32 bytes. The manual fallback code is base32 (RFC 4648, no padding, grouped in 4s) encoding the same 32 bytes and must round-trip. The kit contains no master passphrase, no device tokens, and no plaintext vault data.

## Appendix D — Crypto/format versions (v3 — G2/G5, normative)

- `crypto_format_version = 1`, `kdf_version = 1`, `schema_version = 1`, `key_version = 1` for the MVP. All four travel in the master envelope; `schema_version` + `key_version` additionally ride each record's AAD and plaintext triage columns.
- Master-envelope fields (all required): `kdf_version`, `argon2_m_kib`, `argon2_t`, `argon2_p`, `salt_b64u` (16 bytes), `nonce_b64u` (24 bytes, XChaCha20), `wrapped_dek_b64u`, `crypto_format_version`, `key_version`.
- Recovery-envelope fields (all required): `crypto_format_version`, `key_version`, `nonce_b64u`, `wrapped_dek_b64u` (DEK wrapped under `HKDF(recovery_secret, "PV-V1/RECOVERY-WRAP")`), plus the server-side `recovery_auth_verifier = SHA-256(HKDF(recovery_secret, "PV-V1/RECOVERY-AUTH"))`.
- Test vectors: Milestone 2 ships known-answer fixtures for the Minimum and Recommended Argon2id profiles, one AAD-mismatch rejection case per AAD field, and a `v1`-reads-`v1` forward-compat case with an unknown payload field preserved.
