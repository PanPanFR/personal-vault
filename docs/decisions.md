# Architecture Decisions

The decisions below are the ones that still shape the system. Each entry has a
status, the date it was taken, the context that forced it, the decision and the
consequences. A list of superseded decisions is at the end, with the reason
each one went away.

---

## 0001. Vite and React as a pure client side SPA

- **Status:** Accepted, still in force
- **Date:** 2026-10-13
- **Supersedes:** nothing

### Context

The app is a private vault for one owner. There is no public content, so the
value of server rendering is zero, and the cost of a full stack framework is
not.

### Decision

Use Vite, React and TypeScript as a pure client side single page app. No
Next.js, no server rendering, no hydration.

### Consequences

The build produces static HTML, CSS and JavaScript that any host can serve.
There is no hydration mismatch, no server rendering cost and no framework
runtime between the router and the data.

The trade is that the whole client bundle loads before the app is usable, and
the app is invisible to search engines. For a private vault behind a password,
neither matters.

---

## 0002. Cloudflare Workers with static assets, and D1 for storage

- **Status:** Accepted, amended 2026-10-19
- **Date:** 2026-10-13
- **Amended by:** the move from Cloudflare Pages to Cloudflare Workers static
  assets, commit `0818077`

### Context

The app needs a server for the API and a place to store the data, at no
monthly cost, without running a server.

### Decision

One Cloudflare Worker named `personal-vault` serves the static assets and
answers the API on the same origin. The `functions/` directory is compiled
into the Worker script by `wrangler pages functions build` during
`pnpm build`. The data lives in one D1 database, bound as `DB`.

The project started on Cloudflare Pages Functions and moved to Workers static
assets on 2026-10-19, because Workers is the successor platform and Pages
projects are not where new work should land.

### Consequences

One deployment unit, one origin, no CORS configuration, and a native binding
from the Worker to the database with no connection string to leak.

`wrangler.toml` disables shared preview URLs, because a preview URL would
expose the same API and the same database to anyone holding the link.

---

## 0003. One password, plaintext storage

- **Status:** Accepted
- **Date:** 2026-10-19
- **Supersedes:** the encryption, key derivation and device signing decisions

### Context

The previous design encrypted everything in the browser with a key derived
from a passphrase. That bought confidentiality against a database dump, and it
cost a great deal: an Argon2id derivation on every sign in, a key hierarchy, a
recovery kit, device pairing, a sync engine with encrypted envelopes, and a
large amount of code that only one person ever uses.

The question is whether the guarantee is worth that cost for a single user
whose database is in their own Cloudflare account.

### Decision

The password is a Worker secret, `PV_PASSWORD`. Login compares a SHA-256 digest
of the submitted password with a digest of the secret in constant time (the
secret itself is never stored in the database). Items are stored as plaintext
JSON in D1. The session is an opaque random token in a `sessions` table, handed
back as an `HttpOnly` cookie; only the token's SHA-256 hash is stored.

### Consequences

The security model is now simple enough to state in one sentence: anyone with
the Cloudflare account or a copy of the database can read everything. The app
says so in the README and in the threat model.

What disappears with the crypto layer: the Argon2id sign in delay, the key
hierarchy, the recovery kit, device pairing, the sync envelope format, the
WASM bundle weight, the CSP waiver for WASM, and the fatal crypto load
guard. What replaces them: one password field.

What is lost for real: a stolen database is a stolen vault. Changing the
password does not end existing sessions, because there is no key to rotate.
The rate limit is per Worker isolate, so it is a speed bump and not a lockout.

---

## 0004. Plain filtering for search

- **Status:** Accepted
- **Date:** 2026-10-19
- **Supersedes:** MiniSearch in-memory indexing

### Context

Search has to cover titles, urls, notes, snippet content, usernames and tags,
and support structured filters. The previous design used MiniSearch to build
an in-memory index over the decrypted records.

### Decision

Filter the item list in memory with a hand written parser in
`src/lib/search.ts`. The list is already in memory, it is small, and the
filter runs on every keystroke.

Supported syntax: `type:`, `tag:`, `is:favorite`, `is:archived`, quoted
phrases, and free text matched as a case insensitive substring across the
text fields.

### Consequences

The dependency is gone, and there is no index to build, keep in sync or
discard. The query syntax is small enough to read in one screen, and the
tests cover it directly in `tests/ui/search.test.ts`.

The cost is scale. The search is a linear scan, which is fine for a few
hundred items and would need a different approach for thousands. Free text is
substring matching, so there is no relevance ranking and no fuzzy matching.

