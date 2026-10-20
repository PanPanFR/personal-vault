# API Specification

The vault API has six routes. All of them are same origin: the browser calls
them on the same host that served the app, with cookies attached. There is no
public base URL, no version prefix and no third party client. This document
covers the wire contract, the error catalogue and the limits. Read it before
changing a handler, a status code or a payload shape.

## 1. Conventions

| Aspect | Rule | Source |
|---|---|---|
| Base URL | same origin, no prefix | `src/api/client.ts` |
| Content type | `application/json; charset=utf-8` | `functions/_shared/http.ts` |
| Credentials | `credentials: "same-origin"`, the session cookie rides along | `src/api/client.ts` |
| Success body | `{ "ok": true }`, or a data object | handlers |
| Error body | `{ "error": "<code>" }` | `errorResponse` in `functions/_shared/http.ts` |
| Method not handled | the route returns 404 from the Worker, no JSON body | Workers routing |

Every API response carries these headers, set by `json()` in
`functions/_shared/http.ts`:

```
Cache-Control: no-store, no-cache, must-revalidate, private
Pragma: no-cache
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
X-Frame-Options: DENY
```

## 2. Authentication model

`POST /api/login` mints an opaque token, stores it in the `sessions` table and
returns it as the `pv_session` cookie. The cookie is `HttpOnly`, `SameSite=Lax`,
`Path=/`, carries `Max-Age=7776000` (90 days) and gains `Secure` when the
request arrives over https.

`getRequestSession` in `functions/_shared/auth.ts` looks the token up with
`SELECT token FROM sessions WHERE token = ? AND expires_at > ?`. A missing,
unknown or expired token means the request is not authenticated.

Two routes are reachable without a session: `GET /api/session` (it reports the
state) and `POST /api/logout` (it is idempotent and always succeeds).

The three data routes answer `401 unauthorized` without a valid session.

## 3. Login rate limit

`POST /api/login` is limited to 10 failed attempts per IP per 10 minute
window. The counter lives in a `Map` in the module scope of
`functions/api/login.ts`, so it is per Worker isolate: it resets when the
isolate is recycled, and separate isolates do not share it. The client IP comes
from `CF-Connecting-IP`, falling back to the literal `local`.

A successful login clears the counter for that IP. The limit is a speed bump
against casual guessing, not a lockout.

## 4. Endpoints

### `POST /api/login`

Request:

```json
{ "password": "the vault password" }
```

Success: `200` with `{"ok": true}` and a `Set-Cookie` header carrying
`pv_session`.

| Status | `error` | Cause |
|---|---|---|
| 400 | none | not reachable, a malformed body is treated as a wrong password |
| 401 | `wrong_password` | the password does not match `PV_PASSWORD`, or the body carries no string password |
| 429 | `too_many_attempts` | the per IP limit is reached |
| 500 | `password_not_configured` | the `PV_PASSWORD` secret is missing from the Worker |

Notes: the password is compared as a plain string, with no hashing and no
constant time comparison. The body is parsed defensively: a body that is not
valid JSON falls through to the 401 branch.

### `POST /api/logout`

No request body. Deletes the session row when the cookie is valid, then
returns `200` with `{"ok": true}` and a `Set-Cookie` that clears the cookie
(`Max-Age=0`). Always succeeds, with or without a session.

### `GET /api/session`

No request body. Always `200`:

```json
{ "authenticated": true }
```

or

```json
{ "authenticated": false }
```

Never returns 401. The client uses this as a cheap gate check and treats a
network failure as "not authenticated".

### `GET /api/items`

No request body. Returns the whole vault, newest first:

```json
{ "items": [ { "id": "...", "type": "note", "...": "..." } ] }
```

The server runs `SELECT payload FROM items ORDER BY updated_at DESC` and parses
each row. A row whose payload does not parse is skipped so one corrupt record
cannot take the vault down.

| Status | `error` | Cause |
|---|---|---|
| 401 | `unauthorized` | no valid session |

