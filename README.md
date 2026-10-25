# Personal Vault

Single-user vault webapp: links, notes, snippets, credentials. One password,
plaintext storage on your own Cloudflare account, works from every device.

## What it is

- React SPA (Vite + Tailwind) served by Cloudflare Workers (static assets)
- 6-route JSON API in Worker functions (`functions/`), data in D1 (`items` + `sessions`)
- Auth = one password (`PV_PASSWORD` Worker secret) → HttpOnly session cookie
  (90 days), login rate-limited per IP. Only a SHA-256 hash of the session token
  is stored in D1.
- API bodies are capped while streaming: 300 KiB raw item, 256 KiB parsed item,
  1 KiB login.
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
pnpm build                 # UI build + compiles functions/ into a Worker script
npx wrangler d1 migrations apply personal-vault --local
echo "PV_PASSWORD=dev-password" > .dev.vars

pnpm dev:api               # Worker + static assets on :8787
pnpm dev                   # UI on :5173, /api proxied to :8787
```

```bash
pnpm test                  # vitest (API against in-memory sqlite + UI)
pnpm typecheck
pnpm build                 # tsc + vite + PWA stamping (dist/sw.js, dist/_headers)
```

## Deploy

Deploys as a **Cloudflare Worker with static assets** (Workers is the successor
to Cloudflare Pages for new projects; the `functions/` handlers are compiled to
a single Worker script by `wrangler pages functions build`, which is part of
`pnpm build`).

Schema changes need one manual step before the deploy that ships them:
`npx wrangler d1 migrations apply personal-vault --remote`.

**A. Git-connected (push to deploy) via Workers Builds.**
- Connect the GitHub repo once: Workers & Pages → the `personal-vault` Worker →
  Settings → Builds → connect `PanPanFR/personal-vault`.
- Build command: `pnpm build`
- Deploy command: `npx wrangler deploy`
- Production branch: `main`
- Secret `PV_PASSWORD` is set once per Worker (see CLI command below, or
  dashboard → Settings → Variables & Secrets).

Every push to `main` then builds and deploys automatically.

**B. Direct deploy (CLI).**

```bash
npx wrangler d1 create personal-vault      # done; database_id lives in wrangler.toml
npx wrangler d1 migrations apply personal-vault --remote
echo "<password>" | npx wrangler secret put PV_PASSWORD
pnpm deploy                                # build + wrangler deploy
```

`wrangler.toml` wires everything: `main` (compiled functions Worker),
`[assets]` (the `dist/` UI, SPA fallback, `/api/*` runs Worker-first), and the
D1 binding `DB`.

To change the password later: re-run the `secret put` command (or edit the
dashboard env var). Existing
sessions keep working; delete rows from `sessions` (or just log out per device)
if you want to force re-login.
