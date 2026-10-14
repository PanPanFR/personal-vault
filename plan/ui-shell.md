# Implementation Plan: UI Shell — Dashboard, Navigation & Item CRUD

## Objective

Build the complete user-facing interface shell: navigation, dashboard, Quick Add, item CRUD forms (link/note/snippet/credential), list/card views, tag browser, favorites, archive, responsive layout, empty states, Ctrl+K search overlay, and theme toggle. Uses mock/fixture data shaped by the frozen schemas; no real crypto or sync — those are sibling plans that wire into these components later.

## Scope

IN: Vite + React + TS scaffold; Tailwind + shadcn/ui setup; app layout (sidebar nav on desktop, bottom nav on mobile); All Items / Links / Notes / Snippets / Credentials / Favorites / Tags / Archive pages; Dashboard (recent items, favorites, category shortcuts, tag filters, Quick Add per type, sync status placeholder, empty states); item detail view/edit/duplicate/delete/favorite/archive/restore; tag management (add/remove on items, browse-by-tag view, max 20/item 64-char validation per foundations); Ctrl/Cmd+K search overlay with query syntax rendering (type:/tag:/is:/created:/updated:, quoted phrases, AND semantics — UI only, wired to MiniSearch in crypto plan); responsive cards/list toggle; light/dark theme; keyboard nav + focus + contrast + labels; credential field mask/reveal placeholder (full Clipboard logic in crypto plan); bilingual ID+EN string keys (dictionary populated in crypto plan); Dexie read/write against encrypted-payload-shaped fixture records (plaintext fixture for development, replaced by real ciphertext in crypto plan).

OUT: real encryption/decryption (crypto plan); sync engine/API calls (cloud-sync plan); service worker/manifest/headers (PWA plan); recovery kit/lock screen/WASM block (crypto plan); Settings page final copy (PWA plan). This plan builds the UI chrome; siblings plug in crypto, sync, and hardening.

## Context

- Stack: Vite + React + TS, Tailwind CSS + shadcn/ui, Dexie.js (fixture schema from foundations), Vitest + Playwright.
- PRD: §7 (IA + dashboard + interactions + visual direction), FR-1 (item types + validation + 256 KiB), FR-2 (search UI + query syntax + Ctrl+K), FR-8 (mask/reveal UX), FR-9 (Settings shell), §12 (responsiveness, a11y). M1 steps 2-4.
- Consumes (read-only): `plan/foundations-schemas-contract.md` outputs — item Zod schemas, tag validator, version constants, Dexie schema, error codes.
- User decisions: passphrase min 8 (not used here); bilingual ID+EN (scaffold keys here, dictionary in crypto plan); auto device label (not used here); delete-vs-edit = manual (conflict UI in sync plan).
- Technical defaults: fixture records use encrypted-payload-shaped JSON blobs (type + fields inside a `payload` wrapper) matching the Dexie `records` store schema. Search overlay renders syntax hints but MiniSearch wiring lands in crypto plan.
- Jev delegation: `owner` designer 0.81 conf 0.76. `needs_subagent` 0.52 UNCERTAIN → inline default. `can_parallel` 0.62 UNCERTAIN → sequential unless noted.
- Jev verify: tier MID (`decision_risk` conf 0.38 UNCERTAIN → MID; `proceed` 0.61, `needs_human` 0.63). Risk noted: constraint-fit 0.30 — scope boundaries with crypto/sync plans must be precise. Proceeding.

## Frontend Skills, Tooling & MCP (read before execution)
- Load selectively (not all): `ui-design`, `shadcn`, `ui-ux-pro-max`, `antislop`, `web-design-guidelines`, `impeccable`, `vercel-react`, `vite`, `web-perf`, and `pwa-development` only where relevant.
- Styling source of truth: `docs/frontend/DESIGN.md` (Catppuccin Latte/Mocha tokens). Do not reuse stale Notion colors.
- Component acquisition default: skills + CLI (`npx shadcn@latest add ...`). Use UI MCPs only when genuine discovery is needed; registered UI MCPs are `shadcn`, `reactbits`, `magicuidesign-mcp`, `chrome-devtools`.
- MCP standby handling: if a needed MCP is disabled (`"disabled": true`), ask user to enable it in `opencode.json` and run `/reload`; remind to re-disable after the task.
- Browser verification: use `playwright-cli` for scripted flows/snapshots/videos/E2E; use `chrome-devtools` MCP for one-off live debug, screenshot, perf trace, console errors.

