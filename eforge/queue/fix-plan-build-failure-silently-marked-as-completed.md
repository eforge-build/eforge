---
title: Fix: Plan build failure silently marked as completed
created: 2026-04-17
---

# Fix: Plan build failure silently marked as completed

## Problem / Motivation

When a plan's build pipeline fails (e.g., a "Backend error: Expected double-quoted property name in JSON..." yielded as a `build:failed` event), the orchestrator still records the plan as `completed`, merges it into the feature branch, and schedules dependents. The observed behavior is `build:failed` → `merge:start` → `merge:complete` → `schedule:ready` for the dependent plan. This means failed builds silently propagate, corrupt the feature branch with broken merges, and unblock dependent plans that should never run.

### Root Cause

`runBuildPipeline` in `packages/engine/src/pipeline.ts:1988` yields a `build:failed` event and sets `ctx.buildFailed = true`, then the for-loop at line 2023 returns **normally** (no throw). The async generator closes cleanly.

In `packages/engine/src/orchestrator/phases.ts:237` (`launchPlan`), the `for await (const event of planRunner(...))` loop on line 254 completes without exception. Control falls through to line 258:

```ts
transitionPlan(state, planId, 'completed');
```

The plan is marked `completed` despite the failure event. The merge block at `phases.ts:347-348` checks `planState.status !== 'completed'`, so the merge proceeds, status transitions to `merged`, dependents see their dependency satisfied, and scheduling continues.

The `catch` path at `phases.ts:260-270` (which does call `propagateFailure`) is never reached because no error was thrown.

## Goal

A plan that emits `build:failed` must be marked `failed`, its merge must be skipped, and failure must propagate to dependents so the overall build fails.

## Approach

Inspect events while forwarding them inside `launchPlan` and branch on whether a `build:failed` event was observed. Single change in `packages/engine/src/orchestrator/phases.ts` (around lines 253-259):

```ts
// Delegate to injected plan runner
let buildFailedError: string | undefined;
for await (const event of planRunner(planId, worktreePath, plan)) {
  if (event.type === 'build:failed' && event.planId === planId) {
    buildFailedError = event.error;
  }
  eventQueue.push(event);
}

if (buildFailedError !== undefined) {
  transitionPlan(state, planId, 'failed', { error: buildFailedError });
  saveState(stateDir, state);
  const failureEvents = propagateFailure(state, planId, config.plans);
  saveState(stateDir, state);
  for (const e of failureEvents) eventQueue.push(e);
} else {
  transitionPlan(state, planId, 'completed');
  saveState(stateDir, state);
}
```

Key notes:

- The `build:failed` event is still forwarded to the event queue - no change in the observable event stream for the UI/logs.
- `propagateFailure` (`phases.ts:68`) already walks transitive dependents and marks them `blocked` with a `build:failed` event per dependent, so a dependent plan would be correctly blocked rather than scheduled.
- The subsequent merge loop at `phases.ts:344-361` already short-circuits when `planState.status !== 'completed'`, so no change is needed there.
- `shouldSkipMerge` and the existing `catch (err)` path in `launchPlan` remain unchanged and continue to handle worktree-acquisition and unexpected exceptions.
- `runBuildPipeline` is not changed to throw instead of yielding `build:failed` - the yield-and-return contract is shared with continuation-retry logic and reviewing/gap-closing paths; changing it has wider blast radius than the orchestrator-side fix.

### Files to modify

- `packages/engine/src/orchestrator/phases.ts` - update the body of `launchPlan` (lines ~253-259) as described above.

### Tests

Add one vitest case to `test/orchestration-logic.test.ts` (or a new `test/orchestrator-failure.test.ts` if that file's scope is too narrow) that:

1. Constructs a two-plan config where plan B depends on plan A.
2. Injects a stub `PlanRunner` that yields `build:failed` for plan A.
3. Runs `executePlans` (via the orchestrator) to completion.
4. Asserts: plan A status is `failed`, plan B status is `blocked`, no `merge:start`/`merge:complete` events were emitted, and overall `state.status` ends `failed`.

Reuse `StubBackend` patterns from `test/agent-wiring.test.ts` if any backend wiring is needed. The test exercises only the orchestrator/phases layer, so a hand-crafted `PhaseContext` with a stub `planRunner` is sufficient.

## Scope

### In scope

- Detecting `build:failed` events in the `launchPlan` event loop and marking the plan as `failed` instead of `completed`.
- Propagating failure to dependent plans so they are blocked.
- Skipping the merge step for failed plans.
- Unit test covering the two-plan dependency chain failure propagation.

### Out of scope

- **Aborting already-running parallel plans when a sibling fails.** The reported bug involves a serial dependent chain, and the immediate correctness fix (mark `failed`, propagate, skip merge) resolves it. A broader "any failure aborts all in-flight plans" change is a separate design decision - flag it back to the user if they want that semantic added.
- **Changing `runBuildPipeline` to throw instead of yielding `build:failed`.** The yield-and-return contract is shared with continuation-retry logic and reviewing/gap-closing paths; changing it has wider blast radius than the orchestrator-side fix.

## Acceptance Criteria

- A plan that yields a `build:failed` event is transitioned to `failed` status (not `completed`).
- No `merge:start` or `merge:complete` events are emitted for a failed plan.
- Dependent plans of a failed plan are transitioned to `blocked` status and are not scheduled.
- Overall build state ends as `failed` when any plan fails.
- The `build:failed` event is still forwarded to the event queue (observable event stream unchanged for UI/logs).
- `pnpm build` succeeds.
- `pnpm test` passes, including the new test case and the existing suite.
- `pnpm type-check` shows no type regressions.
- Manual verification: forcing the backend to emit a JSON-parse error during `build:implement` for plan 01 of a two-plan build confirms in the monitor UI that plan 02 is not scheduled and the overall build ends in a failed state.
