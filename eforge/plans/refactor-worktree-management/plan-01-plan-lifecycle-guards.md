---
id: plan-01-plan-lifecycle-guards
name: Plan Lifecycle Guards
depends_on: []
branch: refactor-worktree-management/plan-lifecycle-guards
---

# Plan Lifecycle Guards

## Architecture Context

The orchestrator calls `updatePlanStatus()` from `state.ts` in 7+ places with no validation of transition legality. Any caller can set any status at any time. This plan introduces a guarded transition function that enforces a strict transition table, catching invalid transitions at the call site rather than producing corrupt state downstream.

This is the foundation for later plans - the guarded transitions make it safe to decompose `execute()` into phases (plan-03) because each phase can only perform transitions it's allowed to.

## Implementation

### Overview

Create `src/engine/orchestrator/plan-lifecycle.ts` with a `transitionPlan()` function that validates status transitions against a transition table before delegating to `updatePlanStatus()`. Replace all `updatePlanStatus()` calls in `orchestrator.ts` and all `updatePlanStatus()` calls in `propagateFailure()` and `resumeState()` with `transitionPlan()`.

### Key Decisions

1. **No state machine library** - the transition table is a simple `Record<Status, Status[]>` literal. Adding a library for 6 states is overengineering.
2. **Throw on invalid transition** - callers should crash-loud when they attempt an illegal transition. This catches bugs immediately rather than producing corrupt state.
3. **Metadata parameter** - `transitionPlan()` accepts optional `metadata?: { error?: string }` so callers can set the error field atomically with the transition (currently done as a separate mutation after `updatePlanStatus()`).
4. **Delegating to existing `updatePlanStatus()`** - `transitionPlan()` validates then calls `updatePlanStatus()` from `state.ts`. The existing function handles `completedPlans` bookkeeping. No changes to `state.ts`.

## Scope

### In Scope
- Creating `src/engine/orchestrator/` directory
- Creating `src/engine/orchestrator/plan-lifecycle.ts` with `transitionPlan()` and `VALID_TRANSITIONS`
- Replacing all `updatePlanStatus()` calls in `orchestrator.ts` with `transitionPlan()`
- Replacing `updatePlanStatus()` calls in `propagateFailure()` and `resumeState()` with `transitionPlan()`
- Unit tests for valid transitions, invalid transitions, and metadata propagation

### Out of Scope
- Changing the transition states themselves (pending, running, completed, failed, blocked, merged stay the same)
- Changes to `state.ts` (updatePlanStatus remains as the low-level mutator)
- Any behavioral changes to orchestrator execution flow

## Files

### Create
- `src/engine/orchestrator/plan-lifecycle.ts` - Transition table, `transitionPlan()` function, exported `VALID_TRANSITIONS` constant
- `test/plan-lifecycle.test.ts` - Unit tests for transition validation

### Modify
- `src/engine/orchestrator.ts` - Replace all `updatePlanStatus()` calls with `transitionPlan()`. Add import of `transitionPlan` from `./orchestrator/plan-lifecycle.js`. The import of `updatePlanStatus` from `./state.js` is removed from this file since all calls go through `transitionPlan()`.

## Verification

- [ ] `pnpm type-check` passes with zero errors
- [ ] `pnpm test` passes (all existing tests remain green)
- [ ] Every `updatePlanStatus()` call in `orchestrator.ts` has been replaced with `transitionPlan()`
- [ ] `grep -r 'updatePlanStatus' src/engine/orchestrator.ts` returns zero matches
- [ ] `transitionPlan()` throws `Error` when called with a transition not in `VALID_TRANSITIONS`
- [ ] Tests cover all 8 valid transitions: pending->running, pending->blocked, running->completed, running->failed, completed->merged, completed->failed, failed->pending, blocked->pending
- [ ] Tests cover at least 3 invalid transitions (e.g., pending->merged, merged->running, completed->pending)
- [ ] `transitionPlan()` sets `plan.error` when metadata `{ error: string }` is passed
