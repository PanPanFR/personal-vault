# Implementation Plan: Foundations — Schemas & API Contract Freeze

## Objective

Freeze all data shapes before any UI or crypto code exists, so frontend/backend never drift. Output: item schemas, envelope field names, error-code enum, size caps, version constants, Dexie schema, D1 migrations, and the machine-readable `openapi.yaml` contract (Milestone 3 exit gate, built early per PRD G15).

## Scope

IN: record types (link/note/snippet/credential) field lists; master/recovery envelope fields (Appendix D); error codes (Appendix A) with HTTP mappings; rate-limit table (Appendix B); size caps (256 KiB plaintext / 384 KiB ciphertext / 50 mutations or 1 MiB batch); version constants (`schema_version=1`, `crypto_format_version=1`, `kdf_version=1`, `key_version=1`); ULID vault IDs + UUIDv4 record/device/mutation IDs; Dexie stores (`records`, `outbox`, `device_credentials`, `app_metadata`); D1 tables (`vaults`, `vault_records`, `authorized_devices`, `pairing_tickets` + single-active-ticket index, `sync_changes`); `openapi.yaml` covering all 9 endpoints in §11; tag limits (max 20/item, 64 chars/tag, no control chars or `"`) [technical default, not in PRD v3]; export filename `personal-vault-export-YYYYMMDD.json` [technical default, not in PRD v3]; recovery-kit filename `personal-vault-recovery-kit.json` (Appendix C).
OUT: any UI, any crypto implementation, any Worker code, any sync logic. Those are sibling plans.

## Context

- Stack: Vite + React + TS, Tailwind + shadcn/ui, Cloudflare Pages Functions (Workers runtime) + D1, Dexie.js, libsodium-wrappers-sumo, MiniSearch, Vitest + Playwright. Single Pages project, same-origin `/api/v1/*`.
- PRD: `personal-vault-prd-v3.md` §§8/10/11 + Appendices A–D. Schema-freeze-first is M1-step-1 (fixes G15); contract-freeze is M3 gate (fixes G1).
- User decisions (2026-10-13): passphrase min 8 chars; delete-vs-edit conflict = manual choice UI; device label auto (`Device-XXXX`) renameable; bilingual UI ID+EN switchable in Settings; deploy pages.dev first, custom domain later.
- Technical defaults (planner-decided, challenge if disagree): ULID vault / UUIDv4 record+device+mutation; int cursor from `sync_changes.seq`; tombstone = `is_tombstone=true` + NULL ciphertext; credential `password` is a named field inside encrypted JSON; `api_origin` = creating device's origin.
- Jev verify: tier HIGH (`decision_risk` failure-impact 0.78, conf 0.56; `proceed` 0.47, `needs_human` 0.66 — below strict bar `proceed>=0.8, needs_human<=0.2, conf>=0.5`). `spec_fit` conf 0.22 UNCERTAIN. **Needs human confirm:** schema freeze means later field renames need a contract revision — confirm you accept a freeze now (any rename = minor contract rev). Proceeding with flag noted; builder must not rename frozen fields without a contract rev.
- Jev delegation (shared): `owner` UNCERTAIN (conf 0.24 → default builder-inline), `can_parallel` 0.55 UNCERTAIN → sequential unless noted, `complexity` domain-risk 0.96 HIGH → work split into 4 plans, `needs_subagent` 0.39 UNCERTAIN → inline default. Security review via reviewer (read-only).
- Memory recall: ran `memory_smart_search` (no project-specific lessons; only generic opencode-config lessons). Proceeding with LLM judgment.

## Dependencies

- Requires: PRD v3 only. No code dependency.
- Blocks: `crypto-local-vault`, `cloud-sync-pairing`, `pwa-hardening-release` (all consume this contract; they may start scaffolding but must not finalize field names until this freezes).

## Files / Areas Likely Affected

- `docs/api-spec.md` (NEW — normative human-readable contract; `openapi.yaml` is generated mirror kept in sync by drift CI — never hand-edit both independently)
- `src/lib/schemas.ts` (NEW — item Zod/valibot schemas + tag validator + 256 KiB guard constant)
- `src/lib/versions.ts` (NEW — the four `=1` constants + refuse-to-downgrade helper signatures)
- `src/lib/errors.ts` (NEW — Appendix A code enum + UI category map + HTTP map)
- `src/lib/ids.ts` (NEW — ULID + UUIDv4 generators/validators)
- `src/lib/limits.ts` (NEW — 256 KiB / 384 KiB / 50 / 1 MiB / 5-min ticket / ±5-min clock constants)
- `src/db/dexie-schema.ts` (NEW — Dexie v1 schema, no plaintext content columns)
- `migrations/0001_init.sql` (NEW — D1 tables + indexes + single-active-ticket partial unique index)
- `docs/recovery-kit-format.md` (NEW — Appendix C restatement + base32 round-trip rule)
- `docs/export-format.md` (NEW — export JSON field list)

