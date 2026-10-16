# Setup, Deployment & Recovery Appendix

> **Scope.** Deployment-specific operational runbook owned by
> `plan/pwa-hardening-release.md`. It does **not** duplicate the normative
> specifications:
> - SW lifecycle, caching rules, iOS ITP behaviour → `docs/frontend/pwa-operational.md`
> - Threat boundaries and privacy model → `docs/security/security-threat-model.md`
> - API contract, D1 model, protocol → `docs/backend/*.md`
> - Acceptance trace → `docs/product/acceptance.md`
>
> This file only covers **how to run, ship, migrate, back up, recover and
> respond** for the deployed `pages.dev` release.

---

## 1. Local development

```bash
pnpm install --frozen-lockfile   # the lockfile is the pin; never use `pnpm update`
pnpm dev                         # http://localhost:5173 — service worker intentionally OFF
```

| Command | What it does |
|---|---|
| `pnpm dev` | Vite dev server. No SW (it would break HMR), no install prompt. |
| `pnpm typecheck` | `tsc --noEmit` over `src/`, `tests/`, `functions/`. |
| `pnpm test` | Vitest: unit, integration, PWA/SW, crypto and sync suites. |
| `pnpm build` | typecheck → `vite build` → `scripts/build-pwa.mjs` (SW + `_headers` + manifest). |
| `pnpm verify:prod` | Release gate over `dist/` (see §3). |
| `pnpm release:check` | `build` + `verify:prod` + `test` — the single green command. |
| `pnpm icons` | Regenerates `public/icons/*.png` deterministically (no deps). |

Build outputs that must exist before a deploy:

```
dist/index.html
dist/sw.js                  # stamped with the per-build cache name
dist/_headers               # CSP + security headers, API no-store
dist/build-manifest.json    # digests of every shipped file
dist/manifest.webmanifest
dist/icons/{icon.svg,icon-192.png,icon-512.png,maskable-512.png,apple-touch-icon.png}
dist/assets/*.{js,css}      # content-hashed, immutable
```

---

## 2. Cloudflare setup (Pages + D1)

Two **separate** D1 databases: development must never touch production data, and
destructive release tests run against dev only.

```bash
# 1. Create both databases (once)
wrangler d1 create personal-vault-dev
wrangler d1 create personal-vault-prod

# 2. Bind them in wrangler.toml (Pages project)
#    [[d1_databases]]
#    binding = "DB"
#    database_name = "personal-vault-dev"
#    database_id   = "<dev id>"
#    [[d1_databases]]
#    binding = "DB_PROD"
#    database_name = "personal-vault-prod"
#    database_id   = "<prod id>"
```

`functions/_shared/auth.ts` reads `env.DB`. In the Pages preview environment
that binding must point at the **dev** database; production points at prod.

### 2.1 Migrations (versioned, backup-first)

```bash
# 1. Back up BEFORE any migration — D1 free tier keeps no snapshots.
wrangler d1 export personal-vault-prod --remote --output backup/pre-migration-$(date +%Y%m%d-%H%M%S).sql

# 2. Apply to DEV first, exercise, then PROD.
wrangler d1 execute personal-vault-dev  --file=migrations/0001_init.sql --local
wrangler d1 execute personal-vault-dev  --file=migrations/0001_init.sql --remote
wrangler d1 execute personal-vault-prod --file=migrations/0001_init.sql --remote
```

Rules:
- Migrations are append-only and numbered (`0001_init.sql`, `0002_…`).
- Never edit an applied migration; add a new one.
- `--remote` against prod requires a green `pnpm release:check` on the same SHA.

---

## 3. Release gate (run before every deploy)

```bash
pnpm release:check
```

`scripts/verify-prod-build.mjs` fails the release when any of these break:

1. manifest / icons / `sw.js` missing, or the manifest points at absent icons;
2. `sw.js` lacks its per-build cache name, or the precache list contains
   anything outside `/index.html`, `/assets/*`, `/icons/*`, `/manifest.webmanifest`;
3. `_headers` lacks CSP, `wasm-unsafe-eval`, `nosniff`, `no-referrer`,
   `X-Frame-Options: DENY`, or `/api/*` is not `no-store`;
4. a shipped `.wasm` asset is **not** pinned by sha256 in the CSP;
5. any bundle contains a remote `src`/`href`/import (no CDN at runtime);
6. the service worker can write an `/api/` URL into the Cache API;
7. the Worker JSON helper stops sending `no-store` / `nosniff` / `no-referrer`;
8. the sync batch endpoint stops enforcing the 384 KiB ciphertext row gate.

### 3.1 WASM hash pinning — current state

`libsodium-wrappers-sumo` ships a **pure-JavaScript** build, so the current
production bundle contains no standalone `.wasm` file and the CSP hash list is
empty. `'wasm-unsafe-eval'` is still pinned as the minimum allowance required by
PRD FR-6.

