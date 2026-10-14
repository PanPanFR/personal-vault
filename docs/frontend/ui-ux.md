# Personal Vault — UI/UX Specification

> **Normative Human Specification**  
> This document specifies the authoritative user interface architecture, information architecture, interaction flows, visual design, accessibility (a11y), and bilingual internationalization (i18n) requirements for Personal Vault.  
>  
> **Normative Source:** `personal-vault-prd-v3.md` v3.0 (2026-10-13) in the repository root.  
> **Citations:** Specifically derived from §5 (Target platforms & PWA limitations), §6 (Recommended technology stack), §7 (Information architecture and UX), §8 (FR-1 Item management, FR-2 Global and advanced search, FR-8 Credential and clipboard handling, FR-9 Settings and data portability), §9 (Security model & metadata disclosure), §10 (Data model), §11 (API and synchronization protocol), §12 (Non-functional requirements), §13 (Hosting and free-tier plan), Appendix A (Stable error codes), Appendix C (Recovery-kit file format), and frozen User Decisions (2026-10-13).  
> **Precedence:** On any ambiguity or conflict between this document and the PRD, the **PRD WINS**. Genuine ambiguities are recorded as explicit `> TODO(question): ...` markers and are never resolved by silent speculation.

---

## 1. Information Architecture & Navigation (§7)

Personal Vault is structured around single-owner, local-first capture and retrieval. The navigation model provides rapid switching between primary record collections, classification views, and vault lifecycle management.

```
+----------------------------------------------------------------------------------------------------+
|  [Logo] Personal Vault       [Search: Ctrl/Cmd+K]       [Sync Pill: Synced]   [+ Quick Add]  [Lock] |
+-----------------------+----------------------------------------------------------------------------+
|  NAVIGATION           |  DASHBOARD / MAIN CONTENT VIEW                                             |
|                       |                                                                            |
|  - All Items          |  [Favorites Strip / Quick Filters]                                         |
|  - Favorites          |                                                                            |
|  - Links              |  [Active Collection Header]                 [Filter: Tag] [Sort: Updated v] |
|  - Notes              |  +-----------------------------------------------------------------------+ |
|  - Snippets           |  | Card / List View Items                                                | |
|  - Credentials        |  |  - Type Icon | Title | Content / URL preview | Tags | Actions (Fav/..) | |
|  - Tags               |  +-----------------------------------------------------------------------+ |
|  - Archive            |                                                                            |
|                       |  [Sync Status Bar: Last sync 2m ago | Retry]                               |
|  -------------------- |                                                                            |
|  - Settings           |                                                                            |
+-----------------------+----------------------------------------------------------------------------+
```

### 1.1 Primary Navigation Targets (PRD §7, lines 97–108)

The application provides nine top-level navigation routes/views:

| Navigation Item | Route / Target | Active Filter Scope | Description (PRD §7) |
|---|---|---|---|
| **All Items** | `/` | `is_archived = false` | Active records across all four supported item types. Default landing view upon unlock. |
| **Favorites** | `/favorites` | `is_favorite = true AND is_archived = false` | Quick-access collection of user-starred records. |
| **Links** | `/links` | `type = 'link' AND is_archived = false` | Saved web bookmarks and reference URLs. |
| **Notes** | `/notes` | `type = 'note' AND is_archived = false` | Freeform markdown notes and long-form reference entries. |
| **Snippets** | `/snippets` | `type = 'snippet' AND is_archived = false` | Commands, configuration blocks, code snippets, and reusable text. |
| **Credentials** | `/credentials` | `type = 'credential' AND is_archived = false` | Occasional account logins, usernames, and passwords (masked by default). |
| **Tags** | `/tags` | All distinct tags | Tag management, taxonomy overview, and multi-tag intersection filtering. |
| **Archive** | `/archive` | `is_archived = true` | Inactive/dormant records hidden from the active collections without being permanently deleted. |
| **Settings** | `/settings` | Vault configuration | Lock settings, sync diagnostics, device authorization, backup/recovery, theme, language, and system information. |

### 1.2 Responsive Layout Adaptations (PRD §7, §12, line 490)

- **Desktop (>= 1024px):** Fixed left navigation sidebar (collapsible to icon-rail mode), persistent top app header with global search bar, sync state badge, Quick Add button, manual lock trigger, and main scrollable content area.
- **Tablet (768px – 1023px):** Collapsible sidebar drawer with persistent top bar. Global search triggers as full overlay modal.
- **Mobile (< 768px):** Bottom navigation bar for primary destinations (All, Links, Notes, Snippets, More/Settings) + top header containing sync pill, search trigger icon (`Ctrl/Cmd+K`), and hamburger menu for secondary views (Credentials, Tags, Archive). Quick Add appears as a floating action button (FAB) above the bottom bar. Avoid all desktop-only navigation assumptions.

---

## 2. Dashboard Specification (§7)

The dashboard serves as the central hub for rapid capture, retrieval, and sync monitoring (PRD §7, lines 109–120).

### 2.1 Core Dashboard Components

1. **Global Search Input:** Prominently positioned search bar in header with keyboard shortcut prompt `Ctrl/Cmd + K`. Clicking or typing the shortcut opens the in-memory search modal (see §4).
2. **Quick Add Action Menu:** Primary action button (`+ Quick Add`) with direct keyboard accelerators:
   - `L` -> New Link
   - `N` -> New Note
   - `S` -> New Snippet
   - `C` -> New Credential