---

## 0005. Refetch on focus instead of a sync engine

- **Status:** Accepted
- **Date:** 2026-10-19
- **Supersedes:** the revision based optimistic concurrency protocol

### Context

The same vault is open on more than one device, and the old design synced
between them with revisions, a change cursor, compare and swap, idempotency
keys, tombstones and a conflict dialog.

### Decision

There is no sync engine. The client keeps the full list in memory and
refetches it when the window regains focus, after every mutation, and on
every other hook instance in the tree. Writes are full item upserts, so the
last write wins.

### Consequences

Two devices converge, as long as the user comes back to the tab. The whole
sync protocol, the conflict dialog, the outbox and the tombstone lifecycle
are gone.

The cost is that a concurrent edit on two devices is silently resolved in
favour of the later write. There is no conflict detection and no history.
The read path is also one query per refresh, which is acceptable for a table
of a few hundred rows and would need pagination beyond that.

---

## 0006. UUIDv4 for every identifier

- **Status:** Accepted, amended 2026-10-19
- **Date:** 2026-10-13
- **Amended by:** the removal of vault level identifiers

### Context

Identifiers must be generated by the client, must not be guessable, and must
work with SQLite and JSON without a custom encoding.

### Decision

Every identifier is a UUIDv4 from `crypto.randomUUID()`, validated by a
regular expression in `src/lib/ids.ts`. Item ids are generated in the
browser before the first write. Session tokens are 32 random bytes from
`crypto.getRandomValues`, hex encoded.

The previous split, ULID for vault ids and UUIDv4 for record ids, is gone.
There is one identifier shape left, and the migration comment that still says
ULID is stale.

### Consequences

One format, one validator, no extra dependency, no index locality
optimisation to reason about. ULID was chosen for human transcription in
recovery kits, and there are no recovery kits any more.

---

## 0007. A bilingual interface with a device locale fallback

- **Status:** Accepted, still in force
- **Date:** 2026-10-13

### Context

The app is used in Indonesian and English. Every string has to exist in both
languages, and the second language must not depend on a network fetch.

### Decision

A key registry in `src/i18n/keys.ts` with an English and an Indonesian
dictionary in `src/i18n/index.ts`, bundled with the app. The chosen locale
lives in `localStorage["pv-locale"]`. With no stored choice, the app follows
the device locale, Indonesian when the browser reports a language starting
with `id` and English otherwise.

### Consequences

No i18n framework and no runtime language pack. The cost is that every new
string must be written twice, and `tests/i18n.test.ts` checks that the
dictionary and the registry stay in step.

---

## 0008. An app shell service worker with no offline data

- **Status:** Accepted
- **Date:** 2026-10-19
- **Supersedes:** offline first operation with an IndexedDB outbox

### Context

The app should install to the home screen and start instantly. It does not
need to work without a network, because a vault without a server cannot save
anything.

### Decision

The service worker precaches the shell only: `index.html`, the manifest, the
hashed assets and the icons. It never intercepts `/api/`, never touches a non
GET request and never touches a cross origin request. Navigations are network
first, so a new deploy is picked up immediately, and the cached shell is the
fallback.

### Consequences

The app starts fast and survives a dropped connection on the shell. The vault
itself is unavailable offline, which is the honest behaviour for a server
backed vault.

The `pv-shell-v<build id>` cache name and the `X-PV-Shell-Build` header let a
client tell which shell it is running. The reload happens at most once per
build id, so an update loop cannot spin the tab.

---

## 0009. The workers.dev address, without shared preview URLs

- **Status:** Accepted, amended 2026-10-19
- **Date:** 2026-10-13
- **Amended by:** the move to Workers static assets

### Context

A stable, secure origin is required: service workers and the install prompt
need one, and the user needs one address to bookmark on every device. A custom
domain costs money every year.

### Decision

Serve the app from the `workers.dev` address of the account, with a managed
certificate. No custom domain. A custom domain can be attached later without
a code or schema change.

Shared preview URLs are disabled in `wrangler.toml`. A preview URL points at
the same Worker and the same D1 database, so anyone holding the link would
have the whole vault.

### Consequences

No domain cost, no DNS to manage, and one predictable address for every
device. The address changes if the Worker is renamed, which would mean
reinstalling the PWA on every device.

---

## 0010. One shared item snapshot, a real lint gate and a build gate

- **Status:** Accepted
- **Date:** 2026-10-20

### Context

