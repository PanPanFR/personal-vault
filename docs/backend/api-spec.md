# Personal Vault — API Specification (v1)

> **Normative Human Contract**  
> This document is the authoritative, normative human-readable API contract for Personal Vault. The machine-readable `openapi.yaml` (maintained in the foundations plan) is a generated mirror kept strictly in sync with this specification by automated drift CI. **Never hand-edit both files independently; edits must originate in this document or be reconciled through an explicit contract revision.**  
>  
> **Normative Source:** `personal-vault-prd-v3.md` v3.0 (2026-10-13) in the repository root. On any discrepancy or conflict between this document and the PRD, the **PRD WINS**. Genuine ambiguities are tracked in `docs/product/acceptance.md` (Open Questions Register).

---

## 1. Architectural & Protocol Foundations

*Citations: PRD §2 (Firm product decisions), §8 (FR-1, FR-3, FR-4), §9 (Security model), §10 (Data model), §11 (API & sync protocol), §13 (Hosting & free-tier), Appendix D (Crypto/format versions).*

### 1.1 Base URL & Hosting Model
- **Base URL:** Same-origin `/api/v1/*` deployed via Cloudflare Pages Functions on the Cloudflare Workers runtime (`https://<pages-project>.pages.dev/api/v1/*` or custom domain).
- **Transport:** HTTPS only. Non-TLS traffic is rejected or upgraded at the Cloudflare edge.
- **Content Type:** `application/json; charset=utf-8` for all request and response bodies unless otherwise specified.
- **No Third-Party Infrastructure:** Backed exclusively by Cloudflare D1 (SQL storage) and Workers runtime; no external auth providers, Redis, or auxiliary servers.

### 1.2 Zero-Plaintext Storage Invariant
- The API and D1 database store opaque identifiers, revision metadata, cursors, cryptographic envelopes, and ciphertext only.
- Plaintext item fields (titles, URLs, descriptions, notes, snippets, credential usernames/passwords, tags), search indexes, master passphrases, raw recovery secrets, and device private signing keys are **never transmitted to or processed by the server**.

### 1.3 Transport Headers & Caching Policies
All API responses must include the following headers (PRD §9.3, §13.1):
```http
Cache-Control: no-store, no-cache, must-revalidate, private
Pragma: no-cache
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
X-Frame-Options: DENY
X-Server-Time: 2026-10-13T12:00:00.000Z
```
- **`Cache-Control: no-store`**: Mandatory. Prevents browsers, intermediary proxies, and service workers from caching encrypted vault records or metadata.
- **`X-Server-Time`**: Mandatory ISO-8601 UTC timestamp emitted on every API response. Used by client devices to detect local clock drift and synchronize within the required signature window.

### 1.4 Frozen Primitives & Identifiers
The following primitives are frozen across all schemas and API interactions (PRD §10, §11, Appendix D):

| Primitive | Data Type | Format / Constraints | PRD Citation |
|---|---|---|---|
| `vault_id` | String | 26-character ULID (Crockford Base32, sortable, opaque) | PRD §10, §FR-5 |
| `record_id` | String | Canonical RFC 4122 UUIDv4 (36 chars, lowercase hex with hyphens) | PRD §8 (FR-1), §10 |
| `device_id` | String | Canonical RFC 4122 UUIDv4 (36 chars) | PRD §8 (FR-5), §10 |
| `mutation_id` | String | Canonical RFC 4122 UUIDv4 (client-generated idempotency key) | PRD §8 (FR-4), §10 |
| `ticket_id` | String | Canonical RFC 4122 UUIDv4 (server-generated pairing ticket ID) | PRD §8 (FR-5), §10 |
| `cursor` / `change_seq` | Integer | 64-bit signed monotonic integer (`int` >= 0) from `sync_changes.seq` | PRD §8 (FR-4), §11 |
| `revision` | Integer | Monotonic integer (`int` >= 1) per record | PRD §8 (FR-4), §10 |
| `schema_version` | Integer | `1` (authoritative inside ciphertext, replicated in plaintext triage column) | PRD §FR-1 (G5), App. D |
| `crypto_format_version` | Integer | `1` (vault-level crypto envelope version) | PRD §FR-1 (G5), App. D |
| `kdf_version` | Integer | `1` (Argon2id13 parameter set version) | PRD §FR-6 (G2), App. D |
| `key_version` | Integer | `1` (data-encryption key rotation counter) | PRD §FR-6, App. D |
| Tombstone | State | Record where `is_tombstone = true`, `ciphertext = null`, `nonce_b64u = null` | PRD §8 (FR-4), §11 |

### 1.5 Frozen Size Caps & Operational Limits
The following limits are binding on client and server validation (PRD §FR-1, §FR-4, §FR-5, Appendix B):

| Constraint | Limit | Unit / Scope | Rationale / Enforcement |
|---|---|---|---|
| Plaintext item cap | **256 KiB** (262,144 bytes) | Serialized UTF-8 JSON before encryption | PRD §FR-1. Client validates and rejects pre-encryption; prevents UI bloat. |
| Ciphertext record cap | **384 KiB** (393,216 bytes) | Base64url-encoded string per record | PRD §FR-1 (G10). Accommodates ~33-40% encryption overhead and D1 row limits. |
| Sync batch size cap | **50 mutations** | Count per `POST /api/v1/sync/batch` | PRD §FR-4. Bounded transaction execution time and D1 write operations. |
| Sync batch payload cap | **1 MiB** (1,048,576 bytes) | Request body size in ciphertext bytes | PRD §FR-4. Prevents Worker memory/payload exhaustion. |
| Pairing ticket TTL | **5 minutes** (300 seconds) | Lifespan of temporary pairing code | PRD §FR-5 (G3). Minimizes exposure window for one-time code exchange. |
| Request clock skew | **±5 minutes** (300 seconds) | Max drift between client timestamp & server | PRD Appendix A (`STALE_TIMESTAMP`). Replay prevention window. |

---

## 2. Authentication & Request Signing

*Citations: PRD §FR-5 (Device authorization & pairing), §9 (Security requirements), §11 (API endpoint behaviors).*

Personal Vault implements a zero-trust, passwordless, device-centric authorization model. There is no email, user directory, or central identity provider. Every client represents an explicitly authorized device.

