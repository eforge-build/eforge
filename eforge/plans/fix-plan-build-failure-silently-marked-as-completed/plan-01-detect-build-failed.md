---
id: plan-01-detect-build-failed
name: Detect build:failed in launchPlan and propagate failure
depends_on: []
branch: fix-plan-build-failure-silently-marked-as-completed/detect-build-failed
---

# Detect build:failed in launchPlan and propagate failure

## Architecture Context

`executePlans` in `packages/engine/src/orchestrator/phases.ts` is an async generator that launches plans, merges completed ones, and schedules dependents. Each plan is launched via `launchPlan`, which iterates over events from the injected `PlanRunner`. Currently, `launchPlan` unconditionally transitions the plan to `completed` after the event loop finishes (line 258), even if the runner yielded a `build:failed` event. The `catch` block (lines 260-270) that calls `propagateFailure` is never reached because `runBuildPipeline` yields `build:failed` and returns normally rather than throwing.

The merge loop at lines 344-348 only merges plans with `status === 'completed'`, so a correctly-failed plan would naturally be skipped. The `propagateFailure` function (line 68) already walks transitive dependents and marks them `blocked`. The only missing piece is detecting the failure in `launchPlan`.

## Implementation

### Overview

Track whether a `build:failed` event was observed during the `launchPlan` event loop. After the loop, branch on that flag: if a failure was observed, transition the plan to `failed` and call `propagateFailure`; otherwise transition to `completed` as before.

### Key Decisions

1. **Detect via event inspection, not by changing `runBuildPipeline` semantics.** The yield-and-return contract in the pipeline is shared with continuation-retry and gap-closing paths. Changing it to throw has wider blast radius. Inspecting events in the consumer is surgical and safe.
2. **Capture the error string from the `build:failed` event** so it propagates into the plan's error field via `transitionPlan`.
3. **Continue forwarding `build:failed` events to the event queue** - the observable event stream for UI/logs is unchanged.

## Scope

### In Scope
- Detecting `build:failed` events in the `launchPlan` for-await loop and setting a flag
- Branching after the loop: `failed` transition + `propagateFailure` vs `completed` transition
- Test covering the two-plan dependency chain failure propagation through `executePlans`

### Out of Scope
- Aborting already-running parallel plans when a sibling fails
- Changing `runBuildPipeline` to throw instead of yielding `build:failed`
- Any changes to the merge loop (it already short-circuits on non-completed plans)

## Files

### Modify
- `packages/engine/src/orchestrator/phases.ts` - In the `launchPlan` closure (lines ~253-259): add a `let buildFailedError: string | undefined` variable before the `for await` loop. Inside the loop, check each event for `event.type === 'build:failed' && event.planId === planId` and capture `event.error`. After the loop, if `buildFailedError` is defined, call `transitionPlan(state, planId, 'failed', { error: buildFailedError })`, `saveState`, `propagateFailure`, `saveState`, and push failure events. Otherwise call `transitionPlan(state, planId, 'completed')` and `saveState` as before.
- `test/orchestration-logic.test.ts` - Add a new `describe('executePlans - build:failed handling')` block with a test that:
  1. Creates a two-plan config (plan-a with no deps, plan-b depending on plan-a)
  2. Initializes state via `initializeState` and constructs a `PhaseContext` with a stub `PlanRunner` that yields `{ type: 'build:failed', planId: 'plan-a', error: 'JSON parse error', timestamp: ... }` for plan-a and yields nothing for plan-b
  3. Stubs `WorktreeManager` with `acquireForPlan` returning a temp path, `releaseForPlan`/`mergePlan`/`reconcile` as no-ops
  4. Collects all events from `executePlans(ctx)` into an array
  5. Asserts: `state.plans['plan-a'].status === 'failed'`, `state.plans['plan-b'].status === 'blocked'`, no events with `type: 'merge:start'` or `type: 'merge:complete'` exist in collected events, and a `build:failed` event for plan-a is present in the collected events

## Verification

- [ ] `pnpm type-check` passes with zero errors
- [ ] `pnpm test` passes, including the new `executePlans - build:failed handling` test
- [ ] `pnpm build` succeeds
- [ ] In the modified `launchPlan`, `build:failed` events are still pushed to `eventQueue` (event stream unchanged)
- [ ] After the for-await loop, `transitionPlan(state, planId, 'failed', ...)` is called when `buildFailedError` is defined
- [ ] `propagateFailure` is called for the failed plan, blocking transitive dependents
- [ ] The `else` branch still calls `transitionPlan(state, planId, 'completed')` for non-failed plans