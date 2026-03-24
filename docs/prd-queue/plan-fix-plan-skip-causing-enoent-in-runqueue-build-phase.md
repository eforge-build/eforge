---
title: Plan: Fix plan:skip causing ENOENT in runQueue build phase
created: 2026-03-24
status: pending
---

# Fix plan:skip causing ENOENT in runQueue build phase

## Problem / Motivation

When the planner emits `plan:skip` (work already done), the compile pipeline halts before writing `orchestration.yaml`. The queue runner in `runQueue()` then unconditionally calls `build()`, which tries to read the missing file and fails with a raw ENOENT. The eval scenario `todo-api-errand-skip` exposes this — eforge exits 1 with "Plan set validation failed: ENOENT" instead of cleanly skipping the build.

The root cause is in `src/engine/eforge.ts` lines 650-682: `runQueue()` iterates compile events but doesn't check for `plan:skip`. After compile completes (successfully — skip is not a failure), it unconditionally proceeds to `this.build()`. The build phase calls `validatePlanSet()` which reads `orchestration.yaml` — a file that was never written because the planner skipped.

## Goal

When the planner skips (work already complete), the queue runner should detect the skip, update the PRD status to `skipped`, and continue to the next PRD — instead of falling through to the build phase and crashing on a missing `orchestration.yaml`.

## Approach

1. **Track `plan:skip` in `runQueue()`** (`src/engine/eforge.ts` ~line 650-662): Add a `skipped` boolean alongside `compileFailed`. When iterating compile events, set `skipped = true` if a `plan:skip` event is seen. After compile, if `skipped`, update `prdResult` to `{ status: 'skipped', summary: skipReason }` and `continue` to the next PRD — same pattern as `compileFailed`.

   ```typescript
   let compileFailed = false;
   let skipped = false;
   let skipReason = '';

   for await (const event of this.compile(...)) {
     yield { ...event, sessionId: prdSessionId } as EforgeEvent;
     if (event.type === 'phase:end' && event.result.status === 'failed') {
       compileFailed = true;
     }
     if (event.type === 'plan:skip') {
       skipped = true;
       skipReason = event.reason;
     }
   }

   if (compileFailed) {
     prdResult = { status: 'failed', summary: 'Compile failed' };
     continue;
   }
   if (skipped) {
     prdResult = { status: 'skipped', summary: skipReason || 'Planner skipped — work already complete' };
     continue;
   }
   ```

2. **Verify `prdResult.status` supports `'skipped'`**: Confirm the type of `prdResult.status` and `updatePrdStatus()` accept `'skipped'`. The PRD frontmatter schema already has `'skipped'` as a valid status value (`src/engine/prd-queue.ts`), so this should work without changes.

## Scope

**In scope:**
- `src/engine/eforge.ts` — `runQueue()` method: add skip detection + early continue

**Out of scope:**
- Changes to the planner or `plan:skip` event emission logic
- Changes to the compile pipeline itself
- Changes to the PRD frontmatter schema (already supports `'skipped'`)

## Acceptance Criteria

- `pnpm test` — all existing tests pass
- `./eval/run.sh todo-api-errand-skip` — eforge exits cleanly with a skip message instead of an ENOENT crash
- When `plan:skip` is emitted during compile in queue mode, the PRD status is updated to `skipped` in the queue file frontmatter and the build phase is not entered
- The skip handling follows the same control flow pattern as `compileFailed` (update `prdResult`, `continue` to next PRD)