### 2.1 Authorization Levels

1. **Unauthenticated Endpoints:**  
   `POST /api/v1/vaults` (initial setup) and `POST /api/v1/pairing/exchange` (new device code exchange).
2. **Read-Only Authenticated Endpoints:**  
   `GET /api/v1/vaults/:vaultId/bootstrap` and `GET /api/v1/sync`.  
   Requires a valid device bearer token.
3. **Mutating / Signed Endpoints:**  
   `POST /api/v1/sync/batch`, `POST /api/v1/pairing-tickets`, `POST /api/v1/devices/:deviceId/revoke`, and `PUT /api/v1/vault/crypto-metadata`.  
   Requires **both** a valid device bearer token and a cryptographic Ed25519 signature generated by the device's registered private key.
4. **Recovery-Authorized Endpoint:**  
   `POST /api/v1/recovery/enroll-device`.  
   Authorized solely via the high-entropy recovery authorization token derived from the offline recovery secret.

### 2.2 Device Bearer Token Handling
- Each device possesses a cryptographically random 256-bit (32-byte) bearer token, base64url-encoded (43 chars, no padding).
- The raw token is returned **once** to the client upon creation (`POST /api/v1/vaults`, `POST /api/v1/pairing/exchange`, or `POST /api/v1/recovery/enroll-device`).
- The server stores **only** the SHA-256 hash of the device token: `device_token_hash = SHA-256(raw_token)` (hex-encoded, 64 chars). Raw tokens are never persisted or logged server-side.
- The client stores the device token encrypted locally in IndexedDB under a local key derived from the vault DEK (`PV-V1/LOCAL-CRED`).
- On authenticated requests, the token is supplied via the standard `Authorization` header:
  ```http
  Authorization: Bearer <device_bearer_token>
  ```

### 2.3 Ed25519 Request Signing (`PV-Device` Header)
To defend against token theft (where a compromised or intercepted bearer token alone cannot mutate vault records, pair new devices, change encryption keys, or revoke other devices), mutating endpoints require an Ed25519 signature binding the exact HTTP request (PRD §FR-5, lines 224–226).

#### Wire Format
Signed requests must include the custom `PV-Device` header:
```http
PV-Device: device_id="<UUIDv4>", timestamp="<ISO-8601-UTC>", nonce="<UUIDv4>", signature="<base64url-ed25519-sig>"
```

> Open question Q2: see Open Questions Register in `docs/product/acceptance.md`.

#### Canonical Signing String Construction
The Ed25519 signature is computed over the UTF-8 bytes of the following newline-delimited canonical string:
```text
<HTTP_METHOD>\n
<HTTP_PATH>\n
<TIMESTAMP>\n
<NONCE>\n
<BODY_SHA256_HEX>
```
Where:
- `HTTP_METHOD`: Uppercase HTTP method (`POST`, `PUT`, etc.).
- `HTTP_PATH`: Canonical request path including query parameters (e.g. `/api/v1/sync/batch` or `/api/v1/devices/f47ac10b-58cc-4372-a567-0e02b2c3d479/revoke`).
- `TIMESTAMP`: ISO-8601 UTC timestamp string matching the `timestamp` header attribute (e.g. `2026-10-13T12:00:00.000Z`).
- `NONCE`: A unique RFC 4122 UUIDv4 string matching the `nonce` header attribute (for `POST /api/v1/sync/batch`, this can be identical to the primary `mutation_id` or a dedicated request nonce).
- `BODY_SHA256_HEX`: Lowercase hexadecimal representation of the SHA-256 digest of the exact raw UTF-8 request body bytes. For requests with an empty body, use the SHA-256 digest of empty string `""` (`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`).

#### Server-Side Signature Verification Rules
1. Extract device record using the SHA-256 hash of the bearer token in `Authorization: Bearer`.
2. Verify that `device_id` in `PV-Device` matches the authenticated token record. If not, return `401 DEVICE_UNAUTHORIZED`.
3. Check `revoked_at`. If non-null, return `401 DEVICE_REVOKED`.
4. Check `timestamp`: Compare against `X-Server-Time`. If `|server_time - request_time| > 300 seconds` (±5 minutes), return `401 STALE_TIMESTAMP`.
5. Check `nonce`: Query recent request nonces within the ±5-minute window for that vault. If `nonce` was seen previously:
   - If request body SHA-256 is identical: Idempotent replay; return previous cached response.
   - If request body SHA-256 differs: Return `409 REPLAY_DETECTED`.
6. Compute SHA-256 digest of raw request body. If it does not match `BODY_SHA256_HEX`, return `401 INVALID_SIGNATURE`.
7. Verify Ed25519 signature against the device's registered `device_public_key`. If verification fails, return `401 INVALID_SIGNATURE`.

---

## 3. Error Handling & Standard Envelopes

*Citations: PRD Appendix A (Stable error codes), Appendix B (Application-level rate limits).*

### 3.1 Standard Error Envelope
All error responses from any `/api/v1/*` endpoint return a standardized JSON envelope with HTTP status codes in the 4xx or 5xx range:
```json
{
  "code": "VALIDATION_ERROR",
  "message": "The request body fails schema or size validation.",
  "retryable": false
}
```

#### Envelope Schema
| Field | Type | Description |
|---|---|---|
| `code` | String (Enum) | One of the 18 frozen error codes defined in Appendix A. |
| `message` | String | Clear, human-readable description suitable for UI presentation. **Must contain no stack traces, SQL syntax, or decrypted data.** |
| `retryable` | Boolean | `true` if client may retry automatically or after backoff; `false` if client action/fix is required. |

### 3.2 Stable Error Code Catalog (18 Codes)
The following 18 error codes are normative and frozen. Adding or changing codes requires a formal contract revision.

