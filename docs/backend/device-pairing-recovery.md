# Device Pairing, Authorization, and Vault Recovery Specification

**Normative Source:** `personal-vault-prd-v3.md` v3.0 (2026-10-13)  
**Status:** Normative Technical Contract  
**Owning Area:** Device Lifecycle, Pairing Protocol, Cryptographic Recovery, and Backup Portability

---

## 1. Overview & Normative Principles

This document specifies the exact protocols, cryptographic boundaries, lifecycle transitions, and data formats for **Device Pairing (FR-5)** and **Vault Recovery & Backup (FR-7)** within Personal Vault.

### 1.1 Normative Invariants

1. **Zero Central Credentials:** There are no user accounts, passwords, email addresses, or admin keys stored on the server (PRD §FR-5, line 218; §FR-7, line 302).
2. **Device Isolation:** Each device possesses an independent 256-bit bearer token and an Ed25519 signing keypair (PRD §FR-5, lines 221, 223).
3. **Privilege Split:** Read-only access requires a valid bearer token; all mutations, pairing tickets, revocations, and metadata changes require an Ed25519 request signature (PRD §FR-5, line 224).
4. **All-Devices-Lost Resilience:** Vault recovery does not rely on active devices. If all devices are permanently lost, the offline recovery kit enables re-authorizing a clean device and decrypting the vault (PRD §FR-7, lines 294–295).
5. **No Plaintext Secrets at Rest or Over the Wire:** Raw tokens, master passphrases, recovery secrets, and private signing keys are never transmitted to the server or persisted in unencrypted form (PRD §FR-5, lines 221, 223; §FR-6, line 256; §FR-7, line 300).

---

## 2. Device Authorization & Identity Model (FR-5)

### 2.1 Cryptographic Identity & Credential Generation

When a device is initialized (during initial vault creation, pairing, or recovery enrollment), it generates two independent credentials locally:

1. **Device Bearer Token:**
   - 256 bits of cryptographically secure random entropy (generated client-side or received once over TLS during registration).
   - Server persists **only** `token_hash = SHA-256(raw_device_token)` in `authorized_devices.token_hash` (PRD §FR-5, line 221; §10, line 426).
   - Raw token is never logged by the Cloudflare Worker or written unencrypted to disk (PRD §9, line 381).
2. **Ed25519 Signing Keypair:**
   - Generated client-side via libsodium (`crypto_sign_keypair`).
   - `public_key`: 32 bytes (base64url-encoded) stored in `authorized_devices.public_key` (PRD §FR-5, line 223).
   - `private_key`: 64 bytes (seed + public key), never leaves the client device.

```
+-----------------------------------------------------------------------------------+
| CLIENT LOCAL STORAGE (Dexie: device_credentials)                                  |
|                                                                                   |
|  - device_id: UUIDv4                                                              |
|  - public_key: Ed25519 public key (32 bytes b64u)                                 |
|  - label: Device-XXXX (string)                                                    |
|  - encrypted_device_token: Encrypted under HKDF(DEK, "PV-V1/LOCAL-CRED")          |
|  - encrypted_private_key:  Encrypted under HKDF(DEK, "PV-V1/LOCAL-CRED")          |
|  - nonce: 24-byte XChaCha20 nonce                                                 |
+-----------------------------------------------------------------------------------+
                                       |
              TLS 1.3 / HTTPS          | Authenticated Requests
                                       v
+-----------------------------------------------------------------------------------+
| CLOUDFLARE D1 (authorized_devices table)                                          |
|                                                                                   |
|  - vault_id: ULID                                                                 |
|  - device_id: UUIDv4                                                              |
|  - token_hash: SHA-256(raw_device_token)                                          |
|  - public_key: Ed25519 public key (32 bytes b64u)                                 |
|  - label: Device-XXXX                                                             |
|  - created_at: ISO-8601 UTC                                                       |
|  - last_used_at: ISO-8601 UTC (server-recorded provenance)                         |
|  - revoked_at: ISO-8601 UTC (NULL until revoked)                                  |
+-----------------------------------------------------------------------------------+
```

### 2.2 Local Credential Wrapping (`device_credentials` Store)

Per PRD §FR-5 (lines 222–223) and §10 (lines 398, 401):
- While locked, client IndexedDB holds credentials encrypted at rest.
- The wrapping key is derived from the Vault Data Encryption Key (DEK):
  $$\text{local\_cred\_key} = \text{HKDF-Extract-and-Expand}(\text{DEK}, \text{salt}=\text{empty}, \text{info}=\text{"PV-V1/LOCAL-CRED"}, \text{len}=32)$$
- The payload containing `(raw_device_token, ed25519_private_key)` is encrypted with `crypto_aead_xchacha20poly1305_ietf_encrypt` using a fresh 24-byte nonce.
- While the vault is locked, the device cannot decrypt its bearer token or signing key, preventing any background synchronization or mutation (PRD §FR-5, line 222).

