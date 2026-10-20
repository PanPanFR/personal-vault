# PWA Operations

The app is installable and runs from a cached shell, but it holds no offline
data. There is no offline write queue, no background sync and no push. The
service worker exists so the app starts fast and survives a flaky network,
not so it works with no network. This document covers the build pipeline, the
service worker rules, the install surface and the deploy runbook.

## 1. What the PWA does and does not do

| Does | Does not |
|---|---|
| Install to the home screen on Chromium and iOS | work offline with data |
| Precache the app shell, the icons and the manifest | cache any API response |
| Serve a cached shell when the network fails | queue writes for later |
| Pick up a new build and reload the tab | prompt for a background sync |
| Show the install prompt and the update notice | send push notifications |

The service worker never touches the vault API. The item list lives in the tab
memory only, so a reload without a network gives an empty vault.

## 2. The build pipeline

`pnpm build` runs four steps:

| Step | Command | Output |
|---|---|---|
| 1 | `tsc --noEmit` | nothing, type check only |
| 2 | `vite build` | `dist/index.html` plus hashed assets under `dist/assets/` |
| 3 | `node scripts/build-pwa.mjs` | `dist/sw.js`, `dist/_headers`, `dist/build-manifest.json` |
| 4 | `wrangler pages functions build --outdir=.wrangler/worker` | `.wrangler/worker/index.js` |

Step 3 is deterministic and makes no network request. It walks `dist/`,
hashes every file with sha256, and derives the build id from the digests of
the precached files:

```
build id  = sha256("path:digest" lines).slice(0, 12)
cache name = pv-shell-v<build id>
```

`dist/build-manifest.json` records the build id, the cache name, the precache
list and the digest of every shipped file.

`dist/_headers` is generated from `public/_headers` with the CSP injected.
Never edit `dist/_headers` by hand, it is overwritten on every build.

## 3. The service worker

`src/sw.js` is a template. Step 3 replaces `__BUILD_ID__` and
`__PRECACHE_MANIFEST__` and writes `dist/sw.js`.

Precache allowlist, the only paths that may be written to the cache:

- `/index.html`
- `/manifest.webmanifest`
- `/assets/*`
- `/icons/*`

Rules the worker follows:

| Rule | Reason |
|---|---|
| only GET requests are considered | mutations must reach the server |
| `/api/` and `/functions/` are never intercepted | vault data and session tokens must never be cached |
| cross origin requests are never touched | only same origin resources are cacheable |
| navigation is network first, cache second, 503 last | a new deploy is picked up immediately and the cached shell is the fallback |
| allowlisted assets are cache first | hashed assets never change under the same name |
| the cache key is origin plus pathname, the query string is dropped | an attacker supplied `?v=` cannot mint new cache entries |
| every cached shell response carries `X-PV-Shell-Build` | a client can assert it is not stale |
| `install` precaches then calls `skipWaiting()` | the new build takes over without a second reload |
| `activate` purges other `pv-shell-v*` caches, claims clients and posts `ACTIVATED` | only one shell version stays on disk |

Worker messages: `SKIP_WAITING` (a waiting worker takes over) and `GET_VERSION`
(the client asks for the current build id).

## 4. The update lifecycle

`src/sw-update.ts` owns the client side.

- Registration happens only in a production build
  (`import.meta.env.PROD`), scope `/`. In development a worker makes hot
  reload unusable.
- `updateViaCache: "none"` is mandatory. A HTTP cached `sw.js` lets an old
  worker be reinstalled forever.
- The strategy is `auto` by default: the new worker claims clients and the
  app shows a reloaded notice. `prompt` is switchable in
  `src/sw-update.ts` without touching the components.
- A reload happens at most once per build id, guarded by
  `sessionStorage["pv-sw-reloaded-for"]`. A worker that activates itself over
  and over can never spin the tab.
- `applyServiceWorkerUpdate` has a 3 second timeout, so a controller that
  never claims does not freeze the button.

`UpdateNotice` in `src/components/UpdateNotice.tsx` renders the state through
`useSyncExternalStore`.

## 5. The install surface

`public/manifest.webmanifest`:

| Field | Value |
|---|---|
| `id` and `scope` | `/` |
| `name` | Personal Vault |
| `short_name` | Vault |
| `display` | `standalone`, with `minimal-ui` and `browser` as overrides |
| `theme_color` | `#1c1b1a` |
| `background_color` | `#eff1f5` |
| `lang` | `id` |
| icons | SVG, 192, 512, maskable 512, apple touch 180 |
| shortcuts | Quick Add (`/?quick-add=1`) and Settings (`/settings`) |

`src/pwa/platform.ts` captures `beforeinstallprompt` and replays it on demand.
iOS is detected by user agent, platform string and touch points, because
iPadOS reports a desktop user agent. iOS has no install prompt event, so the
install prompt there explains the Share, Add to Home Screen path.