| Error Code | HTTP Status | Retryable | UI Category | Detailed Condition / Cause |
|---|---|---|---|---|
| `VALIDATION_ERROR` | `400 Bad Request` | `false` | Malformed data | JSON syntax error, missing required fields, invalid UUID/ULID format, or field type mismatch. |
| `CRYPTO_VERSION_UNSUPPORTED` | `400 Bad Request` | `false` | Version mismatch | Argon2id envelope parameters below Minimum floor or above Maximum cap, or unknown `kdf_version`/`crypto_format_version`. |
| `TICKET_INVALID` | `400 Bad Request` | `false` | Malformed data | Pairing ticket hash unknown, invalid format, or ticket does not belong to specified vault. |
| `SYNC_CURSOR_INVALID` | `400 Bad Request` | `false` | Malformed data | Cursor value is negative, non-numeric, or corrupted. Client resets cursor to `0` or durable sync state. |
| `DEVICE_UNAUTHORIZED` | `401 Unauthorized` | `false` | Authorization / revocation | Missing, malformed, or unknown device bearer token; recovery authorization token mismatch. |
| `DEVICE_REVOKED` | `401 Unauthorized` | `false` | Authorization / revocation | Authenticated device has been explicitly revoked. Client UI must halt sync retries and prompt user. |
| `INVALID_SIGNATURE` | `401 Unauthorized` | `false` | Authorization / revocation | Missing or malformed `PV-Device` header, public key mismatch, or body digest mismatch. |
| `STALE_TIMESTAMP` | `401 Unauthorized` | `true` | Rate-limited / Clock skew | Request timestamp differs from server clock by more than ±5 minutes. Client re-syncs clock via `X-Server-Time` and retries once. |
| `VAULT_NOT_FOUND` | `404 Not Found` | `false` | Conflict / Not found | Specified `vault_id` does not exist. Returned uniformly for unknown vaults or unauthorized callers to avoid enumeration oracles. |
| `REPLAY_DETECTED` | `409 Conflict` | `false` | Conflict | Reused `nonce` or `mutation_id` submitted with a differing request body. |
| `REVISION_CONFLICT` | `409 Conflict` | `false` | Conflict | Record `expected_revision` does not match current server revision. Returns latest server ciphertext for client resolution. |
| `VERSION_MISMATCH` | `409 Conflict` | `false` | Version mismatch | Schema or crypto envelope version is newer than supported. UI presents "Please update the app". |
| `TICKET_EXPIRED` | `410 Gone` | `false` | Conflict | Pairing ticket is past its 5-minute lifespan. |
| `TICKET_CONSUMED` | `410 Gone` | `false` | Conflict | Pairing ticket has already been exchanged or was superseded by a newer ticket. |
| `PAYLOAD_TOO_LARGE` | `413 Payload Too Large` | `false` | Malformed data | Single record ciphertext > 384 KiB, batch > 50 mutations, or total batch body > 1 MiB. |
| `RATE_LIMITED` | `429 Too Many Requests` | `true` | Rate-limited | Application rate limit exceeded per Appendix B. Response includes `Retry-After` header. |
| `INTERNAL_ERROR` | `500 Internal Server Error` | `true` | Network / Server failure | Uncaught server exception or database connectivity issue. Logged server-side without secrets. |
| `QUOTA_EXHAUSTED` | `503 Service Unavailable` | `true` | Quota exhaustion | Cloudflare Workers or D1 daily free quota reached. Client pauses cloud sync and maintains durable local storage. |

### 3.3 Conflict Response Envelope (`409 REVISION_CONFLICT`)
When a mutation encounters a revision mismatch, the server returns status `409 Conflict` with code `REVISION_CONFLICT` and includes the conflicting server record state so the client can resolve the conflict locally (PRD §FR-4, §11):
```json
{
  "code": "REVISION_CONFLICT",
  "message": "The record was updated on another device. Revision mismatch.",
  "retryable": false,
  "record_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "expected_revision": 2,
  "server_revision": 3,
  "server_change_seq": 1042,
  "server_schema_version": 1,
  "server_key_version": 1,
  "is_tombstone": false,
  "server_ciphertext": "U2FsdGVkX1+vupppZksvRf5pq5g5XjFRIipRRM0NZGs...",
  "server_nonce_b64u": "dGhpcy1pcy1hLTI0LWJ5dGUtbm9uY2U"
}
```

### 3.4 Rate Limit Response (`429 RATE_LIMITED`)
When an application-level rate limit is hit, the response returns:
```http
HTTP/1.1 429 Too Many Requests
Content-Type: application/json; charset=utf-8
Retry-After: 3600
X-Server-Time: 2026-10-13T12:00:00.000Z

{
  "code": "RATE_LIMITED",
  "message": "Too many requests. Please wait 3600 seconds before retrying.",
  "retryable": true
}
```
The `Retry-After` header indicates the rolling window reset interval in seconds.

---

## 4. Application-Level Rate Limits

*Citations: PRD Appendix B (Application-level rate limits), §13 (Free-tier plan).*

All rate limits are enforced within Cloudflare Pages Functions using D1-backed sliding counter tables. No paid Cloudflare features or external rate-limiting add-ons are required. Every limit operates on a rolling window. Failed requests count toward limits.

| # | Endpoint | Method | Rate Limit | Scope / Bucket Key | Rationale / Abuse Protection |
|---|---|---|---|---|---|
| 1 | `/api/v1/vaults` | `POST` | **3 per IP per hour** | Client IP (`CF-Connecting-IP`) | Vault creation is rare; stops mass-creation bot attacks. |
| 2 | `/api/v1/pairing-tickets` | `POST` | **5 per device per hour** | `device_id` | Generating tickets requires unlocked device; 5 covers manual retries. |
| 3 | `/api/v1/pairing/exchange` | `POST` | **10 per vault per hour** | `vault_id` | Accommodates manual typo retries; prevents ticket brute-force. |
| 4 | `/api/v1/recovery/enroll-device` | `POST` | **5 per vault per hour** *(with doubling backoff after 3 failures)* | `vault_id` | Strictest user-facing limit; protects against recovery secret guessing. |
| 5 | `/api/v1/sync/batch` | `POST` | **120 per vault per hour** | `vault_id` | Covers bursts of editing and offline sync flushes (120 × 50 = 6,000 items/hr). |
| 6 | `/api/v1/sync` | `GET` | **300 per vault per hour** | `vault_id` | Supports initial pull paging; clients must debounce without aggressive polling. |
| 7 | `/api/v1/vault/crypto-metadata` | `PUT` | **10 per vault per hour** | `vault_id` | Master password change or recovery rotation is very infrequent. |

