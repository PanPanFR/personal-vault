# Implementation Plan: PWA, Hardening & Personal Release

## Objective

Turn the working vault into an installable, hardened, cross-device-tested personal release on `pages.dev`: versioned service worker with a safe update lifecycle, no-plaintext caching, pinned security headers, iOS-eviction resilience, quota survival, accessibility, and documented runbooks — then release to real use with test data first.

## Scope

IN: manifest + icons + install guidance (usable-in-browser fallback); SW versioned cache per build, `skipWaiting`+`clientsClaim`-or-prompt strategy, old-cache purge, two-build stale-shell/API test; cache rules (app-shell only, API no-store, no plaintext API in SW/Cache); headers (restrictive CSP with minimum `wasm-unsafe-eval` + pinned WASM hash, `nosniff`, `no-referrer`, frames); dependency pin/lockfile/audit + crypto-upgrade review rule; App B enforcement verification in prod build; Settings (lock timeout 1/5/15/30 default 5, theme light/dark, locale ID/EN switch per user decision, storage/offline status + pending + last-sync + last-error, device list with server-recorded last-seen + rename + revoke, export/import/rotation/recovery guidance, version + privacy notes + limitations); iOS ITP handling (~7-day eviction note, aggressive export banner on iOS until export exists, eviction→clean-start→pairing/recovery offer, real-device test); sync triggers (open/unlock, post-mutation debounced, manual retry, 60-s foreground interval while unlocked = supplementary not polling; ~15 calls/hour vs App B limit 300 GET/vault/hour, debounced bursts); quota-paused UX + local-usable guarantee; full §14 acceptance sweep; deploy (dev+prod D1 separate, versioned migrations, backup-before-migration, no CDN caching of vault API); runbooks (setup, deploy, migrate, backup, recovery, incident) + threat-model/privacy page; personal-release soak on non-critical data.
OUT: schemas, crypto primitives, sync protocol internals. Those are siblings — this plan consumes them.

## Context

- Stack: same Vite/React/TS + Pages + D1 codebase; prod build verification only (headers/CSP/SW meaningful solely on prod bits).
- PRD: §5 (+G11 ITP), FR-3 (+G12 SW lifecycle), FR-8/FR-9, §9 (headers, no third-party scripts, no remote CDN runtime deps), §12 (a11y/perf/offline), §13 (free-tier + recheck-before-deploy), §14 (all checkboxes), M5–M6.
- Consumes (read-only): foundations limits/errors; crypto lock/WASM-block/i18n keys; sync engine status hooks + quota/conflict strings. Freeze Settings key names here (`lock_timeout`, `theme`, `locale`, `last_export_at`).
- User decisions: bilingual default (ship ID+EN, switcher in Settings — pick initial default = device locale, fallback ID); auto device labels; pages.dev first.
- Technical defaults: 60-s foreground sync; `localStorage` lock-epoch kept; tombstones retained.
- Jev verify: tier MID (confidence 0.38 <0.4 → MID; `decision_risk` failure-impact 0.69/reversibility 0.31; `proceed` 0.34, `needs_human` 0.74 ≥0.7 → ask). **Needs human confirm:** SW strategy choice (`skipWaiting` auto-reload vs explicit prompt) and iOS banner aggressiveness (persistent-blocking vs dismissible) — plan default: auto-activate + "reloaded" notice, iOS banner persistent-until-export (dismissible only after export exists). Confirm or override; builder implements default unless told otherwise.

## Dependencies

- Requires: foundations + crypto + sync all green (this is the last merge; needs real two-device + eviction + quota behavior).
- Blocks: nothing (final).

## Files / Areas Likely Affected

- `public/manifest.webmanifest`, `public/icons/*`, `index.html` (NEW/EDIT — installability)
- `src/sw.ts` / `public/sw.js` + `src/sw-update.ts` (NEW — versioned caches, lifecycle, notice/prompt)
- `src/pages/Settings*`, `src/components/BackupBanner*`, `src/components/SyncStatus*` (NEW/EDIT — only plan allowed to finalize Settings copy). Note: "theme default = system preference (prefers-color-scheme), locale default = device locale fallback ID" — previous draft typo said "theme default = device locale".
- `functions/_headers` or Pages header config (NEW — CSP/nosniff/referrer/frames + WASM hash)
- `docs/setup-recovery-appendix.md` (NEW — operational appendix only; `docs/security-threat-model.md` and `docs/pwa-operational.md` owned by docs-split, not duplicated here; this plan adds deployment-specific runbook content as an appendix)
- `package.json` + lockfile, CI workflow (EDIT — pin, audit, prod-build checks)
- Deploy config (Pages project + D1 bindings dev/prod)

## Implementation Steps

