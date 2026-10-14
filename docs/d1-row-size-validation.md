# Contract validation gate — D1 row-size fit for 384 KiB ciphertext

> Acceptance criterion from `plan/foundations-schemas-contract.md`:
> verify 384 KiB ciphertext fits a D1 row; if the limit is lower, lower the
> plaintext cap + API + UI together.

## Verdict: fits (no cap change)

- D1 is SQLite-backed. `TEXT` values hold up to ~1_000_000_000 bytes;
  the practical ceiling for a single record write is the Workers request /
  D1 batch payload, not the column type. A 384 KiB (393_216 char) base64url
  ciphertext + 32-char nonce + integer triage columns is ~400 KiB/row,
  well under SQLite limits and under the 1 MiB sync-batch body cap.
- Worker validation MUST still enforce per-record `length(ciphertext) <= 393216`
  and per-batch `mutations <= 50 AND body <= 1048576` before touching D1,
  so oversized payloads fail with `413 PAYLOAD_TOO_LARGE` instead of
  hitting platform limits.
- If Cloudflare ever documents a smaller D1 TEXT ceiling, the three layers
  change together: `PLAINTEXT_ITEM_CAP_BYTES` (`src/lib/limits.ts`) +
  `CIPHERTEXT_RECORD_CAP_BYTES` + `openapi.yaml` `maxLength: 393216` +
  UI copy (sibling `pwa-hardening-release` verify step).

## How it is tested here

- `tests/foundations.test.ts` asserts `CIPHERTEXT_RECORD_CAP_BYTES = 393216`
  and that the migration stores `ciphertext TEXT` (unbounded, no `VARCHAR(n)`).
- `migrations/0001_init.sql` header records the 384 KiB cap and the gate outcome.
