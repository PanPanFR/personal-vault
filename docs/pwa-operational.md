# Personal Vault — PWA Operational & Hardening Specification

> **Normative Status & Precedence**  
> This document specifies the operational lifecycle, target platform constraints, Service Worker caching policies, storage durability guarantees, Cloudflare free-tier quota limits, operational runbooks, and release soak protocols for Personal Vault.  
>  
> - **Normative Source:** Derived directly from `personal-vault-prd-v3.md` v3.0 (2026-10-13): specifically §2 (Firm product decisions), §3 (Goals and success measures), §5 (Target platforms and PWA limitations, G11), §8 (FR-3 Local-first persistence & SW update lifecycle, G12), §9 (Security model & threat boundaries), §12 (Non-functional requirements), §13 (Hosting and free-tier plan), §14 (MVP acceptance criteria), §15 (Milestones 5 & 6), and §17 (Definition of Done).  
> - **Precedence Rule:** `personal-vault-prd-v3.md` v3.0 is the sole normative authority. On any discrepancy between this specification and the PRD, the **PRD WINS**.  
> - **Derivation Rule:** Derive strictly from PRD requirements without introducing novel product features. Any unresolved ambiguity is explicitly marked with `> TODO(question): ...`.

---

## 1. Target Platforms & PWA Operational Reality

*Citations: PRD §2 (Item 1, 8), §5 (Target platforms and PWA limitations), §8 (FR-3), §12 (Non-functional requirements).*

### 1.1 Target Platform Matrix & Verification Scope

Personal Vault is delivered as a single responsive codebase using Vite + React + TypeScript and standard Web platform APIs. The release gate blocks unless verified across the following platform targets:

| Target Platform | Runtime & Delivery Mechanism | Primary Verification Surface | PRD Requirements & Acceptance Gate |
|---|---|---|---|
| **Windows / Desktop** | Installable PWA via supported Chromium browser (Chrome / Edge); browser access remains supported | Desktop screen widths (>= 1024px), physical keyboard navigation, clipboard API, window resizing | PRD §5, §14: PWA installability, app-shell caching, search shortcut `Ctrl+K`, offline unlock. |
| **Android** | Installable PWA via modern Chromium browser (Chrome) on a real Android device | Touch targets, soft keyboard show/hide, screen rotation, offline sync pause, foreground wake | PRD §5, §14: Real-device installation, Dexie persistence, background lifecycle, touch UX. |
| **iOS / iPadOS** | Add to Home Screen via Safari WebKit on a real iPhone / iPad | Standalone display mode, Safari ITP storage eviction, virtual keyboard viewport shifts, clipboard paste permissions | PRD §5 (G11), §14: Real-device testing; aggressive export banner; clean start after simulated eviction; search shortcut `Cmd+K`. |
| **Modern Web** | Current desktop and mobile browsers (Chromium, Firefox, Safari) | Responsive layouts (mobile < 640px, tablet 640–1023px, desktop >= 1024px) | PRD §5, §12: Usable directly in browser if installation is rejected or unavailable. |

### 1.2 Explicit Non-Promises & PWA Constraints (PRD §5)

Personal Vault is an installable Progressive Web App, **not a native application**. The application explicitly makes **no promises** regarding:
1. **No Native Background Sync:** The app does not sync while closed, backgrounded, or locked. Sync executes strictly in the foreground while unlocked (PRD §5, §FR-5).
2. **No Push Notifications:** No Web Push or OS-level notification daemons are utilized (PRD §4, §5).
3. **No OS Keychain Integration:** Cryptographic keys and tokens are never stored in Windows Credential Manager, Apple Keychain, or Android Keystore (PRD §5).
4. **No Native Biometric Unlock:** The MVP relies exclusively on the master passphrase derived via client-side Argon2id. No WebAuthn/TouchID/FaceID biometrics are promised for the MVP (PRD §5).
5. **No Cross-Browser Parity of Storage Durability:** Browsers manage storage under differing internal eviction policies. Browser storage is treated as an ephemeral cache, never permanent storage (PRD §5, §FR-3).

### 1.3 The Offline-After-Setup Operational Rule (PRD §5, §FR-3, §12)

Offline capabilities are subject to strict lifecycle prerequisites:

```
[ New Device ] ──( Requires Network )──> [ Pairing / Recovery / Setup ]
                                                       │
                                                       ▼
                                          [ Initial Sync (cursor=0) ]
                                          (Download Encrypted Vault)
                                                       │
                                                       ▼
                                          [ Full Offline Operation Ready ]
                                          - View cached records
                                          - Create / edit / delete records
                                          - Search in-memory index
                                          - Queue mutations in outbox
```