The clean code pass found three things that had quietly rotted. The item list
was copied into every `useItems` instance, with a module level broadcast to
keep the copies in step, which is a stale list waiting to happen. The `lint`
script was an alias for `tsc`, so the project had no linting at all. And the
production build verification script had been deleted with the crypto era, so
the CSP, the precache allowlist and the no-store rule on `/api/*` were no
longer checked by anything.

### Decision

- One module level snapshot of the item list in `src/hooks/useItems.ts`,
  published through `useSyncExternalStore`. Every consumer reads the same
  array. The first subscriber triggers the first load, the window focus event
  refreshes it, every mutation refetches, and a logout clears it so a new
  session never shows the previous list.
- ESLint with a flat config becomes the `pnpm lint` gate, and CI runs it.
- `scripts/verify-prod-build.mjs` comes back as `pnpm verify:prod`, a release
  gate over the finished `dist/`.
- `pnpm release:check` runs typecheck, lint, test, build and the gate in that
  order.

### Consequences

There is no second copy of the list to go stale, and the broadcast mechanism
is gone. Linting is real, so a dead export or a hook rule violation fails the
build instead of sitting there.

The build gate reads the build output, so it has to run after the build. That
ordering is why `release:check` exists as one script rather than five
separate commands.

The pass also fixed three real bugs: the `AND` token in the search parser was
matched as the literal word "and", the search overlay advertised `created:`
and `updated:` operators the parser never implemented, and an explicit
English locale choice was lost on reload.

---

## 0011. Hardened boundaries, explicit failure states, keyboard-safe overlays

- **Status:** Accepted
- **Date:** 2026-10-25

### Context

A best-practice review found gaps that the existing tests did not cover: request
bodies were buffered before their limit was checked, a malformed cookie escape
could raise a 500, login compared the password with `!==`, the sessions table
held raw tokens, and the Worker trusted item shapes the client had validated.
On the client, a failed fetch looked like an empty vault, a render error blanked
the page, and both dialogs lacked focus management.

### Decision

- Body limits are enforced while streaming; login accepts at most 1 KiB.
- Cookies tolerate malformed percent escapes; the raw value is used.
- Password comparison hashes both sides and compares in constant time.
- Sessions store `sha256(token)`; migration `0002` rebuilds the table.
- The Worker runs the same zod `ItemSchema` as the client and re-checks 256 KiB.
- The shared item snapshot carries an `error`; the layout shows Retry.
- An `ErrorBoundary` covers render failures.
- Modal and SearchOverlay trap focus, restore it, close on Escape, and the
  search combobox supports arrow keys and Enter.
- CI enforces coverage thresholds; routes are split into lazy chunks.

### Consequences

Migration `0002` invalidates every existing session, so one re-login is
required after deploy. The Worker bundle includes zod. The initial JS chunk is
smaller because pages load on demand. Error and loading states are now visible
instead of being inferred from an empty list.

---

## Superseded decisions

These were accepted and later removed. They are kept here so the shape of the
current system is not a mystery.

| Decision | Removed on | Why |
|---|---|---|
| Libsodium WebAssembly for all crypto | 2026-10-19 | The crypto layer was removed with the encryption model. The bundle weight, the WASM CSP waiver and the fatal load guard went with it. |
| Argon2id key derivation and HKDF subkeys | 2026-10-19 | There is no key to derive. The password is compared as a string. |
| Ed25519 request signing and device bearer tokens | 2026-10-19 | One session cookie replaced the two tier device model. |
| Device pairing and recovery kits | 2026-10-19 | A second device is a browser tab with the same password. |
| Revision based optimistic concurrency with tombstones | 2026-10-19 | Replaced by refetch on focus. See decision 0005. |
| MiniSearch in-memory indexing | 2026-10-19 | Replaced by plain filtering. See decision 0004. |
| Dexie and IndexedDB as the local store | 2026-10-19 | There is no local copy of the vault. The browser holds the list in React state. |
| Cloudflare Pages and Pages Functions | 2026-10-19 | Workers static assets is the current target. See decision 0002. |
| `pages.dev` subdomain | 2026-10-19 | The app serves from `workers.dev` now. See decision 0009. |
| Contract drift workflow and script | 2026-10-19 | Removed with the rest of the crypto era tooling. The API contract is documented in `docs/api-spec.md` instead. The production build gate came back separately, see decision 0010. |

## Related documents

- [Architecture](architecture.md), the system these decisions produced.
- [Data Model](data-model.md), the storage consequences of decision 0003.
- [Security Model](security-threat-model.md), what decision 0003 costs.
