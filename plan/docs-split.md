# Implementation Plan: Docs Split — PRD v3 → Specific Docs via Documenter

## Objective

Split `personal-vault-prd-v3.md` into focused, normative docs under `docs/` so code plans have directed references instead of one giant PRD. Builder dispatches `documenter` subagents in parallel batches; planner does not write docs (planner never mutates).

## Scope

IN: 10 docs + 1 ADR set, all derived (no new product decisions):
- `docs/api-spec.md` (normative human contract; all 9 §11 endpoints, auth, caps, error envelope)
- `docs/architecture.md` (stack §6, decisions §2, hosting §13)
- `docs/adr/` (9 ADRs, see Steps)
- `docs/data-model.md` (§10 Dexie + D1 + indexes)
- `docs/crypto-spec.md` (FR-6 + Appendix D + calibration table + HKDF labels + AAD)
- `docs/sync-protocol.md` (FR-4 + §11 algorithm steps 1–10 + conflict rules + tombstones)
- `docs/device-pairing-recovery.md` (FR-5 4-step + FR-7 flows + kit Appendix C + export format)
- `docs/security-threat-model.md` (§9 + Appendix A codes + Appendix B limits + headers/CSP + metadata disclosure)
- `docs/ui-ux.md` (§7 + FR-2 syntax + FR-8/FR-9 + bilingual + label + passphrase UX)
- `docs/pwa-operational.md` (§5 iOS/ITP + FR-3 SW lifecycle + §12 NFR + §13 quotas + runbook stubs + M6 soak)
- `docs/acceptance.md` (§14 checklist + §15 gates + §17 DoD, each item mapped to owning code plan)
OUT: any `src/`, `functions/`, `migrations/`, `openapi.yaml`, code, tests. Those belong to the 4 frozen code plans. This plan writes `docs/` ONLY.

## Context

- Stack (repeat so fresh session works): Vite + React + TS, Tailwind + shadcn/ui, Cloudflare Pages (static + Functions, Workers runtime) + D1, Dexie.js, libsodium-wrappers-sumo, MiniSearch, Vitest + Playwright. Same-origin `/api/v1/*`.
- Normative source: `personal-vault-prd-v3.md` v3.0 (2026-10-13). On any conflict, **PRD wins**; docs note the conflict, do not silently reinterpret.
- Frozen inputs documenters must reuse verbatim (no reinvention): versions `schema=1/crypto=1/kdf=1/key=1`; IDs (vault ULID, record/device/mutation UUIDv4); caps (256 KiB plain / 384 KiB cipher / 50-or-1 MiB batch / ticket 5-min / clock ±5-min); 18 error codes (App A) + 7 UI categories; 7 rate limits (App B); Argon2id table (Min 64 MiB-t3-p1 / Rec 128 MiB-t4-p1 / Mobile 64-t3-p1 auto-if->3s / Cap 512-t5-p4); HKDF labels `PV-V1/{REC-ENC,LOCAL-CRED,RECOVERY-WRAP,RECOVERY-AUTH}`; AAD `vault||record||schema||key||"record"`; kit file `personal-vault-recovery-kit.json` (App C) + base32 fallback; export `personal-vault-export-YYYYMMDD.json`; tombstone NULL-ciphertext; cursor int; custom `PV-Device` signature header + `X-Server-Time`.
- User decisions (2026-10-13): passphrase min 8; delete-vs-edit = manual dialog; device label auto `Device-XXXX` + rename; bilingual ID+EN (default = device locale, fallback ID); pages.dev first.
- Contract-path resolution (binds foundations plan): hand-written normative source = `docs/api-spec.md` (this plan). `openapi.yaml` (foundations plan) is the generated/machine-readable mirror kept in sync by drift CI — never hand-edit both independently.
- Jev delegation: `owner`=documenter 0.91 conf 0.89 (strong); `needs_subagent`=0.78 YES → builder spawns documenters; `can_parallel`=0.43 UNCERTAIN → explicit file-disjoint batches only; `complexity` coordination-cost 0.78 HIGH → strict file ownership, no two writers per file; `context_isolation` coordination 0.82 HIGH → short self-contained prompts per doc.
- Jev verify: tier HIGH (`decision_risk` failure-impact 0.81 conf 0.62 — wrong contract misleads all code; reversibility 0.19 LOW = markdown easy to fix). `proceed` 0.58, `needs_human` 0.47 — below strict bar. `spec_fit` conf 0.34 UNCERTAIN → MID handling. **Needs human confirm:** docs derive only; any genuine PRD ambiguity found must be left as `> TODO(question): …` in the doc, never invented — confirm you accept TODO-markers over guessed specs. Proceeding with flag; reviewer pass enforces it.

