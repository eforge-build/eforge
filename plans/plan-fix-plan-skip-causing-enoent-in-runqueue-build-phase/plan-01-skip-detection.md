---
id: plan-01-skip-detection
name: Add plan:skip detection to runQueue
dependsOn: []
branch: plan-fix-plan-skip-causing-enoent-in-runqueue-build-phase/skip-detection
---

# Add plan:skip detection to runQueue

## Architecture Context

The `runQueue()` method in `src/engine/eforge.ts` iterates compile events and then unconditionally proceeds to `this.build()`. When the planner emits `plan:skip` (work already done), compile completes successfully but never writes `orchestration.yaml`. The build phase then fails with ENOENT trying to read that file. The fix adds skip detection alongside the existing `compileFailed` pattern.

## Implementation

### Overview

Track `plan:skip` events during compile iteration in `runQueue()`. When detected, set the PRD status to `skipped` and `continue` to the next PRD — bypassing the build phase entirely. This follows the identical control flow pattern already used for `compileFailed`.

### Key Decisions

1. Reuse the `compileFailed` pattern (boolean flag + early `continue`) for consistency — no new abstractions needed
2. Use `'skipped'` as the PRD status, which is already a valid value in the `PrdStatus` type (`src/engine/prd-queue.ts` line 22)

## Scope

### In Scope
- `src/engine/eforge.ts` `runQueue()` method: add `skipped` boolean + `skipReason` string, detect `plan:skip` events, early-continue with `'skipped'` status

### Out of Scope
- Changes to the planner or `plan:skip` event emission logic
- Changes to the compile pipeline
- Changes to the PRD frontmatter schema (already supports `'skipped'`)

## Files

### Modify
- `src/engine/eforge.ts` — In `runQueue()` (~lines 647-667): add `skipped` and `skipReason` variables, detect `plan:skip` in the compile event loop, add early-continue block after `compileFailed` check

## Verification

- [ ] `pnpm type-check` passes with zero errors
- [ ] `pnpm test` — all existing tests pass
- [ ] `./eval/run.sh todo-api-errand-skip` exits 0 with a skip message (no ENOENT)
- [ ] When `plan:skip` is emitted during compile in queue mode, `prdResult.status` is `'skipped'` and `this.build()` is never called
- [ ] The `skipped` status is written to the PRD file frontmatter via `updatePrdStatus()`