### 2.3 Ed25519 Request Signing (`PV-Device` Header)

All mutation, pairing ticket creation, envelope updates, and revocation requests require proof of possession of the registered private signing key (PRD §FR-5, lines 224–225; §11, line 456).

#### Header Syntax
```http
Authorization: Bearer <device_bearer_token>
PV-Device: device_id="<UUIDv4>", timestamp="<ISO-8601-UTC>", nonce="<UUIDv4>", signature="<base64url-ed25519-sig>"
```

#### Canonical String to Sign
The client computes an Ed25519 detached signature (`crypto_sign_detached`) over the UTF-8 bytes of:
$$\text{CanonicalString} = \text{HTTP\_METHOD} \parallel \text{"\n"} \parallel \text{REQUEST\_PATH} \parallel \text{"\n"} \parallel \text{TIMESTAMP} \parallel \text{"\n"} \parallel \text{NONCE} \parallel \text{"\n"} \parallel \text{SHA256}(\text{REQUEST\_BODY})$$

Where:
- `HTTP_METHOD`: Uppercase method string (e.g., `POST`, `PUT`).
- `REQUEST_PATH`: Canonical path with leading slash (e.g., `/api/v1/sync/batch`).
- `TIMESTAMP`: ISO-8601 UTC string (e.g., `2026-10-13T12:00:00.000Z`).
- `NONCE`: UUIDv4 string generated per request (or mutation ID for idempotent retries).
- `SHA256(REQUEST_BODY)`: Hexadecimal or base64url digest of the exact request body bytes. For empty bodies, the digest of empty string `""`.

#### Server-Side Signature Verification Rules
1. **Token Match:** Lookup `token_hash = SHA-256(BearerToken)`. Verify device is authorized and `revoked_at IS NULL`.
2. **Identity Alignment:** Verify `device_id` in `PV-Device` matches the authenticated record.
3. **Clock Window:** Verify server time $\Delta t = |t_{\text{server}} - t_{\text{request}}| \le 300\text{ seconds}$ (±5 minutes). If violated, return `401 STALE_TIMESTAMP` with `X-Server-Time: <ISO-8601-UTC>` (PRD Appendix A, line 714).
4. **Replay Protection:** Verify `(device_id, nonce)` has not been seen within the rolling 5-minute window with a different body digest. If reused with different body, return `409 REPLAY_DETECTED` (PRD Appendix A, line 715).
5. **Cryptographic Check:** Verify signature using registered `authorized_devices.public_key`. On mismatch, return `401 INVALID_SIGNATURE`.

### 2.4 Device Labeling & Identification

Per User Decision (2026-10-13) and PRD §FR-5 (line 229):
- **Automatic Default:** On initialization/exchange, the device assigns itself an auto-generated label following pattern `Device-XXXX` (where `XXXX` is the first 4 uppercase hex characters of the device UUIDv4, e.g. `Device-4F8A`).
- **User Rename:** The user can rename any device in Settings (`Settings > Authorized Devices`).
- **Privacy Boundary:** No browser user-agent strings, hardware fingerprints, battery levels, or screen resolutions are harvested or transmitted (PRD §FR-5, line 229).

### 2.5 Server-Recorded `last_used_at` Provenance

Per PRD §FR-5 (lines 242–244) and §10 (line 429):
- Every authenticated API request updates `authorized_devices.last_used_at` with the current UTC server time.
- The client cannot write or override `last_used_at`.
- This timestamp is displayed in the Authorized Devices list so the vault owner can detect dormant, stolen, or suspicious device sessions. Disclosed as server-visible metadata (PRD §9, line 375).

---

## 3. Four-Step Device Pairing Protocol (FR-5)

### 3.1 Overview & State Invariants

Pairing authorizes a new device (Device B) from an existing, unlocked device (Device A) without entering the master passphrase on Device A or exposing vault encryption keys across the network.

- **Ticket Lifespan:** Exactly **5 minutes** (300 seconds) (PRD §FR-5, lines 226, 237).
- **Entropy:** 256 bits of cryptographically secure random entropy (PRD §FR-5, line 237).
- **Single-Active Invariant:** At most one unconsumed, unexpired pairing ticket may exist per vault. Creating a second ticket immediately invalidates/supersedes any prior ticket (PRD §FR-5, lines 227, 436). Enforced by partial unique index:
  ```sql
  CREATE UNIQUE INDEX idx_pairing_tickets_single_active 
  ON pairing_tickets (vault_id) 
  WHERE consumed_at IS NULL;
  ```
- **Single-Use Consumption:** The ticket is atomically consumed during exchange. Once consumed, it cannot be reused (PRD §FR-5, lines 226, 240).

