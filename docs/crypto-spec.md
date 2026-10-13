# Personal Vault — Cryptographic Specification (v1)

> **Normative Status & Precedence**  
> This document specifies the authoritative cryptographic architecture, key derivation hierarchy, envelope schemas, request signing contracts, and verification rules for Personal Vault.  
>  
> - **Normative Source:** Derived directly from `personal-vault-prd-v3.md` v3.0 (2026-10-13) §2 (Firm product decisions), §8 (FR-1, FR-3, FR-4, FR-5, FR-6, FR-7), §9 (Security model & requirements), §10 (Data model), §11 (API & sync protocol), Appendix C (Recovery-kit file), and Appendix D (Crypto/format versions).  
> - **Precedence Rule:** `personal-vault-prd-v3.md` v3.0 is the sole normative authority. On any discrepancy between this specification and the PRD, the **PRD WINS**.  
> - **Derivation Rule:** Derive strictly from PRD requirements without introducing novel cryptographic semantics. Any unresolved ambiguity is explicitly marked with `> TODO(question): ...`.

---

## 1. System Invariants & Frozen Constants

*Citations: PRD §2 (Item 5, 10, 11), §8 (FR-1, FR-6), §9 (Item 4, 9), Appendix D.*

### 1.1 Frozen Version Identifiers
The following version identifiers are frozen for MVP v1 and must be strictly validated across all client operations and server-side checks:

| Identifier | Value | Storage / Transport Scope | Description | PRD Citation |
|---|---|---|---|---|
| `schema_version` | `1` | Record payload (authoritative) & DB column (triage) | Record schema version for item validation and forward-compatibility checks. | PRD §FR-1 (G5), App. D |
| `crypto_format_version` | `1` | `vaults` envelope & `vault_records` AAD/triage | Cryptographic envelope format (XChaCha20-Poly1305 + HKDF-SHA-256). | PRD §FR-1 (G5), App. D |
| `kdf_version` | `1` | `vaults` master envelope | Key derivation profile format (Argon2id13 parameter set). | PRD §FR-6 (G2), App. D |
| `key_version` | `1` | `vaults` envelope & `vault_records` AAD/triage | Data Encryption Key (DEK) generation counter for rotation tracking. | PRD §FR-6, App. D |

### 1.2 Frozen Size Limits & Overhead Budgets
Client and server must enforce identical size limits to prevent validation mismatches, denial-of-service, or truncated payloads:

| Boundary | Limit (Bytes / Units) | Enforcement Point | Technical Justification | PRD Citation |
|---|---|---|---|---|
| **Plaintext Item Limit** | **256 KiB** (262,144 bytes) | Client pre-encryption; API validator | Maximum serialized UTF-8 JSON plaintext payload per item. Oversized records rejected immediately before encryption. | PRD §FR-1 |
| **Ciphertext Record Cap** | **384 KiB** (393,216 bytes) | Client DB (Dexie); Cloudflare D1 | Maximum base64url ciphertext string per record. Accounts for XChaCha20-Poly1305 overhead (24-byte nonce + 16-byte Poly1305 MAC) and base64url encoding expansion (~33–40%). | PRD §FR-1 (G10) |
| **Sync Batch Payload** | **1 MiB** (1,048,576 bytes) | `POST /api/v1/sync/batch` | Evaluated in raw ciphertext request body bytes. | PRD §FR-4 (G10) |
| **Sync Batch Count** | **50 mutations** | `POST /api/v1/sync/batch` | Maximum mutation count per sync batch request. | PRD §FR-4 |
| **Request Clock Skew** | **±5 minutes** (300 seconds) | API Ed25519 signature verifier | Permissible drift between client timestamp and server `X-Server-Time`. | PRD §FR-5, App. A |
| **Pairing Ticket TTL** | **5 minutes** (300 seconds) | D1 pairing ticket verification | Single-use pairing ticket lifespan. | PRD §FR-5 (G3) |

---

## 2. Cryptographic Primitives & Runtime Guardrails

*Citations: PRD §2 (Item 5, 11), §8 (FR-6), §9 (Item 4), Appendix D.*

### 2.1 Reviewed Cryptographic Primitives
Personal Vault delegates all cryptographic operations to a reviewed implementation—specifically `libsodium-wrappers-sumo` (WebAssembly build) or an equivalent reviewed Libsodium wrapper. Custom cryptographic primitive implementations are strictly prohibited.