There is no pagination. The table holds one row per item and the app is built
for a few hundred of them at most.

### `PUT /api/items/:id`

The body is the complete item JSON, the same shape the client models. The
route is an upsert:

```sql
INSERT INTO items (id, payload, updated_at) VALUES (?, ?, ?)
ON CONFLICT(id) DO UPDATE SET payload = excluded.payload,
                              updated_at = excluded.updated_at
```

Success: `200` with `{"ok": true}`.

| Status | `error` | Cause |
|---|---|---|
| 400 | `missing_id` | the route parameter is empty |
| 400 | `invalid_item` | the shape check failed |
| 400 | `id_mismatch` | the `id` inside the body differs from the id in the URL |
| 413 | `payload_too_large` | the raw body is larger than 300 KiB |
| 401 | `unauthorized` | no valid session |

The shape check requires an object with string `id`, `type`, `title` and
`updated_at`, and `updated_at` under 64 bytes. The `id` match rule is not
cosmetic: the UI keys on the item id, so a mismatch would fork one record
into two rows on the next save.

The body is measured in raw bytes before `JSON.parse` runs, so an oversized
payload is rejected without being parsed.

### `DELETE /api/items/:id`

No request body. Hard delete, idempotent: deleting an id that does not exist
still returns `200`.

Success: `200` with `{"ok": true}`.

| Status | `error` | Cause |
|---|---|---|
| 400 | `missing_id` | the route parameter is empty |
| 401 | `unauthorized` | no valid session |

There is no soft delete and no tombstone. A deleted item is gone from the
database and from every device on the next fetch.

## 5. Error code catalogue

| Code | Status | Raised by |
|---|---|---|
| `wrong_password` | 401 | `POST /api/login` |
| `too_many_attempts` | 429 | `POST /api/login` |
| `password_not_configured` | 500 | `POST /api/login` |
| `unauthorized` | 401 | the three data routes |
| `missing_id` | 400 | `PUT` and `DELETE /api/items/:id` |
| `invalid_item` | 400 | `PUT /api/items/:id` |
| `id_mismatch` | 400 | `PUT /api/items/:id` |
| `payload_too_large` | 413 | `PUT /api/items/:id` |
| `invalid_json` | 400 | `readJsonBody`, when the body does not parse |

## 6. Size caps

| Cap | Value | Enforced in |
|---|---|---|
| Raw request body | 300 KiB | `MAX_BODY_BYTES` in `functions/api/items/[id].ts` |
| Serialized item | 256 KiB | `PLAINTEXT_ITEM_CAP_BYTES` in `src/lib/limits.ts` |
| Tags per item | 20 | `TAG_MAX_PER_ITEM` in `src/lib/limits.ts` |
| Tag length | 64 characters | `TAG_MAX_LENGTH` in `src/lib/limits.ts` |

The client checks the 256 KiB cap before writing, the server checks the 300
KiB cap on the raw body. The server does not re-validate the item against the
zod schema, so the client is the only place where the field rules are
enforced.

## 7. Client contract

`src/api/client.ts` is the only module that calls the network.

- Every request uses `credentials: "same-origin"`.
- A 401 on any request dispatches a `pv:logout` event on `window` and throws
  `AuthError`. The auth provider turns that into the login screen.
- `getSession()` never throws. A network failure means "not authenticated".
- `putItem` and `deleteItem` throw a plain `Error` with the status when the
  response is not ok.
- Item ids are URL encoded into the path.

The client sends the whole item on every write. There is no partial update and
no field mask.

## 8. The old version 1 surface

The `/api/v1/*` routes (vaults, sync, devices, pairing, recovery) existed in
an earlier design and were removed when the app was rewritten as a single
password plaintext vault. Requests to them now return 404. There is no
compatibility layer and no migration path for old clients.

## Related documents

- [Architecture](architecture.md), the runtime topology and the request flow.
- [Data Model](data-model.md), the item contract and the D1 tables.
- [Security Model](security-threat-model.md), the threat analysis behind the
  limits above.