---

### 3.2 Protocol Sequence Diagram

```
Device A (Authorized + Unlocked)        Cloudflare API / D1              Device B (New Device)
   |                                            |                                   |
   |-- 1. POST /api/v1/pairing-tickets ------->|                                   |
   |   (token + PV-Device sig + ticket_hash)    |                                   |
   |                                            | [Stores ticket_hash,              |
   |                                            |  invalidates old active,          |
   |                                            |  expires_at = now() + 5 min]      |
   |<-- 201 Created { ticket_id, expires_at } --|                                   |
   |                                            |                                   |
   | [Renders QR Code & Base32 code]            |                                   |
   |   { vault_id, api_origin, ticket }         |                                   |
   |                                            |                                   |
   |==================== Out-of-band scan or manual entry =========================>|
   |                                            |                                   |
   |                                            |   [Generates Ed25519 keypair,     |
   |                                            |    device_id, default label]      |
   |                                            |<-- 2. POST /pairing/exchange -----|
   |                                            |   { vault_id, ticket, device_id,  |
   |                                            |     device_public_key, label }    |
   |                                            |                                   |
   |                                            | [Atomically:                      |
   |                                            |  Verify SHA-256(ticket) matches,  |
   |                                            |  Verify now < expires_at,         |
   |                                            |  Verify consumed_at IS NULL,      |
   |                                            |  Set consumed_at = now(),         |
   |                                            |  Generate device_token,           |
   |                                            |  Store token_hash & public_key]   |
   |                                            |-- 201 Created { device_token } -->|
   |                                            |   (token sent once in body)       |
   |                                            |                                   |
   |                                            |<-- 3. GET /vaults/:id/bootstrap --|
   |                                            |   (Authorization: Bearer token)   |
   |                                            |-- 200 OK { master_envelope } ---->|
   |                                            |                                   |
   |                                            |   [User enters master password]   |
   |                                            |   [Derives KEK via Argon2id]      |
   |                                            |   [Unwraps DEK via KEK]           |
   |                                            |   [Encrypts token + privkey       |
   |                                            |    under HKDF(DEK, LOCAL-CRED)]   |
   |                                            |   [Writes to Dexie]               |
   |                                            |                                   |
   |                                            |<-- 4. GET /sync?cursor=0 ---------|
   |                                            |-- 200 OK { records, cursor } ---->|
   |                                            |                                   |
   |                                            |   [Populates local IndexedDB,     |
   |                                            |    builds MiniSearch index,       |
   |                                            |    opens dashboard]               |
```

---

### 3.3 Step-by-Step Execution Details

#### Step 1: Ticket Creation (Device A)
1. Device A verifies the vault is unlocked.
2. Device A generates 32 random bytes: $\text{ticket} \leftarrow \text{random\_bytes}(32)$.
3. Device A calculates $\text{ticket\_hash} = \text{SHA-256}(\text{ticket})$.
4. Device A signs request and invokes:
   ```http
   POST /api/v1/pairing-tickets
   Authorization: Bearer <device_A_token>
   PV-Device: device_id="...", timestamp="...", nonce="...", signature="..."
   Content-Type: application/json

   {
     "ticket_hash": "a591a6d40bf420404a011733cfb7b190d62c65bf0bcda32b57b277d9ad9f146e"
   }
   ```
5. Server transaction:
   - Rate limit check: max 5 requests per device per hour (Appendix B, line 736).
   - Any prior record in `pairing_tickets` for `vault_id` where `consumed_at IS NULL` is deleted or marked superseded (`consumed_at = now()`).
   - Inserts new ticket with `expires_at = now() + 300s`.
6. Server responds with `201 Created` (`{ ticket_id, expires_at }`).
7. Device A displays payload:
   - **QR Code:** Encodes JSON string:
     ```json
     {
       "vault_id": "01J9Z8QK7M3V6P2R5T8W4Y6U1A",
       "api_origin": "https://personal-vault.pages.dev",
       "ticket": "dGhpcy1pcy1hLTI1Ni1iaXQtcGFpcmluZy10aWNrZXQ"
     }
     ```
   - **Manual Fallback Code:** Base32 string (RFC 4648, uppercase, grouped in 4 characters, e.g. `MZXW-6YTB-OI2G-ENRS-...`) representing the same 32 raw bytes of `ticket`.
8. UI countdown displays remaining time of the 5-minute window.

#### Step 2: Ticket Exchange (Device B)
1. Device B opens the app in clean/unauthorized state and selects "Pair Existing Vault".
2. User scans QR code or manually inputs `api_origin`, `vault_id`, and Base32 `ticket`.
3. Device B generates its cryptographic materials locally:
   - `device_id = crypto.randomUUID()`
   - `(public_key, private_key) = crypto_sign_keypair()`
   - `label = "Device-" + device_id.substring(0, 4).toUpperCase()` (editable by user).