3. **Favorites Bar / Strip:** Horizontal scrollable rail or top grid showcasing pinned favorite items for instant access.
4. **Recent Items Stream:** Reverse chronological list of recently created or modified items (`updated_at DESC`).
5. **Category Shortcuts & Tag Cloud:** One-click filter chips reflecting the top tags and record counts per type.
6. **Sync State Status Indicator:** Persistent visual pill showing exact connectivity, outbox queue, and cloud synchronization state.
7. **Empty States:** Instructive empty-state illustrations and actionable onboarding buttons for fresh views.

### 2.2 Sync State Indicator & Status Matrix (PRD §7, line 117; §FR-4, line 210; Appendix A, lines 727–728)

The sync indicator reflects the client state machine across five mutually exclusive states. The client must **never report "synced" until all mutations are acknowledged by the server** (PRD §FR-4, line 210):

| Sync State | Visual Token | Badge Label | Description / Trigger Conditions | User Actions Available |
|---|---|---|---|---|
| **`synced`** | Emerald / Green dot (`bg-emerald-500`) | `Synced` | Outbox empty (`pending_count = 0`), last batch confirmed by server, online. | Shows "Last synced: [time]". Manual "Sync Now" trigger available. |
| **`pending`** | Amber / Orange pulse (`bg-amber-500 animate-pulse`) | `Syncing (N)` / `Pending (N)` | Local mutations queued in Dexie `outbox` awaiting server push or in-flight HTTP request. | Displays count of uncommitted mutations. Shows progress indicator. |
| **`offline`** | Slate / Gray cloud-off (`bg-slate-400`) | `Offline` | `navigator.onLine === false` or network fetch failure. Outbox durable locally. | Message: "Changes saved locally. Will sync when back online." Manual "Retry" button. |
| **`conflict`** | Rose / Red alert icon (`bg-rose-500`) | `Conflict (N)` | CAS revision mismatch (`409 REVISION_CONFLICT`) or delete-vs-edit collision encountered. | Prominent banner: "Sync paused: 1 conflict requires resolution." Action: `[Review Conflict]`. |
| **`error`** | Rose / Red warning (`bg-rose-600`) | `Sync Error` | API returned non-conflict error (classified per PRD Appendix A: network, quota, auth, version, rate-limited). | Displays error category, human-readable message, and `[Retry Sync]` button. |

#### Detailed Error Mapping in UI (PRD Appendix A, line 727)
- **Network Failure:** Displays "Network connection lost. Retrying automatically..." (`INTERNAL_ERROR` retryable).
- **Quota Exhaustion (`QUOTA_EXHAUSTED` / HTTP 503):** Displays amber banner: *"Cloud sync paused — Cloudflare free quota reached. Local vault remains fully functional; sync resumes when quota resets."* (PRD §FR-3, line 191; §13, line 518).
- **Rate Limited (`RATE_LIMITED` / HTTP 429):** Displays *"Too many requests. Retrying in N seconds..."* respecting server `Retry-After` header (PRD Appendix B).
- **Device Revoked (`DEVICE_REVOKED` / HTTP 401):** Displays blocking warning *"This device has been revoked by the vault owner. Cloud sync is disabled. Local data remains accessible until locked."* (PRD §FR-5, line 230; Appendix A, line 712).
- **Version Mismatch (`VERSION_MISMATCH` / HTTP 409):** Displays *"Vault requires a newer app version. Please update the app to resume sync."* (PRD §FR-1, line 161; Appendix A, line 717).

#### Last Sync & Retry Controls
- The status bar displays the humanized elapsed time: e.g., *"Last sync: 2 minutes ago"* with an accessible tooltip showing the exact ISO timestamp (`2026-10-13 14:32:01 UTC`).
- Next to the status is a manual `[Sync Now]` / `[Retry]` button. Clicks are debounced to prevent API rate-limit exhaustion (PRD §13, line 520; Appendix B).

### 2.3 Empty States (PRD §7, line 119)

Empty states must be instructive and provide immediate action:
- **Empty Vault (Fresh Setup):**  
  *Title:* "Your vault is empty"  
  *Body:* "Start capturing your links, notes, snippets, and occasional credentials. Everything is encrypted on your device before syncing."  
  *Actions:* Primary `[+ Add Your First Item]`, Secondary `[Restore from Backup]`, `[Pair Another Device]`.
- **Empty Category View (e.g., Links):**  
  *Title:* "No saved links yet"  
  *Body:* "Save web URLs, reference documentation, and tools here."  
  *Action:* `[+ Add Link]`.
- **Empty Search Results:**  
  *Title:* "No matching items found"  
  *Body:* "No items match your search. Check spelling, try broader keywords, or clear active syntax filters."  
  *Action:* `[Clear Search Filters]`.
- **Empty Archive:**  
  *Title:* "Archive is empty"  
  *Body:* "Archived items are kept safe but hidden from your active collections."

---

## 3. Item Management & Form Specifications (FR-1, §7)

### 3.1 Global Item Rules & Constraints (PRD §FR-1, lines 137–151; §10)