- **Setup Requires Network:** Creating a cloud vault, pairing a new device, or recovering an existing vault using the recovery kit **strictly requires active network access** to Cloudflare Pages Functions and D1 (PRD §5).
- **Offline Operational Scope:** Once initial setup is complete and encrypted vault records are cached locally in Dexie.js (IndexedDB), the vault is fully operational offline while unlocked:
  - Viewing, editing, creating, archiving, and deleting records operates locally against IndexedDB (PRD §FR-3).
  - Search indexes are built in-memory upon entering the master passphrase (PRD §FR-2, §12).
  - Mutations are queued durably in the encrypted outbox store (PRD §FR-3, §10).
- **Post-Offline Resumption:** Edits made offline remain encrypted locally. Upload commences automatically when the user unlocks the vault on that device and active network connectivity returns (PRD §5, §11).

---

## 2. Browser Storage Durability & iOS ITP Eviction Architecture

*Citations: PRD §5 (Target platforms and PWA limitations, G11), §8 (FR-3), §9 (Threat boundaries), §14 (Acceptance criteria).*

### 2.1 Storage Durability vs. Ephemeral Browser State

Under browser storage models, IndexedDB and Cache API are subject to browser-controlled eviction under storage pressure or tracking heuristics (PRD §5, §FR-3, §9).

```
+------------------------------------------------------------------------------+
|                         DATA DURABILITY CLASSIFICATION                       |
+------------------------------------------------------------------------------+
| [ Tier 1: Authoritative Independent Backup ]                                  |
|   - Encrypted JSON Export (`personal-vault-export-YYYYMMDD.json`)            |
|   - Recovery Kit Document (`personal-vault-recovery-kit.json`)               |
|   => Stored offline outside the browser profile by the user                  |
+------------------------------------------------------------------------------+
| [ Tier 2: Synchronized Relay Copy ]                                          |
|   - Cloudflare D1 Database (`vault_records`, `sync_changes`, `vaults`)       |
|   => Remote ciphertext copy; vulnerable to quota caps or tenant loss         |
+------------------------------------------------------------------------------+
| [ Tier 3: Ephemeral Local Working Cache ]                                    |
|   - Browser IndexedDB via Dexie.js (`records`, `outbox`, `device_credentials`)|
|   - Service Worker Cache API (app-shell static assets only)                  |
|   => Subject to OS storage pressure and WebKit ITP 7-day eviction            |
+------------------------------------------------------------------------------+
```

1. **Storage Is Not a Backup:** The application UI must never describe local browser storage or Cloudflare D1 storage as an "independent backup" (PRD §5, §FR-7).
2. **Persistent Storage Request:** On supported browsers, the client must explicitly invoke `navigator.storage.persist()` during vault setup and record the granted state in `app_metadata` (PRD §5, §FR-3).
3. **Backup Reminders:** The application surfaces scheduled reminders in Settings urging the user to export an encrypted backup (`.json`) and store their recovery kit offline (PRD §5, §FR-3, §FR-9).

### 2.2 iOS Safari ITP ~7-Day Eviction Dynamics (PRD §5, G11)

On iOS and iPadOS (Safari WebKit), Apple's Intelligent Tracking Prevention (ITP) and mobile storage management enforce aggressive client-side deletion rules:
- **The ~7-Day Eviction Rule:** If a user does not open the PWA or website within approximately 7 days, WebKit may evict all writable client-side storage, including IndexedDB databases, Cache API contents, and localStorage (PRD §5 G11).
- **Stand-alone Display Mode Vulnerability:** Even when added to the iOS Home Screen, WebKit standalone web apps remain subject to storage clearing under device storage pressure or prolonged inactivity.
- **Data Loss Boundary:** While Cloudflare D1 retains the remote ciphertext, any local mutations in the IndexedDB `outbox` that have not synced to the cloud before eviction will be irrevocably deleted by the browser.

### 2.3 Aggressive iOS Backup Banner Architecture (PRD §5 G11)

To protect users against unexpected WebKit storage purging, the application implements specialized UI behavior when running on iOS/iPadOS:

1. **Platform Detection:** The client detects iOS/iPadOS via user agent inspection and touch/platform capability flags (`navigator.platform` / `navigator.maxTouchPoints`).
2. **Aggressive Export Banner:**
   - On iOS/iPadOS devices, the app displays a prominent, persistent warning banner across the Dashboard and Settings views (PRD §5 G11).
   - Banner Copy: *"iOS Safari may delete local vault data if unopened for 7 days. Download an encrypted backup to prevent data loss."*
   - Banner Persistence: The banner remains prominently visible until the user completes at least one encrypted export (tracked locally via `last_export_at` timestamp).