| Purpose | Algorithm / Primitive | Standard / Reference | Libsodium Symbol |
|---|---|---|---|
| **Password KDF** | Argon2id (v1.3) | RFC 9106 | `crypto_pwhash` (`crypto_pwhash_ALG_ARGON2ID13`) |
| **Symmetric AEAD** | XChaCha20-Poly1305 (IETF) | RFC 8439 / draft-arciszewski | `crypto_aead_xchacha20poly1305_ietf_encrypt` / `_decrypt` |
| **Subkey Derivation** | HKDF-SHA-256 | RFC 5869 | `crypto_kdf_hkdf_sha256_expand` / WebCrypto `HKDF` |
| **Device Request Signing**| Ed25519 (EdDSA) | RFC 8032 | `crypto_sign_detached` / `crypto_sign_verify_detached` |
| **Cryptographic Hashing** | SHA-256 | FIPS 180-4 | `crypto_hash_sha256` / WebCrypto `SHA-256` |
| **Random Number Generation** | CSPRNG | Libsodium / WebCrypto | `randombytes_buf` / `crypto.getRandomValues` |

### 2.2 Fatal WASM Load Failure Policy (PRD §2.11, §FR-6, §9.4, §14)
The application relies unconditionally on WebAssembly-backed cryptography:
1. **Blocking Fatal Error:** If the WASM crypto module fails to initialize (e.g., blocked WASM execution, Content Security Policy violation, missing browser support, or corrupt binary), the application must immediately halt execution and render a blocking, full-screen error modal stating:  
   *"Your browser or security policy does not support required cryptographic primitives. Personal Vault cannot operate."*
2. **Strict Non-Fallback Invariant:** The application must **never** fall back to an unencrypted mode, an unreviewed JavaScript implementation, or a weaker cryptographic primitive.
3. **Refuse All Operations:** When WASM initialization fails, vault creation, unlocking, device pairing, emergency recovery, encrypted import/export, and local database reads are completely blocked.
4. **CSP Pinned Hash:** The Content Security Policy must restrict `script-src` to include only the minimum required permission (e.g. `'wasm-unsafe-eval'`) and pin the exact production WASM binary hash. Load failure is treated as fatal, never retryable behind user input.

---

## 3. Key Hierarchy & Derivation Architecture

*Citations: PRD §8 (FR-6, FR-7), Appendix D.*

```text
                               +-----------------------------+
                               |   Master Passphrase (User)  |
                               +-----------------------------+
                                              |
                                              | + Salt (16 bytes random)
                                              | + Argon2id13 (calibrated m, t, p)
                                              v
                               +-----------------------------+
                               |  Key-Encryption Key (KEK)   | (256-bit)
                               +-----------------------------+
                                              |
                                              | XChaCha20-Poly1305 Unwrap
                                              v
+------------------------+     +-----------------------------+     +------------------------+
| Recovery Secret (256b) |     |  Data Encryption Key (DEK)  | <---| Recovery Envelope      |
+------------------------+     |   (256-bit CSPRNG Master)   |     | (wrapped under         |
            |                  +-----------------------------+     |  PV-V1/RECOVERY-WRAP)  |
            |                                 |                    +------------------------+
            |                                 | HKDF-SHA-256
            |                                 | (info = Context Labels)
            |          +----------------------+----------------------+
            |          |                                             |
            v          v                                             v
+-------------------------------+                     +-------------------------------+
|     HKDF-SHA-256 Contexts     |                     |     HKDF-SHA-256 Contexts     |
|   (from Recovery Secret)      |                     |          (from DEK)           |
+-------------------------------+                     +-------------------------------+
| PV-V1/RECOVERY-WRAP           |                     | PV-V1/REC-ENC                 |
| -> Unwraps DEK during recovery|                     | -> Encrypts/decrypts records  |
|                               |                     |                               |
| PV-V1/RECOVERY-AUTH           |                     | PV-V1/LOCAL-CRED              |
| -> SHA-256 hash stored on     |                     | -> Encrypts device token &    |
|    server as auth verifier    |                     |    Ed25519 private key in DB  |
+-------------------------------+                     +-------------------------------+
```

### 3.1 Vault Data Encryption Key (DEK)
- **Generation:** Generated client-side at vault creation using a cryptographically secure random number generator (`randombytes_buf(32)`).
- **Entropy:** Exactly 256 bits (32 bytes).
- **Role:** Master root key for all vault record encryption and local credential wrapping. The raw DEK is held strictly in volatile client memory while the vault is unlocked and is **never** transmitted to the server or persisted in unencrypted form.