---

## 5. Cryptographic Envelopes & Schemas

*Citations: PRD §FR-6 (Master password & keys), §FR-7 (Recovery), Appendix C (Recovery-kit file), Appendix D (Crypto/format versions).*

### 5.1 Master Key Envelope
The master envelope encrypts the vault Data-Encryption Key (DEK) under a Key-Encryption Key (KEK) derived from the user's master passphrase via Argon2id13.

```json
{
  "crypto_format_version": 1,
  "key_version": 1,
  "kdf_version": 1,
  "argon2_m_kib": 131072,
  "argon2_t": 4,
  "argon2_p": 1,
  "salt_b64u": "vL3...16_bytes_base64url...",
  "nonce_b64u": "xCh...24_bytes_base64url...",
  "wrapped_dek_b64u": "enc...wrapped_32_byte_dek_base64url..."
}
```

#### Envelope Field Specification
| Field | Type | Validation / Value |
|---|---|---|
| `crypto_format_version` | Integer | Exactly `1` for MVP. |
| `key_version` | Integer | Starts at `1`. Increment on DEK re-wrap. |
| `kdf_version` | Integer | Exactly `1` (Argon2id13). |
| `argon2_m_kib` | Integer | Memory parameter in KiB. Floor: `65536` (64 MiB), Recommended: `131072` (128 MiB), Cap: `524288` (512 MiB). Values outside `[65536, 524288]` are rejected with `CRYPTO_VERSION_UNSUPPORTED`. |
| `argon2_t` | Integer | Iteration count. Floor: `3`, Recommended: `4`, Cap: `5`. |
| `argon2_p` | Integer | Parallelism parameter. Standard: `1`, Cap: `4`. |
| `salt_b64u` | String | 16 random bytes base64url-encoded without padding (22 chars). |
| `nonce_b64u` | String | 24 random bytes base64url-encoded without padding (32 chars) for XChaCha20-Poly1305. |
| `wrapped_dek_b64u` | String | Base64url-encoded ciphertext of the 256-bit DEK + 16-byte Poly1305 authentication tag (48 raw bytes -> 64 chars base64url). |

### 5.2 Recovery Envelope & Authorization Verifier
The recovery envelope wraps the same DEK under an independent recovery key derived via HKDF from the 256-bit recovery secret (`PV-V1/RECOVERY-WRAP`).
```json
{
  "crypto_format_version": 1,
  "key_version": 1,
  "nonce_b64u": "rCv...24_bytes_base64url...",
  "wrapped_dek_b64u": "rec...wrapped_32_byte_dek_base64url..."
}
```
- **`recovery_auth_verifier`**: The server persists **only** `SHA-256(HKDF(recovery_secret, "PV-V1/RECOVERY-AUTH"))` as a hex or base64url string. The recovery decryption key and raw recovery secret are **never sent to the server**.

### 5.3 Offline Recovery-Kit File Schema (Appendix C)
The recovery kit downloaded by the user during vault creation or rotation is formatted as `personal-vault-recovery-kit.json`:
```json
{
  "format": "personal-vault-recovery-kit",
  "version": 1,
  "vault_id": "01J9Z8QK7M3V6P2R5T8W4Y6U1A",
  "api_origin": "https://personal-vault.pages.dev",
  "recovery_secret": "dGhpcy1pcy1hbi1leGFtcGxlLTI1Ni1iaXQtc2VjcmV0ISE",
  "created_at": "2026-10-13T00:00:00.000Z",
  "instructions": "Open api_origin, choose Recover, enter vault_id and recovery_secret (or its base32 manual code). Keep this file offline."
}
```

### 5.4 Item Record Ciphertext & AAD Binding
Each encrypted item is stored as an authenticated ciphertext blob with its unique nonce:
- **Ciphertext ceiling:** 384 KiB base64url string.
- **Algorithm:** XChaCha20-Poly1305.
- **Associated Authenticated Data (AAD):**  
  `vault_id || record_id || schema_version || key_version || "record"` (raw UTF-8 concatenation).
- If any AAD parameter does not match during decryption, decryption fails closed.

---

## 6. Endpoint Reference

*Citations: PRD §11 (API & sync protocol), §FR-1, §FR-4, §FR-5, §FR-6, §FR-7, Appendix A, Appendix B.*

```
Summary of Endpoints:
1. POST /api/v1/vaults                    Create vault & register initial device
2. GET  /api/v1/vaults/:vaultId/bootstrap Fetch master envelope & bootstrap state
3. GET  /api/v1/sync                      Fetch remote changes page by cursor
4. POST /api/v1/sync/batch                Submit encrypted mutations
5. POST /api/v1/pairing-tickets           Create single-use pairing ticket
6. POST /api/v1/pairing/exchange          Exchange pairing ticket for device registration
7. POST /api/v1/devices/:deviceId/revoke  Revoke authorized device
8. PUT  /api/v1/vault/crypto-metadata     Update master key envelope
9. POST /api/v1/recovery/enroll-device    Enroll new device via recovery authorization token
```

---

### 6.1 `POST /api/v1/vaults` — Create Vault & Register First Device
*PRD §11 (line 453), §FR-5, §FR-6, §FR-7, Appendix B.*

Creates a new personal vault, stores its master and recovery key envelopes, and registers the creating device.

- **Authentication:** None.
- **Rate Limit:** 3 requests per IP per hour.
- **Request Headers:**
  - `Content-Type: application/json`

#### Request Body
```json
{
  "vault_id": "01J9Z8QK7M3V6P2R5T8W4Y6U1A",
  "crypto_format_version": 1,
  "key_version": 1,
  "schema_version": 1,
  "master_envelope": {
    "crypto_format_version": 1,
    "key_version": 1,
    "kdf_version": 1,
    "argon2_m_kib": 131072,
    "argon2_t": 4,
    "argon2_p": 1,
    "salt_b64u": "dB8g8jH_839aKdk_23kdPQ",
    "nonce_b64u": "rB1Z6k_89qW1...24_bytes_b64u...",
    "wrapped_dek_b64u": "kP0...wrapped_dek_b64u..."
  },
  "recovery_envelope": {
    "crypto_format_version": 1,
    "key_version": 1,
    "nonce_b64u": "mN3...24_bytes_b64u...",
    "wrapped_dek_b64u": "qZ8...wrapped_dek_b64u..."
  },
  "recovery_auth_verifier": "f2d9e83...sha256_hex_64_chars...",
  "device": {
    "device_id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "device_token_hash": "e3b0c44...sha256_of_token_64_chars...",
    "device_public_key": "xP4...ed25519_pub_32_bytes_b64u...",
    "label": "My Desktop"
  }
}
```

