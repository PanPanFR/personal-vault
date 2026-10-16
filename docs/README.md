# Documentation Index

> Canonical map of the `docs/` tree. Update this file whenever a document is added, moved, renamed, or deleted.

## Purpose

Use this index as the first lookup point before searching the whole repository. It is organized for both human contributors and AI agents: each entry states **what** the document owns, **when** to read it, and **where** the authoritative contract lives.

## Quick Routing (AI Agents)

| If you need... | Read first |
|---|---|
| Token/component/UI styling decisions | `frontend/DESIGN.md` |
| Screen flows, UI behavior, UX rules | `frontend/ui-ux.md` |
| PWA, caching, installability, operational runbooks | `frontend/pwa-operational.md` |
| Deployment, migrations, backup/recovery/incident runbook | `setup-recovery-appendix.md` |
| Endpoint schemas, request/response, status codes, caps | `backend/api-spec.md` (normative human source) |
| System stack, hosting, quotas, decisions | `backend/architecture.md` |
| Dexie/D1 storage, tables, indexes, privacy rules | `backend/data-model.md` |
| Key derivation, crypto formats, AAD/KDF details | `backend/crypto-spec.md` |
| Sync algorithm, idempotency, conflicts, tombstones | `backend/sync-protocol.md` |
| Pairing, revocation, recovery/bootstrap/enroll flows | `backend/device-pairing-recovery.md` |
| Security model, headers/CSP, threat analysis | `security/security-threat-model.md` |
| Release acceptance gates and owner mapping | `product/acceptance.md` |
| Architecture decisions and rationale | `adr/*.md` |

## Authoritative Precedence

When documents disagree, resolve in this order:

1. PRD: `personal-vault-prd-v3.md`
2. API contract: `backend/api-spec.md`
3. Other normative specs (`crypto-spec.md`, `data-model.md`, `sync-protocol.md`, etc.)
4. Code and tests

`openapi.yaml` (if present in project) is a machine-readable mirror of `backend/api-spec.md`, not the hand-edited source.

## Document Catalog

### Frontend

| Path | Role | Read when |
|---|---|---|
| `frontend/DESIGN.md` | Personal Vault design system (Catppuccin tokens, components, spacing, motion) | Styling, theming, layout, components, design review |
| `frontend/ui-ux.md` | UI/UX specification, flows, interaction behavior | Building/changing screens, UX acceptance, accessibility behavior |
| `frontend/pwa-operational.md` | PWA lifecycle, caching, storage quotas, operational runbooks | Service worker, offline, install, quota, deployment/runbook work |

### Backend

| Path | Role | Read when |
|---|---|---|
| `backend/api-spec.md` | Normative human-readable API contract (endpoints, auth, caps, errors) | API implementation, client integration, contract drift checks |
| `backend/architecture.md` | Architecture, stack, hosting, decisions | High-level system changes, infra decisions |
| `backend/data-model.md` | Local/server storage model and indexes | Schema, migrations, indexing, data privacy |
| `backend/crypto-spec.md` | Cryptographic specification and parameters | KDF/crypto changes, calibration, test vectors |
| `backend/sync-protocol.md` | Sync algorithm and conflict handling | Mutation sync, cursor handling, conflict resolution |
| `backend/device-pairing-recovery.md` | Pairing, recovery envelopes, enrollment/bootstrap/resync | Device lifecycle, recovery, enrollment |

### Security

| Path | Role | Read when |
|---|---|---|
| `security/security-threat-model.md` | Threat model, controls, metadata disclosure | Security review, hardening, incident analysis |

### Product

| Path | Role | Read when |
|---|---|---|
| `product/acceptance.md` | Acceptance checklist mapped to gates/owners | Release readiness, milestone gates, test planning |

### Operations

| Path | Role | Read when |
|---|---|---|
| `setup-recovery-appendix.md` | Deployment-specific runbook: local dev, Pages+D1 setup, versioned migrations, release gate, backup, recovery, incidents, device matrix | Deploying, migrating, backing up, recovering, or running a release |

### Decisions

| Path | Role | Read when |
|---|---|---|
| `adr/0001-vite-over-nextjs.md` | Vite vs Next.js decision | Tooling/web framework decisions |
| `adr/0002-pages-functions-d1.md` | Pages + Functions + D1 decision | Hosting/runtime/data platform decisions |
| `adr/0003-libsodium-no-handrolled.md` | Crypto library decision | Crypto implementation choices |
| `adr/0004-minisearch-in-memory.md` | Search library decision | Search implementation choices |
| `adr/0005-revision-sync-no-framework.md` | Sync revision decision | Sync implementation choices |
| `adr/0006-custom-device-signature.md` | Device signature decision | Pairing/auth implementation choices |
| `adr/0007-ulid-vault-uuid-records.md` | ID/UUID decision | Data modeling/ID decisions |
| `adr/0008-bilingual-id-en.md` | Internationalization decision | Copy/localization decisions |
| `adr/0009-pages-dev-first.md` | Dev-first deployment decision | Deployment/release decisions |

## Maintenance Rules

- Update this index whenever a document is added, moved, renamed, or removed.
- Prefer one owner per document and keep ownership explicit in plans.
- Do not duplicate normative contract details; link to the owning document instead.
- If a path changes, update both this index and references in `plan/`, `personal-vault-prd-v3.md`, CI, and code.
- Keep descriptions short, factual, and stable; avoid implementation-progress notes here.