> TODO(question): PRD §5 (G11) specifies an "aggressive backup reminder on iOS (e.g. persistent Settings banner until an export exists)". Can the user temporarily dismiss this banner on the Dashboard for the current session, or must it remain permanently pinned to both Dashboard and Settings until `last_export_at` is populated?

### 2.4 Relaunch-After-Eviction Test & Clean-Start State Machine (PRD §5 G11, §14)

A critical acceptance requirement is ensuring that storage eviction does not leave the application in an indeterminate, crashed, or corrupt state.

```
                   [ App Launch on iOS / Desktop ]
                                  │
                                  ▼
                    [ Check IndexedDB Storage ]
                                  │
        ┌─────────────────────────┴─────────────────────────┐
        ▼                                                   ▼
 [ Database Intact ]                               [ Database Evicted / Empty ]
   (`app_metadata` exists)                           (`app_metadata` missing)
        │                                                   │
        ▼                                                   ▼
 [ Normal Unlock Flow ]                             [ Clean-Start Recovery State ]
 Enter Master Passphrase                             - DO NOT show partial vault
                                                     - DO NOT throw uncaught crash
                                                     - Present Clean Start Screen:
                                                       1. "Restore with Recovery Kit"
                                                       2. "Pair with Existing Device"
                                                       3. "Create New Vault"
```

#### Acceptance Test Procedure: Relaunch After Eviction (PRD §14)
1. **Setup:** Enroll a real iOS Safari device or simulate eviction on desktop Chromium by deleting IndexedDB and Cache storage via developer tools while preserving the app shell.
2. **Trigger:** Launch the PWA directly from the home screen / bookmark.
3. **Assertions:**
   - The application starts cleanly without unhandled JavaScript exceptions.
   - The UI does **not** render a corrupt half-vault, a missing-record dashboard, or a broken lock screen (PRD §5 G11, §14).
   - The app detects that local credentials and metadata are absent, cleanly transitioning to the Onboarding / Recovery screen.
   - The user can seamlessly restore access using their `personal-vault-recovery-kit.json` (or base32 recovery secret) or initiate pairing from an active device (PRD §5, §FR-5, §FR-7).

---

## 3. Service Worker Lifecycle & Offline Cache Architecture

*Citations: PRD §2 (Item 1, 8), §6 (Tech stack), §8 (FR-3, G12), §9 (Security requirements 1, 3, 4), §13 (Hosting plan), §14 (Acceptance criteria).*

### 3.1 App-Shell Caching Only & Versioned Storage (PRD §6, §FR-3)

The Service Worker (`sw.js`) serves exactly one primary operational purpose: **reliable app-shell caching for offline installation and asset delivery** (PRD §6, §FR-3).

- **Cache Scope:** Only static, immutable, or version-hashed assets may be cached:
  - `index.html` (entry document)
  - Compiled JavaScript and CSS bundles (`/assets/*-[hash].js`, `/assets/*-[hash].css`)
  - WebAssembly cryptographic binary (`libsodium.wasm` with pinned hash)
  - PWA manifest (`manifest.webmanifest`) and application icon assets (`/icons/*`)
- **Versioned Cache Naming:** Every production build generates a unique cache identifier derived from the build commit or semantic build hash:
  ```text
  CACHE_NAME = "pv-shell-v" + BUILD_HASH; // e.g., "pv-shell-v3.0.0-8f92a1c"
  ```

### 3.2 Strict No-Plaintext Cache Invariant (PRD §FR-3, §9, §13, §14)

Under no circumstances may dynamic vault records, ciphertext responses, or cryptographic keys be persisted within browser HTTP or Service Worker caches.

| Storage Surface | Permitted Contents | Prohibited Contents (Strict Invariants) | PRD Citation |
|---|---|---|---|
| **Service Worker Cache API** | Versioned static app shell, HTML/JS/CSS, WASM binary, icons | Any request/response under `/api/*`, vault ciphertext, recovery tokens, decrypted records | PRD §FR-3, §9 |
| **HTTP Browser Cache** | Static assets with immutable/long-lived headers | All `/api/v1/*` endpoints (must return `Cache-Control: no-store`) | PRD §FR-3, §13 |
| **`localStorage`** | Non-sensitive UI flags (e.g. lock-epoch timestamp, active theme) | Master passphrase, DEK, recovery secret, plaintext records, decrypted outbox entries | PRD §FR-3, §10 |
| **URL Query Strings & History** | Non-sensitive routing parameters | Vault IDs in public links, tokens, search queries, passwords | PRD §FR-3, §FR-8 |
| **IndexedDB (Dexie.js)** | Encrypted records, encrypted outbox, encrypted device credentials | Plaintext records, unencrypted private keys, raw bearer tokens | PRD §FR-3, §10 |