> Open question Q1: see Open Questions Register in `docs/product/acceptance.md`.

#### Response `201 Created`
```json
{
  "vault_id": "01J9Z8QK7M3V6P2R5T8W4Y6U1A",
  "device_id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "created_at": "2026-10-13T12:00:00.000Z"
}
```

#### Possible Error Responses
- `400 VALIDATION_ERROR`: Malformed body, missing envelope fields, or invalid ULID/UUID.
- `400 CRYPTO_VERSION_UNSUPPORTED`: Argon2id parameters below floor or above cap.
- `409 REPLAY_DETECTED` / `409 VERSION_MISMATCH`: Vault ID collision or unsupported version.
- `429 RATE_LIMITED`: Exceeded 3 requests per IP per hour.
- `500 INTERNAL_ERROR`: Database write failure.

---

### 6.2 `GET /api/v1/vaults/:vaultId/bootstrap` — Fetch Bootstrap Metadata
*PRD §11 (line 454), §FR-5 (G3 step 3), Appendix D.*

Retrieves the encrypted master-key envelope, versions, and current sync cursor needed by an authorized device to unlock the vault.

> **CRITICAL BOOTSTRAP SHAPE INVARIANT:**  
> This response **MUST NEVER** include the `recovery_envelope`, `recovery_auth_verifier`, or authorized devices list. Ordinary authorized devices unlock only via the master envelope. The recovery envelope is isolated to recovery flows.

- **Authentication:** Valid device bearer token (`Authorization: Bearer <device_token>`).
- **Rate Limit:** Governed by general read budget.
- **Request Headers:**
  - `Authorization: Bearer <device_bearer_token>`
- **URL Parameters:**
  - `vaultId`: 26-char ULID matching the authenticated device's vault.

#### Response `200 OK`
```json
{
  "vault_id": "01J9Z8QK7M3V6P2R5T8W4Y6U1A",
  "crypto_format_version": 1,
  "key_version": 1,
  "kdf_version": 1,
  "schema_version": 1,
  "master_envelope": {
    "crypto_format_version": 1,
    "key_version": 1,
    "kdf_version": 1,
    "argon2_m_kib": 131072,
    "argon2_t": 4,
    "argon2_p": 1,
    "salt_b64u": "dB8g8jH_839aKdk_23kdPQ",
    "nonce_b64u": "rB1Z6k_89qW1...24_bytes_b64u...",
    "wrapped_dek_b64u": "kP0...wrapped_dek_b64u..."
  },
  "change_cursor": 42
}
```

#### Possible Error Responses
- `401 DEVICE_UNAUTHORIZED`: Missing or invalid device bearer token.
- `401 DEVICE_REVOKED`: The calling device has been revoked.
- `404 VAULT_NOT_FOUND`: Vault does not exist or caller is unauthorized.
- `500 INTERNAL_ERROR`: Server error.

---

### 6.3 `GET /api/v1/sync` — Fetch Remote Changes Page
*PRD §11 (line 455), §FR-4, §13, Appendix B.*

Fetches an ordered, paginated list of encrypted sync changes and tombstones that occurred after the client's last durable cursor.

- **Authentication:** Valid device bearer token (`Authorization: Bearer <device_token>`).
- **Rate Limit:** 300 requests per vault per hour.
- **Request Headers:**
  - `Authorization: Bearer <device_bearer_token>`
- **Query Parameters:**
  - `cursor`: Integer (>= 0). Changes strictly greater than this sequence number are returned. Defaults to `0`.
  - `limit`: Integer (optional, 1 to 50, default 50). Maximum number of changes per page.

#### Response `200 OK`
```json
{
  "changes": [
    {
      "change_seq": 43,
      "record_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
      "revision": 1,
      "schema_version": 1,
      "key_version": 1,
      "is_tombstone": false,
      "ciphertext": "U2FsdGVkX1+vupppZksvRf5pq5g5XjFRIipRRM0NZGs...",
      "nonce_b64u": "dGhpcy1pcy1hLTI0LWJ5dGUtbm9uY2U",
      "updated_at": "2026-10-13T12:05:00.000Z"
    },
    {
      "change_seq": 44,
      "record_id": "4a2b9184-25e2-4f36-9e1e-28b3a72013f9",
      "revision": 4,
      "schema_version": 1,
      "key_version": 1,
      "is_tombstone": true,
      "ciphertext": null,
      "nonce_b64u": null,
      "updated_at": "2026-10-13T12:06:00.000Z"
    }
  ],
  "next_cursor": 44,
  "has_more": false
}
```

#### Sync & Idempotency Invariants (PRD §FR-4, G6)
- Applying downloaded changes must be idempotent, keyed by `(record_id, revision, change_seq)`.
- Re-applying an already applied page must perform a safe upsert, never duplicating or corrupting local records.
- Deletions are sent as `is_tombstone: true` with `ciphertext: null` and `nonce_b64u: null`. Tombstones are never purged in the MVP.

#### Possible Error Responses
- `400 SYNC_CURSOR_INVALID`: Negative or corrupt cursor.
- `401 DEVICE_UNAUTHORIZED`: Missing or invalid device bearer token.
- `401 DEVICE_REVOKED`: Calling device is revoked.
- `404 VAULT_NOT_FOUND`: Vault does not exist.
- `429 RATE_LIMITED`: Exceeded 300 requests per vault per hour.
- `503 QUOTA_EXHAUSTED`: Cloudflare D1 daily free read/write quota exhausted. Sync paused.

---

### 6.4 `POST /api/v1/sync/batch` — Submit Encrypted Mutations
*PRD §11 (line 456), §FR-1 (G10), §FR-4, Appendix A, Appendix B.*

Submits a batch of client-side encrypted mutations (creates, updates, and deletes) to be applied atomically using Compare-And-Swap (CAS) revision verification.