## Jev Gates (mandatory, no slash)
- Before substantial UI work: `node ~/.config/opencode/skills/jev-decision/scripts/jev-decide.mjs -Preset ui -State "<request + screens>"`.
- Execute directly only when `needs_designer <= 0.3` and every `ui_complexity` dimension max probability `<= 0.3`; otherwise route designer/plan path.
- Run reviewer review gate + tester scope gate before final.
- Script failure is fail-open: proceed with LLM judgment, never block.

## Done Gate
- Browser preview matches `docs/frontend/DESIGN.md`.
- Responsive checks pass at 375px and 1280px.
- No console errors; no blocking a11y violations.
- `npx impeccable detect <path>` has no blocking findings.
- Lighthouse/perf target >90 (or documented waiver).
- Create/edit/delete/read CRUD flow works with fixtures.

## Dependencies

- Requires: foundations schemas frozen (item types, Dexie schema, tag validator, version constants).
- Blocks: crypto plan (needs UI components to wire encrypt/decrypt into); cloud-sync plan (needs SyncStatus placeholder, conflict dialog shell); PWA plan (needs Settings page shell).

## Files / Areas Likely Affected

- `vite.config.ts`, `tailwind.config.ts`, `postcss.config.js` (NEW — project scaffold)
- `src/main.tsx`, `src/App.tsx` (NEW — entry + router)
- `src/layouts/AppLayout.tsx` (NEW — sidebar/bottom nav, responsive shell)
- `src/pages/Dashboard.tsx`, `src/pages/AllItems.tsx`, `src/pages/Links.tsx`, `src/pages/Notes.tsx`, `src/pages/Snippets.tsx`, `src/pages/Credentials.tsx`, `src/pages/Favorites.tsx`, `src/pages/Tags.tsx`, `src/pages/Archive.tsx`, `src/pages/Settings.tsx` (NEW — all page shells)
- `src/components/QuickAdd.tsx`, `src/components/ItemCard.tsx`, `src/components/ItemForm.tsx`, `src/components/ItemDetail.tsx`, `src/components/SearchOverlay.tsx`, `src/components/TagInput.tsx`, `src/components/EmptyState.tsx`, `src/components/ThemeToggle.tsx` (NEW)
- `src/components/SyncStatusPlaceholder.tsx` (NEW — static placeholder, replaced by sync plan)
- `src/hooks/useItems.ts`, `src/hooks/useTags.ts`, `src/hooks/useSearch.ts` (NEW — Dexie queries against fixture data)
- `src/i18n/keys.ts` (NEW — bilingual string key constants, dictionaries populated in crypto plan)
- `tests/ui/*` (NEW — component render tests, form validation, responsive snapshots)

## Implementation Steps