- **Encrypted Payload Boundary:** All user content fields, title, URLs, tags, content body, favorite state, archive state, and timestamps reside strictly inside the encrypted ciphertext payload. Only opaque identifiers (`vault_id`, `record_id`), revisions, and version numbers exist in database columns (PRD §FR-1, lines 148–149; §10, line 401).
- **Item Plaintext Capacity Budget:** Strictly maximum **256 KiB of serialized plaintext per item** (PRD §FR-1, line 150). The client form validates UTF-8 byte length pre-encryption. If input exceeds 256 KiB:
  - Form submission is blocked.
  - UI displays an inline validation banner: *"Item size (X KiB) exceeds the 256 KiB limit. Please reduce content length before saving."*
  - The application **must never silently truncate content** (PRD §FR-1, line 151).
- **Ciphertext Budget Notice:** Encrypted ciphertext expands by ~33–40% to a maximum of 384 KiB per record for D1 storage (PRD §FR-1, line 154).
- **No Custom Fields in MVP:** Item fields are strictly standard per type; custom user-defined schema fields are deferred to post-MVP (PRD §FR-1, lines 148–149).

### 3.2 Supported Item Types & Field Definitions

```
+----------------------------------------------------------------------------------------------------+
| ITEM TYPE MODAL / FORM                                                                             |
|                                                                                                    |
|  Type: [ Link | Note | Snippet | Credential ]                      Favorite: [*]  Archive: [ ]     |
|                                                                                                    |
|  Title:   [ Enter item title...                                                ]                   |
|  Tags:    [ #work ] [ #docs ] [ + Add tag...                                   ]                   |
|                                                                                                    |
|  -- Type Specific Fields (e.g. Credential) ------------------------------------------------------  |
|  Website:  [ https://example.com                                               ]                   |
|  Username: [ user@example.com                                  ]  [Copy]                           |
|  Password: [ ••••••••••••••••                        ] [Show]  [Copy]                              |
|  Notes:    [ Additional secure notes...                                        ]                   |
|                                                                                                    |
|  Plaintext Size: 1.2 KiB / 256 KiB                                                                 |
|  [Cancel]                                                                           [Save Item]    |
+----------------------------------------------------------------------------------------------------+
```

#### 1. Link (PRD §FR-1, line 143)
- `title` *(String, required)*: Descriptive label for the link.
- `url` *(String, required)*: Valid URL format (`http://` or `https://`).
  - **Validation Rule:** Validated entirely client-side using `new URL()`. The application **never fetches the remote URL from the server** (PRD §4, line 58; §FR-1, line 150; §9, line 385). No automatic link scrapers or remote preview generation.
- `description` *(String, optional)*: Short summary of URL purpose.
- `notes` *(String/Markdown, optional)*: Multiline reference notes.
- `tags` *(Array of Strings, optional)*: Categorization tokens.
- **UI Interaction:** Card/view displays external link icon. Clicking executes safe external navigation opening a new browser tab with mandatory attributes: `target="_blank" rel="noopener noreferrer"` (PRD §7, line 125).

#### 2. Note (PRD §FR-1, line 144)
- `title` *(String, required)*: Note headline.
- `body` *(String, required)*: Freeform multiline text or markdown.
  - **Rendering Rule:** Rendered strictly as safe sanitized text/markdown. Executable HTML, arbitrary scripts, and embedded remote iframes are strictly escaped to prevent XSS (PRD §9, line 385).
- `tags` *(Array of Strings, optional)*: Categorization tokens.
- **UI Interaction:** Clean reading typography with monospace or prose styling options, word count indicator, and quick "Copy Body" button.

#### 3. Snippet (PRD §FR-1, line 145)
- `title` *(String, required)*: Command or code snippet title.
- `content` *(String, required)*: Raw code, script, CLI command, or configuration block.
- `language` *(String, optional)*: Syntax identifier (e.g., `bash`, `javascript`, `typescript`, `python`, `json`, `sql`, `yaml`, `dockerfile`, `text`).
- `tags` *(Array of Strings, optional)*: Categorization tokens.
- **UI Interaction:** Monospace code block presentation with line numbers, code highlighting, and prominent one-click `[Copy Snippet]` action with instant tooltip feedback ("Copied!").

#### 4. Credential (PRD §FR-1, line 146; §FR-8, lines 342–349)
- `title` *(String, required)*: Account, organization, or service title.
- `website` *(String, optional)*: Login URL or service domain.
- `username` *(String, optional)*: Username, email, or account ID.
- `password` *(String, optional)*: Sensitive password / token.
  - **Masking Invariant:** Masked by default (`••••••••`). Explicit reveal toggle required (see §5).
- `notes` *(String, optional)*: Security questions, recovery notes, or PINs.
- `tags` *(Array of Strings, optional)*: Categorization tokens.
- **Mandatory UI Disclaimer Banner:** At the top of credential creation and view dialogs, display:
  > *"Notice: Personal Vault is designed for occasional personal credentials. It is not an independently audited, full-featured password manager and does not provide browser autofill."* (PRD §1, line 16; §FR-8, line 348).

### 3.3 Item Lifecycle Interactions (PRD §7, lines 122–129)