4. Device B calls public exchange endpoint:
   ```http
   POST /api/v1/pairing/exchange
   Content-Type: application/json

   {
     "vault_id": "01J9Z8QK7M3V6P2R5T8W4Y6U1A",
     "ticket": "dGhpcy1pcy1hLTI1Ni1iaXQtcGFpcmluZy10aWNrZXQ",
     "device_id": "c3d4e5f6-a7b8-4901-c2d3-e4f5a6b7c8d9",
     "device_public_key": "vK7...ed25519_pub_32_bytes_b64u...",
     "label": "Device-C3D4"
   }
   ```
5. Server transaction:
   - Rate limit check: max 10 requests per vault per hour (Appendix B, line 737).
   - Computes `SHA-256(ticket)` and checks `pairing_tickets`.
   - If not found: `400 TICKET_INVALID`.
   - If `now() > expires_at`: `410 TICKET_EXPIRED`.
   - If `consumed_at IS NOT NULL`: `410 TICKET_CONSUMED`.
   - Atomically updates `consumed_at = now()`.
   - Generates 256-bit `device_token = random_bytes(32)`.
   - Stores `SHA-256(device_token)`, `device_public_key`, `device_id`, `label`, `created_at`, `last_used_at = now()`.
   - Returns `201 Created` with raw `device_token` in body.

#### Step 3: Vault Bootstrap & Local Credential Wrap (Device B)
1. Device B holds raw `device_token` in memory only.
2. Device B requests bootstrap envelope:
   ```http
   GET /api/v1/vaults/01J9Z8QK7M3V6P2R5T8W4Y6U1A/bootstrap
   Authorization: Bearer <device_token>
   ```
3. Server returns `200 OK` containing `master_envelope` (salt, Argon2id parameters, nonce, wrapped DEK) and format versions (PRD §11, line 454).
4. Device B prompts user for Master Passphrase (minimum 8 characters).
5. Device B validates Argon2id parameters:
   - Memory `m >= 65536 KiB` (64 MiB floor) and `m <= 524288 KiB` (512 MiB ceiling).
   - Time `t >= 3` and `t <= 5`.
   - Parallelism `p >= 1` and `p <= 4`.
   - If invalid, aborts with `CRYPTO_VERSION_UNSUPPORTED`.
6. Device B derives KEK:
   $$\text{KEK} = \text{Argon2id13}(\text{passphrase}, \text{salt}, t, m, p, \text{keylen}=32)$$
7. Device B unwraps DEK:
   $$\text{DEK} = \text{crypto\_aead\_xchacha20poly1305\_ietf\_decrypt}(\text{wrapped\_dek}, \text{aad}=\text{""}, \text{nonce}, \text{KEK})$$
   If decryption fails (wrong password), Device B prompts again; fails closed, does not persist corrupt state (PRD §FR-6, line 285).
8. Device B wraps local credentials:
   $$\text{local\_key} = \text{HKDF}(\text{DEK}, \text{"PV-V1/LOCAL-CRED"})$$
   $$\text{enc\_token} = \text{Encrypt}(\text{raw\_device\_token}, \text{local\_key})$$
   $$\text{enc\_privkey} = \text{Encrypt}(\text{ed25519\_private\_key}, \text{local\_key})$$
9. Device B commits `enc_token`, `enc_privkey`, `device_id`, `public_key`, `label` into Dexie store `device_credentials`. Raw secrets in memory are zeroed/garbage collected.

#### Step 4: Initial Sync (Device B)
1. Device B calls `GET /api/v1/sync?cursor=0` with `Authorization: Bearer <device_token>`.
2. Downloads ciphertext pages, verifies AAD:
   $$\text{AAD} = \text{vault\_id} \parallel \text{record\_id} \parallel \text{schema\_version} \parallel \text{key\_version} \parallel \text{"record"}$$
3. Commits records and updates local cursor in Dexie transaction.
4. Populates in-memory MiniSearch index with decrypted records.
5. Transitions UI to unlocked dashboard.

---

## 4. Device Revocation Semantics (FR-5)

### 4.1 Revocation Endpoint & Execution

An authorized, unlocked device can revoke any device registered to the vault (including itself or other devices) via:

```http
POST /api/v1/devices/:deviceId/revoke
Authorization: Bearer <device_bearer_token>
PV-Device: device_id="...", timestamp="...", nonce="...", signature="..."
Content-Type: application/json

{}
```

#### Processing Rules
1. Server verifies token, device signature, and timestamps.
2. Server executes atomic update on `authorized_devices`:
   ```sql
   UPDATE authorized_devices 
   SET revoked_at = datetime('now') 
   WHERE vault_id = ? AND device_id = ? AND revoked_at IS NULL;
   ```