When a `.wasm` asset does ship, the build auto-adds its sha256 to `script-src`.
Be aware of what that actually buys: CSP hash sources are authoritative for
inline/classic scripts; browser support for enforcing them against
`WebAssembly` compilation is uneven, so treat them as defence in depth. The
**authoritative** integrity record is `dist/build-manifest.json`, which carries
the sha256 of every shipped file. `verify:prod` fails if a wasm asset ever ships
without being recorded there and pinned in the CSP — so switching the crypto
sibling to a wasm build cannot silently drop the pin.

### 3.2 Deploy

```bash
pnpm build
pnpm verify:prod
npx wrangler pages deploy dist --project-name personal-vault --branch main
```

After deploy, confirm from the deployed origin:

```bash
curl -sI https://<project>.pages.dev/ | grep -iE "content-security-policy|x-frame-options|referrer-policy|x-content-type"
curl -sI https://<project>.pages.dev/api/v1/sync | grep -i "cache-control"     # expect no-store
curl -s  https://<project>.pages.dev/build-manifest.json | head -20              # build id changed
```

---

## 4. Backup procedure (the only real backup)

Browser storage is a cache, and Cloudflare D1 is a relay copy — neither is a
backup.

1. **Vault data:** Settings → *Export encrypted backup* → save
   `personal-vault-export-YYYYMMDD.json` outside the browser profile (two
   copies, one off-machine).
2. **Recovery key:** `personal-vault-recovery-kit.json`, printed/stored offline.
   Losing every device **and** this file means the vault is permanently
   unreadable — that is the design, not a defect.
3. **Server schema:** before migrations, `wrangler d1 export … --remote`.
4. **Cadence:** export after every credential rotation, and monthly otherwise.
   On iOS the app nags until `last_export_at` exists — that is deliberate.

Restore drill (clean profile):

```
Settings → Import encrypted backup → master passphrase (or recovery secret)
→ verify record count matches → re-pair the device if it should sync again
```

---

## 5. Recovery procedures

### 5.1 All devices lost (recovery-kit path)

1. On a clean device open the app (clean-start screen appears).
2. *Restore with Recovery Kit* → select `personal-vault-recovery-kit.json`.
3. Enter the recovery secret → the DEK unwraps client-side.
4. Re-authorize the new device (recovery enrollment), then initial sync pulls
   the encrypted records.
5. Re-export immediately and store a fresh copy.

### 5.2 One device lost

Revoke it from any surviving device (Settings → Devices → Revoke). Revocation
is immediate and server-side; the lost device keeps only its local cache.

### 5.3 iOS storage eviction (ITP ~7 days)

Symptom: app opens to the clean-start screen, local data gone.

1. Do **not** create a new vault into the same profile if you intend to restore.
2. Restore with the recovery kit or pair from another device (see 5.1).
3. Unsynced local edits made after the last successful sync are unrecoverable —
   that is the documented boundary of local-first storage.

### 5.4 Suspected compromise

1. Revoke every device except one you control.
2. Change the master passphrase (the recovery envelope is untouched, so rotate
   it too).
3. Re-export; delete older export files once the new one is verified.
4. Treat the D1 ciphertext as compromised-by-key only if a device token leaked —
   rotate the device, not the vault.

---

## 6. Incident playbook

| Symptom | Likely cause | First move |
|---|---|---|
| Sync badge stuck "Sync paused (quota exhausted)" | D1 free-tier cap | Local vault stays fully usable; wait for the daily reset, or reduce sync frequency |
| Sync badge "Conflict (N)" | Concurrent edit on two devices | Resolve in the UI; both versions are preserved until you choose |
| `429 RATE_LIMITED` | Too many requests | Wait for `Retry-After`; the interval already skips idle cycles |
| "Vault requires a newer app version" | `VERSION_MISMATCH` | Deploy the newer build; old shells must not run against the new API |
| App shows a half-empty vault after iOS eviction | ITP cleared IndexedDB | Recovery-kit flow (§5.3) |
| Blank page after deploy | Stale shell vs new assets | Hard reload once; the SW reloads itself once per new build id |
| CSP violation in console | Over-strict header after a refactor | Re-run `pnpm verify:prod`; add the narrowest possible allowance |

### 6.1 Rolling back a bad deploy

`sw.js` is versioned per build and old caches are purged on activation, so a
rollback is a plain Pages redeploy:

```bash
git revert <bad-sha> && pnpm release:check
npx wrangler pages deploy dist --project-name personal-vault --branch main
```

Clients pick the rollback up on the next navigation (network-first) and the old
cache is deleted by the restored build's `activate` handler.

---

## 7. Real-device release matrix (before real credentials)

| Target | Checklist |
|---|---|
| Desktop Chromium | Install → relaunch offline → two-build update (no stale shell) → keyboard-only pass (`Ctrl+K`, `Esc`, focus ring visible) |
| Real Android Chrome | Install → soft keyboard does not cover Quick Add → rotation keeps state → foreground wake syncs |
| Real iOS Safari | Add to Home Screen → standalone display → keyboard viewport → banner persists until export → relaunch after eviction starts clean |
| Any browser without install | Full CRUD, search, export/import still work in a plain tab |

Soak: run 1–2 weeks on **non-critical test data only**. Real credentials are
gated on PRD §17: lifecycle, two-device sync, conflict resolution, export/restore
and all-devices-lost recovery all passing.