### 3.3 Service Worker Update Lifecycle & Version Transitions (PRD §FR-3 G12, §14)

A major operational failure mode in PWAs is the "stale-shell hazard," where a cached client version continues to run against an updated backend API, resulting in schema incompatibilities or contract drift.

```
           [ New Production Deployment Released ]
                              │
                              ▼
           [ Browser Detects Updated sw.js (1 byte diff) ]
                              │
                              ▼
           [ Service Worker Installation & Pre-cache ]
           Pre-caches new assets into `pv-shell-v(N+1)`
                              │
                              ▼
    ┌───────────────────────────────────────────────────┐
    │          Update Activation Strategy Gate          │
    │  (PRD §FR-3 G12: skipWaiting vs Explicit Prompt)  │
    └───────────────────────────────────────────────────┘
          │                                       │
          ▼ [ Option A: skipWaiting ]             ▼ [ Option B: Prompt ]
   [ Worker Activates Immediately ]        [ Show "Update Available" ]
   Invokes `self.clients.claim()`          User clicks "Reload to Update"
   Notifies client: "App updated"          Calls `postMessage({type: 'SKIP_WAITING'})`
          │                                       │
          └───────────────────┬───────────────────┘
                              │
                              ▼
                   [ activate Event Triggered ]
          - Iterate all keys in CacheStorage
          - Delete any cache key != `pv-shell-v(N+1)`
          - Ensure old assets are purged immediately
                              │
                              ▼
                   [ Client Re-evaluates API ]
          Zero stale-shell / newer-API mismatches permitted
```

#### The Stale-Shell / Two-Build Acceptance Test (PRD §FR-3 G12, §14)
Acceptance testing requires deploying two consecutive production builds (Build 1 followed by Build 2):
1. Load Build 1 on reference devices; create and unlock a test vault.
2. Deploy Build 2 with updated frontend assets and an updated API route contract.
3. Reload or navigate: verify that Build 2 either prompts the user or auto-reloads cleanly.
4. Verify that Build 1 cache (`pv-shell-v1`) is completely purged and that no API request from Build 1 fails against Build 2 due to client cache staleness (PRD §FR-3 G12, §14).

> TODO(question): PRD §FR-3 (G12) provides two paths for service worker update activation: (1) immediate `skipWaiting` + `clientsClaim` followed by a "reloaded to new version" notice, or (2) an explicit "Update available — reload" prompt. Sibling implementation plan `pwa-hardening-release.md` selected Option 1 (auto-activate + notice) as the engineering default. Does product accept auto-activate as the permanent default, or must an explicit user prompt be configurable?

### 3.4 Browser Storage Errors & Persistent Storage Requests (PRD §FR-3)

- **`QuotaExceededError` Handling:** When local disk quota is exhausted during a Dexie write or outbox queue operation, the application must catch the exception, present an explicit error modal, and explain that local storage is full. It must **never fail silently** or crash the React state machine.
- **Local Usability Survival:** If storage write operations fail or if network connectivity is severed, existing cached records remain readable in-memory while the vault remains unlocked (PRD §FR-3, §12).

---

## 4. Non-Functional Requirements & Performance Envelopes

*Citations: PRD §3 (MVP success measures), §12 (Non-functional requirements), §14 (Acceptance criteria).*

### 4.1 Performance & Capacity Targets (PRD §3, §12)

Personal Vault establishes explicit performance budgets for reference hardware:

| Metric | Target / Ceiling | Measurement Condition | PRD Citation |
|---|---|---|---|
| **Vault Capacity** | **5,000 records** | Small text records (avg 1–2 KiB plaintext) | PRD §3, §12 |
| **Search Latency** | **< 200 ms at p95** | In-memory MiniSearch index across 5,000 records on reference mobile/desktop hardware | PRD §3, §12 |
| **Search Index Build** | Fast / non-blocking UI | Built immediately following unlock from decrypted Dexie records | PRD §FR-2, §12 |
| **Unlock Derivation Time** | **< 3.0 seconds** | Desktop: 128 MiB (t=4, p=1); Mobile: 64 MiB (t=3, p=1) fallback | PRD §FR-6 (G2) |
| **Plaintext Record Size** | **256 KiB max** | Validated pre-encryption; oversized inputs rejected with UI notice | PRD §FR-1 |
| **Ciphertext Record Size**| **384 KiB max** | Base64url ciphertext accepted by D1 schema | PRD §FR-1 (G10) |
| **Sync Batch Request** | **1 MiB max / 50 records** | Max payload size evaluated in ciphertext bytes | PRD §FR-4 (G10) |

