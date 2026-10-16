# Plan: simple-vault rewrite — plaintext, single password

Branch: `feature/simple-vault`. Fresh start: no data migration, prod DB is disposable.
User-confirmed decisions (2026-10-16): clean rewrite, fresh start, login page + cookie.

## Goal

A vault webapp that just works on all devices: one password, no crypto, no
encryption, no pairing/recovery/sync-engine machinery. Plaintext items in D1,
served by Cloudflare Pages + Functions. Single user.

## Architecture (target)

- **Auth**: `PV_PASSWORD` Worker secret. `POST /api/login` → HttpOnly cookie
  (`pv_session`, 90d) backed by `sessions` table. In-memory per-IP rate limit
  on login (10 / 10 min). No hashing ceremony, no device tokens.
- **Data**: one D1 table `items(id TEXT PK, payload TEXT /* full item JSON */,
  updated_at TEXT)`. Last-write-wins.
- **API** (4 routes):
  - `POST /api/login` {password} → Set-Cookie | 401
  - `GET /api/session` → {authenticated}
  - `POST /api/logout` → clears session + cookie
  - `GET /api/items` → {items:[…]}
  - `PUT /api/items/:id` → upsert (body = full item JSON, ≤256 KiB)
  - `DELETE /api/items/:id` → hard delete
- **Client**: keep React/Tailwind UI wholesale; swap `useItems` internals from
  Dexie to fetch. AuthProvider gate: login screen when `/api/session` false or
  any API 401 (`pv:logout` event). Search → plain in-memory filter (drop
  MiniSearch). PWA shell pipeline kept, WASM pinning stripped.

## Steps

1. [x] Branch `feature/simple-vault`, this plan.
2. Backend: new `migrations/0001_init.sql` (drop old 0001/0002); rewrite
   `functions/_shared/{http,auth}.ts`; delete old `_shared/{crypto,rate-limit,validate}.ts`
   and all `functions/api/v1/*`; add `functions/api/{login,session,logout}.ts`,
   `functions/api/items/{index,[id]}.ts`. Tests: rewrite `tests/helpers/mock-d1.ts`
   (glob migrations) + new `tests/api/{auth,items}.test.ts`. `pnpm test` green.
3. Client: new `src/api/client.ts`; rewrite `src/hooks/useItems.ts` (same public
   shape: create/update/remove/favorite/archive/duplicate/restore, focus refetch);
   new `src/hooks/useAuth.tsx` + `src/components/LoginScreen.tsx`; strip
   `main.tsx` (kill eviction/CleanStart/db), `App.tsx` gate, `AppLayout` seed removal.
   Delete `src/{crypto,db,sync,pairing,recovery,backup,devices,vault,search,settings}` +
   dead components (WasmBlock, ConflictDialog, RecoveryKit, SyncStatus*, BackupBanner,
   CleanStart). Rewrite `Settings.tsx` (theme/locale/logout/about only).
   Prune i18n to used keys. `pnpm typecheck` green.
4. PWA/assets: `build-pwa.mjs` minus wasm pinning; `public/_headers` CSP cleanup;
   `index.html` copy; `wrangler.toml` single DB; `package.json` deps
   (-dexie, -libsodium, -minisearch, -fake-indexeddb; +wrangler dev); vite dev
   proxy `/api` → `localhost:8788`.
5. Docs/cleanup: README rewrite (setup + deploy + dev loop); delete `docs/*`,
   `openapi.yaml`, PRD, `check-contract-drift.mjs`, `verify-prod-build.mjs`.
6. Verify: full `pnpm test`, `pnpm build`; tester subagent on auth/session matrix
   (Jev triage: auth → +tester); reviewer subagent on full diff (security dim
   0.91 ≥ 0.7 → reviewer required). Fix findings. Commit phases.
7. Integration: merge `feature/simple-vault` → main inline (sequential single
   plan), delete this plan file. `graphify update .`. Report deploy commands.

## Verification

- `pnpm test` (rewritten suite: auth, items API via real in-memory sqlite,
  UI smoke) + `pnpm build` (tsc + vite + pwa) green.
- Manual: `pnpm dev` + `pnpm dev:api` → login with PV_PASSWORD works, items
  CRUD roundtrip visible via two "devices" (two browser profiles).
- Reviewer pass on diff; log Jev verify numbers in final report.

## Deploy (documented in README)

1. `npx wrangler d1 create personal-vault` → paste id into wrangler.toml
2. `npx wrangler d1 migrations apply personal-vault --remote`
3. `npx wrangler pages secret put PV_PASSWORD` (project: personal-vault)
4. `pnpm build && npx wrangler pages deploy dist --project-name personal-vault`

## Out of scope

Multi-user, password change UI (change = `wrangler pages secret put`), offline
write queue, conflict resolution, E2E encryption — all deliberately deleted.