---

## 4. Master Password KDF & Calibration

*Citations: PRD §FR-6 (G2, normative), Appendix D.*

### 4.1 Argon2id Parameters & Profiles
The Key-Encryption Key (KEK) is derived from the master passphrase using Argon2id (v1.3) via `libsodium-wrappers-sumo`. The vault master envelope stores `kdf_version = 1`, memory cost `argon2_m_kib`, iterations `argon2_t`, parallelism `argon2_p`, and a 16-byte random salt (`salt_b64u`).

The client strictly enforces the following parameter bounds and profile targets:

| Profile | Memory (`m`) | Iterations (`t`) | Parallelism (`p`) | Role & Enforcement Rule |
|---|---|---|---|---|
| **Minimum** | **64 MiB** (`65536` KiB) | **3** | **1** | **Hard Floor.** Envelopes with parameters below this floor are rejected on unlock with error `CRYPTO_VERSION_UNSUPPORTED`. |
| **Recommended** | **128 MiB** (`131072` KiB) | **4** | **1** | **Default Target.** Attempted first on desktop and laptop hardware during initial vault creation. |
| **Mobile Fallback** | **64 MiB** (`65536` KiB) | **3** | **1** | **Automatic Step-Down.** Selected automatically if the Recommended profile benchmark takes longer than 3.0 seconds on the creating device. |
| **Maximum Cap** | **512 MiB** (`524288` KiB) | **5** | **4** | **Hard Ceiling.** Envelopes exceeding any of these maximum values are rejected immediately without attempting derivation (DoS and memory exhaustion guard). |

### 4.2 Calibration Procedure at Vault Creation
During vault setup, the client executes an automated calibration benchmark to select the strongest profile suitable for the local hardware:
1. **Benchmark Recommended Profile:** The client derives a dummy key using:
   - `m = 131072` KiB (128 MiB)
   - `t = 4`
   - `p = 1`
   - Dummy salt (16 bytes) and dummy input.
2. **Timing Evaluation:**
   - If execution time is **≤ 3000 ms** (3.0 seconds): Select **Recommended** profile (`m = 131072`, `t = 4`, `p = 1`).
   - If execution time is **> 3000 ms**: Automatically step down to **Mobile Fallback** profile (`m = 65536`, `t = 3`, `p = 1`).
3. **Commit Chosen Profile:** Record the selected parameters (`argon2_m_kib`, `argon2_t`, `argon2_p`) in the vault's master envelope.
4. **Invariant:** The chosen parameters travel with the envelope. Subsequent unlocks on any authorized device use the exact parameters committed in the envelope. Parameter alteration requires a `kdf_version` bump and versioned migration fixtures.

### 4.3 Floor & Ceiling Validation Invariant
Before running Argon2id on any envelope (local, remote bootstrap, or imported backup), the client validates:
```typescript
function validateArgon2Params(m: number, t: number, p: number): void {
  // Hard Floor Check (PRD §FR-6)
  if (m < 65536 || t < 3 || p < 1) {
    throw new CryptoError("CRYPTO_VERSION_UNSUPPORTED", "Argon2id parameters below minimum security floor.");
  }
  // Hard Ceiling DoS Guard Check (PRD §FR-6)
  if (m > 524288 || t > 5 || p > 4) {
    throw new CryptoError("CRYPTO_VERSION_UNSUPPORTED", "Argon2id parameters exceed maximum allowable ceiling.");
  }
}
```
If bounds check fails, the client immediately throws `CRYPTO_VERSION_UNSUPPORTED` and aborts before allocating memory or invoking WebAssembly.

---

## 5. Subkey Derivation & Domain Separation (HKDF-SHA-256)

*Citations: PRD §FR-6, §FR-7, Appendix D.*

To enforce strict cryptographic domain separation, keys are never reused across purposes. Subkeys are derived using HKDF-SHA-256 (RFC 5869) with fixed, versioned context labels.

### 5.1 Fixed Context Labels Table

