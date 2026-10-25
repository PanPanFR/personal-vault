# Security Model and Threat Analysis

**Items are stored as plaintext in D1.** Anyone with access to the Cloudflare
account or a copy of the database can read every item, including credential
passwords. That is a deliberate trade for simplicity, not a bug. Do not put
anything in this vault that you cannot afford to lose.

This document lists what the system protects, what it does not, and why. Read it
before changing the auth flow, the headers, the CSP or any limit.

## 1. Trust boundaries

| Boundary | What crosses it | What it is worth |
|---|---|---|
| Browser | the password, the session cookie, every item | the least trusted surface. A compromised browser has the session |
| Worker | the password on login, the cookie on every request | the only place the password is checked |
| D1 | item JSON and session tokens, in clear | readable by anyone with database access |
| Cloudflare account | the Worker, the D1 database, the `PV_PASSWORD` secret | total control over the data |

The Worker is the enforcement point. It is the only component that can decide
whether a request is allowed, and it can only decide that by checking a
session row in D1 and by matching the password against a secret.

## 2. Protected by design

| Protection | Mechanism | Source |
|---|---|---|
| Password never leaves the Worker | the login body is read and compared server side | `functions/api/login.ts` |
| Password is not stored in the database | it lives in a Worker secret, compared as a SHA-256 digest in constant time | `functions/_shared/auth.ts` |
| Session token cannot be read by JavaScript | the cookie is `HttpOnly` | `sessionCookie` in `functions/_shared/auth.ts` |
| A database dump cannot replay sessions | only `sha256(token)` is stored in `sessions` | `createSession`, migration `0002` |
| Session token is not sent cross site | the cookie is `SameSite=Lax` | same |
| Session token is not sent over plain http | the cookie gains `Secure` on https requests | `isSecureRequest` |
| A stolen session expires | the row carries `expires_at`, 90 days out | `getRequestSession` |
| A session can be ended at any time | logout deletes the row | `POST /api/logout` |
| Data responses are never cached | `no-store` on every API response | `functions/_shared/http.ts` |
| Responses are not sniffed or framed | `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` | same |
| The referrer is not leaked | `Referrer-Policy: no-referrer` | same |
| Only same origin resources load | the CSP allows no third party origin | `scripts/build-pwa.mjs` |
| SQL injection | every query is parameterised with `?` bindings | `functions/_shared/auth.ts`, `functions/api/items/[id].ts` |
| Oversized payloads | 300 KiB raw body cap, enforced on the stream before parsing | `functions/api/items/[id].ts`, `functions/_shared/http.ts` |
| Malformed payloads | the same zod `ItemSchema` the client uses runs on the Worker | `functions/api/items/[id].ts` |
| A body cannot fork a record | the payload `id` must match the URL id | same |
| Password guessing is slowed | 10 attempts per IP per 10 minutes | `functions/api/login.ts` |
| The service worker cannot cache vault data | the API prefix is never intercepted | `src/sw.js` |
| Searching cannot surface a secret | the credential password is excluded from the searchable text | `src/lib/search.ts` |
| A release cannot ship with a broken shell | the production build gate checks the CSP, the precache list, the headers and the remote dependencies | `scripts/verify-prod-build.mjs` |
| The client reacts to a dead session | a 401 broadcasts `pv:logout` and the gate drops to the login screen | `src/api/client.ts`, `src/hooks/useAuth.tsx` |

## 3. Explicitly not protected

| Not protected | Consequence |
|---|---|
| Plaintext at rest | a D1 dump exposes every item, including credential passwords |
| Cloudflare account compromise | the attacker can read the database and read or replace `PV_PASSWORD` |
| The `PV_PASSWORD` secret | it is visible to anyone with Worker secret access, which is the account owner |
| No second factor | the password is the only thing standing between a stranger and the vault |
| No password hashing | the password is compared as a digest, but it exists in clear in the Worker runtime and in the secret store |
| Password change does not revoke sessions | `wrangler secret put PV_PASSWORD` leaves existing session rows valid until they expire |
| No session rotation | the token is the same for its whole 90 day life |
| The rate limit is approximate | the counter lives in one Worker isolate, so it resets on recycle and is not shared between isolates |
| No audit log | there is no record of who read or changed what |
| No CSRF token | `SameSite=Lax` and a same origin only API cover the common cases, but there is no explicit token |
| Credential items are stored in clear | a `credential` item keeps the password in the payload, unmasked at rest |
| No backup of the database | a lost or corrupted D1 database is a lost vault |
| No export or import | the only way to move data out is a direct D1 query |
| No deletion confirmation at the API level | a delete is immediate and irreversible, the UI asks first |
| Items are not sanitised as HTML | React escapes by default and the CSP blocks inline scripts, but item text is not sanitised for a future sink |

