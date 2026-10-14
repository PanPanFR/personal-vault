# Personal Vault — Recovery Kit File Format

> Frozen contract v1. Mirror of `docs/backend/crypto-spec.md` §6.3 (Appendix C).
> Any field rename = contract revision.

## Filename

`personal-vault-recovery-kit.json` (MIME `application/json`, UTF-8, no BOM).

## Schema (frozen)

```json
{
  "format": "personal-vault-recovery-kit",
  "version": 1,
  "vault_id": "01J9Z8QK7M3V6P2R5T8W4Y6U1A",
  "api_origin": "https://personal-vault.pages.dev",
  "recovery_secret": "<base64url, 43 chars, 32 bytes>",
  "created_at": "2026-10-13T00:00:00.000Z",
  "instructions": "Open api_origin, choose Recover, enter vault_id and recovery_secret (or its base32 manual code). Keep this file offline."
}
```

| Field | Type | Constraint |
|---|---|---|
| `format` | string | const `personal-vault-recovery-kit` |
| `version` | integer | const `1` |
| `vault_id` | string | ULID, 26 Crockford Base32 chars |
| `api_origin` | string (uri) | Creating device origin, e.g. `https://personal-vault.pages.dev` |
| `recovery_secret` | string | Unpadded base64url of 32 CSPRNG bytes (43 chars, `[A-Za-z0-9_-]{43}`) |
| `created_at` | string | ISO-8601 UTC |
| `instructions` | string | Human recovery steps |

`additionalProperties: false`. `recovery_secret` raw bytes are the IKM for
`HKDF(..., "PV-V1/RECOVERY-WRAP")` and `HKDF(..., "PV-V1/RECOVERY-AUTH")`.
The file itself is secret material — store offline, never upload.

## Manual fallback (Base32 round-trip)

For paper backup: RFC 4648 Base32 (`A-Z2-7`), uppercase, no padding,
grouped `XXXX-XXXX-...` (13 groups of 4 = 52 chars for 32 bytes).
Round-trip rule: Base32 string MUST decode to the exact 32 bytes of
`recovery_secret`. Validators reject on any byte mismatch.