3. **Idempotency:** If the target device was already revoked, the operation returns `200 OK` (`status: "revoked"`) without error.
4. **Self-Revocation:** If a device revokes itself, the server commits revocation; subsequent requests from that device are rejected immediately.

### 4.2 Security Guarantees & Inherent Limitations

- **Immediate API Cut-off:** Once committed in D1, any request presenting the revoked device's token immediately returns `401 DEVICE_REVOKED` (PRD Appendix A, line 712). The client must halt sync and surface a persistent "Device Revoked" banner.
- **Local Ciphertext Limitation:** Revocation cannot reach across the network to erase or sanitize local IndexedDB storage on a remote or offline device (PRD §FR-5, line 230; §9, line 376). Ciphertext cached locally remains subject to the passphrase security of that device.
- **Token Invalidation:** Revoked tokens cannot create pairing tickets or submit mutations.

---

## 5. Vault Recovery Protocol (FR-7)

### 5.1 Architecture: Why Recovery Kits Are Necessary

In Personal Vault, there are no administrative master accounts. Furthermore, **the master passphrase alone cannot register a new device if all authorized devices are lost** (PRD §FR-7, line 302). 

Registration of a new device requires either:
1. An active authorized device creating a signed pairing ticket (FR-5), OR
2. A valid Recovery Authorization Token derived from the offline Recovery Secret (FR-7).

If all active devices are destroyed or browser storage is evicted on iOS Safari (PRD §5, line 75), the Recovery Kit is the **only** mechanism that permits re-entry into the cloud vault.

### 5.2 Cryptographic Key Separation (FR-7)

From a single 256-bit random `recovery_secret`, two cryptographically independent values are derived using domain-separated HKDF labels (PRD §FR-7, line 299; §FR-6, line 271):

1. **Recovery Wrapping Key (`RECOVERY-WRAP`):**
   $$\text{K}_{\text{rec\_wrap}} = \text{HKDF-Extract-and-Expand}(\text{recovery\_secret}, \text{salt}=\text{empty}, \text{info}=\text{"PV-V1/RECOVERY-WRAP"}, \text{len}=32)$$
   - Used client-side to encrypt the DEK during vault setup/rotation into the `recovery_envelope`.
   - Never sent to the server.
2. **Recovery Authorization Token (`RECOVERY-AUTH`):**
   $$\text{T}_{\text{rec\_auth}} = \text{HKDF-Extract-and-Expand}(\text{recovery\_secret}, \text{salt}=\text{empty}, \text{info}=\text{"PV-V1/RECOVERY-AUTH"}, \text{len}=32)$$
   - Sent to the server over TLS during recovery enrollment (`POST /api/v1/recovery/enroll-device`).
3. **Recovery Authorization Verifier:**
   $$\text{V}_{\text{rec}} = \text{SHA-256}(\text{T}_{\text{rec\_auth}})$$
   - Stored in D1 table `vaults.recovery_auth_verifier`.
   - Verifies the client's authority to enroll without the server learning $\text{T}_{\text{rec\_auth}}$ in storage, and without anyone learning $\text{recovery\_secret}$ or $\text{K}_{\text{rec\_wrap}}$.

---

### 5.3 Recovery Kit File Specification (Appendix C)

- **File Name:** `personal-vault-recovery-kit.json`
- **MIME Type:** `application/json`
- **Encoding:** UTF-8 JSON without byte order mark (BOM)
- **Design Intent:** Plaintext JSON so a user on an unconfigured machine can inspect and read it without specialized tools (PRD §FR-7, line 308).

```json
{
  "format": "personal-vault-recovery-kit",
  "version": 1,
  "vault_id": "01J9Z8QK7M3V6P2R5T8W4Y6U1A",
  "api_origin": "https://personal-vault.pages.dev",
  "recovery_secret": "dGhpcy1pcy1hbi1leGFtcGxlLTI1Ni1iaXQtc2VjcmV0ISE",
  "created_at": "2026-10-13T00:00:00Z",
  "instructions": "Open api_origin, choose Recover, enter vault_id and recovery_secret (or its base32 manual code). Keep this file offline."
}
```

#### Field Validation Rules on Recovery Import (Appendix C, line 761)
1. `format`: Must match `"personal-vault-recovery-kit"` exactly.
2. `version`: Integer `1`.
3. `vault_id`: Non-empty opaque string (ULID format).
4. `api_origin`: Valid HTTPS origin URL matching deployment domain.
5. `recovery_secret`: Must decode from base64url into exactly 32 bytes (256 bits).

#### Base32 Manual Fallback Representation
- RFC 4648 Base32 alphabet (A–Z, 2–7), uppercase, unpadded.
- Formatted in 4-character hyphen-separated groups for human transcription:
  `XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX`