Every item card or detail view supports the standard action set:
- **View:** Opens full modal or dedicated view pane displaying all fields.
- **Edit:** Opens form pre-populated with current values. Saving creates a local mutation with `expected_revision = current_revision`.
- **Duplicate:** Clones item contents into a new creation modal with title prefixed by *"Copy of [Title]"*, generating a fresh `record_id` and `expected_revision = 0`.
- **Favorite / Unfavorite:** One-click star toggle updating `is_favorite` inside the encrypted payload.
- **Archive / Unarchive:** Toggles `is_archived`. Archived items are excluded from All Items and category views; accessible via the Archive view.
- **Delete:** Prompts permanent deletion confirmation modal. Confirming writes a **sync tombstone** with `is_tombstone = true` and `ciphertext = null` to ensure deletion propagates across all paired devices without resurrection (PRD §7, line 124; §FR-4, line 207).

---

## 4. Global & Advanced Search Experience (FR-2)

Search in Personal Vault operates strictly client-side against in-memory decrypted records using MiniSearch (PRD §2, line 25; §FR-2, lines 164–182). **Search terms, indexes, and queries are never sent to the server** (PRD §FR-2, line 180).

### 4.1 Search Interface & Key Bindings

- **Overlay Shortcut:** Pressing `Ctrl + K` (Windows/Linux) or `Cmd + K` (macOS/iOS) opens the search palette from any screen.
- **Dismissal:** Pressing `Escape` or clicking the backdrop closes the overlay immediately (PRD §FR-2, line 171).
- **Navigation:** Arrow Up / Arrow Down navigates results list; `Enter` opens the selected item; `Tab` cycles between filter pills.
- **Index Lifecycle:** Search index is constructed in memory immediately after vault unlock and **completely wiped from application memory on lock** (PRD §FR-2, line 181).

### 4.2 Documented Search Syntax (PRD §FR-2, lines 172–179)

The search parser supports structured tokens combined with free text:

| Filter Operator | Syntax Example | Behavior / Scope |
|---|---|---|
| **Item Type** | `type:link`<br>`type:note`<br>`type:snippet`<br>`type:credential` | Restricts results strictly to the specified record type. |
| **Tag** | `tag:work`<br>`tag:"side project"` | Filters items containing the tag. Quoted strings support multi-word tags. |
| **Status Flags** | `is:favorite`<br>`is:archived` | Matches favorited or archived items respectively. |
| **Created Date Range** | `created:2026-01-01..2026-10-13` | Inclusive ISO date range filter on record creation timestamp. |
| **Updated Date Range** | `updated:2026-10-01..2026-10-13` | Inclusive ISO date range filter on last modification timestamp. |
| **Exact Phrase** | `"cloudflare pages"` | Matches exact contiguous string within item content or title. |
| **Free Text** | `ssh deploy key` | Full-text token match across titles, URLs, descriptions, notes, snippets, usernames, and tags. |

### 4.3 Query Parsing & Error Handling Rules (PRD §FR-2, line 179)

- **AND Conjunction:** Combining operators narrows results using strict AND semantics (e.g., `type:snippet tag:bash "docker"` matches items meeting all three constraints).
- **Invalid Operators / Malformed Syntax:** If an operator contains an invalid format (e.g. malformed date range `created:invalid..date`), the UI must **not silently guess or ignore the date**. The search input highlights the malformed token with a visible red badge: *"Invalid date syntax. Expected YYYY-MM-DD..YYYY-MM-DD"* or treats unsupported tokens as literal search text consistently (PRD §FR-2, line 179).
- **Sorting Options:** Dropdown controls within search overlay:
  1. *Recently Updated* (Default)
  2. *Recently Created*
  3. *Title (A-Z)*

---

## 5. Credential & Clipboard UX (FR-8)

Handling sensitive credentials requires defensive UI controls to prevent shoulder surfing, accidental exposure, and clipboard snooping (PRD §FR-8, lines 342–349).

### 5.1 Password Field Masking & Reveal Interaction

- **Default State:** All password fields in views and edit dialogs are masked by default using standard bullets (`••••••••••••••••`) (PRD §FR-8, line 344).
- **Explicit Reveal Action:** A dedicated visibility toggle button (eye icon) sits adjacent to the field.
  - Toggling requires an explicit user click.
  - Provides accessible label: `aria-label="Reveal password"` (when hidden) and `aria-label="Mask password"` (when visible).
  - Toggling password visibility reveals the text visually on screen; it does not change its memory encryption properties.
  - Auto-mask on blur: Navigating away from the credential view or locking the vault immediately re-masks the field.

### 5.2 Explicit Copy & Clipboard Safety Rules (PRD §FR-8, line 346)

- **Direct User Action Only:** The Clipboard API (`navigator.clipboard.writeText`) is invoked **only upon direct user click** on an explicit `[Copy]` button. No automatic copy on focus or hover.
- **Copy Feedback:** Clicking `[Copy]` changes button state to a green checkmark with text *"Copied!"* for 2000 ms, announced to screen readers via `aria-live="polite"`.
- **Clipboard Clearing Notice & Policy:** The application attempts best-effort clipboard clearance after a brief delay (e.g., 30–60 seconds). However, because browser PWAs cannot control system clipboard managers or external applications, the UI must explicitly display the following disclaimer in Settings and Credential views:
  > *"Security Notice: Operating systems, third-party apps, and clipboard history managers may retain copied passwords. Clear your clipboard history manually if operating on a shared computer."* (PRD §FR-8, line 346).

> TODO(question): PRD §FR-8 line 346 permits best-effort clipboard clearing after a short interval without specifying exact seconds. Is the default interval 30 seconds or 60 seconds, and should it be user-configurable in Settings?

