# Architecture

Personal Vault is a single-user web app for links, notes, snippets and
credentials. One password opens it. Items are stored as plaintext JSON in one
Cloudflare D1 table. The app is a React single page app served as static assets
by a single Cloudflare Worker that also answers the API. There is no encryption
layer, no sync engine and no device pairing. This document describes the
system as it is today. Read it before changing the runtime topology, the
request flow or the deploy path.

## 1. Runtime topology

| Piece | Value | Source |
|---|---|---|
| Worker | `personal-vault`, `compatibility_date = "2025-02-01"` | `wrangler.toml` |
| Worker entry | `.wrangler/worker/index.js` | `wrangler.toml` |
| Static assets | `./dist`, SPA fallback for unknown paths | `wrangler.toml` |
| Worker-first paths | `/api/*` | `wrangler.toml` |
| D1 | binding `DB`, database `personal-vault` | `wrangler.toml` |
| Secrets | exactly one: `PV_PASSWORD` | `wrangler.toml` |
| Public URL | `workers_dev = true`, `preview_urls = false` | `wrangler.toml` |

```
        browser
           |  https
           v
  +---------------------------+
  | Cloudflare Worker        |
  |  main: .wrangler/worker/ |
  |        index.js           |
  |                           |
  |  /api/*  --> functions/   |----> D1 "personal-vault"
  |            handlers       |      items, sessions
  |  /*      --> dist/        |
  |            static assets  |
  +---------------------------+
```

The `functions/` directory is compiled into one Worker script by
`wrangler pages functions build --outdir=.wrangler/worker`, the last step of
`pnpm build`. The bundle lives outside `dist/` so it is never served as a
static asset.

Preview URLs are disabled on purpose. A preview URL would expose the same API
and the same D1 database to anyone holding the link.

## 2. Request lifecycle

`run_worker_first = ["/api/*"]` splits every incoming request:

- `/api/*` goes to the Worker, which dispatches to the handler in
  `functions/api/`.
- Everything else is looked up in `dist/`. A path that matches no asset falls
  back to `index.html` (`not_found_handling = "single-page-application"`), so
  client side routes survive a hard refresh.

The Worker answers both kinds of request. Static assets get the headers in
`public/_headers`; dynamic API responses get the headers set in
`functions/_shared/http.ts`.

## 3. Authentication flow

1. The app boots and calls `GET /api/session`
   (`src/hooks/useAuth.tsx`). The answer is `{"authenticated": boolean}` and
   never 401.
2. While the check is in flight the gate state is `null` and nothing renders.
   This avoids flashing the login screen at an already signed in user.
3. If the answer is `false`, `LoginScreen` renders. The user submits a
   password to `POST /api/login`.
4. On a correct password the server mints a 32 byte random token, stores it in
   the `sessions` table, and returns it as the `pv_session` cookie
   (`HttpOnly`, `SameSite=Lax`, `Secure` over https, 90 day lifetime).
5. Every data request is checked against that table by
   `getRequestSession` (`functions/_shared/auth.ts`). A missing, unknown or
   expired token produces `401 unauthorized`.
6. The client treats any 401 as "the session died". `src/api/client.ts`
   dispatches a `pv:logout` event on `window` and throws `AuthError`. The auth
   provider listens for that event and drops back to the login screen.

Logout is `POST /api/logout`: it deletes the session row and clears the
cookie.

## 4. Data flow

Reading is one request. `GET /api/items` runs
`SELECT payload FROM items ORDER BY updated_at DESC` and returns every item.
A row whose payload does not parse is skipped rather than failing the whole
response.

Writing is one request per item. `PUT /api/items/:id` upserts the row. The
client owns the id, it is a UUIDv4 generated at creation time.

`src/hooks/useItems.ts` is the whole client data layer. It keeps the item list
in React state and re-fetches it:

- after every mutation, so the list on screen matches what was just written;
- when the window regains focus, so a change made on another device shows up
  when the user comes back to the tab;
- for every other `useItems` instance in the tree. A module level listener set
  broadcasts a bump after each mutation, so the search overlay and the tag
  sidebar never serve a stale list.

Two devices therefore converge by refetching. There is no push channel and no
conflict detection. If both devices write the same item, the last write wins
because the row is replaced wholesale.

## 5. Client architecture

`src/main.tsx` runs in this order:

1. The theme is applied to the document element before the first paint, from
   `localStorage["pv-theme"]` or the system preference.
2. The locale is resolved from `localStorage["pv-locale"]`, falling back to the
   device locale, and written to the `lang` attribute.
