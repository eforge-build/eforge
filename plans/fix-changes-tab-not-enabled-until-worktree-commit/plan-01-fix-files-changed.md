---
id: plan-01-fix-files-changed
name: Fix files_changed git command and emit from all file-modifying stages
dependsOn: []
branch: fix-changes-tab-not-enabled-until-worktree-commit/fix-files-changed
---

# Fix files_changed git command and emit from all file-modifying stages

## Architecture Context

The monitor UI's "Changes" tab relies on `build:files_changed` events to enable and populate its file heatmap. Currently, the event is emitted only once (after the `implement` stage) and uses `git diff --name-only baseBranch...HEAD` (three-dot), which only compares committed changes — missing staged and unstaged working tree modifications. The reducer already handles repeated `build:files_changed` events per `planId` by overwriting the previous files array, so emitting from multiple stages is safe.

## Implementation

### Overview

1. Fix the git diff command from three-dot (`baseBranch...HEAD`) to two-dot (`baseBranch`) to capture all committed + staged + unstaged changes.
2. Extract a reusable `emitFilesChanged` async generator helper in `pipeline.ts`.
3. Call the helper at the end of every file-modifying build stage: `implement`, `review-fix`, `doc-update`, `test-write`, `test-fix`.

### Key Decisions

1. **Two-dot diff without `HEAD`** — `git diff --name-only baseBranch` compares the base branch tip to the working tree, which captures committed, staged, and unstaged changes in one command. This is the minimal change needed.
2. **Helper function instead of inline duplication** — A reusable `emitFilesChanged(ctx)` async generator keeps the logic DRY across five stages.
3. **Non-critical, silently caught** — Matching the existing error handling pattern: the helper wraps in try/catch and silently skips on failure since file change tracking is non-critical.

## Scope

### In Scope
- Fixing the git diff command in the `implement` stage
- Extracting `emitFilesChanged` helper
- Adding `yield* emitFilesChanged(ctx)` to `review-fix`, `doc-update`, `test-write`, `test-fix` stages
- Updating tests in `test/files-changed-event.test.ts` if they assert on git command format

### Out of Scope
- Changes to the monitor UI reducer (already handles repeated events)
- Changes to the `build:files_changed` event type definition

## Files

### Modify
- `src/engine/pipeline.ts` — Replace inline git diff + event emission in `implement` stage (~lines 862-871) with a call to new `emitFilesChanged` helper. Add the helper function. Add `yield* emitFilesChanged(ctx)` at the end of `reviewFixStageInner`, `docUpdateStage`, `testWriteStage`, and `testFixStage` (which delegates to `reviewFixStageInner`). For `test-fix`, since it calls `reviewFixStageInner` which will now emit the event, no additional change is needed there — but `testWriteStage` needs it added after the agent loop.
- `test/files-changed-event.test.ts` — Verify existing tests still pass. The tests are type-level checks and event shape assertions that don't reference the git command, so they should pass without changes.

## Verification

- [ ] `git diff --name-only baseBranch` (two-dot, no `HEAD`) is used in the `emitFilesChanged` helper — confirmed by searching `pipeline.ts` for `baseBranch...HEAD` and finding zero matches
- [ ] `emitFilesChanged` helper function exists as an exported or module-level async generator in `pipeline.ts`
- [ ] `implement` stage calls `yield* emitFilesChanged(ctx)` instead of inline git diff code
- [ ] `reviewFixStageInner` calls `yield* emitFilesChanged(ctx)` after the fixer completes
- [ ] `docUpdateStage` calls `yield* emitFilesChanged(ctx)` after the doc updater completes
- [ ] `testWriteStage` calls `yield* emitFilesChanged(ctx)` after the test writer completes
- [ ] `pnpm type-check` exits with code 0
- [ ] `pnpm test` exits with code 0 (all tests pass, including `test/files-changed-event.test.ts`)