## 4. Session security

The token is 32 bytes from `crypto.getRandomValues`, hex encoded. Only its
SHA-256 hash is stored in `sessions`; the raw token exists in the cookie and
nowhere else. Every data request hashes the cookie and looks that hash up,
together with an `expires_at` check, so an expired token is rejected even
though the row may still exist.

Cookie attributes: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age=7776000`,
and `Secure` when the request protocol is https. The `Secure` attribute is
conditional because the local development server is plain http.

Logout deletes the row and clears the cookie. It does not invalidate other
sessions, and there is no way to list or revoke sessions from the UI. To end
every session, delete the rows in the `sessions` table.

A password change does not end any session. After changing `PV_PASSWORD`, log
out on every device or clear the `sessions` table by hand.

## 5. Transport and response headers

Every API response, from `json()` in `functions/_shared/http.ts`:

```
Cache-Control: no-store, no-cache, must-revalidate, private
Pragma: no-cache
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
X-Frame-Options: DENY
```

The static side adds the same protections plus the CSP, through
`public/_headers`. The `/api/*` block in that file is defence in depth: the
dynamic responses set their own headers, and on Workers static assets
`_headers` only covers static responses.

## 6. Content Security Policy

Built in `scripts/build-pwa.mjs` and injected into `public/_headers`:

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data:; font-src 'self'; connect-src 'self';
manifest-src 'self'; worker-src 'self'; object-src 'none';
base-uri 'self'; form-action 'self'; frame-ancestors 'none';
upgrade-insecure-requests
```

No third party origin is allowed anywhere. There is no CDN, no remote font and
no analytics.

`style-src` keeps `unsafe-inline` because the search overlay sets inline style
attributes on the operator chips (`src/components/SearchOverlay.tsx`). The CSP
has no attribute scoped alternative short of hashing each value. `script-src`
has no `unsafe-inline`, so injected markup cannot run.

## 7. Input validation

The client validates before it writes. `useItems` runs `ItemSchema.parse`,
`assertPlaintextSize` and `validateTags`, plus the link URL rule, and refuses
to send an item that fails any of them.

The server validates independently with the same `ItemSchema` the client uses,
requires the payload id to match the URL id, caps the raw body at 300 KiB while
streaming it, and re-checks the 256 KiB serialized item cap. Unknown fields
still pass through.

All SQL uses `?` bindings. There is no string interpolation of user input
into a query anywhere in `functions/`.

## 8. Incident guidance

**The password leaked.** Change it with `echo "<new>" | npx wrangler secret put
PV_PASSWORD`. Then delete every row in the `sessions` table, because existing
sessions survive the change. Expect the previous password to still be in the
secret version history of the account.

**The database leaked.** Every item is exposed, including credential
passwords. Rotate anything you stored here that is used anywhere else, then
delete the vault and the database and start over. There is no way to make a
stolen copy unreadable retroactively.

**A session token leaked.** Delete the row for that token, or clear the whole
`sessions` table. The thief is otherwise indistinguishable from a signed in
device until the token expires.

**Suspected compromise of the account.** Rotate the `PV_PASSWORD` secret, drop
the D1 database, and review the Cloudflare audit log. Items in the database
are readable, so assume anything there is disclosed.

## 9. Residual risks

| Risk | Likelihood | Impact | Current mitigation | What would close it |
|---|---|---|---|---|
| D1 or account compromise exposes all items | low | critical | none by design | encrypting the payloads, which the current design deliberately does not do |
| Password guessing | low | critical | 10 attempts per IP per 10 minutes, per isolate | a shared, durable rate limit store, or a second factor |
| Session theft through the browser | low | high | `HttpOnly`, `SameSite=Lax`, `Secure`, 90 day expiry | shorter session lifetime, or rotating refresh tokens |
| Stale session survives a password change | medium | medium | manual cleanup of the `sessions` table | invalidating sessions inside the login handler when the secret changes |
| XSS through item content | low | critical | React escaping, `script-src 'self'`, no `dangerouslySetInnerHTML` in the code | keep it that way, plus a sanitiser if a new sink appears |
| No data backup | medium | high | none | an export endpoint, which does not exist yet |
| Service worker serves a stale shell | low | low | network first for navigations, versioned cache names | nothing needed |

## Related documents

- [API Specification](api-spec.md), the routes and the error catalogue.
- [Architecture](architecture.md), where the boundaries sit.
- [Data Model](data-model.md), the plaintext payload shape.
- [PWA Operations](pwa-operational.md), the cache rules and the CSP.