## Dependencies

- Requires: PRD v3 + 4 committed code plans (read for acceptance-mapping only).
- Blocks: foundations `openapi.yaml` finalization (reads `docs/api-spec.md`); all code plans' final review (docs are their directed refs).
- Precedence: PRD > `docs/api-spec.md` > `openapi.yaml` mirror > code.

## Files / Areas Likely Affected

- `docs/api-spec.md`, `docs/architecture.md`, `docs/data-model.md`, `docs/crypto-spec.md`, `docs/sync-protocol.md`, `docs/device-pairing-recovery.md`, `docs/security-threat-model.md`, `docs/ui-ux.md`, `docs/pwa-operational.md`, `docs/acceptance.md` (all NEW)
- `docs/adr/0001-vite-over-nextjs.md` … `0009-pages-dev-first.md` (NEW, 9 files; full list in Steps)
- Nothing else. Documenters must not touch `plan/`, `src/`, `functions/`, `migrations/`, `*.yaml`.

## Implementation Steps

1. (Batch A — contract-critical) Documenter A1: `docs/api-spec.md` ← PRD §11 + App A/B + caps + bootstrap shape (master envelope + versions + cursor; explicitly NOT recovery envelope/device list) + error envelope `{code,message,retryable}` + `429`/`Retry-After` + `X-Server-Time`. Dispatch prompt must include: frozen IDs/caps/codes verbatim + "PRD wins on conflict + TODO-marker rule".
2. (Batch A) Documenter A2: `docs/data-model.md` ← PRD §10 (all 5 tables + columns + indexes + single-active-ticket index + no-plaintext-indexes rule) + Dexie stores + 384 KiB note. Same dispatch rules.
3. (Batch B — security-critical) Documenter B1: `docs/crypto-spec.md` ← FR-6 (KDF table + calibration + floor/ceiling + AAD + HKDF + password-change scope + WASM-fatal) + App D field lists + vectors to ship. Must not alter params.
4. (Batch B) Documenter B2: `docs/sync-protocol.md` ← FR-4 + §11 steps + idempotency keys + CAS/`409` payload + batching + tombstones + crash-safe apply.
5. (Batch B) Documenter B3: `docs/device-pairing-recovery.md` ← FR-5 4-step + revocation + last-seen provenance + FR-7 enroll/bootstrap/unlock/resync + kit App C (fields + base32 + confirm-gate) + export format + rotation rule.
6. (Batch B) Documenter B4: `docs/security-threat-model.md` ← §9 (protected/not + 10 requirements) + App A table + App B table + CSP/headers + metadata disclosure + no-plaintext-logging audit rule.
7. (Batch C — product/ops) Documenter C1: `docs/architecture.md` (decisions §2 incl. crypto-blocking + stack §6 + hosting/quotas §13 + sync triggers) + `docs/adr/` (9 ADRs: 0001 vite-over-nextjs, 0002 pages-functions-d1, 0003 libsodium-no-handrolled, 0004 minisearch-in-memory, 0005 revision-sync-no-framework, 0006 custom-device-signature, 0007 ulid-vault-uuid-records, 0008 bilingual-id-en, 0009 pages-dev-first; each: Status accepted, Context, Decision, Consequences). One writer owns whole `adr/` dir.
8. (Batch C) Documenter C2: `docs/ui-ux.md` ← §7 + FR-1 types + FR-2 syntax + FR-8 mask/clipboard + FR-9 settings + user decisions (min-8, manual-conflict, auto-label, bilingual, pages.dev).
9. (Batch C) Documenter C3: `docs/pwa-operational.md` ← §5 iOS/ITP + FR-3 SW lifecycle + §12 NFR + §13 deploy/quotas/debounce + runbook stubs + M6 soak rule (test data first).
10. (Batch C) Documenter C4: `docs/acceptance.md` ← §14 checkboxes grouped by owning plan (foundations/crypto/sync/pwa) + M3/M1 gates + §17 DoD + G1–G15 trace (each fix → where verified).
11. Reviewer (read-only): cross-doc consistency — field names/codes/limits/params identical everywhere, no invented specs, TODO-markers listed, no `src/` touched.