| Context Label (`info`) | Input Key Material (IKM) | Derived Key Role | Key Length |
|---|---|---|---|
| `PV-V1/REC-ENC` | Vault DEK (32 bytes) | Record payload symmetric encryption/decryption key. | 32 bytes (256 bits) |
| `PV-V1/LOCAL-CRED` | Vault DEK (32 bytes) | Local IndexedDB wrap key for device bearer token and Ed25519 private key. | 32 bytes (256 bits) |
| `PV-V1/RECOVERY-WRAP` | Recovery Secret (32 bytes) | Recovery key-encryption key used to wrap/unwrap DEK in the recovery envelope. | 32 bytes (256 bits) |
| `PV-V1/RECOVERY-AUTH` | Recovery Secret (32 bytes) | High-entropy recovery authorization token. Server stores `SHA-256(token)`. | 32 bytes (256 bits) |

### 5.2 HKDF Derivation Rules
1. **IKM Source:** High-entropy 256-bit root keys only (DEK or Recovery Secret). Never use raw passwords directly as IKM.
2. **Context String Binding:** The `info` parameter is passed as exact ASCII/UTF-8 bytes matching the table above.
3. **No Cross-Purpose Reuse:** A key derived under `PV-V1/REC-ENC` must never be used for local credential encryption, and vice versa.
4. **Adding New Purposes:** Adding any cryptographic purpose requires defining a new versioned context label (e.g. `PV-V2/...`), never reusing existing subkeys.

> TODO(question): Confirm whether HKDF-SHA-256 extract step uses an empty/zero-length salt (`""` / `null`) per RFC 5869 Section 2.2 defaults, or binds the vault `salt_b64u` as the HKDF salt. For IKM with 256 bits of uniform cryptographic entropy (DEK and Recovery Secret), RFC 5869 allows salt to be omitted. Recommended convention: empty salt `null` (zero-length byte array).

---

## 6. Cryptographic Envelope Schemas

*Citations: PRD §10, Appendix C, Appendix D.*

All binary cryptographic fields transported via JSON or stored in D1/IndexedDB use unpadded URL-safe Base64 encoding (**base64url**, RFC 4648 §5).

### 6.1 Master Key Envelope (`master_envelope`)
Stored in D1 table `vaults` and local store `app_metadata`. Used to unlock the vault using the master passphrase.

#### Required Fields List (PRD Appendix D)
```typescript
interface MasterEnvelope {
  kdf_version: 1;              // Integer: KDF parameter set version (frozen at 1)
  argon2_m_kib: number;        // Integer: Memory cost in KiB (e.g. 131072 or 65536)
  argon2_t: number;            // Integer: Iterations (e.g. 4 or 3)
  argon2_p: number;            // Integer: Parallelism lanes (e.g. 1)
  salt_b64u: string;           // Base64url string: 16 random bytes Argon2id salt
  nonce_b64u: string;          // Base64url string: 24 random bytes XChaCha20 nonce
  wrapped_dek_b64u: string;    // Base64url string: DEK encrypted under KEK + 16-byte Poly1305 MAC (48 bytes total)
  crypto_format_version: 1;    // Integer: AEAD envelope version (frozen at 1)
  key_version: number;         // Integer: DEK rotation counter (starts at 1)
}
```

#### Master Key Wrapping Procedure
1. Derive KEK (32 bytes) from passphrase: `KEK = Argon2id13(passphrase, salt, m, t, p)`.
2. Generate 24 random bytes: `nonce = randombytes_buf(24)`.
3. Encrypt DEK with XChaCha20-Poly1305:  
   `wrapped_dek = crypto_aead_xchacha20poly1305_ietf_encrypt(DEK, ad=null, nonce, KEK)`.
4. Encode all binary fields as unpadded base64url strings.

---

### 6.2 Recovery Envelope (`recovery_envelope`) & Auth Verifier
Stored in D1 table `vaults`. Enables full vault recovery when all authorized devices are lost.

#### Required Fields List (PRD Appendix D)
```typescript
interface RecoveryEnvelope {
  crypto_format_version: 1;    // Integer: AEAD envelope version (frozen at 1)
  key_version: number;         // Integer: DEK rotation counter (matches master envelope)
  nonce_b64u: string;          // Base64url string: 24 random bytes XChaCha20 nonce
  wrapped_dek_b64u: string;    // Base64url string: DEK encrypted under recovery unwrap key (48 bytes total)
  recovery_auth_verifier: string; // Hex string (64 chars): SHA-256 hash of recovery auth token
}
```

#### Recovery Envelope Derivation & Wrapping Procedure
1. Client generates random 256-bit recovery secret: `recovery_secret = randombytes_buf(32)`.
2. Derive recovery wrapping key:  
   `K_rec_wrap = HKDF-SHA-256(IKM = recovery_secret, info = "PV-V1/RECOVERY-WRAP", len = 32)`.