1. Add manifest/icons/install guidance + browser-fallback; responsive + keyboard/focus/contrast/screen-reader pass at desktop + mobile widths; theme default = device locale rule + toggle.
2. Implement SW (per-build cache name, app-shell-only, API no-store + never cache, activate strategy default auto + notice, purge old caches) + two-consecutive-build update test.
3. Apply + verify prod headers (CSP incl. pinned WASM hash, nosniff, no-referrer, frames) + no-third-party-scripts + no-remote-CDN audit + snippet/note text-only rendering (no executable HTML) + no-arbitrary-URL-fetch recheck.
4. Implement iOS handling (persistent Settings/export banner until `last_export_at` set, eviction clean-start test on real iOS Safari, relaunch/keyboard/clipboard/lifecycle checks on real Android + iOS + desktop Chromium).
5. Wire sync triggers + quota UX (60-s foreground while unlocked, debounce bursts, batch; quota-503 → sync-paused + local-usable + retry; never "synced" pre-ack) + finalize Settings (devices with server last-seen + rename, storage status, version/privacy/limitations copy).
6. Pin/audit deps, run full §14 sweep (incl. 5,000-record + 200 ms p95 measurement, blocked-WASM, oversize, 429 matrix, export/restore clean-device, pair/revoke/recover-all-lost), write `docs/setup-recovery-appendix.md` (deployment-specific runbook; references docs-split's `docs/security-threat-model.md` and `docs/pwa-operational.md` — does not duplicate them).
7. Deploy pages.dev + prod D1, confirm quotas + limit-enforcement behavior docs rechecked, soak with non-critical data before real credentials.

## Acceptance Criteria

- [ ] Install + relaunch green on desktop Chromium, real Android, real iOS Safari; browser-fallback usable where install unavailable.
- [ ] Two-build SW update never serves stale shell against new API; old caches purged.
- [ ] SW/Cache/HTTP never hold plaintext API responses (assert in prod-build test). Oversized-record check includes D1 row-size gate (384 KiB ceiling).
- [ ] CSP/headers verified on prod build incl. WASM hash; audit clean; no remote runtime deps.
- [ ] iOS eviction → clean start + pairing/recovery offer, no corrupt half-vault; iOS banner persists until export.
- [ ] Quota exhaustion → local fully usable, outbox durable, sync-paused message + retry.
- [ ] Full §14 checklist green; runbooks + threat-model published; soak started with test data.

## Verification / Tests

- E2E prod-build: install, SW update across 2 builds, eviction simulation, quota-503 injection, blocked-WASM, keyboard/a11y pass.
- Perf: 5,000 small records open + search p95 log; 60-s interval request/row-count sanity vs free quotas.
- Release: pairing + revoke + all-lost recovery + export/restore re-run against deployed pages.dev + prod D1 (dev DB untouched by destructive tests).

## Git (branch: feature/pwa-hardening-release)

- Base: `main`. Builder creates branch, commits, opens PR. No self-merge. Single sequential tail — may merge inline per builder rules once all prior plans integrated and green.

## Integration Notes (merge order vs sibling plans, likely file overlaps)

- Merge order: **5th / last** (after docs-split → foundations → ui-shell → crypto → sync).
- Sibling overlaps: exclusive owner of SW/manifest/headers/Settings-copy/runbooks — no other plan writes these. Reads sync status hooks + lock/i18n keys; any string-key rename must land before this plan's copy-freeze. Overlap risk on `index.html` (SW registration vs crypto CSP meta) — this plan owns the final header/meta reconciliation.
- `/integrate` order: docs-split → foundations → ui-shell → crypto → sync → this plan; full suite + real-device checks after merge; remove `plan/*.md` on green.

## Delegation Strategy

| Step | Owner | Parallel batch | Why |
|------|-------|----------------|-----|
| 1 manifest/install + a11y/theme/locale | designer | A | UI system work, separate files, parallel to 2 |
| 2 SW lifecycle + cache rules | builder | A | Isolated SW files, parallel to 1 |
| 3 headers/CSP/audit/rendering | builder | — | Inline: applies headers + CSP config, after 1-2 |
| 3b headers/CSP verify | reviewer | — | Read-only security audit after builder applies headers |
| 4 iOS eviction + real-device matrix | tester | B | Device lab work, parallel to 5 |
| 5 sync triggers + quota UX + Settings finalize | builder | B | App code, parallel to 4 |
| 6 dep pin/audit + §14 sweep | builder | C | Inline: lockfile/audit/checklist, parallel to 7 |
| 6b runbooks + threat-model docs | documenter | C | Docs-only, parallel to 6 |
| 7 deploy + quota confirm + soak | builder | C | Ops, parallel to 6b (different surface: dashboard vs docs) |

Batch A = steps 1+2; B = 4+5; C = 6+6b+7. Reviewer read-only at step 3b + final §14 sign-off (never writes headers/config). Builder owns dep pin/audit/sweep; documenter owns runbooks/threat-model docs only. Bulk header/meta edits across routes via one shell script inline, never split.
