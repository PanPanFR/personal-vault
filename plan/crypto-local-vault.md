# Implementation Plan: Crypto & Local Vault Lifecycle

## Objective

Implement client-side key lifecycle, authenticated encryption, lock/unlock, in-memory search, and recovery-kit handling so vault records are ciphertext everywhere at rest (IndexedDB, outbox, API, D1) and the app refuses to operate if crypto cannot load.

## Scope

IN: DEK gen (256-bit CSPRNG); Argon2id via libsodium-wrappers-sumo with normative table (Min 64 MiB/t3/p1 floor, Recommended 128 MiB/t4/p1 default, Mobile fallback 64 MiB/t3/p1 auto if >3 s, Cap 512 MiB/t5/p4 ceiling, `kdf_version=1`, 16-byte salt); 3-second calibration at creation; floor/ceiling rejection without derivation; XChaCha20-Poly1305 record encryption with fresh nonce + AAD `vault_id||record_id||schema_version||key_version||"record"`; HKDF-SHA-256 labels `PV-V1/REC-ENC`, `PV-V1/LOCAL-CRED`, `PV-V1/RECOVERY-WRAP`, `PV-V1/RECOVERY-AUTH`; master envelope (9 Appendix D fields) + password-change re-wrap (master envelope only, atomic replace, recovery untouched + UI disclosures); recovery secret (256-bit) + kit file Appendix C + base32 fallback + save-confirmation gate + rotation gate; lock (manual + 1/5/15/30 min, default 5, `localStorage` epoch fallback, clear DEK/subkeys/index/token/key from memory); WASM-load fatal full-screen block; MiniSearch in-memory only, cleared on lock; passphrase UX (min 8 chars per user decision + strength warning + offline-guess disclosure); bilingual strings scaffold (ID+EN, user chose both).
OUT: API/Worker, D1, sync protocol, pairing endpoints, service worker, deploy. Those are sibling plans.

## Context

- Stack: Vite + React + TS, Dexie.js (ciphertext-only stores), libsodium-wrappers-sumo (pinned, hashed), MiniSearch, Vitest + Playwright. No server crypto — Argon2id/record encryption run on client only.
- PRD: FR-6, FR-7 (kit + flow steps 1–6), FR-2 (search), FR-8 (clipboard/mask), §2(11) crypto-blocking, §9(4) CSP/WASM, Appendix D vectors.
- Consumes (read-only): `plan/foundations-schemas-contract.md` outputs — envelope field names, version constants, 256 KiB guard, error codes `CRYPTO_VERSION_UNSUPPORTED`/`VERSION_MISMATCH`. Do not rename frozen fields.
- User decisions: min passphrase 8; bilingual UI; auto device label (used when wrapping local creds, no UX here).
- Technical defaults: outbox payloads use same `PV-V1/REC-ENC` subkey (staged record ciphertext); `localStorage` holds only lock-epoch int, cleared on lock.
- Jev verify: tier HIGH (`decision_risk` failure-impact 0.96, conf 0.92; `proceed` 0.31, `needs_human` 0.74 — below strict bar). **Needs human confirm:** Argon2id Recommended 128 MiB/t4 may take >3 s on low-end Android → auto fallback to 64 MiB/t3 is the plan; confirm you accept auto-fallback (vs forcing 128 MiB everywhere). Proceeding with flag; builder must not weaken below floor or raise above cap without a `kdf_version` bump + fixtures.

## Dependencies

- Requires: foundations contract frozen (envelope field names, versions). Can scaffold in parallel but must conform on freeze.
- Blocks: `cloud-sync-pairing` (needs unwrap/encrypt + local-cred wrap + envelope shapes); `pwa-hardening-release` (needs lock + WASM-block + i18n scaffold).

## Files / Areas Likely Affected

- `src/crypto/*` (NEW — argon2-calibrate, dek, rec-enc, hkdf-labels, aad, envelopes, recovery, wasm-guard)
- `src/vault/*` (NEW — create/unlock/lock, password-change, rotation)
- `src/db/*` (USE foundations Dexie schema; add encrypted read/write helpers only, no schema edits)
- `src/search/*` (NEW — MiniSearch build/clear, query parser `type:/tag:/is:/created:/updated:` + quoted phrases, AND semantics, invalid-operator-as-error rule)
- `src/i18n/*` (NEW — ID+EN dictionaries, Settings switcher key)
- `src/components/RecoveryKit*`, `src/components/LockScreen*`, `src/components/WasmBlock*` (NEW)
- `tests/crypto/*`, `tests/fixtures/*` (NEW — Min/Rec known-answer vectors, per-AAD-field mismatch cases, unknown-field forward-compat case, floor/ceiling rejection, WASM-block test)