3. Derive recovery authorization token:  
   `T_rec_auth = HKDF-SHA-256(IKM = recovery_secret, info = "PV-V1/RECOVERY-AUTH", len = 32)`.
4. Compute server-side authorization verifier:  
   `recovery_auth_verifier = SHA-256(T_rec_auth)` (lowercase hex string).
5. Generate 24 random bytes: `nonce = randombytes_buf(24)`.
6. Wrap DEK with XChaCha20-Poly1305:  
   `wrapped_dek = crypto_aead_xchacha20poly1305_ietf_encrypt(DEK, ad=null, nonce, K_rec_wrap)`.
7. Transmit `recovery_auth_verifier`, `nonce_b64u`, and `wrapped_dek_b64u` to server. The raw `recovery_secret`, `K_rec_wrap`, and `T_rec_auth` are **never** stored on or sent to the server.

---

### 6.3 Recovery-Kit File Specification (PRD §FR-7, Appendix C)
The recovery-kit file is a downloadable UTF-8 JSON document named `personal-vault-recovery-kit.json` (MIME `application/json`, no BOM).

#### JSON Schema
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "PersonalVaultRecoveryKit",
  "type": "object",
  "required": [
    "format",
    "version",
    "vault_id",
    "api_origin",
    "recovery_secret",
    "created_at",
    "instructions"
  ],
  "properties": {
    "format": {
      "type": "string",
      "const": "personal-vault-recovery-kit"
    },
    "version": {
      "type": "integer",
      "const": 1
    },
    "vault_id": {
      "type": "string",
      "pattern": "^[0-9A-HJKMNP-TV-Z]{26}$"
    },
    "api_origin": {
      "type": "string",
      "format": "uri"
    },
    "recovery_secret": {
      "type": "string",
      "pattern": "^[A-Za-z0-9_-]{43}$"
    },
    "created_at": {
      "type": "string",
      "format": "date-time"
    },
    "instructions": {
      "type": "string"
    }
  },
  "additionalProperties": false
}
```

#### Manual Fallback Representation (Base32)
For manual transcription and paper backup:
- **Encoding:** RFC 4648 Base32 alphabet (`A-Z`, `2-7`), uppercase, no padding (`=`).
- **Grouping:** 32 bytes encode to 52 characters, formatted in groups of 4 separated by hyphens (13 blocks of 4 chars):  
  `XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX`
- **Round-Trip Requirement:** The base32 string must decode to the exact 32 bytes of `recovery_secret`.

---

## 7. Record Encryption & Associated Authenticated Data (AAD)

*Citations: PRD §FR-1 (G5, G10), §FR-6, §10, Appendix D.*

### 7.1 AEAD Construction
All vault records are encrypted individually using XChaCha20-Poly1305 before persistence in IndexedDB or upload to Cloudflare D1.
- **Key:** Derived subkey `K_rec_enc` from HKDF context `PV-V1/REC-ENC`.
- **Nonce:** Fresh 24-byte random nonce generated via CSPRNG for every encryption operation. Nonce reuse is cryptographically catastrophic; random 192-bit nonces ensure collision probability is negligible across the lifetime of the vault.
- **Ciphertext Ceiling:** 384 KiB base64url string (~288 KiB binary ciphertext + MAC).

### 7.2 Associated Authenticated Data (AAD) Specification
To bind the encrypted record immutably to its vault context and prevent record-swapping, cross-vault injection, or purpose-confusion attacks, the AEAD encryption operation binds authenticated associated data.

#### Exact AAD Construction Formula
```text
AAD = vault_id || record_id || schema_version || key_version || "record"
```

Where:
- `vault_id`: 26-character Crockford Base32 ULID string.
- `record_id`: 36-character canonical lowercase UUIDv4 string.
- `schema_version`: String representation of the integer schema version (e.g. `"1"`).
- `key_version`: String representation of the integer key version (e.g. `"1"`).
- `"record"`: Fixed literal ASCII string indicating purpose.

#### Raw UTF-8 Concatenation
The components are concatenated into a single UTF-8 byte sequence without separators:
```typescript
function constructRecordAAD(
  vaultId: string,
  recordId: string,
  schemaVersion: number,
  keyVersion: number
): Uint8Array {
  const aadString = `${vaultId}${recordId}${schemaVersion}${keyVersion}record`;
  return new TextEncoder().encode(aadString);
}
```

> TODO(question): Verify whether the raw concatenation `${vaultId}${recordId}${schemaVersion}${keyVersion}record` is accepted by all test vectors or whether a delimiter (e.g. `:` or `|`) or length-prefixing is required to eliminate theoretical ambiguity if version strings vary in length. For MVP `schema_version=1` and `key_version=1`, string concatenation is unambiguous because `vault_id` (26 chars) and `record_id` (36 chars) have invariant fixed lengths.

### 7.3 Fail-Closed Decryption Invariant
If **any** component of the AAD differs during decryption (wrong `vault_id`, tampered `record_id`, mismatched `schema_version`, mismatched `key_version`, or incorrect purpose string), Poly1305 MAC verification fails. The client **must fail closed**:
- Discard the decrypted buffer immediately.
- Never return partial or unverified plaintext.
- Log a structured error `VALIDATION_ERROR` or `CRYPTO_VERSION_UNSUPPORTED`.

### 7.4 Dual Schema Version Storage & Forward Compatibility (PRD §FR-1 G5)
- **Dual Storage:** `schema_version` is stored in two locations:
  1. *Inside the encrypted JSON payload:* The authoritative value.
  2. *Plaintext D1/IndexedDB column:* Used strictly for filtering and migration triage, never for content indexing.
- **Forward-Compatibility Rule:** Unknown fields inside the encrypted JSON payload must be preserved and ignored by older clients, never stripped upon re-encryption.
- **Version Guard:** A client encountering a higher major `schema_version` or `crypto_format_version` than it supports must refuse to decrypt or modify the record, display *"Please update the app"*, and never overwrite or downgrade the record.

---

## 8. Device Authorization & Ed25519 Request Signing

*Citations: PRD §FR-5 (G3, G13), §9 (Item 3), §11, Appendix A.*

### 8.1 Device Authentication Hierarchy
Personal Vault eliminates shared passwords and centralized user directories. Every device is an independently authorized cryptographic actor.

1. **Device Bearer Token:**
   - 256 bits of CSPRNG entropy generated client-side or server-side during pairing.
   - Raw token returned **once** to the client.
   - Server stores **only** the SHA-256 hash: `device_token_hash = SHA-256(raw_token)` (64-character lowercase hex string).
   - Authorizes read-only endpoints (`GET /api/v1/sync`, `GET /api/v1/vaults/:vaultId/bootstrap`).
2. **Device Signing Keypair (Ed25519):**
   - Generated client-side via `crypto_sign_keypair()`.
   - `device_public_key` (32 bytes, base64url) registered with D1 table `authorized_devices`.
   - `device_private_key` (64 bytes, base64url) stored locally in IndexedDB, encrypted under `PV-V1/LOCAL-CRED`.
   - Required for all mutating or administrative endpoints (`POST /api/v1/sync/batch`, `POST /api/v1/pairing-tickets`, `POST /api/v1/devices/:deviceId/revoke`, `PUT /api/v1/vault/crypto-metadata`).

### 8.2 Request Signing Protocol (`PV-Device` Header)
To prevent token theft from granting write or administrative access, mutating requests require an Ed25519 detached signature.

#### Header Wire Format
```http
Authorization: Bearer <device_bearer_token>
PV-Device: device_id="<UUIDv4>", timestamp="<ISO-8601-UTC>", nonce="<UUIDv4>", signature="<base64url-sig>"
```

#### Canonical String Construction
The Ed25519 signature is computed over the UTF-8 bytes of the newline-delimited canonical string:
```text
<HTTP_METHOD>\n
<HTTP_PATH>\n
<TIMESTAMP>\n
<NONCE>\n
<BODY_SHA256_HEX>
```

Where:
- `HTTP_METHOD`: Uppercase HTTP verb (e.g. `POST`, `PUT`).
- `HTTP_PATH`: Request path including query parameters (e.g. `/api/v1/sync/batch`).
- `TIMESTAMP`: ISO-8601 UTC timestamp string matching the header attribute (e.g. `2026-10-13T12:00:00.000Z`).
- `NONCE`: RFC 4122 UUIDv4 string matching header attribute (or primary `mutation_id`).
- `BODY_SHA256_HEX`: Lowercase hex digest of the raw UTF-8 request body bytes. For empty bodies, use SHA-256 of empty string `""` (`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`).

#### Server-Side Verification Pipeline
1. Lookup device by `SHA-256(Bearer Token)`. If missing, return `401 DEVICE_UNAUTHORIZED`.
2. Verify `device_id` matches token registration.
3. Check `revoked_at`. If non-null, return `401 DEVICE_REVOKED`.
4. Check clock skew: If `|server_time - timestamp| > 300 seconds` (±5 minutes), return `401 STALE_TIMESTAMP`.
5. Check replay: If `nonce` was seen within window:
   - Identical body digest: return cached idempotent response.
   - Differing body digest: return `409 REPLAY_DETECTED`.
6. Compute request body SHA-256 and match with `BODY_SHA256_HEX`.
7. Verify Ed25519 detached signature against registered `device_public_key`. If invalid, return `401 INVALID_SIGNATURE`.

---

## 9. Cryptographic Lifecycle Operations

*Citations: PRD §FR-5, §FR-6 (G8), §FR-7, §10, §11.*

### 9.1 Local State & Locking Lifecycle
- **Encrypted at Rest:** In IndexedDB:
  - `records`: Payloads stored as XChaCha20-Poly1305 ciphertext.
  - `outbox`: Pending sync mutations stored as ciphertext.
  - `device_credentials`: Device bearer token and Ed25519 private key encrypted under `PV-V1/LOCAL-CRED`.
- **In-Memory While Unlocked:** DEK, derived subkeys, decrypted records, in-memory MiniSearch index, raw device token, and Ed25519 private key exist only in memory.
- **Inactivity Locking:**
  - Default inactivity timeout: **5 minutes** (configurable to 1, 5, 15, or 30 minutes).
  - On app resume/foreground, verify elapsed time and lock if expired.
  - On lock: Overwrite key buffers with zeros where practical in JavaScript, purge search index, clear decrypted records.
  - Failed unlock attempts fail closed without erasing local or cloud vaults.

### 9.2 Master Password Change Scope (PRD §FR-6 G8, normative)
A master-password change modifies **only** the master-key envelope:
1. Client derives new KEK using newly calibrated Argon2id parameters and fresh 16-byte salt.
2. Re-wraps existing DEK with new KEK and fresh 24-byte nonce.
3. **Recovery Envelope Unchanged:** The recovery envelope is **not modified** because it wraps the identical DEK under the independent recovery secret.
4. Server atomically replaces the master envelope via `PUT /api/v1/vault/crypto-metadata`.
5. User disclosure: Old backups remain decryptable with the old password; to invalidate the old password completely, rotate the recovery kit and re-export backups.

### 9.3 All-Devices-Lost Recovery Flow (PRD §FR-7)
When all authorized devices are lost, the vault is recovered using the offline recovery kit:
1. User enters `vault_id` and `recovery_secret` on a clean device.
2. Client derives recovery authorization token:  
   `T_rec_auth = HKDF-SHA-256(recovery_secret, "PV-V1/RECOVERY-AUTH")`.
3. Client generates new device Ed25519 keypair and requests enrollment:  
   `POST /api/v1/recovery/enroll-device` (authorized via `T_rec_auth`).
4. Server verifies `SHA-256(T_rec_auth) == recovery_auth_verifier`, registers new device, and returns new bearer token.
5. Client downloads encrypted recovery envelope and unwraps DEK using:  
   `K_rec_wrap = HKDF-SHA-256(recovery_secret, "PV-V1/RECOVERY-WRAP")`.
6. Client prompts user for a new master passphrase, derives new KEK, creates a new master envelope, and updates the vault.

---

## 10. Milestone 2 Test Vectors & Verification Fixtures

*Citations: PRD §14, §15 (Milestone 2), Appendix D.*

To verify cryptographic conformance prior to cloud synchronization, Milestone 2 requires shipping the following automated test fixtures.

### 10.1 Argon2id Known-Answer Test Vectors (KAT)
Verifies exact implementation of Argon2id13 via `libsodium-wrappers-sumo`.

#### Minimum Profile Fixture
```json
{
  "profile": "Minimum",
  "kdf_version": 1,
  "passphrase": "correct horse battery staple",
  "salt_b64u": "AAAAAAAAAAAAAAAAAAAAAA",
  "argon2_m_kib": 65536,
  "argon2_t": 3,
  "argon2_p": 1,
  "key_len": 32,
  "expected_kek_b64u": "<KAT_VECTOR_HEX_OR_B64U>"
}
```

#### Recommended Profile Fixture
```json
{
  "profile": "Recommended",
  "kdf_version": 1,
  "passphrase": "correct horse battery staple",
  "salt_b64u": "/////////////////////w",
  "argon2_m_kib": 131072,
  "argon2_t": 4,
  "argon2_p": 1,
  "key_len": 32,
  "expected_kek_b64u": "<KAT_VECTOR_HEX_OR_B64U>"
}
```

### 10.2 AAD Mismatch Negative Test Cases
To guarantee fail-closed AEAD integrity, five distinct test cases must assert that modifying any single component of the AAD results in decryption failure:

| Case ID | Baseline Value | Modified Field | Altered Test Value | Expected Outcome |
|---|---|---|---|---|
| `AAD-FAIL-1` | `vault_id` = `01J9Z8QK7M3V6P2R5T8W4Y6U1A` | `vault_id` | `01J9Z8QK7M3V6P2R5T8W4Y6U1B` | Decryption throws MAC error; no plaintext returned. |
| `AAD-FAIL-2` | `record_id` = `550e8400-e29b-41d4-a716-446655440000` | `record_id` | `550e8400-e29b-41d4-a716-446655440001` | Decryption throws MAC error; no plaintext returned. |
| `AAD-FAIL-3` | `schema_version` = `1` | `schema_version` | `2` | Decryption throws MAC error; no plaintext returned. |
| `AAD-FAIL-4` | `key_version` = `1` | `key_version` | `2` | Decryption throws MAC error; no plaintext returned. |
| `AAD-FAIL-5` | `purpose` = `"record"` | `purpose` | `"records"` | Decryption throws MAC error; no plaintext returned. |

### 10.3 Forward-Compatibility Test Vector (`v1`-reads-`v1`)
Asserts that unknown JSON attributes in encrypted payloads are preserved during round-trip decryption and re-encryption:
- **Input Plaintext Payload:**
  ```json
  {
    "schema_version": 1,
    "type": "note",
    "title": "Forward Compatibility Test",
    "body": "Payload with unknown future field.",
    "future_unrecognized_field": {
      "nested_key": 42,
      "flag": true
    }
  }
  ```
- **Assertion:** When decrypted, edited (e.g. `title` modified), and re-encrypted by an MVP v1 client, `future_unrecognized_field` must remain intact in the serialized output.

### 10.4 Argon2id Boundary Rejection Test Cases
Verifies that client rejects out-of-bounds parameters before invoking KDF:
1. **Below Floor:** `m = 32768, t = 3, p = 1` → Throws `CRYPTO_VERSION_UNSUPPORTED`.
2. **Below Floor Iterations:** `m = 65536, t = 2, p = 1` → Throws `CRYPTO_VERSION_UNSUPPORTED`.
3. **Above Ceiling Memory:** `m = 1048576, t = 5, p = 4` → Throws `CRYPTO_VERSION_UNSUPPORTED` (no memory allocated).
4. **Above Ceiling Iterations:** `m = 524288, t = 6, p = 4` → Throws `CRYPTO_VERSION_UNSUPPORTED`.
5. **Above Ceiling Threads:** `m = 524288, t = 5, p = 5` → Throws `CRYPTO_VERSION_UNSUPPORTED`.

---

## 11. Open Questions & Ambiguities

> TODO(question): Confirm whether HKDF-SHA-256 extract step uses an empty/zero-length salt (`""` / `null`) per RFC 5869 Section 2.2 defaults, or binds the vault `salt_b64u` as the HKDF salt. For IKM with 256 bits of uniform cryptographic entropy (DEK and Recovery Secret), RFC 5869 allows salt to be omitted. Recommended convention: empty salt `null` (zero-length byte array).

> TODO(question): Verify whether the raw concatenation `${vaultId}${recordId}${schemaVersion}${keyVersion}record` is accepted by all test vectors or whether a delimiter (e.g. `:` or `|`) or length-prefixing is required to eliminate theoretical ambiguity if version strings vary in length. For MVP `schema_version=1` and `key_version=1`, string concatenation is unambiguous because `vault_id` (26 chars) and `record_id` (36 chars) have invariant fixed lengths.

> TODO(question): Confirm whether the Cloudflare D1 schema stores the master and recovery envelopes as individual unpacked columns (`master_wrapped_dek`, `salt`, `kdf_m_kib`, etc., as in `docs/data-model.md`) or as two serialized JSON strings (`master_envelope` and `recovery_envelope`). Both representations are semantically equivalent; serializer must match the D1 migration scripts.