## Acceptance Criteria

- [ ] All 10 docs + 9 ADRs exist under `docs/`; zero files outside `docs/` modified.
- [ ] `docs/api-spec.md` covers all 9 endpoints + App A/B + caps; declared normative human source.
- [ ] Every doc cites its PRD sections; conflicts (if any) note "PRD wins" + TODO, never silent rewrite.
- [ ] Genuine ambiguities are `TODO(question)` markers with a collected list (max ~10); no guessed crypto/sync semantics.
- [ ] Acceptance doc maps every §14 checkbox to exactly one owning code plan.
- [ ] Reviewer pass clean (terms/codes/params consistent across all docs).

## Verification / Tests

- Reviewer checklist (read-only): spot-check 3 field names, 3 codes, KDF table, kit fields against PRD; confirm no new params; confirm `docs/` file ownership disjoint.
- Builder: `git status` shows only `docs/` + `plan/docs-split.md`; markdown renders (no broken tables); TODO list extracted via single grep.
- No unit/e2e tests in this plan (docs-only).

## Git (branch: feature/docs-split)

- Base: `main`. Builder creates branch, commits docs, opens PR. No self-merge (`/integrate` order below).

## Integration Notes (merge order vs sibling plans, likely file overlaps)

- Merge order: **0th — before all 4 code plans** (docs are their directed refs). Updated full order: docs-split → foundations → crypto → sync → pwa-release.
- File overlaps: NONE by construction (this plan owns `docs/` only; foundations owns root `openapi.yaml` + `src/lib/*` + `migrations/`). Known mirror pair (`docs/api-spec.md` ↔ `openapi.yaml`) kept in sync by foundations' drift CI; on conflict PRD > api-spec > yaml.
- ADR decisions are records of already-frozen choices (PRD §2 + user answers), not new decision venues — any ADR wanting a different choice becomes a TODO, not a change.

## Delegation Strategy

| Step | Owner | Parallel batch | Why |
|------|-------|----------------|-----|
| 1 api-spec | documenter | A | Normative contract; batch with 2 (disjoint files) |
| 2 data-model | documenter | A | Same batch A, no shared files with 1 |
| 3 crypto-spec | documenter | B | Security batch; disjoint from 4–6 |
| 4 sync-protocol | documenter | B | Same batch B, disjoint files |
| 5 pairing-recovery | documenter | B | Same batch B, disjoint files |
| 6 threat-model | documenter | B | Same batch B, disjoint files |
| 7 architecture + adr/ | documenter | C | One writer for whole dir; batch C |
| 8 ui-ux | documenter | C | Same batch C, disjoint files |
| 9 pwa-operational | documenter | C | Same batch C, disjoint files |
| 10 acceptance | documenter | C | Same batch C, disjoint files |
| 11 consistency pass | reviewer | — | Read-only, after all batches; lists TODOs |

Batch A = steps 1–2 in one message. Batch B = steps 3–6 in one message. Batch C = steps 7–10 in one message. Each documenter prompt is self-contained (goal + PRD sections + frozen inputs + output path + TODO-rule). Reviewer never mutates. No mechanical bulk edits; TODO extraction via one inline grep (`grep -rn "TODO(question)" docs/`), never split.