- Must round-trip to the exact 32 bytes of `recovery_secret` (PRD §FR-7, line 322; Appendix C, line 761).

#### Type-to-Confirm Gate
During vault creation and recovery kit rotation, the application **blocks completion** behind an unavoidable confirmation gate:
1. User must download `personal-vault-recovery-kit.json` or copy the Base32 manual code.
2. User must tick: `[x] I have saved this recovery kit offline in a secure location`.
3. User must type the confirmation phrase: `"CONFIRM"` (or `"SIMPAN"` in Indonesian locale) OR paste the recovery secret before the vault is activated or old recovery metadata is overwritten (PRD §FR-7, line 322; §14, line 545).

---

### 5.4 All-Devices-Lost Recovery Flow (FR-7)

When all authorized devices are destroyed, lost, or cleared by OS eviction:

```
Clean Browser / Device                     Cloudflare API / D1
       |                                            |
       |-- 1. User inputs vault_id + secret --------|
       |   (Loads recovery-kit.json or Base32)      |
       |                                            |
       |   [Derives T_rec_auth = HKDF(secret,       |
       |    "PV-V1/RECOVERY-AUTH")]                 |
       |   [Generates device_id & Ed25519 keypair]  |
       |                                            |
       |-- 2. POST /recovery/enroll-device -------->|
       |   { vault_id, recovery_auth_token,         |
       |     device_id, device_public_key, label }  |
       |                                            | [Checks SHA-256(T_rec_auth) matches,
       |                                            |  Rate limit: 5/hr with doubling backoff,
       |                                            |  Registers new device in D1,
       |                                            |  Generates new device_token]
       |<-- 201 Created { device_token, ------------|
       |     recovery_envelope }                    |
       |                                            |
       |   [Derives K_rec_wrap = HKDF(secret,       |
       |    "PV-V1/RECOVERY-WRAP")]                 |
       |   [Unwraps DEK from recovery_envelope]     |
       |                                            |
       |-- 3. User sets new Master Passphrase ------|
       |   [Calibrates Argon2id (Rec/Mobile)]       |
       |   [Wraps DEK into new master_envelope]     |
       |                                            |
       |-- 4. PUT /api/v1/vault/crypto-metadata --->|
       |   (token + PV-Device sig + new master_env) |
       |<-- 200 OK ---------------------------------|
       |                                            |
       |   [Wraps token + privkey under LOCAL-CRED] |
       |   [Saves credentials to Dexie]             |
       |                                            |
       |-- 5. GET /api/v1/sync?cursor=0 ----------->|
       |<-- 200 OK { records, cursor } -------------|
       |   [Decrypts records, builds search index]  |
       |   [Opens Vault Dashboard]                  |
```

#### Detailed Execution Steps
1. **Initiation:** User navigates to deployed app URL (`api_origin`) and chooses "Recover Vault". User uploads `personal-vault-recovery-kit.json` or enters `vault_id` and Base32 code.
2. **Device Enrollment:**
   - Client calculates $\text{T}_{\text{rec\_auth}} = \text{HKDF}(\text{recovery\_secret}, \text{"PV-V1/RECOVERY-AUTH"})$.
   - Client generates new `device_id` and Ed25519 keypair.
   - Client invokes `POST /api/v1/recovery/enroll-device` (PRD §11, line 461; Appendix B, line 738).
   - Server checks rate limit: **5 requests per vault per hour**, with doubling backoff after 3 consecutive failures.
   - Server verifies $\text{SHA-256}(\text{T}_{\text{rec\_auth}}) == \text{vaults.recovery\_auth\_verifier}$.
   - Server registers the new device and returns `201 Created` with `device_token` and the `recovery_envelope`.
> Open question Q7: see Open Questions Register in `docs/product/acceptance.md`.
3. **DEK Decryption:**
   - Client derives $\text{K}_{\text{rec\_wrap}} = \text{HKDF}(\text{recovery\_secret}, \text{"PV-V1/RECOVERY-WRAP"})$.
   - Client unwraps DEK using `crypto_aead_xchacha20poly1305_ietf_decrypt`.
   - If decryption fails: client halts; existing downloaded ciphertext is kept intact without overwriting (PRD §FR-7, line 331).
4. **Master Passphrase Reset:**
   - Client prompts user to enter a new master passphrase (minimum 8 characters).
   - Client derives new KEK with fresh salt and Argon2id parameters.
   - Client re-wraps DEK under the new KEK.
   - Client calls `PUT /api/v1/vault/crypto-metadata` with the new `master_envelope`.
5. **Local Persistence & Resync:**
   - Client encrypts device token and private signing key under local key derived from DEK (`PV-V1/LOCAL-CRED`).
   - Client performs initial sync from `cursor = 0`, builds search index, and displays dashboard.

---