- **Authentication:** Valid device bearer token + valid `PV-Device` signature.
- **Rate Limit:** 120 requests per vault per hour.
- **Caps:** Maximum **50 mutations** AND maximum **1 MiB total request body**. Each individual record ciphertext must not exceed **384 KiB**.
- **Request Headers:**
  - `Content-Type: application/json`
  - `Authorization: Bearer <device_bearer_token>`
  - `PV-Device: device_id="...", timestamp="...", nonce="...", signature="..."`

#### Request Body
```json
{
  "mutations": [
    {
      "mutation_id": "e6a2b8e3-0d3e-4b67-891a-7b3c2e1d0f5a",
      "record_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
      "expected_revision": 0,
      "schema_version": 1,
      "key_version": 1,
      "is_tombstone": false,
      "ciphertext": "U2FsdGVkX1+vupppZksvRf5pq5g5XjFRIipRRM0NZGs...",
      "nonce_b64u": "dGhpcy1pcy1hLTI0LWJ5dGUtbm9uY2U"
    },
    {
      "mutation_id": "c1f7a4b9-8e2d-4567-9abc-123456789abc",
      "record_id": "4a2b9184-25e2-4f36-9e1e-28b3a72013f9",
      "expected_revision": 3,
      "schema_version": 1,
      "key_version": 1,
      "is_tombstone": true,
      "ciphertext": null,
      "nonce_b64u": null
    }
  ]
}
```

#### Mutation Rules
- For **new records**, `expected_revision` must be `0`.
- For **updates and deletions**, `expected_revision` must match the client's current base revision.
- For **tombstones (deletions)**, `is_tombstone` is `true`, `ciphertext` is `null`, and `nonce_b64u` is `null`.

#### Response `200 OK`
```json
{
  "results": [
    {
      "mutation_id": "e6a2b8e3-0d3e-4b67-891a-7b3c2e1d0f5a",
      "record_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
      "revision": 1,
      "change_seq": 45,
      "status": "applied"
    },
    {
      "mutation_id": "c1f7a4b9-8e2d-4567-9abc-123456789abc",
      "record_id": "4a2b9184-25e2-4f36-9e1e-28b3a72013f9",
      "revision": 4,
      "change_seq": 46,
      "status": "applied"
    }
  ],
  "new_cursor": 46
}
```

#### Revision Conflict (`409 REVISION_CONFLICT`)
If any mutation fails its CAS revision check (`expected_revision != current_revision`), the entire batch transaction is rolled back and returns `409 REVISION_CONFLICT` containing the latest server record state (see §3.3).

> Open question Q7: see Open Questions Register in `docs/product/acceptance.md`.

#### Possible Error Responses
- `400 VALIDATION_ERROR`: Body malformed, missing fields, or empty mutation list.
- `401 DEVICE_UNAUTHORIZED` / `401 DEVICE_REVOKED`: Token invalid or revoked.
- `401 INVALID_SIGNATURE`: Ed25519 signature verification failure.
- `401 STALE_TIMESTAMP`: Request timestamp outside ±5-minute window.
- `404 VAULT_NOT_FOUND`: Vault does not exist.
- `409 REVISION_CONFLICT`: Expected revision mismatch.
- `409 REPLAY_DETECTED`: Reused mutation ID with different ciphertext payload.
- `413 PAYLOAD_TOO_LARGE`: Record > 384 KiB, batch > 50 mutations, or body > 1 MiB.
- `429 RATE_LIMITED`: Exceeded 120 batches per vault per hour.
- `503 QUOTA_EXHAUSTED`: Cloudflare D1 write quota exceeded.

---

### 6.5 `POST /api/v1/pairing-tickets` — Create Pairing Ticket
*PRD §11 (line 457), §FR-5 (G3 step 1), Appendix B.*

Called by an existing, authorized, unlocked device (Device A) to initiate the pairing of a new device.

- **Authentication:** Valid device bearer token + valid `PV-Device` signature.
- **Rate Limit:** 5 requests per device per hour.
- **Lifespan:** Exactly **5 minutes** (300 seconds).
- **Single-Active-Ticket Invariant:** At most one unconsumed, unexpired pairing ticket may exist per vault. Creating a new ticket immediately invalidates/supersedes any previous ticket (PRD §FR-5, lines 227, 436).

#### Request Body
Device A generates 256 bits of cryptographically secure random entropy locally (`ticket`), computes `ticket_hash = SHA-256(ticket)`, and sends **only** `ticket_hash`:
```json
{
  "ticket_hash": "a591a6d40bf420404a011733cfb7b190d62c65bf0bcda32b57b277d9ad9f146e"
}
```

#### Response `201 Created`
```json
{
  "ticket_id": "7b231920-80d5-4e78-9e12-3210ab45c678",
  "expires_at": "2026-10-13T12:05:00.000Z"
}
```

Device A displays the raw ticket to the user as a QR code containing `{ "vault_id": "...", "api_origin": "...", "ticket": "..." }` and a manual grouped Base32 fallback code.

#### Possible Error Responses
- `400 VALIDATION_ERROR`: Malformed hash or missing parameter.
- `401 DEVICE_UNAUTHORIZED` / `401 DEVICE_REVOKED` / `401 INVALID_SIGNATURE` / `401 STALE_TIMESTAMP`.
- `404 VAULT_NOT_FOUND`.
- `429 RATE_LIMITED`: Exceeded 5 requests per device per hour.

---

### 6.6 `POST /api/v1/pairing/exchange` — Exchange Ticket for Device Registration
*PRD §11 (line 458), §FR-5 (G3 step 2), Appendix B.*

Called by a new, unauthorized device (Device B) that has scanned or typed the one-time pairing ticket.

- **Authentication:** None (authorized via knowledge of the 256-bit pairing ticket).
- **Rate Limit:** 10 requests per vault per hour.
- **Atomic Single-Use Invariant:** Server checks hash match, validates expiry (`< 5 minutes`), verifies unconsumed status, and consumes the ticket in the same transaction. The ticket cannot be reused.

