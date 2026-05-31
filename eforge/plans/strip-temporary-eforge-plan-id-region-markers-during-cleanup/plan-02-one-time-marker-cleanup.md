---
id: plan-02-one-time-marker-cleanup
name: One-Time Plan-ID Marker Removal
branch: strip-temporary-eforge-plan-id-region-markers-during-cleanup/plan-02-one-time-marker-cleanup
agents:
  builder:
    rationale: This plan is a broad mechanical source edit across many tracked
      files; shards let builders remove marker-only lines in disjoint roots
      without overlapping edits.
    shards:
      - id: engine
        roots:
          - packages/engine/src/
      - id: package-surfaces
        roots:
          - packages/client/src/
          - packages/monitor/src/
          - packages/extension-sdk/src/
          - packages/docs-gen/src/
          - packages/eforge/src/
          - packages/pi-eforge/extensions/
      - id: ui
        roots:
          - packages/console-ui/src/
          - packages/monitor-ui/src/
          - packages/monitor-ui/test/
      - id: tests
        roots:
          - test/
      - id: scripts-config
        roots:
          - scripts/
        files:
          - vitest.main.config.ts
---

# One-Time Plan-ID Marker Removal

## Architecture Context

Plan 01 adds automatic marker stripping to future successful cleanup commits. This plan performs the one-time mechanical source cleanup requested by the source document: remove existing tracked eforge region marker comment lines whose slug matches the temporary plan-ID form, while preserving all code and all durable semantic region markers.

This plan is intentionally sharded because the current repository scan finds temporary marker lines across more than 170 tracked source/test files.

## Implementation

### Overview

Remove only marker comment lines matching temporary plan-ID slugs from tracked JavaScript/TypeScript-family source files. Do not remove code between marker lines. Do not remove semantic markers such as `types`, `path-normalization`, `provenance-collection`, or any other slug that does not match `plan-\d{2}-...`.

### Key Decisions

1. Treat this as a marker-only deletion pass: every changed line must be an eforge `region` or `endregion` marker line with a `plan-NN-*` slug.
2. Use repository searches to discover the current file set rather than relying on a stale hand-written list.
3. Keep test fixture strings introduced by Plan 01 split across string fragments so the final grep does not match test source.
4. Run the final grep after all shard edits merge to prove no tracked source line still contains `eforge:(end)?region plan-[0-9]{2}-`.

## Scope

### In Scope

- Remove existing `// --- eforge:region plan-NN-* ---` and `// --- eforge:endregion plan-NN-* ---` marker comment lines from tracked source/test/config files.
- Remove equivalent temporary JSX marker comment lines if any are found in the sharded roots.
- Preserve all non-marker content.
- Preserve all semantic/durable non-plan markers.
- Verify marker balance after removal with `pnpm maintainability:check`.

### Out of Scope

- Refactoring code inside formerly marked regions.
- Collapsing blank lines except where the marker line itself is deleted.
- Removing semantic marker comments.
- Editing generated `dist/`, `node_modules/`, `.eforge/`, or untracked files.

## Files

### Create

- None.

### Modify

Remove temporary marker comment lines from all tracked files returned by this command within the shard-owned roots:

```bash
git ls-files -z | xargs -0 rg -l "eforge:(end)?region plan-[0-9]{2}-"
```

At planning time, the affected roots were:

- `packages/engine/src/` — engine implementation files.
- `packages/client/src/` — client API, event schema, and client test files.
- `packages/monitor/src/` — daemon/server files and monitor tests.
- `packages/extension-sdk/src/` — extension SDK source.
- `packages/docs-gen/src/` — docs generator source.
- `packages/eforge/src/` — CLI source.
- `packages/pi-eforge/extensions/` — Pi extension command files.
- `packages/console-ui/src/` — active console UI source and tests.
- `packages/monitor-ui/src/` and `packages/monitor-ui/test/` — legacy monitor UI source and tests.
- `test/` — root Vitest tests.
- `scripts/` — repository scripts.
- `vitest.main.config.ts` — main Vitest project config.

Each shard must stay inside its assigned roots/files.

## Shard Instructions

For each file in the shard scope:

1. Remove only whole marker comment lines whose slug matches `plan-\d{2}-...`.
2. Keep all code lines and all comments that are not temporary eforge marker lines.
3. Keep every marker whose slug does not match `plan-\d{2}-...`.
4. After editing, run a shard-local search such as:

```bash
rg "eforge:(end)?region plan-[0-9]{2}-" <shard-root-or-file>
```

If the search still reports a match, inspect the line. If it is a temporary marker comment line in the shard scope, remove that marker line. If it is not a marker comment line, do not change it without confirming it is covered by the source requirements.

## Verification

- [ ] Every changed line in this plan is a deleted eforge temporary marker line or an adjacent newline effect from deleting that marker line.
- [ ] `git diff --check` exits 0.
- [ ] `bash -lc 'if git ls-files -z | xargs -0 rg -n "eforge:(end)?region plan-[0-9]{2}-"; then exit 1; fi'` exits 0.
- [ ] `pnpm maintainability:check` exits 0.
- [ ] `pnpm type-check` exits 0 after this plan is merged on top of Plan 01.
- [ ] `pnpm exec vitest run test/region-marker-cleanup.test.ts test/prd-artifact.test.ts test/stack-landing-cleanup.test.ts test/agent-maintainability-check.test.ts` exits 0 after this plan is merged on top of Plan 01.