Note: the manifest description still says the vault is encrypted and synced
end to end. That is false. The app stores plaintext items and has no sync
engine.

## 6. Headers and the CSP

`public/_headers` is the template for the static side:

| Path | Rules |
|---|---|
| `/assets/*` | `Cache-Control: public, max-age=31536000, immutable`, `nosniff`, `no-referrer` |
| `/icons/*` | `Cache-Control: public, max-age=604800`, `nosniff`, `no-referrer` |
| `/index.html` | `no-cache`, `nosniff`, `no-referrer`, `DENY`, the CSP, the permissions policy, `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin` |
| `/*` | the same set as `/index.html` |
| `/api/*` | `no-store, no-cache, must-revalidate, private`, `nosniff`, `no-referrer`, `DENY`, `default-src 'none'; frame-ancestors 'none'; base-uri 'none'` |

The CSP, built in `scripts/build-pwa.mjs`:

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data:; font-src 'self'; connect-src 'self';
manifest-src 'self'; worker-src 'self'; object-src 'none';
base-uri 'self'; form-action 'self'; frame-ancestors 'none';
upgrade-insecure-requests
```

`style-src` keeps `unsafe-inline` because the search overlay sets inline
style attributes on the operator chips. `script-src` does not, so injected
markup cannot run.

On Workers static assets `_headers` applies to static responses. The dynamic
API responses set their own headers in `functions/_shared/http.ts`, so the
`/api/*` block in the template is defence in depth.

## 7. Deployment runbook

**Git connected, the default path.** Connect the repository in the Cloudflare
dashboard, then set:

- build command: `pnpm build`
- deploy command: `npx wrangler deploy`

Every push to the branch deploys.

**Manual path.**

```bash
pnpm deploy
```

**One time setup.**

```bash
npx wrangler d1 create personal-vault
npx wrangler d1 migrations apply personal-vault --remote
echo "<password>" | npx wrangler secret put PV_PASSWORD
```

**Verify a deploy.**

1. Open the workers.dev address. The login screen appears.
2. Log in, create an item, reload the page. The item is still there.
3. Check the response headers on `/api/session` in the browser devtools. The
   CSP and `no-store` must be present.
4. Check `dist/build-manifest.json` in the deployed assets and confirm the
   build id matches the `X-PV-Shell-Build` header on a cached response.

## 8. Rollback

Workers keeps previous versions. Redeploy an earlier commit:

```bash
git checkout <old-sha>
pnpm install
pnpm deploy
```

Or pick the version in the Cloudflare dashboard. A rollback changes the build
id, so the next load activates a new service worker and the old cache is
purged. No data migration is involved, the database is untouched.

## 9. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| The tab shows an old interface after a deploy | the shell is cached and the tab is not focused | focus the tab or reload, the network first navigation picks up the new build |
| The service worker never updates | a cached `sw.js` | `updateViaCache: "none"` is already set. In devtools, check the update button, or unregister and reload |
| The app shows the 503 offline document | the network is down and there is no cached shell | the first visit has nothing cached. The shell is cached after one successful load |
| The CSP blocks a resource | something loads a third party origin | the app has no third party dependencies. Find the request in the console |
| The install prompt does not appear | the browser has no install event, or the app is already installed | on iOS use Share, Add to Home Screen |
| The update notice never appears | the service worker is not registered | it registers only in a production build |

To clear everything the worker owns:

```ts
await unregisterServiceWorkers();  // src/sw-update.ts
```

That unregisters every worker and deletes every cache.

## 10. Manual verification checklist

After a deploy, confirm:

- [ ] The login screen appears and the password works.
- [ ] An item survives a reload.
- [ ] The API response headers include `no-store` and the CSP.
- [ ] The service worker is registered and `dist/sw.js` is served with the
      build id inside it.
- [ ] The precache list in `dist/build-manifest.json` contains only
      `/index.html`, `/manifest.webmanifest`, `/assets/*` and `/icons/*`.
- [ ] No request to `/api/` appears in the service worker cache storage.

## 11. Known gaps

- `scripts/verify-prod-build.mjs` was deleted in the rewrite, so the build
  time verification of the precache list and the CSP no longer runs. The
  comment at the top of `src/sw.js` still names it.
- The manifest description claims encryption and end to end sync.
- The `created:`, `updated:` and `AND` chips in the search overlay are not
  implemented by the parser.
- The Quick Add shortcut in the manifest points at `/?quick-add=1`. The
  dashboard does not read that query parameter yet.

## Related documents

- [Architecture](architecture.md), the deploy topology.
- [Security Model](security-threat-model.md), the header and CSP rationale.
- [UI and UX](ui-ux.md), the install prompt and the update notice.