#### Request Body
Device B generates its own Ed25519 keypair and `device_id` locally, then submits:
```json
{
  "vault_id": "01J9Z8QK7M3V6P2R5T8W4Y6U1A",
  "ticket": "dGhpcy1pcy1hLTI1Ni1iaXQtcGFpcmluZy10aWNrZXQ",
  "device_id": "c3d4e5f6-a7b8-4901-c2d3-e4f5a6b7c8d9",
  "device_public_key": "vK7...ed25519_pub_32_bytes_b64u...",
  "label": "Pixel 8 Phone"
}
```

#### Server Action
1. Computes `ticket_hash = SHA-256(ticket)`.
2. Locates active ticket for `vault_id`.
3. If not found or hash mismatch -> `400 TICKET_INVALID`.
4. If expired (`now > expires_at`) -> `410 TICKET_EXPIRED`.
5. If already consumed -> `410 TICKET_CONSUMED`.
6. Generates 256-bit device bearer token server-side.
7. Stores `SHA-256(device_token)`, `device_public_key`, `device_id`, `label`, and records `last_seen` timestamp.
8. Atomically sets `consumed_at = now()` on the ticket.
9. Returns the raw device bearer token **once** in the response.

#### Response `201 Created`
```json
{
  "vault_id": "01J9Z8QK7M3V6P2R5T8W4Y6U1A",
  "device_id": "c3d4e5f6-a7b8-4901-c2d3-e4f5a6b7c8d9",
  "device_token": "aW1wb3J0YW50LTI1Ni1iaXQtYmVhcmVyLXRva2VuIQ",
  "created_at": "2026-10-13T12:02:00.000Z"
}
```

Device B stores the bearer token in memory only, immediately calls `GET /api/v1/vaults/:vaultId/bootstrap` to retrieve the master envelope, prompts the user for the master passphrase to unwrap the DEK, and re-encrypts the token and its private signing key locally before writing to IndexedDB.

#### Possible Error Responses
- `400 VALIDATION_ERROR`: Missing or malformed parameters.
- `400 TICKET_INVALID`: Ticket hash unknown or vault mismatch.
- `404 VAULT_NOT_FOUND`: Specified vault does not exist.
- `410 TICKET_EXPIRED`: Ticket is past 5-minute lifespan.
- `410 TICKET_CONSUMED`: Ticket was already consumed or superseded.
- `429 RATE_LIMITED`: Exceeded 10 requests per vault per hour.

---

### 6.7 `POST /api/v1/devices/:deviceId/revoke` — Revoke Authorized Device
*PRD §11 (line 459), §FR-5, Appendix B.*

Revokes an authorized device. Once committed, the revoked device is immediately rejected on all endpoints.

- **Authentication:** Valid device bearer token + valid `PV-Device` signature.
- **Idempotency:** Calling revoke on an already-revoked device is safe and returns `200 OK`.
- **URL Parameters:**
  - `deviceId`: RFC 4122 UUIDv4 of the device to revoke.
- **Request Headers:**
  - `Authorization: Bearer <device_bearer_token>`
  - `PV-Device: device_id="...", timestamp="...", nonce="...", signature="..."`

#### Request Body
Empty object `{}` or omitted.

#### Response `200 OK`
```json
{
  "device_id": "c3d4e5f6-a7b8-4901-c2d3-e4f5a6b7c8d9",
  "revoked_at": "2026-10-13T12:10:00.000Z",
  "status": "revoked"
}
```

#### Revocation Guarantees & Limitations (PRD §FR-5, lines 230, 376)
- The revoked device can never again authenticate to the API. Subsequent calls return `401 DEVICE_REVOKED`.
- Revocation cannot retroactively erase ciphertext already downloaded and cached locally on that device.

#### Possible Error Responses
- `400 VALIDATION_ERROR`: Malformed `deviceId` UUID.
- `401 DEVICE_UNAUTHORIZED` / `401 DEVICE_REVOKED` / `401 INVALID_SIGNATURE` / `401 STALE_TIMESTAMP`.
- `404 VAULT_NOT_FOUND`: Device or vault not found.
- `429 RATE_LIMITED`: Standard abuse limits.

---

### 6.8 `PUT /api/v1/vault/crypto-metadata` — Update Master/Recovery Envelopes
*PRD §11 (line 460), §FR-6 (G8), Appendix B, Appendix D.*

Updates the master-password key envelope (e.g. after a master passphrase change) or rotates recovery envelope metadata.

> **MASTER PASSPHRASE CHANGE SCOPE (PRD §FR-6 G8):**  
> A passphrase change updates **only** the `master_envelope` (new salt, new Argon2id parameters, new nonce, re-wrapped DEK). The `recovery_envelope` is **not touched** because it wraps the same DEK under the independent recovery secret. The recovery envelope is updated only during explicit recovery-kit rotation.

- **Authentication:** Valid device bearer token + valid `PV-Device` signature.
- **Rate Limit:** 10 requests per vault per hour.
- **Request Headers:**
  - `Content-Type: application/json`
  - `Authorization: Bearer <device_bearer_token>`
  - `PV-Device: device_id="...", timestamp="...", nonce="...", signature="..."`

#### Request Body
```json
{
  "expected_crypto_format_version": 1,
  "expected_key_version": 1,
  "master_envelope": {
    "crypto_format_version": 1,
    "key_version": 1,
    "kdf_version": 1,
    "argon2_m_kib": 131072,
    "argon2_t": 4,
    "argon2_p": 1,
    "salt_b64u": "n3W...new_salt_16_bytes_b64u...",
    "nonce_b64u": "yT9...new_nonce_24_bytes_b64u...",
    "wrapped_dek_b64u": "vR4...re_wrapped_dek_b64u..."
  },
  "recovery_envelope": null,
  "recovery_auth_verifier": null
}
```

> Open question Q3: see Open Questions Register in `docs/product/acceptance.md`.

#### Response `200 OK`
```json
{
  "vault_id": "01J9Z8QK7M3V6P2R5T8W4Y6U1A",
  "crypto_format_version": 1,
  "key_version": 1,
  "updated_at": "2026-10-13T12:15:00.000Z"
}
```