### 5.5 Master Passphrase Change vs Recovery Rotation

Per PRD §FR-6 (lines 288–290) and §FR-7 (lines 322, 329):

| Dimension | Master Passphrase Change | Recovery Kit Rotation |
|---|---|---|
| **Trigger** | User updates password in Settings. | User chooses "Rotate Recovery Kit" in Settings. |
| **Envelopes Updated** | `master_envelope` **ONLY**. | `recovery_envelope` and `recovery_auth_verifier`. |
| **Effect on Recovery** | Recovery envelope is **untouched**. Existing recovery kit continues to work seamlessly. | Old recovery kit is immediately invalidated; new kit is required. |
| **Effect on DEK / Data** | Same DEK re-wrapped. Vault record ciphertexts are **not** re-encrypted. | Same DEK re-wrapped. Vault record ciphertexts are **not** re-encrypted. |
| **Historical Exports** | Old backups remain decryptable with the **old** passphrase. | Old backups remain decryptable with the **old** recovery secret. |
| **UI Disclosure** | Must state: (a) old exports decrypt with old password, (b) already-downloaded ciphertext is unaffected, (c) rotate recovery kit to fully sever access. | Must require Type-to-Confirm gate before committing server update. |

#### Recovery Rotation Procedure
1. User clicks "Rotate Recovery Kit" in Settings.
2. Client generates fresh 256-bit `new_recovery_secret`.
3. Client derives new `RECOVERY-WRAP` key and wraps the existing DEK with a fresh 24-byte nonce.
4. Client derives new `RECOVERY-AUTH` token and computes `new_verifier = SHA-256(new_auth_token)`.
5. Client prompts user with the Type-to-Confirm gate and downloads `personal-vault-recovery-kit.json`.
6. Once confirmed, client submits:
   ```http
   PUT /api/v1/vault/crypto-metadata
   Authorization: Bearer <device_token>
   PV-Device: device_id="...", timestamp="...", nonce="...", signature="..."
   Content-Type: application/json

   {
     "expected_crypto_format_version": 1,
     "expected_key_version": 1,
     "master_envelope": null,
     "recovery_envelope": {
       "crypto_format_version": 1,
       "key_version": 1,
       "nonce_b64u": "...",
       "wrapped_dek_b64u": "..."
     },
     "recovery_auth_verifier": "..."
   }
   ```
7. Server atomically updates the recovery columns. Old recovery secret cannot authorize device enrollment.

---

## 6. Encrypted Export and Data Portability (FR-7)

### 6.1 Export File Format (`personal-vault-export-YYYYMMDD.json`)

Per PRD §FR-7 (lines 333–341) and §13 (line 508):
- **File Name:** `personal-vault-export-YYYYMMDD.json` (e.g., `personal-vault-export-20261013.json`).
- **Encoding:** UTF-8 JSON.
- **Security Rule:** Export contains **only ciphertext and envelopes**. It contains **zero** raw recovery secrets, zero plaintext items, and zero device tokens (PRD §FR-7, line 335).

#### Export JSON Structure
```json
{
  "format": "personal-vault-export",
  "format_version": 1,
  "vault_id": "01J9Z8QK7M3V6P2R5T8W4Y6U1A",
  "exported_at": "2026-10-13T12:00:00.000Z",
  "app_version": "1.0.0",
  "crypto_metadata": {
    "crypto_format_version": 1,
    "key_version": 1,
    "master_envelope": {
      "kdf_version": 1,
      "argon2_m_kib": 131072,
      "argon2_t": 4,
      "argon2_p": 1,
      "salt_b64u": "...",
      "nonce_b64u": "...",
      "wrapped_dek_b64u": "..."
    },
    "recovery_envelope": {
      "crypto_format_version": 1,
      "key_version": 1,
      "nonce_b64u": "...",
      "wrapped_dek_b64u": "..."
    }
  },
  "records": [
    {
      "record_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
      "schema_version": 1,
      "key_version": 1,
      "revision": 3,
      "is_tombstone": false,
      "ciphertext": "U2FsdGVkX1+vuppp...",
      "nonce_b64u": "dGhpcy1pcy1hLTI0LWJ5dGUtbm9uY2U",
      "updated_at": "2026-10-13T11:45:00.000Z"
    }
  ]
}
```

### 6.2 Dual-Key Restorability Matrix

The encrypted export can be unlocked on a fresh browser profile using either credential:

1. **Restore with Master Passphrase:** Client parses `crypto_metadata.master_envelope`, derives KEK via Argon2id, and unwraps the DEK.
2. **Restore with Recovery Secret:** Client parses `crypto_metadata.recovery_envelope`, derives `PV-V1/RECOVERY-WRAP` key, and unwraps the DEK.

Once the DEK is restored, all records in the export file are verified against their AAD and decrypted.

