---
id: plan-01-skip-detection
name: Add plan:skip detection to runQueue
depends_on: []
branch: plan-fix-plan-skip-causing-enoent-in-runqueue-build-phase/skip-detection
---

# Add plan:skip detection to runQueue

## Architecture Context

The `runQueue()` method in `EforgeEngine` iterates compile events and then unconditionally calls `build()`. When the planner emits `plan:skip` (work already complete), compile succeeds but never writes `orchestration.yaml`. The subsequent `build()` call fails with ENOENT when `validatePlanSet()` tries to read the missing file.

The fix follows the existing `compileFailed` pattern — track a boolean during compile event iteration and short-circuit before `build()`.

## Implementation

### Overview

Add a `skipped` boolean and `skipReason` string alongside the existing `compileFailed` flag in `runQueue()`. When a `plan:skip` event is seen during compile iteration, set `skipped = true`. After compile completes, check `skipped` before entering the build phase — if true, set `prdResult` to `{ status: 'skipped', summary: skipReason }` and `continue` to the next PRD.

### Key Decisions

1. Follow the identical control flow pattern as `compileFailed` — a boolean flag set during event iteration, checked after the loop, with `continue` to skip remaining processing. This keeps the code consistent and minimal.
2. Use `'skipped'` as the `prdResult.status` value — the `PrdStatus` type already includes `'skipped'` in its union (`src/engine/prd-queue.ts` line 22), so no type changes are needed.

## Scope

### In Scope
- `runQueue()` method in `src/engine/eforge.ts`: add skip detection between compile and build phases

### Out of Scope
- Planner agent logic or `plan:skip` event emission
- Compile pipeline stages
- PRD frontmatter schema changes
- Test file changes (no existing unit tests cover `runQueue` — it's integration-level per CLAUDE.md conventions)

## Files

### Modify
- `src/engine/eforge.ts` — Add `skipped`/`skipReason` tracking in `runQueue()` compile event loop (~lines 647-667). Insert skip check between the `compileFailed` check and the build phase.

## Verification

- [ ] `pnpm type-check` passes with zero errors
- [ ] `pnpm test` passes — all existing tests remain green
- [ ] `./eval/run.sh todo-api-errand-skip` exits 0 (skip scenario no longer crashes with ENOENT)
- [ ] In `runQueue()`, when `plan:skip` is emitted during compile, `prdResult.status` is set to `'skipped'` and the build phase loop is never entered
- [ ] The `skipped` check appears after `compileFailed` check and before the build phase, following the same `continue` pattern