#### Possible Error Responses
- `400 VALIDATION_ERROR`: Missing envelope fields.
- `400 CRYPTO_VERSION_UNSUPPORTED`: Argon2id parameters outside allowable bounds.
- `401 DEVICE_UNAUTHORIZED` / `401 DEVICE_REVOKED` / `401 INVALID_SIGNATURE` / `401 STALE_TIMESTAMP`.
- `404 VAULT_NOT_FOUND`.
- `409 VERSION_MISMATCH`: `expected_key_version` or `expected_crypto_format_version` mismatch.
- `429 RATE_LIMITED`: Exceeded 10 requests per vault per hour.

---

### 6.9 `POST /api/v1/recovery/enroll-device` — Enroll Device via Recovery Kit
*PRD §11 (line 461), §FR-7, Appendix B.*

Called when **all previously authorized devices are lost**. Authorizes a clean device using the domain-separated recovery authorization token from the recovery kit.

> **SECURITY INVARIANT (PRD §FR-7, lines 300, 327):**  
> The client sends **only** `recovery_auth_token = HKDF(recovery_secret, "PV-V1/RECOVERY-AUTH")`. The raw `recovery_secret` and the decryption wrapping key `HKDF(recovery_secret, "PV-V1/RECOVERY-WRAP")` are **never transmitted to the server**.

- **Authentication:** Recovery authorization token in request body.
- **Rate Limit:** **5 requests per vault per hour**, with **doubling backoff** after 3 failures (Appendix B). Strictest user-facing limit.
- **Request Headers:**
  - `Content-Type: application/json`

#### Request Body
```json
{
  "vault_id": "01J9Z8QK7M3V6P2R5T8W4Y6U1A",
  "recovery_auth_token": "dGhpcy1pcy1hLXJlY292ZXJ5LWF1dGgtdG9rZW4h",
  "device_id": "e4f5a6b7-c8d9-4012-e3f4-a5b6c7d8e9f0",
  "device_public_key": "kL8...ed25519_pub_32_bytes_b64u...",
  "label": "Recovered Laptop"
}
```

#### Server Action
1. Computes `SHA-256(recovery_auth_token)`.
2. Validates against `recovery_auth_verifier` stored in `vaults` table for `vault_id`.
3. If mismatch -> Returns `401 DEVICE_UNAUTHORIZED` (increments failure backoff counter).
4. Atomically registers the new device with `device_public_key` and generated device bearer token.
5. Returns raw device bearer token **once**.

#### Response `201 Created`
```json
{
  "vault_id": "01J9Z8QK7M3V6P2R5T8W4Y6U1A",
  "device_id": "e4f5a6b7-c8d9-4012-e3f4-a5b6c7d8e9f0",
  "device_token": "bmV3LTI1Ni1iaXQtZGV2aWNlLWJlYXJlci10b2tlbg",
  "created_at": "2026-10-13T12:20:00.000Z"
}
```

#### Subsequent Recovery Steps (PRD §FR-7, lines 328–330)
1. Device calls `GET /api/v1/vaults/:vaultId/bootstrap` using the received bearer token.
2. Device fetches `recovery_envelope` (or recovery envelope is provided via bootstrap in recovery mode).
3. Device unwraps the DEK using `HKDF(recovery_secret, "PV-V1/RECOVERY-WRAP")`.
4. User sets a new master passphrase. Device wraps the DEK with new KDF parameters and updates master envelope via `PUT /api/v1/vault/crypto-metadata`.
5. Device downloads changes from `cursor = 0` via `GET /api/v1/sync`.

> Open question Q7: see Open Questions Register in `docs/product/acceptance.md`.

#### Possible Error Responses
- `400 VALIDATION_ERROR`: Missing fields or invalid UUID/ULID.
- `401 DEVICE_UNAUTHORIZED`: Recovery authorization token invalid.
- `404 VAULT_NOT_FOUND`: Specified vault not found.
- `429 RATE_LIMITED`: Exceeded 5 requests per vault per hour.

---

## 7. Ambiguities & Open Questions Registry

> Open question Q7: see Open Questions Register in `docs/product/acceptance.md`.

> Open question Q1: see Open Questions Register in `docs/product/acceptance.md`.
   *Context:* PRD §11 line 453 specifies "token hash only" for `POST /api/v1/vaults`, implying the client generates the initial device bearer token and sends `SHA-256(token)`. However, pairing exchange (§FR-5 line 238) and recovery enrollment generate tokens server-side and return the raw token once.  
   *Recommendation:* Standardize on server-side generation across all endpoints or confirm client-generated token on initial creation.

> Open question Q2: see Open Questions Register in `docs/product/acceptance.md`.
   *Context:* PRD §FR-5 lines 224–226 requires both device token and Ed25519 signature. Plan `cloud-sync-pairing.md` proposed combining them into `Authorization: PV-Device <device_id>.<ts>.<nonce>.<sig_b64u>`, whereas `docs-split.md` specified `Authorization: Bearer <token>` paired with custom `PV-Device` header.  
   *Recommendation:* Use `Authorization: Bearer <token>` + `PV-Device: device_id="...", timestamp="...", nonce="...", signature="..."` for clean separation of identity and cryptographic assertion.

> Open question Q7: see Open Questions Register in `docs/product/acceptance.md`.
   *Context:* PRD §11 line 456 specifies "atomic DB writes", while conflict resolution (§FR-4) discusses handling revision conflicts per record. If mutation 2 of 10 conflicts, does the entire batch reject with `409 REVISION_CONFLICT` or can non-conflicting mutations commit?  
   *Recommendation:* True atomic execution: reject entire batch with `409 REVISION_CONFLICT` returning conflicting record data, allowing client to reconcile and re-issue batch.

> Open question Q3: see Open Questions Register in `docs/product/acceptance.md`.
   *Context:* PRD §11 lists `PUT /api/v1/vault/crypto-metadata` (singular `vault`, no `:vaultId`).  
   *Recommendation:* Scope vault by the authenticated device token, matching `/api/v1/sync`.

> Open question Q7: see Open Questions Register in `docs/product/acceptance.md`.
   *Context:* Bootstrap explicitly omits `recovery_envelope` for standard security isolation, but an enrolled recovery device requires the recovery envelope to unwrap the DEK.  
   *Recommendation:* Return `recovery_envelope` directly in the `201 Created` payload of `POST /api/v1/recovery/enroll-device`.