*Note: The 200 ms p95 search latency is a release target to validate under agreed test datasets, not an unconditional guarantee across arbitrary legacy hardware (PRD §3).*

### 4.2 Multi-Device Sync Reach (PRD §3, §12)

- **End-to-End Propagation:** A change committed on Authorized Device A must reach Authorized Device B upon B's subsequent sync cycle.
- **Zero Plaintext Exposure:** Sync propagation occurs exclusively via opaque ciphertext blobs and monotonic cursors. The intermediate Workers API and D1 database receive zero plaintext fields (PRD §3, §FR-4, §12).

### 4.3 The "No Silent Discard" Reliability Invariant (PRD §3, §12)

A core engineering law of Personal Vault is the prevention of silent data loss:

> **PRD §3 & §12 Invariant:**  
> *"No acceptance test or failure mode can silently discard a pending local change."*

1. **Outbox Durability:** Every local edit (create, update, delete tombstone) must be committed to the Dexie `outbox` store **in the same local transaction** as the local record update.
2. **Network/Server Failures:** If a sync request fails due to network disconnection, server `500 INTERNAL_ERROR`, `429 RATE_LIMITED`, or `503 QUOTA_EXHAUSTED`, the pending outbox mutation **must not be removed**. It remains intact across reloads until explicitly acknowledged by the server (PRD §11, §12).
3. **Conflict Preservation:** In the event of a revision conflict (`409 REVISION_CONFLICT`), the client must never silently overwrite or discard local mutations. Both local and server versions are preserved locally until the user makes an explicit resolution choice (PRD §FR-4, §11).

### 4.4 Availability & Quota Survival Guarantees (PRD §12, §13)

- **Local-First Independence:** The application must remain fully usable for viewing, editing, and searching local data even when Cloudflare Pages Functions or D1 is completely down, unreachable, or over quota.
- **Graceful Sync Pause:** When cloud services are exhausted, the app marks sync state as **"Sync Paused"** while keeping the user's workflow uninterrupted (PRD §12, §13).

---

## 5. Cloud Hosting, Free-Tier Quotas & Sync Debouncing

*Citations: PRD §2 (Item 2, 8, 9), §6 (Tech stack), §13 (Hosting and free-tier plan), Appendix B (Application-level rate limits).*

### 5.1 Cloudflare Unified Deployment Architecture (PRD §2, §13)

Personal Vault deploys as a unified Cloudflare Pages project:

```
[ User Browser / PWA ]
          │
          │ HTTPS (pages.dev or custom domain)
          ▼
+──────────────────────────────────────────────────────────+
| Cloudflare Global Edge                                   |
|                                                          |
|  [ Static Pages Delivery ]                               |
|    - Vite SPA Distribution                               |
|    - Service Worker (`sw.js`) & WebAssembly Assets        |
|    - Pinned Security Headers (`_headers`)                |
|                                                          |
|  [ Pages Functions (Workers Runtime) ]                   |
|    - Same-origin API routes (`/api/v1/*`)                |
|    - D1 Database Binding (`env.DB`)                      |
|    - Zero third-party backend servers                     |
+──────────────────────────────────────────────────────────+
          │
          ▼
+──────────────────────────────────────────────────────────+
| Cloudflare D1 Storage Engine                             |
|    - `vaults`, `vault_records`, `sync_changes`           |
|    - `authorized_devices`, `pairing_tickets`             |
+──────────────────────────────────────────────────────────+
```

- **Zero Additional Infrastructure:** No Supabase, Redis, Next.js server, paid auth provider, or VPS instances (PRD §2 Item 8).
- **Cost Target:** Designed to operate at **$0/month** within current Cloudflare Free tier limits (PRD §2 Item 9).

### 5.2 Database Environment Isolation (PRD §13)

To ensure zero risk of accidental data destruction during updates or testing:
- **Strict D1 Separation:** Development and testing environments must use a distinct D1 database instance (e.g., `personal-vault-dev-db`) separate from the production database (`personal-vault-prod-db`).
- **Migration Verification:** Destructive migrations must never be executed against production without verified export snapshots (PRD §13).

### 5.3 Cloudflare Free-Tier Quota Matrix & Limit Enforcement (PRD §13)

*Quotas verified against Cloudflare documentation as of 2026-10-13 (PRD §13, §19).*

| Subsystem | Free-Tier Allowance (2026-10-13) | Enforcement Behavior on Limit Hit | Application Handling & UX State | PRD Citation |
|---|---|---|---|---|
| **Cloudflare Workers / Functions** | **100,000 requests / day**<br>**10 ms CPU time / invocation** | Edge returns `429` or `1015` error; Worker invocation halts | Handlers must remain lightweight. All crypto runs in browser. UI shows "Sync Paused". | PRD §13 |
| **Cloudflare D1 Reads** | **5,000,000 rows read / day** | D1 returns error; Worker maps to `503 QUOTA_EXHAUSTED` | App halts background pull; displays "Quota reached — sync paused". Local vault stays open. | PRD §13, App. A |
| **Cloudflare D1 Writes** | **100,000 rows written / day** | D1 write rejected; Worker maps to `503 QUOTA_EXHAUSTED` | Outbox mutations stay safely queued in IndexedDB. Manual retry offered. | PRD §13, App. A |
| **Cloudflare D1 Storage** | **500 MB / database**<br>(5 GB account maximum) | D1 rejects additional INSERTs (`STORAGE_EXHAUSTED`) | Client rejects new uploads. User advised to export and archive items. | PRD §13 |
| **D1 Per-Invocation Queries**| **50 queries / Worker execution** | Invocation fails with internal exception | Sync batch operations must use optimized SQL transactions (`db.batch`). | PRD §13 |
| **Cloudflare Pages** | **500 builds / month**<br>**20,000 files / site**<br>**25 MiB max / static asset** | Deployment blocked in CI/CD pipeline | Maintain lean bundle size; verify static assets are below 25 MiB. | PRD §13 |

#### D1 Free Tier Limit Enforcement Notice (2026-09-01)
As mandated by Cloudflare's 2026-09-01 enforcement rules:
- When daily row reads or writes hit 100%, D1 strictly fails subsequent queries until the daily reset window (00:00 UTC).
- The Pages Function catches D1 limit errors and returns HTTP `503` with `{ "code": "QUOTA_EXHAUSTED", "retryable": true }`.
- The client receives `QUOTA_EXHAUSTED`, pauses background syncing, preserves all pending outbox edits, and presents the user with an informative "Sync Paused" status banner with a retry button (PRD §13, Appendix A).

### 5.4 Sync Trigger Lifecycle & Rate-Limiting Debounce Engine (PRD §13, Appendix B)

Continuous polling is strictly prohibited to preserve free-tier request and CPU quotas (PRD §13). Sync requests are executed only under four explicit triggers:

```
+──────────────────────────────────────────────────────────────────────────────+
|                           SYNC TRIGGER ENGINE                                |
+──────────────────────────────────────────────────────────────────────────────+
| 1. On App Open / Unlock: Immediate single pull + push cycle                  |
| 2. Post-Mutation Debounce: 500ms trailing debounce after local edits          |
| 3. Explicit User Action: Manual "Sync Now" button in Dashboard / Settings     |
| 4. Conservative Foreground Interval: Periodic sync while active (e.g. 60s)   |
+──────────────────────────────────────────────────────────────────────────────+
```

1. **Debouncing Edit Bursts:** Rapid edits (e.g., typing notes or creating multiple snippets in succession) are coalesced locally using a 500 ms trailing debounce before initiating a push.
2. **Batch Packing:** The outbox packs up to **50 mutations or 1 MiB of ciphertext** into a single `POST /api/v1/sync/batch` request, minimizing HTTP overhead and D1 row transactions.
3. **Foreground Inactivity Guard:** When the browser tab is hidden or backgrounded, periodic interval timers are suspended. Upon regaining foreground visibility, the app checks if the inactivity lock timeout has elapsed before performing any sync (PRD §FR-6, §13).

> TODO(question): PRD §13 specifies sync executes on a "conservative foreground interval while unlocked" without freezing the exact interval duration. Implementation plans specify a 60-second default. Should the 60-second foreground timer be hard-coded or user-configurable in Settings (e.g., 30s, 60s, 300s, or manual-only)?

---

## 6. Operational Runbooks

*Citations: PRD §13 (Hosting & free tier), §14 (Acceptance criteria), §15 (Milestones 5 & 6).*

### 6.1 Runbook 1: Production Deployment Procedure

**Purpose:** Deploy static assets and Pages Functions to Cloudflare without causing service interruptions or stale-shell mismatches.

#### Prerequisites & Access
- Cloudflare API token with `Pages:Edit` and `D1:Edit` permissions.
- Git repository clean on `main` branch with all acceptance tests passing.
- Verified WASM binary hash in `libsodium-wrappers-sumo`.

#### Execution Steps
1. **Pre-Deployment Verification:**
   - Execute production build: `npm run build`.
   - Verify CSP headers: ensure `functions/_headers` contains the exact SHA-256 hash of the generated WASM binary and `'wasm-unsafe-eval'`.
   - Run API contract drift check against `docs/api-spec.md`.
2. **Apply Database Migrations (if applicable):**
   - Review versioned SQL migration under `migrations/`.
   - Apply to staging/dev database first: `npx wrangler d1 migrations apply personal-vault-dev-db --local=false`.
   - Apply to production database: `npx wrangler d1 migrations apply personal-vault-prod-db --local=false`.
3. **Deploy Pages Project:**
   - Deploy build artifact: `npx wrangler pages deploy dist --project-name personal-vault`.
4. **Post-Deployment Smoke Test:**
   - Open production URL on clean private window.
   - Verify `GET /api/v1/vaults/:id/bootstrap` returns `Cache-Control: no-store`.
   - Confirm Service Worker registers and caches only static assets.

---

### 6.2 Runbook 2: Emergency Rollback Procedure

**Purpose:** Rapidly revert a faulty frontend deployment or mitigate an unexpected API incompatibility.

#### Execution Steps
1. **Frontend Instant Rollback:**
   - Access Cloudflare Dashboard -> **Workers & Pages** -> **personal-vault** -> **Deployments**.
   - Locate the previous stable deployment.
   - Click **Manage Deployment** -> **Rollback to this deployment**.
   - Cloudflare Edge rolls back static asset routing within seconds globally.
2. **Service Worker Cache Invalidation:**
   - Because cache names are tied to build hashes (`pv-shell-v${hash}`), clients detecting the rolled-back `sw.js` will automatically pre-cache the restored version and delete the faulty version during the `activate` event.
3. **Database Schema Rollback Guard (Crucial Invariant):**
   - **Never execute a destructive D1 schema rollback** (e.g., dropping columns or modifying revision sequences).
   - The data model forward-compatibility contract requires clients to ignore unknown JSON fields and refuse downgrades (PRD §FR-1 G5).
   - If an API defect exists, deploy an emergency patch rather than reverting the D1 database tables.

---

### 6.3 Runbook 3: Quota-Exhausted Incident Response

**Purpose:** Triage and handle `503 QUOTA_EXHAUSTED` conditions when daily D1 or Workers allowances are exceeded.

#### Incident Indicators
- Users observe **"Sync Paused"** badge on Dashboard.
- API requests return HTTP `503` with `{ "code": "QUOTA_EXHAUSTED", "retryable": true }`.
- Cloudflare Dashboard displays D1 Read/Write metrics reaching 100% of daily free allowance.

#### Triage & Resolution Procedure
1. **Verify Local Safety:**
   - Reassure the user that local vault operations remain 100% functional.
   - Confirm IndexedDB `outbox` has retained all pending changes without data loss (PRD §12, §13).
2. **Determine Quota Status:**
   - Check Cloudflare Dashboard -> D1 Analytics for daily read/write consumption.
3. **Mitigation Options:**
   - **Option A (Wait for Daily Reset):** Daily limits reset at **00:00 UTC**. Advise the user that sync will automatically resume after the reset window.
   - **Option B (Temporary Upgrade):** If immediate sync is urgently required, upgrade the Cloudflare account to the Workers Paid tier ($5/month), which instantly lifts free-tier limits.
4. **Post-Incident Recovery:**
   - Once quotas are available, open the vault and tap **"Retry Sync"** in Settings.
   - Confirm pending mutations drain from outbox and sync status transitions to **"Synced"**.

> TODO(question): Cloudflare resets daily free quotas at UTC 00:00. When receiving `503 QUOTA_EXHAUSTED`, should the client schedule an automated sync retry at UTC midnight, or rely exclusively on user foreground interaction / manual retry?

---

### 6.4 Runbook 4: iOS Storage Eviction Recovery

**Purpose:** Restore full vault access when an iOS/iPadOS device loses local storage due to WebKit ~7-day ITP eviction.

#### Incident Indicators
- User opens PWA from iOS Home Screen after > 7 days of inactivity.
- The app renders the initial Onboarding / Clean Start screen instead of the familiar unlock prompt.

#### Recovery Procedure
1. **Confirm Clean Start:**
   - Verify the UI presents options to **Pair Device** or **Restore with Recovery Kit** (no broken/half-loaded vault).
2. **Execute Recovery via Recovery Kit:**
   - Select **Restore with Recovery Kit**.
   - Input the `vault_id` and `recovery_secret` from `personal-vault-recovery-kit.json` (or paste the base32 manual fallback code).
   - Tap **Authorize Device**: The client derives the recovery authorization token, calls `POST /api/v1/recovery/enroll-device`, and receives authorization (PRD §FR-7).
   - Set a new master passphrase when prompted.
   - Client pulls all encrypted records from D1 from `cursor=0` and restores full local vault state.
3. **Execute Recovery via Second Device (Alternative):**
   - If an authorized desktop or Android device is available, open the active vault on that device.
   - Go to Settings -> **Add New Device** to generate a 5-minute pairing code.
   - Scan QR code or enter manual ticket on the iOS device to re-register without using the recovery kit (PRD §FR-5).
4. **Post-Recovery Hardening:**
   - Immediately navigate to Settings -> **Export Encrypted Backup** to refresh the local offline copy.

---

## 7. Milestone 6 Personal Release & Soak Protocol

*Citations: PRD §15 (Milestone 6 — Personal release), §16 (Risks and mitigations), §17 (Definition of Done).*

### 7.1 Pre-Release Acceptance Gates (PRD §14, §15)

Prior to entering personal release soak, all Milestone 1 through 5 gates must be certified passing:

- [ ] **Contract Drift Gate (M3):** CI verifies frontend/backend parity against `docs/api-spec.md`.
- [ ] **WASM Integrity Gate (M2, M5):** Pinned binary hash verified in CSP; blocked-WASM failure halts safely.
- [ ] **Two-Build SW Update Gate (M5):** Production consecutive builds update without stale-shell hazards.
- [ ] **iOS Eviction Gate (M5):** Clean start after simulated eviction verified on real iOS Safari device.
- [ ] **Quota Survival Gate (M4, M5):** Simulated `503 QUOTA_EXHAUSTED` preserves local outbox.

### 7.2 The Non-Critical Data Soak Protocol (PRD §15 M6, §17 DoD)

> **Mandatory PRD Principle (§15 M6, §17):**  
> *"Start using the app with non-critical test data before storing important credentials. No important real credential should be stored until recovery, sync, and key lifecycle tests have passed."*

The soak protocol enforces a structured evaluation period on the user's primary devices before entrusting real personal secrets to the vault:

```
[ Phase 1: Deployment & Test Data Population ]
  - Deploy to Cloudflare Pages production (`pages.dev`)
  - Create test vault; populate with 50+ non-sensitive test items
  - Include all 4 item types: Links, Notes, Snippets, Test Credentials
        │
        ▼
[ Phase 2: Active Cross-Device Soak (Minimum 7–14 Days) ]
  - Use daily across at least two authorized devices (e.g. Desktop + iOS)
  - Perform edits, tags, searches, and favorites
  - Induce offline periods (airplane mode edits)
  - Verify multi-device sync propagation
        │
        ▼
[ Phase 3: Stress & Lifecycle Drills ]
  - Perform planned master passphrase change (verify envelope re-wrap)
  - Perform pairing ticket exchange with third device
  - Test device revocation of third device
  - Execute clean-device restore from `personal-vault-recovery-kit.json`
  - Export and restore encrypted JSON backup on clean profile
        │
        ▼
[ Phase 4: Certification for Personal Credentials ]
  - Verify zero unhandled exceptions, zero data loss, zero quota surprises
  - Vault certified for sensitive personal credentials
```

### 7.3 Criteria for Transitioning to Sensitive Personal Credentials

A vault is certified for production personal use only when the user has verified:
1. At least one successful round-trip restore from `personal-vault-export-YYYYMMDD.json`.
2. A verified offline physical or digital copy of `personal-vault-recovery-kit.json` stored safely.
3. No occurrences of silent change discards or outbox corruption across all test sessions.

---

## 8. Open Questions & Ambiguity Register

*Citations: Derived per derivation rule; genuine PRD ambiguities tracked below.*

The following questions represent ambiguities identified in `personal-vault-prd-v3.md` that must be finalized during engineering execution:

> TODO(question): PRD §FR-3 (G12) provides two valid options for service worker update activation: (1) immediate `skipWaiting` + `clientsClaim` followed by a "reloaded to new version" notice, or (2) an explicit user prompt modal ("Update available — reload"). The plan default selects Option 1. Does product confirm Option 1 as the single permanent behavior?

> TODO(question): PRD §13 mandates periodic sync on "a conservative foreground interval while unlocked" without specifying the exact duration. Plan specifies 60 seconds. Should this be fixed at 60s or configurable in Settings (e.g. 30s, 60s, 300s, manual)?

> TODO(question): PRD §5 (G11) specifies an "aggressive backup reminder on iOS (e.g. persistent Settings banner until an export exists)". Can the user temporarily dismiss this banner on the Dashboard during an active session, or is it strictly non-dismissible until `last_export_at` is recorded?

> TODO(question): Cloudflare Free tier resets daily limits at UTC 00:00. When receiving `503 QUOTA_EXHAUSTED`, should the client schedule an automated sync retry at UTC midnight, or rely exclusively on user foreground interaction / manual retry?