---

## 6. Settings & Vault Lifecycle Management (FR-9)

The Settings view (`/settings`) coordinates authentication, hardware authorization, offline portability, and device preferences (PRD §FR-9, lines 350–359).

```
+----------------------------------------------------------------------------------------------------+
| SETTINGS & VAULT MANAGEMENT                                                                        |
|                                                                                                    |
|  [1. Security & Lock]          [2. Authorized Devices]       [3. Backup & Recovery]                |
|  - Inactivity Timeout: [5m v]  - Device-4F8A (This Device)   - Recovery Kit: [Download JSON]       |
|  - [Lock Vault Now]            - Device-9B1C [Revoke]        - Export: [Download Encrypted Backup] |
|  - [Change Master Passphrase]  - [+ Pair New Device]         - Import: [Restore from File]         |
|                                                                                                    |
|  [4. Cloud Sync & Status]      [5. Appearance & Language]    [6. About & Disclosures]              |
|  - Status: Synced              - Theme: [System | Light | Dark] - Version: 1.0.0 (Schema v1)        |
|  - Outbox: 0 pending mutations - Language: [Bahasa Indonesia | English]                            |
|  - [Sync Now]                  - Host: personal-vault.pages.dev                                    |
+----------------------------------------------------------------------------------------------------+
```

### 6.1 Section 1: Security & Lock Settings (PRD §FR-6, lines 280–291; User Decisions)

1. **Manual Lock Trigger:** A prominent `[Lock Vault Now]` button clears in-memory DEK, search index, decrypted items, and local device signing keys immediately (PRD §FR-6, line 283).
2. **Auto-Lock Inactivity Timeout:** Dropdown options:
   - `1 minute`
   - `5 minutes` *(Default, PRD §FR-6, line 282)*
   - `15 minutes`
   - `30 minutes`
   - *Behavior:* In addition to JavaScript timers, the app registers a `visibilitychange` listener. When the app returns to the foreground, it calculates elapsed time and locks immediately if inactivity timeout has elapsed (PRD §FR-6, line 282).
3. **Master Passphrase Change Dialog:**
   - **Minimum Length Enforcement:** Enforces **minimum 8 characters** verbatim (User Decision 2026-10-13).
   - Form fields: *Current Passphrase*, *New Passphrase* (min 8 chars), *Confirm New Passphrase*.
   - **Normative UI Scope Explanation (PRD §FR-6, lines 288–290):** The dialog must explicitly state:
     > *"Changing your master passphrase re-wraps the vault key envelope. It does not re-encrypt old backups or previously synchronized ciphertext. Old encrypted exports remain decryptable only with your previous password. To fully cut off old passwords, rotate your recovery kit and generate fresh backup exports."*

### 6.2 Section 2: Authorized Devices & Pairing (PRD §FR-5, lines 216–246; User Decisions)

Personal Vault has no email or central account directory; authorization is device-to-device.

#### 1. Device List Display
- Lists all active authorized devices registered in `authorized_devices`.
- **Automatic Device Label:** Newly registered devices automatically receive the label format `Device-XXXX` (where `XXXX` represents the first 4 uppercase hex characters of the device UUIDv4, e.g., `Device-4F8A`) (User Decision 2026-10-13).
- **Inline Rename:** Users can click an edit icon next to the label to rename the device (e.g., "Work ThinkPad", "Pixel 8").
- **Provenance Disclosures (PRD §FR-5, lines 242–244):**
  - *Created:* Date of device pairing.
  - *Last Seen:* Server-recorded timestamp of last authenticated API request. Annotated: *"Recorded by server on authenticated sync; never supplied by client."*
  - *Current Device Tag:* Clearly badges the active browser instance ("This Device").
- **Device Revocation Action:**
  - Clicking `[Revoke Device]` opens a confirmation modal: *"Revoking this device will block it from all future cloud synchronization immediately. Note: Revocation cannot remotely wipe data already downloaded to that device."* (PRD §FR-5, line 230; §9, line 376).

> TODO(question): PRD §FR-5 line 229 allows device renaming, but PRD §11 does not specify an endpoint for updating device labels (e.g., PATCH /api/v1/devices/:deviceId). Does device rename persist locally in IndexedDB only, or should an API endpoint be added to the frozen Milestone 3 contract?

#### 2. Device Pairing Workflow (PRD §FR-5, lines 233–241)
- Initiated from an authorized, unlocked device by clicking `[+ Pair New Device]`.
- **Ticket Generation:** Device calls `POST /api/v1/pairing-tickets`. Generates a 256-bit cryptographically secure one-time pairing ticket.
- **Pairing Modal Display:**
  - Displays a high-contrast **QR Code** containing `{ vault_id, api_origin, ticket }`.
  - Displays a **Manual Fallback Code** formatted as grouped Crockford Base32 characters (e.g., `7K3M - 9P2R - 5T8W - 4Y6U`).
  - **Live Countdown Timer:** Displays remaining validity countdown from **5 minutes (300 seconds)** (PRD §FR-5, line 226).
  - **Single Active Ticket Notice:** Displays *"Creating a new pairing code invalidates any previous pending code"* (PRD §FR-5, line 227).
- **New Device Flow:** The new device opens the web app, selects *"Pair with Existing Device"*, scans the QR code or enters the manual code, and enters the master passphrase to unwrap the DEK and complete enrollment.