### 6.3 Import Rules & Conflict Prevention Gate

Per PRD §FR-7 (lines 337–338):
1. **Pre-Validation:** Client validates JSON schema, checks `format == "personal-vault-export"`, verifies format versions, and ensures no individual record ciphertext exceeds 384 KiB.
2. **Preview Mode:** Before altering local state, client displays a preview showing:
   - Export timestamp and record count.
   - Tally of items to add, update, or resolve.
3. **Non-Empty Vault Conflict Gate:**
   - If importing into an existing non-empty vault, the app **never overwrites data silently**.
   - The user must explicitly choose:
     - **Merge:** Conflicting records are preserved (e.g. "Keep local as new item" or "Use imported version").
     - **Overwrite Restore:** Replaces local vault data only after explicit type-to-confirm dialog warning of permanent local replacement.

---

## 7. User Decisions & Localization Policy

### 7.1 Master Passphrase Policy
- **Minimum Length:** **8 characters** (`passphrase.length >= 8`) (User Decision 2026-10-13).
- **Entropy & Complexity:** No arbitrary character-class requirements (e.g. requiring special characters or uppercase), but length is strictly enforced.
- **Derivation Parameters:** Argon2id parameters calibrated at vault creation:
  - Desktop default: Recommended ($m=128\text{ MiB}, t=4, p=1$).
  - Auto-fallback: Mobile fallback ($m=64\text{ MiB}, t=3, p=1$) if derivation takes $>3$ seconds during setup benchmark.
  - Hard floor: Minimum ($m=64\text{ MiB}, t=3, p=1$).
  - Hard cap: Maximum ($m=512\text{ MiB}, t=5, p=4$) (PRD §FR-6, line 267).

### 7.2 Bilingual Support (ID + EN)
Per User Decision (2026-10-13):
- Supported languages: Indonesian (`id`) and English (`en`).
- **Default Resolution:** Inspect `navigator.language`. If starts with `id`, use Indonesian; if `en`, use English.
- **Fallback:** Indonesian (`id`) is the default fallback locale for all other system locales.
- **User Override:** Persistent toggle in `Settings > Language` (`Pengaturan > Bahasa`).
- **Confirmation Prompts:**
  - English confirm gate: `"CONFIRM"`
  - Indonesian confirm gate: `"SIMPAN"` or `"KONFIRMASI"`

---

## 8. Ambiguities & Open Questions Registry

> Open question Q7: see Open Questions Register in `docs/product/acceptance.md`.
> *Context:* PRD §FR-7 step 3 states "Client downloads encrypted envelopes and record ciphertext, then uses the recovery secret locally (PV-V1/RECOVERY-WRAP) to unwrap the DEK." However, standard `GET /api/v1/vaults/:vaultId/bootstrap` explicitly omits the recovery envelope to minimize leakage to regular devices. Does `POST /api/v1/recovery/enroll-device` return the `recovery_envelope` directly in its `201 Created` response body, or is there a specialized authenticated endpoint `GET /api/v1/vault/recovery`?  
> *Adopted Specification:* `POST /api/v1/recovery/enroll-device` returns `{ vault_id, device_id, device_token, recovery_envelope, created_at }` directly in the response. This avoids an extra round-trip and eliminates stateful tracking of "recovering" devices on the server.

> Open question Q6: see Open Questions Register in `docs/product/acceptance.md`.
> *Context:* PRD §FR-5 line 229 mandates: "Show authorized devices with a user-entered or minimal local label, creation time, last-seen time, and revoke action." User decisions established that default `Device-XXXX` labels can be renamed. However, PRD §11 does not list an endpoint for updating device labels (e.g., `PATCH /api/v1/devices/:deviceId`).  
> *Adopted Specification:* In the MVP, device labels can be updated locally in Dexie store `device_credentials` for the local device, and synchronized to D1 via an optional `label` parameter during sync or a lightweight `PATCH /api/v1/devices/:deviceId` endpoint. Builder to confirm if remote rename endpoint is in scope for foundations contract or remains local-only.

> Open question Q7: see Open Questions Register in `docs/product/acceptance.md`.
> *Context:* PRD §FR-5 lines 227 & 436 specify that at most one unconsumed pairing ticket may exist per vault, and creating a new ticket invalidates any previous unconsumed ticket. D1 partial unique index `idx_pairing_tickets_single_active` enforces uniqueness of active tickets. When Device A requests a new ticket, does the worker delete prior unconsumed tickets or update `consumed_at = now()`?  
> *Adopted Specification:* The worker runs an atomic transaction that executes `UPDATE pairing_tickets SET consumed_at = datetime('now') WHERE vault_id = ? AND consumed_at IS NULL;` immediately prior to inserting the new ticket. This preserves an audit trail of expired/superseded tickets without violating the unique index.
