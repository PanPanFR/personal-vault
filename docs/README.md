# Personal Vault — Documentation

Authoritative technical documentation, architecture specifications, and operational runbooks for Personal Vault.

## Precedence

When specifications disagree, resolve in this order:
1. `personal-vault-prd-v3.md` (PRD v3.0, sole normative authority)
2. `docs/api-spec.md` (normative human-readable API contract)
3. Specialized specifications (`crypto-spec.md`, `data-model.md`, `sync-protocol.md`, etc.)
4. `openapi.yaml` (machine-readable mirror of `docs/api-spec.md`)
5. Implementation code and automated test fixtures

> *Note:* Documentation was consolidated flat on 2026-10-16, folding previous `backend/`, `frontend/`, `security/`, `product/`, `adr/`, and loose appendix files into these 11 root documents.

## Where to Read What

| If you need to understand... | Read |
|---|---|
| System stack, hosting, quotas, invariants, and local dev/deploy/incident runbooks | [`architecture.md`](architecture.md) |
| Normative HTTP API endpoints, request/response bodies, auth headers, and error codes | [`api-spec.md`](api-spec.md) |
| Cryptographic hierarchy, Argon2id parameters, envelopes, AAD, and KAT test vectors | [`crypto-spec.md`](crypto-spec.md) |
| Cloudflare D1 relational SQL tables, client Dexie IndexedDB stores, and size limits | [`data-model.md`](data-model.md) |
| Cloud sync protocol, optimistic concurrency, cursor pagination, and conflict resolution | [`sync-protocol.md`](sync-protocol.md) |
| QR pairing protocol, device revocation, offline recovery kit, and backup export/import | [`device-pairing-recovery.md`](device-pairing-recovery.md) |
| PWA Service Worker caching, iOS ITP eviction defense, and real-device release matrix | [`pwa-operational.md`](pwa-operational.md) |
| UI/UX flows, information architecture, bilingual i18n, and Catppuccin Design System | [`ui-ux.md`](ui-ux.md) |
| Threat boundaries, attack vectors, CSP/WASM rules, and application-level rate limits | [`security-threat-model.md`](security-threat-model.md) |
| Architecture Decision Records (ADRs 0001–0009) and rationale | [`decisions.md`](decisions.md) |

## Document Catalog

The 11 documents in this directory form a flat, self-contained documentation suite:
- `architecture.md`: Executive architecture, Cloudflare Pages/D1 stack, and Section 9 Operations Runbook.
- `api-spec.md`: Complete API specification for all 9 v1 endpoints, error taxonomy, and auth headers.
- `crypto-spec.md`: Cryptographic primitives, Argon2id KDF profile, envelopes, and KAT test vectors.
- `data-model.md`: D1 schema, Dexie IndexedDB stores, AAD formulas, and verified 384 KiB row fit.
- `sync-protocol.md`: Push/pull sync algorithm, CAS optimistic concurrency, and conflict resolution.
- `device-pairing-recovery.md`: QR exchange, device enrollment, offline recovery kit, and export format.
- `pwa-operational.md`: Service Worker caching lifecycle, iOS ITP eviction defense, and release matrix.
- `ui-ux.md`: Information architecture, component behaviors, bilingual glossary, and Design System tokens.
- `security-threat-model.md`: Trust boundaries, attack vectors, CSP/WASM hash pinning, and rate limits.
- `decisions.md`: Squashed record of Architecture Decision Records (ADRs 0001–0009).
- `README.md`: This navigation index and precedence guide.
