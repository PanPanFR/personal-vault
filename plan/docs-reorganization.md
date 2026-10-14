# Implementation Plan: Reorganize docs into category folders

## Objective
Reorganize the flat `docs/` directory into category folders (frontend/backend/security/product) while retaining a root `docs/README.md` index, and update all internal references without breaking plans or PRD cross-links.

## Scope
- In scope: move 12 documentation files into category folders; add `docs/README.md`; update references in markdown/plans/code/config.
- Out of scope: content edits, new docs, architecture changes, deletions.
- Safe rollback: single commit revert.

## Context
- Repo root contains many `docs/*.md` files consumed by plans/PRD.
- Existing `docs/adr/` already category folder precedent.
- Plans reference paths like `docs/api-spec.md`, `docs/ui-ux.md` extensively.
- Need a one-shot mechanical move + reference rewrite to avoid drift.

## Files / Areas Likely Affected
- docs/README.md (new index)
- docs/frontend/*
- docs/backend/*
- docs/security/*
- docs/product/*
- docs/adr/* (unchanged, already foldered)
- plan/*.md references
- personal-vault-prd-v3.md references
- any code/config referencing docs paths (e.g. CI contract drift)

## Proposed Structure
```
docs/
  README.md
  adr/
  frontend/
    DESIGN.md
    ui-ux.md
    pwa-operational.md
  backend/
    api-spec.md
    architecture.md
    data-model.md
    crypto-spec.md
    sync-protocol.md
    device-pairing-recovery.md
  security/
    security-threat-model.md
  product/
    acceptance.md
```

## Implementation Steps
1. Create new directories.
2. Move files according to mapping above (git mv to preserve history).
3. Create `docs/README.md` table listing new paths.
4. Run mechanical reference rewrite across `**/*.md`, `**/*.yaml`, `**/*.yml`, `**/*.ts`, `**/*.js`, `**/*.json`, `**/*.toml` (adjust README too).
   - Replace `docs/adr/` stays.
   - Replace other paths using mapping table.
5. Verify no stale old paths remain (`grep` for `docs/(api-spec|architecture|...)`).
6. Run project tests/lint if any affected; docs-only change should still validate markdown links.
7. Review git diff for unintended moves.

## Path Mapping
| Old | New |
|-----|-----|
| docs/DESIGN.md | docs/frontend/DESIGN.md |
| docs/ui-ux.md | docs/frontend/ui-ux.md |
| docs/pwa-operational.md | docs/frontend/pwa-operational.md |
| docs/api-spec.md | docs/backend/api-spec.md |
| docs/architecture.md | docs/backend/architecture.md |
| docs/data-model.md | docs/backend/data-model.md |
| docs/crypto-spec.md | docs/backend/crypto-spec.md |
| docs/sync-protocol.md | docs/backend/sync-protocol.md |
| docs/device-pairing-recovery.md | docs/backend/device-pairing-recovery.md |
| docs/security-threat-model.md | docs/security/security-threat-model.md |
| docs/acceptance.md | docs/product/acceptance.md |

## Acceptance Criteria
- All docs files reachable at new paths.
- No references to old flat paths (except historical archives explicitly listed).
- `docs/README.md` index reflects new structure.
- Git history preserved via `git mv`.
- No test regressions from path changes.

## Verification / Tests
- `grep` stale paths across repo; expected none for active refs.
- `git status` shows renames, no accidental deletions.
- Run targeted docs lint if available (markdown-link-check) or manual spot check.

## Git (branch: docs/reorganize)
Commit after verification; keep a single commit for moves + rewrite.

## Integration Notes
- New plan supersedes root docs references in existing plans; apply this before executing those plans.
- Plans referencing `docs/*.md` must be updated (included in step 4).
- `adr/` unchanged, so ADR consumers unaffected.
- If old external links exist (outside repo), they will 404; README index can note redirects conceptually (no actual redirect in static repo).

## Delegation Strategy
| Step | Owner | Parallel batch | Why |
|------|-------|----------------|-----|
| 1 | builder | - | Shell mkdir + git mv |
| 2 | builder | - | Add README index |
| 3 | builder | - | Mechanical sed across file types |
| 4 | reviewer | A | Validate path mapping and no stale refs |
| 5 | tester | A | Run check commands |
Batch A = reviewer + tester parallel. Inline mechanical steps are builder single shell scripts.