3. React mounts inside `AuthProvider` and `BrowserRouter`.
4. The install prompt watcher and the service worker registration are started.
   The worker registers only in a production build.

`src/App.tsx` is the auth gate and the router. It renders nothing while the
session check is in flight, `LoginScreen` when signed out, and the route table
otherwise. Twelve routes sit under one `AppLayout`, which supplies the
navigation, the search overlay and the theme toggle.

State lives in four hooks: `useAuth` for the gate, `useItems` for the item
list, `useTags` for derived tag counts, `useTheme` for the appearance. There
is no client side database. The browser stores only the theme, the locale and
the service worker reload guard.

## 6. Build and deploy pipeline

`pnpm build` runs four steps in order:

| Step | Command | Output |
|---|---|---|
| 1 | `tsc --noEmit` | type check, no output |
| 2 | `vite build` | `dist/` with hashed assets and `index.html` |
| 3 | `node scripts/build-pwa.mjs` | `dist/sw.js`, `dist/_headers`, `dist/build-manifest.json` |
| 4 | `wrangler pages functions build --outdir=.wrangler/worker` | `.wrangler/worker/index.js` |

Deployment has two paths.

Git connected, the default. Workers Builds runs `pnpm build` then
`npx wrangler deploy` on every push to the branch.

Manual:

```bash
pnpm deploy
```

The password is a Worker secret, never a file in the repository:

```bash
echo "<password>" | npx wrangler secret put PV_PASSWORD
```

The D1 schema is applied with `npx wrangler d1 migrations apply personal-vault
--remote`, and with `--local` for the local database.

Local development runs two processes. `pnpm dev` serves the UI on port 5173
and proxies `/api` to `http://localhost:8787`. `pnpm dev:api` builds the
functions and starts `wrangler dev` on port 8787, serving both the API and
the static assets from `dist/`. The local secret lives in `.dev.vars`, which
is git ignored.

## 7. Repository layout

| Path | Contents |
|---|---|
| `functions/_shared/` | Session model, JSON responses, headers, body reader, cookie parser |
| `functions/api/` | The six route handlers |
| `migrations/` | The single D1 migration |
| `src/api/` | The only place that calls `fetch` |
| `src/hooks/` | Auth gate, item store, tag counts, theme |
| `src/lib/` | Item contract, limits, validators, ids, search, types |
| `src/i18n/` | Locale registry and the English and Indonesian strings |
| `src/pages/` | One file per route |
| `src/components/` | Feature components plus the `ui/` primitives |
| `src/layouts/` | The app shell |
| `src/sw.js`, `src/sw-update.ts`, `src/pwa/` | Service worker template, update lifecycle, install surface |
| `scripts/` | PWA build step, icon generation |
| `public/` | Header template, web manifest, icons |
| `tests/` | Vitest suite, split by area |

## 8. Operations runbook

**Deploy.** Push to the branch and let Workers Builds run, or run `pnpm deploy`
from a machine with the Cloudflare credentials.

**Roll back.** Workers keeps the previous version. Redeploy the previous
commit with `npx wrangler deploy` from a checkout of that commit, or use the
Workers dashboard to roll back to an earlier version.

**Change the password.** `echo "<new>" | npx wrangler secret put PV_PASSWORD`.
Existing session rows stay valid until they expire, so log out everywhere
afterwards or delete the rows in `sessions`.

**Invalidate every session.** Delete every row in the `sessions` table. The
next request from every device gets a 401 and the client returns to the login
screen.

**Inspect the data.** `npx wrangler d1 execute personal-vault --remote --command
"SELECT id, updated_at FROM items ORDER BY updated_at DESC LIMIT 20"`. Rows
contain readable JSON, treat the output as secret.

**Reset the local database.** `npx wrangler d1 execute personal-vault --local
--command "DROP TABLE items; DROP TABLE sessions"` then re-apply the
migrations with `--local`.

## 9. Deliberate non-goals

- No encryption at rest. Items are readable JSON in D1.
- No sync engine. Convergence happens by refetching.
- No offline write queue. The app needs the network to save.
- No multi user support. One password, one owner.
- No shared preview URLs.
- No password change endpoint, no recovery kit, no second factor.

## Related documents

- [API Specification](api-spec.md), the six routes in detail.
- [Data Model](data-model.md), the D1 tables and the item contract.
- [Security Model](security-threat-model.md), what the system protects and what
  it does not.
- [PWA Operations](pwa-operational.md), the service worker and the deploy
  runbook.
- [UI and UX](ui-ux.md), the routes and the interaction model.
- [Decisions](decisions.md), why the system looks like this.
