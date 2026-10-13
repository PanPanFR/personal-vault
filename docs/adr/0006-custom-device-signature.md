# 0006. Two-Tier Device Authentication and Custom Ed25519 Request Signing

- **Status:** Accepted
- **Date:** 2026-10-13
- **Authoritative Source:** `personal-vault-prd-v3.md` §2 (Decision 2), §8 (FR-5), §9 (Security requirements 2, 3), §10 (Data model), §11 (API endpoint behaviors), §18 (Gap fix 3)

---

## Context

Personal Vault has no user accounts, email logins, or central identity provider. Authorization is anchored directly in individual user devices explicitly authorized by the vault owner.

In a naive bearer token architecture, a client presents an opaque bearer token on every request. However, if a device bearer token is intercepted in transit, extracted from client memory, or leaked, an attacker could silently:
- Inject forged or malicious records into the vault.
- Delete existing records or push tombstones.
- Alter the master cryptographic envelope (`PUT /api/v1/vault/crypto-metadata`), locking out the legitimate owner.
- Generate pairing tickets to enroll additional rogue devices.
- Revoke the owner's legitimate devices.

We required an authentication architecture that defends against bearer token theft while avoiding external identity dependencies (Auth0, Firebase, Supabase, OAuth).

---

## Decision

We implement a **two-tier device authorization model** combining high-entropy bearer tokens with cryptographic **Ed25519 request signatures**:

1. **256-bit Device Bearer Token:**
   - Generated client-side (or server-side during exchange/recovery) with 256 bits of cryptographic entropy.
   - The server stores **only** the SHA-256 hash (`device_token_hash`). Raw tokens are never stored or logged on the server.
   - The client stores the token encrypted locally in IndexedDB under a DEK-derived key (`PV-V1/LOCAL-CRED`).
2. **Ed25519 Device Keypair:**
   - Each device generates a persistent Ed25519 signing keypair during enrollment.
   - The public key is stored in D1 (`authorized_devices.device_public_key`).
   - The private key is stored encrypted locally under the DEK (`PV-V1/LOCAL-CRED`).
3. **Two Authorization Tiers:**
   - **Tier 1 (Read-Only):** `GET /api/v1/vaults/:vaultId/bootstrap` and `GET /api/v1/sync` require a valid device bearer token in `Authorization: Bearer <token>`.
   - **Tier 2 (Mutating & Administrative):** `POST /api/v1/sync/batch`, `POST /api/v1/pairing-tickets`, `POST /api/v1/devices/:deviceId/revoke`, and `PUT /api/v1/vault/crypto-metadata` require **both** the bearer token and an Ed25519 cryptographic signature.
4. **Signature Specification (`PV-Device` Header):**
   - Mutating requests supply the signature in a custom header:
     `PV-Device: device_id="<UUID>", timestamp="<ISO-8601-UTC>", nonce="<UUID>", signature="<base64url-sig>"`
   - The signature signs the canonical string:
     `METHOD\nPATH\nTIMESTAMP\nNONCE\nSHA256(BODY)`
   - The server validates that `timestamp` is within ±5 minutes of server time and enforces replay protection on nonces.
   - Every API response includes `X-Server-Time: <ISO-8601-UTC>` to allow clients to correct clock skew.
5. **Automatic Device Labeling:**
   - When a device is registered or paired, it automatically receives a label formatted as **`Device-XXXX`** (where `XXXX` is a random 4-character hex or alphanumeric string).
   - The user can rename the device in Settings at any time.

---

## Consequences

### Positive
- **Defense in Depth Against Token Theft:** An attacker possessing only a stolen device bearer token cannot alter, delete, or inject records, cannot generate pairing tickets, and cannot revoke devices.
- **Zero External Auth Dependencies:** Operates without third-party authentication services, recurring fees, or external network calls.
- **Replay Protection:** Request nonces and the strict ±5-minute timestamp window prevent replay attacks.
- **User Device Hygiene:** Automatic `Device-XXXX` labeling provides immediate identification in the device management UI without forcing manual text input during setup.

### Negative / Trade-offs
- **Worker Verification CPU:** The Worker must execute Ed25519 signature verification on all mutating requests. (Ed25519 verification is highly efficient and easily completes within the 10 ms CPU budget).
- **Client Key Management:** The client must securely store and handle the Ed25519 private key in IndexedDB (encrypted under DEK).

---

## PRD Citations
- PRD §2.2: Same-origin API and edge authorization.
- PRD §8 (FR-5): Device authorization, pairing, Ed25519 keypair, signature binding requirements, and token hashing.
- PRD §9.3: Security requirements for request authentication.
- PRD §18.3: Gap fix 3 establishing per-device Ed25519 signatures.
- User Decision (2026-10-13): Automatic device label format `Device-XXXX` with user rename capability.