1. Scaffold Vite + React + TS + Tailwind + shadcn/ui + React Router; configure paths, aliases, base config.
2. Build AppLayout (sidebar nav desktop ≥768px, bottom nav mobile; nav items: All Items, Favorites, Links, Notes, Snippets, Credentials, Tags, Archive, Settings; active state + icons).
3. Build Dashboard (recent items list, favorites strip, category shortcut cards, tag filter chips, Quick Add buttons per type, sync status placeholder showing "not connected", empty states teaching first-item creation).
4. Build item CRUD: ItemForm (type-specific fields per FR-1 — Link: title/URL/description/notes/tags; Note: title/body/tags; Snippet: title/content/language/tags; Credential: title/website/username/password/notes/tags), validation (URL format without fetch, 256 KiB pre-encrypt, tag limits 20/item 64-char), ItemCard (list + card toggle), ItemDetail (view/edit/duplicate/favorite/archive/delete with confirmations).
5. Build tag system: TagInput component (add/remove, autocomplete from existing tags, validation), Tags page (browse-by-tag, filter).
6. Build Ctrl/Cmd+K SearchOverlay (overlay + shortcut listener, query input with syntax hint chips, results list, Escape closes; syntax UI renders `type:` `tag:` `is:` `created:` `updated:` as colored chips — actual search wired in crypto plan's MiniSearch step).
7. Build credential field UX (password masked by default, reveal toggle, copy button placeholder — actual Clipboard API + retention warning in crypto plan).
8. Add theme toggle (light/dark via Tailwind `dark:` + `prefers-color-scheme` default + localStorage persist), responsive polish, keyboard nav audit (focus rings, tab order, labels, contrast, screen-reader announcements).

## Acceptance Criteria

- [ ] All 9 nav pages render at desktop (≥768px) and mobile widths; nav switches between sidebar and bottom bar.
- [ ] Dashboard shows Quick Add, recent items, favorites, category shortcuts, tag filters, sync placeholder, and empty states.
- [ ] All 4 item types can be created, viewed, edited, duplicated, favorited, archived, restored, and deleted with fixture data.
- [ ] URL validation rejects invalid URLs without fetching; 256 KiB size guard rejects oversized fixture payloads; tag limits enforced.
- [ ] Ctrl/Cmd+K opens search overlay, Escape closes; syntax chips render for supported operators.
- [ ] Credential passwords masked by default, reveal toggle works.
- [ ] Light/dark theme toggles, respects system preference on first load.
- [ ] Keyboard nav: all interactive elements focusable, visible focus rings, sufficient contrast (4.5:1 AA).

## Verification / Tests

- Unit (Vitest): ItemForm validation per type, tag validator, size guard, URL validation.
- Component (Vitest + testing-library): render each page, Quick Add flow, search overlay open/close, theme toggle.
- E2E (Playwright): full CRUD flow with fixtures, responsive check at 375px + 1280px, keyboard-only navigation.

## Git (branch: feature/ui-shell)

- Base: `main`. Builder creates branch, commits, opens PR. No self-merge.

## Integration Notes (merge order vs sibling plans, likely file overlaps)

- Merge order: **1.5** (after foundations, before crypto). Updated full order: docs-split → foundations → **ui-shell** → crypto → sync → pwa-release.
- Sibling overlaps: crypto plan adds `src/components/RecoveryKit*`, `LockScreen*`, `WasmBlock*` — no overlap (different components). Crypto plan wires MiniSearch into `useSearch` hook — coordinate hook interface (export `setSearchFn` callback). Sync plan replaces `SyncStatusPlaceholder` with real `SyncStatus` — same file path, sync plan owns final version. PWA plan finalizes Settings copy — this plan builds the Settings shell, PWA fills content.
- Shared interface contracts: `useItems` hook returns `{ items, create, update, delete, favorite, archive }` — crypto plan wraps with encrypt/decrypt. `SearchOverlay` accepts `onSearch: (query: string) => Item[]` prop — crypto plan provides MiniSearch implementation.
- i18n keys: this plan defines key constants (`DASHBOARD_TITLE`, `QUICK_ADD`, etc.); crypto plan populates ID+EN dictionaries. Key names frozen here.

## Delegation Strategy

| Step | Owner | Parallel batch | Why |
|------|-------|----------------|-----|
| 1 scaffold Vite+Tailwind+shadcn | builder | — | Inline: config, needs current context |
| 2 AppLayout + nav | designer | A | UI component, parallel to 3 |
| 3 Dashboard + empty states | designer | A | UI component, parallel to 2 (disjoint files) |
| 4 item CRUD forms + validation | builder | — | Form logic + schema validation, sequential after 1 |
| 5 tag system | designer | B | UI component, parallel to 6 |
| 6 search overlay | designer | B | UI component, parallel to 5 (disjoint files) |
| 7 credential mask/reveal | builder | — | Inline: small, needs form context |
| 8 theme + responsive + a11y | designer | — | Final polish pass |
| Component tests | tester | C | After steps 2-8, isolated `tests/` |
| A11y audit | reviewer | C | Read-only, parallel to tester |

Batch A = steps 2+3. Batch B = steps 5+6. Batch C = tester + reviewer. Reviewer read-only. No mechanical bulk edits expected.
