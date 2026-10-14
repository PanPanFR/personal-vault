# Personal Vault — Encrypted Export File Format

> Frozen contract v1. Ciphertext-only export. Filename helper:
> `src/lib/limits.ts` `exportFilename()`.

## Filename

`personal-vault-export-YYYYMMDD.json` (UTC date, e.g.
`personal-vault-export-20261013.json`). MIME `application/json`, UTF-8, no BOM.

## Top-level fields

| Field | Type | Constraint |
|---|---|---|
| `format` | string | const `personal-vault-export` |
| `version` | integer | const `1` |
| `exported_at` | string | ISO-8601 UTC |
| `vault_id` | string | ULID 26 chars |
| `schema_version` | integer | `1` |
| `crypto_format_version` | integer | `1` |
| `kdf_version` | integer | `1` |
| `key_version` | integer | `1` |
| `master_envelope` | object | 9 Appendix-D fields (see `MASTER_ENVELOPE_FIELDS`) |
| `recovery_envelope` | object \| null | 4 fields + verifier context; included only on explicit recovery-key export, else `null` |
| `records` | array | All live + tombstone records |

## Record entry

| Field | Type | Notes |
|---|---|---|
| `record_id` | UUIDv4 | |
| `schema_version` | integer | `1` |
| `key_version` | integer | AAD binding version |
| `revision` | integer >= 1 | Last known revision |
| `is_tombstone` | boolean | |
| `ciphertext` | string \| null | Base64url, max 384 KiB; `null` iff tombstone |
| `nonce_b64u` | string \| null | 24-byte nonce; `null` iff tombstone |
| `updated_at` | string | ISO-8601 UTC |

Export never contains plaintext titles, URLs, tags, notes, credentials, or
search indexes. Unknown fields inside decrypted payloads are preserved on
re-import (forward-compat). Adding a top-level field = contract revision.