### 6.3 Section 3: Backup, Recovery & Storage (PRD §FR-7, lines 292–341; Appendix C)

#### 1. Recovery Kit Management (PRD §FR-7, Appendix C)
- **Download Recovery Kit:** Downloads plaintext JSON file `personal-vault-recovery-kit.json`.
- **Manual Fallback Code:** Displays grouped base32 string representing the 32-byte recovery secret.
- **Offline Warning:** The UI displays: *"Anyone holding this recovery kit can recover and decrypt your vault. Store it offline on a secure USB drive or printed on paper. Do not store it in unencrypted cloud drives."* (PRD §FR-7, line 308).
- **Mandatory Confirmation Gate (PRD §FR-7, line 322):** The vault setup or rotation process is blocked until the user checks an explicit confirmation box:
  - `[x] I have downloaded and safely stored my recovery kit offline` (or typed confirmation word).

#### 2. Encrypted Backup & Restore (PRD §FR-7, lines 333–341)
- **Encrypted Export:** Clicking `[Download Encrypted Export]` produces a standalone encrypted JSON file (`personal-vault-export-YYYYMMDD.json`) containing ciphertext records, key envelopes, and schema versions. Decryptable with master passphrase or recovery secret.
- **Encrypted Import:** File uploader parses backup file, validates `schema_version` and envelope format, and displays a **Pre-Import Preview Modal**:
  - Displays count of incoming records and timestamps.
  - User chooses resolution strategy: **Merge with existing** vs **Full Restore**. Conflicting records trigger explicit conflict resolution (see §7); data is never overwritten silently (PRD §FR-7, line 338).

#### 3. iOS Storage Eviction Banner (PRD §5, lines 73–76)
- When running on iOS/iPadOS Safari, display a persistent reminder banner in Settings:
  > *"iOS Storage Warning: Apple WebKit may evict local browser storage if Personal Vault is not opened for 7 days. Ensure you have downloaded an encrypted export backup and saved your recovery kit."*

### 6.4 Section 4: Cloud Sync & Storage Quota Status (PRD §13, lines 511–521)

- Displays real-time status of Cloudflare D1 Free Tier usage.
- Shows pending outbox mutation count, current cursor sequence, and last sync timestamp.
- Manual `[Sync Now]` button with loading spinner.

### 6.5 Section 5: Appearance & Language (User Decisions)

1. **Theme Selection (PRD §7, line 133):** Radio buttons or toggle:
   - `Light`
   - `Dark`
   - `System Default`
2. **Bilingual Language Selection (User Decision 2026-10-13):**
   - Options: **Bahasa Indonesia** (`id-ID`) and **English** (`en-US`).
   - **Default Behavior:** Automatically checks browser `navigator.language`. If matching `id*`, defaults to Bahasa Indonesia; otherwise falls back to Bahasa Indonesia (`id-ID`) as primary project default, switchable at any time to English.

### 6.6 Section 6: About & System Metadata Disclosures (PRD §9, line 375; User Decisions)

- **Application Information:** Personal Vault v1.0.0 (Schema v1, Crypto v1, KDF v1).
- **Deployment Hostname:** Shows current Cloudflare Pages domain (default `https://<pages-project>.pages.dev` first; custom domain post-MVP per User Decision 2026-10-13).
- **Metadata Leakage Disclosure (PRD §9, line 375):** To prevent false security expectations, Settings displays:
  > *"Privacy Disclosure: Personal Vault encrypts all item contents, titles, URLs, tags, and passwords. However, the Cloudflare backend can observe server metadata including vault ID, record IDs, ciphertext sizes, revisions, device labels, and sync timestamps."*

---

## 7. Concurrency & Conflict Resolution UX (§11, User Decisions)

Personal Vault strictly rejects Last-Write-Wins (LWW) concurrency (PRD §11, lines 478–486). When concurrent edits occur, the UI provides explicit, human-controlled resolution dialogs.

### 7.1 Conflict Dialog 1: Edit-vs-Edit Conflict (PRD §11, lines 474–476)

Triggered when the server returns `409 REVISION_CONFLICT` due to an `expected_revision` mismatch between the client's outbox and the server's current record.

```
+----------------------------------------------------------------------------------------------------+
| CONFLICT RESOLUTION: EDIT COLLISION                                                                |
|                                                                                                    |
|  This item was modified on another device while you were editing it locally.                       |
|  Item: "Work AWS Access Keys"                                                                      |
|                                                                                                    |
|  +---------------------------------------+  +---------------------------------------+             |
|  | LOCAL VERSION (Your device)           |  | REMOTE VERSION (Server)               |             |
|  | Modified: Today, 14:15                |  | Modified: Today, 14:10 by Device-B4C1 |             |
|  | Username: admin-prod                  |  | Username: admin-root                  |             |
|  | Notes: Updated temporary session      |  | Notes: Rotated keys per ticket 402    |             |
|  +---------------------------------------+  +---------------------------------------+             |
|                                                                                                    |
|  Choose resolution action:                                                                         |
|  ( ) Keep local version as a new item (Preserves both versions safely)                            |
|  ( ) Use remote version (Discards your local unsaved edits)                                       |
|                                                                                                    |
|  [Resolve Conflict]                                                                                |
+----------------------------------------------------------------------------------------------------+
```

