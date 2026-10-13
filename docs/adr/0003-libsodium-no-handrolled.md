# 0003. Reviewed Libsodium WebAssembly and Fatal Crypto Load Failure

- **Status:** Accepted
- **Date:** 2026-10-13
- **Authoritative Source:** `personal-vault-prd-v3.md` §2 (Decisions 5, 11), §6 (Recommended technology stack), §8 (FR-6), §9 (Security requirement 4), Appendix D (Crypto/format versions)

---

## Context

Personal Vault requires a robust cryptographic foundation for:
1. **Password Key Derivation:** Argon2id (RFC 9106) to derive a Key Encryption Key (KEK) from the master passphrase, resisting GPU/ASIC offline brute-force attacks.
2. **Authenticated Symmetric Encryption:** XChaCha20-Poly1305 with 192-bit random nonces to eliminate nonce reuse hazards and provide authenticated associated data (AAD) binding.
3. **Asymmetric Request Signing:** Ed25519 (RFC 8032) to sign mutating API requests from authorized devices.
4. **Key Separation:** HKDF-SHA-256 (RFC 5869) to derive domain-separated subkeys for records, local credentials, and recovery.

The native browser Web Crypto API (`window.crypto.subtle`) lacks support for Argon2id and XChaCha20-Poly1305. Hand-rolling cryptographic primitives in JavaScript or stitching together multiple disparate, unreviewed npm packages introduces catastrophic security vulnerabilities, side-channel timing leaks, and maintenance hazards.

Additionally, user feedback and security hygiene mandate establishing a strict minimum length for the master passphrase.

---

## Decision

1. **Use `libsodium-wrappers-sumo`:** We adopt the reviewed, audited WebAssembly build of Libsodium (`libsodium-wrappers-sumo`) for all cryptographic primitives (Argon2id13, XChaCha20-Poly1305, Ed25519, HKDF-SHA-256). Hand-rolling cryptographic primitives is strictly prohibited.
2. **Enforce Minimum Master Passphrase Length:** The client strictly enforces a minimum passphrase length of **8 characters** at vault creation and password update.
3. **Fatal Blocking on Crypto Load Failure (PRD §2.11, G14):** If the Libsodium WebAssembly module fails to initialize (e.g., due to browser incompatibility, disabled WASM, or Content Security Policy restriction), the application **must halt immediately with a fatal full-screen error**. It must refuse vault creation, unlock, pairing, and export, and must **never** fall back to unencrypted storage or a weaker algorithm.
4. **Argon2id Bounds:** Enforce a hard minimum floor of `m=64 MiB`, `t=3`, `p=1` on unlock, and a maximum DoS cap of `m=512 MiB`, `t=5`, `p=4`.

---

## Consequences

### Positive
- **Audited Security:** Libsodium is an industry-standard, battle-tested cryptographic library implemented in constant time to prevent side-channel timing attacks.
- **Large Nonces:** XChaCha20's 192-bit nonce allows safe, stateless random nonce generation without counter state synchronization across devices.
- **Fail-Closed Safety:** If the cryptographic environment is hostile or compromised, the fatal blocking guard prevents plaintext exposure or unencrypted operations.
- **Strict Passphrase Hygiene:** The 8-character floor combined with Argon2id parameters provides a strong baseline defense against offline dictionary attacks.

### Negative / Trade-offs
- **WASM Binary Overhead:** The `libsodium-wrappers-sumo` package adds ~300–400 KiB to the initial application bundle download (cached by the service worker after install).
- **CSP Configuration:** Deploying WebAssembly requires configuring the Content Security Policy to include `script-src 'wasm-unsafe-eval'` (or equivalent narrow directive for the pinned WASM build; PRD §9.4).
- **Device Calibration:** Argon2id memory and iteration costs require calibration (Recommended 128 MiB/t=4/p=1, stepping down to Mobile fallback 64 MiB/t=3/p=1 if calibration exceeds 3 seconds) to ensure unlock performance on constrained mobile hardware.

---

## PRD Citations
- PRD §2.5: *"Cryptography: Use a reviewed library such as `libsodium-wrappers-sumo` for Argon2id, XChaCha20-Poly1305, Ed25519, and supporting primitives. Do not implement cryptographic algorithms manually."*
- PRD §2.11: *"Crypto failure is blocking (v3): If the reviewed crypto/WASM module fails to load, the app must refuse vault creation and unlock with a clear error. It must never fall back to unencrypted operation or a weaker algorithm (see FR-6)."*
- PRD §8 (FR-6): Normative Argon2id parameter table, calibration procedure, and floor/ceiling rejection rules.
- PRD §9.4: Restrictive CSP compatible with pinned WASM build.
- User Decision (2026-10-13): Master passphrase minimum length of 8 characters.