## Implementation Steps

1. Write `src/lib/versions.ts` + `src/lib/ids.ts` + `src/lib/limits.ts` (constants only, no logic).
2. Write `src/lib/schemas.ts`: four item schemas, envelope field-name lists (master Appendix D ×9 fields, recovery ×4 + verifier), tag validator, plaintext-size guard (measure serialized JSON bytes, reject >256 KiB pre-encryption).
3. Write `src/lib/errors.ts`: all 18 Appendix A codes with HTTP + retryable + UI-category mapping (7 categories).
4. Write Dexie schema + `migrations/0001_init.sql` (all §10 tables/columns/indexes; ciphertext cap comment 384 KiB; no plaintext content indexes).
5. Write `openapi.yaml` (machine-readable mirror of `docs/api-spec.md`): all 9 endpoints, request/response shapes, auth (device token; token+Ed25519 signature where required), size caps, error `code/message/retryable` envelope, `429` + `Retry-After`, bootstrap response = master envelope + versions + `change_cursor` (NOT recovery envelope, NOT device list). `POST /api/v1/recovery/enroll-device` 201 returns `{ vault_id, device_id, device_token, recovery_envelope, created_at }`.
6. Write `docs/export-format.md` + `docs/recovery-kit-format.md`.
7. Add contract-drift CI check (frontend types vs `openapi.yaml` — fail on drift; exact tool up to builder, e.g. openapi-typescript + typecheck).

## Acceptance Criteria

- [ ] `openapi.yaml` covers all 9 §11 endpoints with Appendix A codes + HTTP mappings; reviewed + frozen (M3 gate artifact delivered early). `docs/api-spec.md` is normative human source; `openapi.yaml` is machine-readable mirror.
- [ ] D1 row-size validation gate: verify 384 KiB ciphertext fits D1 row; if limit lower, lower plaintext cap + API + UI together (foundations schema + pwa verify).
- [ ] Error enum has exactly the 18 frozen codes; adding one requires a contract rev (documented).
- [ ] D1 migration includes single-active-ticket partial unique index; Dexie schema has zero plaintext-content columns.
- [ ] Contract-drift CI fails on a deliberate field rename (tested).

## Verification / Tests

- Unit: schema accept/reject boundaries, tag validator, ID format validators, version constants.
- Integration: migration applies cleanly to a fresh local D1; Dexie schema opens with fixtures.
- CI: `tsc --noEmit`, lint, contract-drift check. No crypto/sync tests here (sibling plans).

## Git (branch: feature/foundations-schemas-contract)

- Base: `main`. Builder creates branch, commits, opens PR. No self-merge (integration via `/integrate` in order).

## Integration Notes (merge order vs sibling plans, likely file overlaps)

- Merge order: **1st** (after docs-split; all code plans depend on it). Full order: docs-split → foundations → ui-shell → crypto → sync → pwa-release.
- Sibling overlaps: `crypto-local-vault` and `cloud-sync-pairing` READ these files but must not edit frozen fields — edits here after freeze = contract rev + notify all siblings. `pwa-hardening-release` reads limits/errors only.
- If `openapi.yaml` path disputed (`docs/api-spec.md` vs root `openapi.yaml`): resolved — `docs/api-spec.md` is normative human source (owned by docs-split), `openapi.yaml` is machine-readable mirror (owned by foundations), kept in sync by drift CI. Precedence: PRD > api-spec.md > openapi.yaml > code.

## Delegation Strategy

| Step | Owner | Parallel batch | Why |
|------|-------|----------------|-----|
| 1 constants (versions/ids/limits) | builder | — | Inline: trivial, 3 small files, needs current context |
| 2 item schemas + tag/size guards | builder | — | Inline: core, sequential after step 1 |
| 3 error enum + UI map | builder | A | Independent of step 4, same batch |
| 4 Dexie + D1 migration | builder | A | Independent of step 3, same batch |
| 5 openapi.yaml | builder | — | After 1–4; needs all field names settled |
| 6 export/recovery-kit docs | documenter | B | Docs-only, parallel with step 7 |
| 7 drift CI check | tester | B | Test-only, parallel with step 6 |
| Final review | reviewer | — | Read-only contract review, after all steps |

Batch A = steps 3+4 dispatched together (no shared files). Batch B = steps 6+7 together. Reviewer is read-only, never mutates. No mechanical bulk edits expected; if renames needed across schema files, builder runs them via one shell script inline, never split across subagents.