- **Visual Presentation:** Clean side-by-side (desktop) or stacked comparison (mobile) highlighting divergent fields (title, content, tags, username, notes).
- **Normative Choices (PRD §11, line 475):**
  1. **Keep local as a new item:** Creates a brand-new record with a new random `record_id` and `revision = 0` containing the local edits, while adopting the remote version for the original record ID. Guarantees zero data loss.
  2. **Use remote version:** Overwrites local draft with the incoming remote ciphertext and advances local revision to match the server.

> TODO(question): PRD §11 line 475 mandates 'Keep local as a new item' and 'Use remote version', stating to omit merge rather than guess if it risks data loss. Should visual diff/field-level merge be deferred strictly to post-MVP?

### 7.2 Conflict Dialog 2: Delete-vs-Edit Conflict (PRD §11, line 482; User Decisions verbatim)

Triggered when a local edit conflicts with a remote deletion tombstone, or a local deletion conflicts with a remote edit.

```
+----------------------------------------------------------------------------------------------------+
| CONFLICT RESOLUTION: DELETE VS. EDIT                                                               |
|                                                                                                    |
|  One device deleted this item while another device edited it.                                      |
|  Item: "Postgres Connection String"                                                                |
|                                                                                                    |
|  Status: Item was deleted remotely by Device-1A2B, but edited locally on this device.              |
|                                                                                                    |
|  Choose resolution action:                                                                         |
|  [ Restore & Keep Edited Version ]            [ Confirm Deletion ]                                 |
|  (Resurrects item with your local edits)      (Discards edits and applies deletion)                |
+----------------------------------------------------------------------------------------------------+
```

- **Verbatim User Decision Rule (2026-10-13):** The application **never silently resurrects or silently erases the item** (PRD §11, line 482).
- **Two Manual Choices:**
  1. **Keep edited version:** Rejects the deletion tombstone, resurrects the record, increments the server revision, and uploads the local edited version.
  2. **Confirm deletion:** Discards local pending edits, removes the item from local storage, and durably records the deletion tombstone.

---

## 8. Visual Design System & Theming (§7, lines 131–134)

### 8.1 Visual Direction & Philosophy

Personal Vault uses a clean, disciplined, and utilitarian visual language built with **Tailwind CSS and shadcn/ui** (PRD §6, line 82; §7, line 133). The interface prioritizes speed, readability, high contrast, and low cognitive overhead over ornamental design.

