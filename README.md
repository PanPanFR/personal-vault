# Personal Vault

Single-user vault webapp: links, notes, snippets, credentials. One password,
plaintext storage on your own Cloudflare account, works from every device.

## What it is

- React SPA (Vite + Tailwind) served by Cloudflare Pages
- 6-route JSON API in Pages Functions, data in D1 (`items` + `sessions`)
- Auth = one password (`PV_PASSWORD` Worker secret) → HttpOnly session cookie
  (90 days), login rate-limited per IP
- PWA: installable app shell, no offline data cache

**Security model, out loud:** items are stored **plaintext** in D1. Sessions
are opaque random tokens. Anyone with your Cloudflare account or a database
dump can read everything — that is the deliberate trade for simplicity, not a
bug. Do not put things in here you cannot afford to lose.

## API

| Method | Path | Auth |
|---|---|---|
| POST | `/api/login` `{password}` | none (rate-limited) |
| GET | `/api/session` | cookie |
| POST | `/api/logout` | cookie |
| GET | `/api/items` | cookie |
| PUT | `/api/items/:id` (full item JSON, ≤256 KiB) | cookie |
| DELETE | `/api/items/:id` | cookie |

## Local development

```bash
pnpm install
pnpm build                 # needed once: wrangler serves dist/
npx wrangler d1 migrations apply personal-vault --local
echo "PV_PASSWORD=dev-password" > .dev.vars

pnpm dev:api               # Pages Functions on :8788
pnpm dev                   # UI on :5173, /api proxied to :8788
```

```bash
pnpm test                  # vitest (API against in-memory sqlite + UI)
pnpm typecheck
pnpm build                 # tsc + vite + PWA stamping (dist/sw.js, dist/_headers)
```

## Deploy

```bash
npx wrangler d1 create personal-vault      # paste database_id into wrangler.toml
npx wrangler d1 migrations apply personal-vault --remote
npx wrangler pages secret put PV_PASSWORD --project-name personal-vault
pnpm deploy                                # build + wrangler pages deploy dist
```

To change the password later: re-run the `pages secret put` command. Existing
sessions keep working; delete rows from `sessions` (or just log out per device)
if you want to force re-login.