## Implementation Steps

1. Pin `libsodium-wrappers-sumo` version, record WASM hash for CSP; implement WASM-load fatal gate (full-screen block, zero vault ops) + test with blocked WASM.
2. Implement Argon2id calibrate (Recommended → fallback if >3 s), floor/ceiling guards (reject without deriving), envelope create/parse; ship Min + Recommended known-answer fixtures.
3. Implement record encrypt/decrypt (fresh nonce, AAD binding, wrong-AAD/wrong-vault/tamper rejection), HKDF subkeys (4 labels), forward-compat (preserve+ignore unknown payload fields; refuse higher major, no write-back/downgrade).
4. Implement vault lifecycle: create, unlock (fail closed, no wipe on wrong password), lock (timeout options, resume check, memory clear), password-change (master-envelope-only atomic replace + 3 UI disclosure strings), recovery kit generate/export/confirm-gate + rotation gate (new kit confirmed before old auth invalidated).
5. Implement encrypted IndexedDB helpers (records/outbox/token+private-key under `PV-V1/LOCAL-CRED`), no plaintext in Cache/logs/URLs/history/localStorage (epoch int only).
6. Implement MiniSearch (decrypted-only, clear on lock), query syntax + invalid-operator handling, no-plaintext-upload rule.
7. Implement credential field UX (mask default, explicit reveal/copy, Clipboard-after-gesture + retention warning), passphrase UI (min 8 + encourage-long + offline-guess note), bilingual ID+EN strings.

## Acceptance Criteria

- [ ] 5,000-record open+search on reference hardware; search p95 <200 ms on agreed dataset (release target, measure and log).
- [ ] Wrong passphrase fails closed, no data wipe; tampered/AAD-mismatch/unknown-version/nonce-bad all reject safely; fresh nonce every encryption (test).
- [ ] Floor envelopes rejected, cap envelopes rejected without derivation; Min + Recommended vectors pass.
- [ ] Password change leaves recovery unwrap working; old exports still open with old password (documented in UI).
- [ ] Kit file matches Appendix C byte-for-byte + base32 round-trip; setup/rotation cannot complete without save-confirmation.
- [ ] Blocked-WASM build shows fatal error, zero vault ops permitted.
- [ ] D1/Worker-log inspection (with sibling) shows no plaintext fields, passphrase, recovery secret, raw token, private key, or query.

## Verification / Tests

- Unit (Vitest): KDF vectors, AAD matrix (one rejection per AAD field), nonce uniqueness, HKDF separation, floor/ceiling, forward-compat, size guard agreement with server (256 KiB plain).
- Integration: create → lock → unlock → export → clean-profile restore via passphrase AND via recovery secret.
- E2E (Playwright): lock-timeout resume, WASM-block, kit confirm-gate cannot be skipped.

## Git (branch: feature/crypto-local-vault)

- Base: `main`. Builder creates branch, commits, opens PR. No self-merge.

## Integration Notes (merge order vs sibling plans, likely file overlaps)

- Merge order: **2nd**, after foundations.
- Sibling overlaps: `cloud-sync-pairing` consumes envelopes/ciphertext shapes — no file overlap if it only imports `src/crypto/*` read-only. Dexie schema owned by foundations; this plan adds helpers only. `pwa-hardening-release` consumes lock/WASM-block/i18n — coordinate Settings keys (`lock_timeout`, `locale`) names now to avoid rename later.
- Real dependency: do not start password-change/recovery UI strings final copy until bilingual dictionary keys freeze here.

## Delegation Strategy

| Step | Owner | Parallel batch | Why |
|------|-------|----------------|-----|
| 1 WASM pin + fatal gate | builder | — | Inline: blocking constraint, first |
| 2 Argon2id + envelopes | builder | — | Inline: core crypto, sequential after 1 |
| 3 record enc/AAD/HKDF/compat | builder | — | Inline: same crypto context as 2 |
| 4 lifecycle (create/unlock/lock/change/kit) | builder | — | Inline: needs steps 1–3 context |
| 5 encrypted IDB helpers | reviewer | A | Read-only audit: no-plaintext-at-rest check, parallel to 6 |
| 6 search + query parser | builder | A | Separate files (`src/search/*`), parallel to 5 |
| 7 credential/clipboard/passphrase/i18n UX | designer | B | UI strings + mask/reveal/a11y, after crypto settled |
| Fixtures + unit tests | tester | B | Parallel with 7, isolated `tests/` |

Batch A = steps 5+6 together. Batch B = step 7 + tester together. Reviewer read-only. Bulk fixture generation (if many vectors) via one shell script inline, never split across subagents.