- **Layout Grid:** Responsive container with max width `1280px` (`max-w-7xl`), `px-4` padding on mobile, `px-8` on desktop.
- **Card Styling:** Flat cards with subtle 1px border (`border-border`), rounded corners (`rounded-lg`), subdued background (`bg-card`), and gentle hover borders (`hover:border-primary/40`).
- **Typography:** System font stack (`font-sans`: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`) for optimal cross-platform rendering; monospace stack (`font-mono`: `"JetBrains Mono", Menlo, Consolas, monospace`) for code snippets, pairing codes, and recovery keys.

### 8.2 Light & Dark Themes (PRD §7, line 133)

- **Requirement:** Light and dark theme switching is supported out of the box using class-based Tailwind theming (`class="dark"`). The theme must load instantly without flashing unstyled content (FOUC) by executing a lightweight inline script in `index.html`.
- **Theme Palette Tokens:**

| Token Role | Light Mode Value | Dark Mode Value | Usage Scope |
|---|---|---|---|
| `--background` | `hsl(0 0% 100%)` (Pure White) | `hsl(222.2 84% 4.9%)` (Deep Slate) | View background |
| `--foreground` | `hsl(222.2 84% 4.9%)` (Dark Charcoal) | `hsl(210 40% 98%)` (Bright Slate) | Body text |
| `--card` | `hsl(0 0% 100%)` | `hsl(222.2 84% 6.5%)` | Record cards / panels |
| `--border` | `hsl(214.3 31.8% 91.4%)` (Subtle Gray) | `hsl(217.2 32.6% 17.5%)` (Subtle Dark Slate) | Borders, dividers |
| `--primary` | `hsl(221.2 83.2% 53.3%)` (Vibrant Blue) | `hsl(217.2 91.2% 59.8%)` (Bright Blue) | Primary buttons, active tabs |
| `--muted-foreground` | `hsl(215.4 16.3% 46.9%)` | `hsl(215 20.2% 65.1%)` | Secondary timestamps, helper text |
| `--destructive` | `hsl(0 84.2% 60.2%)` (Red) | `hsl(0 62.8% 30.6%)` | Delete buttons, revocation |

---

## 9. Accessibility (a11y) & Interaction Standards (§7, §12)

Personal Vault must comply with **WCAG 2.1 AA** standards across desktop and touch devices (PRD §7, line 129; §12, line 493).

### 9.1 Keyboard Navigation & Focus Management

- **Full Keyboard Operability:** Every interactive element (buttons, links, form inputs, copy actions, disclosure toggles) must be reachable and actionable via `Tab`, `Shift + Tab`, `Space`, and `Enter`.
- **Visible Focus Rings:** High-visibility focus indicators on all focusable elements using `focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2`. Outline-none without focus ring replacement is strictly prohibited.
- **Focus Trapping in Modals:** When dialogs open (Search overlay, Item modal, Pairing QR modal, Conflict dialog), focus is trapped within the dialog using Radix UI / shadcn dialog primitives. Pressing `Escape` closes the modal and returns focus to the triggering element.

### 9.2 Contrast Ratios & Visual Accessibility

- Text elements maintain a minimum contrast ratio of **4.5:1** against their background.
- Large headers and prominent UI components maintain at least **3.0:1** contrast.
- Visual state changes (e.g. sync state, item favorited) must never rely on color alone; each status badge includes an icon and clear textual label.

### 9.3 Screen Reader Compatibility (ARIA)

- **Live Region Updates:** Real-time state transitions use `aria-live` containers:
  - Sync state transitions (`synced`, `pending`, `error`): `aria-live="polite"`.
  - Inactivity lock warnings and fatal session expiration: `aria-live="assertive"`.
  - "Copied to clipboard" toasts: `aria-live="polite"`.
- **Accessible Form Controls:** All inputs have explicit `<label>` elements or `aria-label`. Helper instructions and size counters bind via `aria-describedby`.
- **Sensitive Fields:** Masked password fields announce state clearly via `aria-label="Password (masked)"` and toggle buttons use `aria-expanded="false"` / `aria-expanded="true"`.

---

## 10. Bilingual Internationalization (i18n: ID + EN)

Per user decision (2026-10-13), Personal Vault provides complete bilingual support for **Bahasa Indonesia (ID)** and **English (EN)**.

### 10.1 Locale Resolution Strategy
1. **Device Locale Detection:** On first launch, the app reads `navigator.language`.
2. **Matching Rule:** If the language tag starts with `id` (e.g., `id-ID`, `id`), the interface activates Bahasa Indonesia.
3. **Fallback:** If language tag is anything else or undefined, the interface falls back to **Bahasa Indonesia (`id-ID`)** as the primary default.
4. **User Override:** The user can switch between Indonesian and English at any time in Settings. The choice is persisted in Dexie `app_metadata.language`.

### 10.2 Normative UI Glossary & Translation Matrix

| UI Key / Concept | English (EN) | Bahasa Indonesia (ID) |
|---|---|---|
| `nav.all_items` | All Items | Semua Item |
| `nav.favorites` | Favorites | Favorit |
| `nav.links` | Links | Tautan |
| `nav.notes` | Notes | Catatan |
| `nav.snippets` | Snippets | Potongan Kode |
| `nav.credentials` | Credentials | Kredensial |
| `nav.tags` | Tags | Tag |
| `nav.archive` | Archive | Arsip |
| `nav.settings` | Settings | Pengaturan |
| `actions.quick_add` | Quick Add | Tambah Cepat |
| `actions.save` | Save | Simpan |
| `actions.cancel` | Cancel | Batal |
| `actions.delete` | Delete | Hapus |
| `actions.copy` | Copy | Salin |
| `actions.copied` | Copied! | Tersalin! |
| `actions.reveal` | Show | Tampilkan |
| `actions.mask` | Hide | Sembunyikan |
| `actions.lock_now` | Lock Vault | Kunci Brankas |
| `actions.sync_now` | Sync Now | Sinkronkan Sekarang |
| `actions.retry` | Retry | Coba Lagi |
| `sync.synced` | Synced | Tersinkronisasi |
| `sync.pending` | Pending changes | Perubahan tertunda |
| `sync.offline` | Offline | Luring (Offline) |
| `sync.conflict` | Conflict detected | Konflik terdeteksi |
| `sync.error` | Sync error | Gagal sinkronisasi |
| `sync.quota_paused` | Sync paused (Quota reached) | Sinkronisasi dijeda (Batas kuota tercapai) |
| `conflict.edit_vs_edit` | Edit collision | Konflik perubahan data |
| `conflict.delete_vs_edit` | Delete vs. edit conflict | Konflik hapus vs. ubah |
| `conflict.keep_local` | Keep local as a new item | Simpan versi lokal sebagai item baru |
| `conflict.use_remote` | Use remote version | Gunakan versi server |
| `conflict.keep_edit` | Restore & keep edited version | Pulihkan & simpan versi perubahan |
| `conflict.confirm_delete` | Confirm deletion | Konfirmasi penghapusan |
| `credential.disclaimer` | Occasional personal credentials only; not an audited password manager. | Hanya untuk kredensial pribadi sesekali; bukan pengelola kata sandi terverifikasi audit. |
| `recovery.save_warning` | Store your recovery kit offline. | Simpan kit pemulihan Anda secara luring (offline). |

---

## 11. Consolidated Ambiguities & Open Questions

The following open questions were identified during specification derivation from `personal-vault-prd-v3.md` and user decisions:

1. `> TODO(question): PRD §FR-5 line 229 allows device renaming, but PRD §11 does not specify an endpoint for updating device labels (e.g., PATCH /api/v1/devices/:deviceId). Does device rename persist locally in IndexedDB only, or should an API endpoint be added to the frozen Milestone 3 contract?`
2. `> TODO(question): PRD §FR-8 line 346 permits best-effort clipboard clearing after a short interval without specifying exact seconds. Is the default interval 30 seconds or 60 seconds, and should it be user-configurable in Settings?`
3. `> TODO(question): PRD §11 line 475 mandates 'Keep local as a new item' and 'Use remote version', stating to omit merge rather than guess if it risks data loss. Should field-level 3-way visual merge be deferred strictly to post-MVP?`
