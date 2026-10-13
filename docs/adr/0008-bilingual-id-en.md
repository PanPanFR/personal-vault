# 0008. Bilingual Interface (Indonesian and English) with Device Locale Fallback

- **Status:** Accepted
- **Date:** 2026-10-13
- **Authoritative Source:** User decisions (2026-10-13); `personal-vault-prd-v3.md` §7 (Information architecture and UX), §8 (FR-9: Settings and data portability)

---

## Context

Personal Vault is designed as a personal information vault utilized in bilingual environments, specifically requiring support for Indonesian (*Bahasa Indonesia*, `id`) and English (`en`).

Key considerations:
1. **Critical User Flows:** Critical operations—such as vault creation, master passphrase setup, recovery kit confirmation, device pairing, and conflict resolution—carry significant security consequences. Misunderstanding technical instructions or security warnings due to language barriers can lead to unrecoverable data loss.
2. **Performance & Bundle Size:** Heavy internationalization frameworks (such as full-featured i18next bundles with remote backend loaders) add unnecessary runtime overhead and complexity to a lightweight PWA.
3. **User Content Neutrality:** Vault content itself (titles, notes, snippets, URLs, tags) is user-authored UTF-8 plaintext stored as encrypted binary blobs. The localization system only affects application shell strings, dialogs, buttons, validation errors, and guidance copy.

---

## Decision

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

---

## Consequences

### Positive
- **Clear Guidance on High-Stakes Flows:** Critical security warnings (e.g. "Anyone holding this recovery kit can recover your vault; store it offline" / "Siapapun yang memiliki berkas pemulihan ini dapat memulihkan brankas Anda") are delivered in the user's primary language.
- **Zero Latency:** Translation dictionaries are bundled with the app shell and cached by the service worker, enabling instant offline rendering without asynchronous language pack network fetches.
- **Deterministic Fallback:** Explicit fallback to Indonesian aligns with user profile requirements while accommodating standard English browser environments.

### Negative / Trade-offs
- **Maintenance Overhead:** Every new UI feature, validation rule, or error message must be authored and verified in both Indonesian and English dictionaries before release.
- **Scope Limit:** Additional languages beyond Indonesian and English are excluded from the MVP.

---

## PRD Citations & User Decisions
- User Decision (2026-10-13): Bilingual ID+EN; default = device locale, fallback ID.
- PRD §7: Information architecture, dashboard, and visual direction.
- PRD §8 (FR-9): Settings options and localized data portability guidance.
- PRD Appendix A: Stable error code category mapping to localized user feedback.
