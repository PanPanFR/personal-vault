---

# Personal Vault

Encrypted, local-first personal vault. Zero-knowledge: the server never sees
plaintext. Two devices converge via cursor-based sync with optimistic
concurrency; lost devices are re-authorized from an offline recovery kit.

## Quick start

```bash
pnpm install
pnpm dev        # Vite dev server
pnpm test       # vitest (291 tests)
pnpm build      # tsc --noEmit + vite build
pnpm contract-drift   # asserts openapi.yaml matches docs/api-spec.md
```

## Architecture

| Layer | Where | Stack |
|---|---|---|
| UI | `src/components`, `src/pages`, `src/hooks` | React 19, Vite, Tailwind 4 |
| Crypto | `src/crypto` | libsodium-wrappers-sumo (Argon2id, XChaCha20-Poly1305, Ed25519, HKDF) |
| Local store | `src/db`, `src/vault` | Dexie / IndexedDB, ciphertext-only at rest |
| Sync / pairing | `src/sync`, `src/pairing`, `src/recovery`, `src/backup` | outbox + cursor engine |
| API | `functions/api/v1` | Cloudflare Pages Functions (Workers runtime) |
| Storage | `migrations/*.sql` | Cloudflare D1 (dev and prod databases are separate) |

## Security model

- **No central credentials.** No accounts, passwords, or server-held secrets.
- **Device-scoped authority.** Each device holds a 256-bit bearer token (server
  stores only its SHA-256) plus an Ed25519 keypair. Mutating requests require
  both, so a stolen token alone cannot mutate records, pair devices, revoke
  devices, or rotate key envelopes.
- **Request signing.** `PV-Device: device_id="…", timestamp="…", nonce="…",
  signature="…"` over `METHOD\nPATH\nTIMESTAMP\nNONCE\nBODY_SHA256_HEX`, with a
  ±5 minute window and nonce replay detection.
- **All-devices-lost recovery.** The offline recovery kit is the only path back
  in; the recovery envelope is delivered solely by
  `POST /api/v1/recovery/enroll-device`.
- **No silent overwrites.** Optimistic concurrency (CAS) with explicit conflict
  resolution; tombstones are never resurrected.

## API

Nine endpoints under `/api/v1`, frozen in `openapi.yaml` and specified
normatively in `docs/api-spec.md`:

| Method | Path | Auth |
|---|---|---|
| POST | `/vaults` | none (3/IP/hour) |
| GET | `/vaults/:vaultId/bootstrap` | bearer |
| GET | `/sync` | bearer (300/vault/hour) |
| POST | `/sync/batch` | bearer + signature (120/vault/hour) |
| POST | `/pairing-tickets` | bearer + signature (5/device/hour) |
| POST | `/pairing/exchange` | ticket knowledge (10/vault/hour) |
| POST | `/devices/:deviceId/revoke` | bearer + signature |
| PUT | `/vault/crypto-metadata` | bearer + signature (10/vault/hour) |
| POST | `/recovery/enroll-device` | recovery token (5/vault/hour, backoff) |

Every response carries `Cache-Control: no-store`, `X-Server-Time` and the
standard security headers. Errors use the frozen 18-code envelope.

## Database migrations

```bash
wrangler d1 migrations apply personal-vault-db --local   # dev
wrangler d1 migrations apply personal-vault-db           # prod
```

`0001_init.sql` is the frozen schema (vaults, vault_records,
authorized_devices, pairing_tickets, sync_changes). `0002` adds the rate-limit
counters, request-nonce replay table, and mutation idempotency keys required by
Appendix B rate limits and §11 idempotency.

## Documentation

| Area | Path |
|---|---|
| Product requirements | `personal-vault-prd-v3.md` |
| Backend contracts | `docs/api-spec.md`, `docs/sync-protocol.md`, `docs/data-model.md`, `docs/crypto-spec.md`, `docs/device-pairing-recovery.md` |
| Architecture & runbook | `docs/architecture.md` |
| Security | `docs/security-threat-model.md` |
| Frontend / UX | `docs/ui-ux.md`, `docs/pwa-operational.md` |
| Architecture decisions | `docs/decisions.md` |

Precedence on any discrepancy: **PRD > api-spec.md > openapi.yaml > code**.
Adding or renaming fields or error codes requires a formal contract revision,
enforced by `pnpm contract-drift`.