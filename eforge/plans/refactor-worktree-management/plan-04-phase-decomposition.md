---
id: plan-04-phase-decomposition
name: Phase Decomposition
depends_on: [plan-03-worktree-manager]
branch: refactor-worktree-management/phase-decomposition
---

# Phase Decomposition

## Architecture Context

After plan-03, the orchestrator still has a monolithic `execute()` method (~460 lines, or whatever remains after WorktreeManager extraction). This plan breaks it into focused phase functions: `executePlans()`, `validate()`, `finalize()`. The orchestrator's `execute()` becomes a ~30-line coordinator that calls these phases in sequence with a shared context.

Helper functions (`propagateFailure`, `shouldSkipMerge`, `resumeState`, `computeMaxConcurrency`) currently live as standalone exports in `orchestrator.ts`. After decomposition, they become implementation details of the modules that consume them.

## Implementation

### Overview

1. Create `src/engine/orchestrator/phases.ts` with three async generator phase functions
2. Define a `PhaseContext` interface that carries shared state between phases
3. Move `propagateFailure` and `shouldSkipMerge` into `phases.ts` (consumed only by `executePlans`)
4. Move `resumeState` into `plan-lifecycle.ts` (consumed only by `initializeState`)
5. Move `computeMaxConcurrency` into `phases.ts` (consumed only by `executePlans`)
6. Slim `Orchestrator.execute()` to a ~30-line coordinator

### Key Decisions

1. **Phase context, not class state** - phases receive a `PhaseContext` object with everything they need (state, config, worktreeManager, signal, etc.). This keeps phases pure functions that are easy to test independently.
2. **Phases are async generators** - they yield `EforgeEvent`s, same as `execute()`. The coordinator uses `yield*` to forward events.
3. **Helper relocation follows usage** - `propagateFailure`/`shouldSkipMerge`/`computeMaxConcurrency` are only used within plan execution, so they move to `phases.ts`. `resumeState` is only used by `initializeState`, so it moves to `plan-lifecycle.ts`. This reduces the orchestrator module to just the `Orchestrator` class and `initializeState`.
4. **`initializeState` stays in `orchestrator.ts`** - it's used by the Orchestrator class directly and doesn't fit in phases or plan-lifecycle. Keeping it here avoids circular dependencies.
5. **Re-export updates** - `propagateFailure`, `resumeState`, `shouldSkipMerge`, `computeMaxConcurrency` are currently exported from `orchestrator.ts` and tested in `test/orchestration-logic.test.ts`. Their test imports must be updated to the new locations. Re-exports from `engine/index.ts` are removed (these are internal implementation details, not public API).

## Scope

### In Scope
- Creating `src/engine/orchestrator/phases.ts` with `executePlans()`, `validate()`, `finalize()`
- Defining `PhaseContext` interface
- Moving `propagateFailure`, `shouldSkipMerge`, `computeMaxConcurrency` to `phases.ts`
- Moving `resumeState` to `orchestrator/plan-lifecycle.ts`
- Slimming `Orchestrator.execute()` to ~30 lines
- Updating `test/orchestration-logic.test.ts` imports to new module locations
- Removing re-exports of moved functions from `engine/index.ts` if present

### Out of Scope
- Changing any execution logic (the event stream must be identical before and after)
- Changes to `WorktreeManager`, `state.ts`, `concurrency.ts`
- Resume reconciliation (that's plan-05)

## Files

### Create
- `src/engine/orchestrator/phases.ts` - Phase functions (`executePlans`, `validate`, `finalize`), `PhaseContext` interface, relocated helpers (`propagateFailure`, `shouldSkipMerge`, `computeMaxConcurrency`)

### Modify
- `src/engine/orchestrator.ts` - Remove `propagateFailure`, `shouldSkipMerge`, `resumeState`, `computeMaxConcurrency` function bodies (moved to phases.ts and plan-lifecycle.ts). Slim `execute()` to coordinator calling phases via `yield*`. Import phases from `./orchestrator/phases.js`. Keep `Orchestrator` class, `initializeState`, and type exports.
- `src/engine/orchestrator/plan-lifecycle.ts` - Add `resumeState()` function (moved from orchestrator.ts). Add import of `updatePlanStatus` from `../state.js` for use in `resumeState`.
- `src/engine/index.ts` - Remove re-exports of `propagateFailure`, `resumeState`, `shouldSkipMerge`, `computeMaxConcurrency` if they exist (check first - they may not be re-exported)
- `test/orchestration-logic.test.ts` - Update imports of `propagateFailure`, `resumeState`, `shouldSkipMerge`, `computeMaxConcurrency` to their new module paths (`../src/engine/orchestrator/phases.js` and `../src/engine/orchestrator/plan-lifecycle.js`)

## Verification

- [ ] `pnpm type-check` passes with zero errors
- [ ] `pnpm test` passes (all existing tests, including orchestration-logic tests with updated imports)
- [ ] `Orchestrator.execute()` method body is 40 lines or fewer (excluding blank lines and comments)
- [ ] `grep -c 'function' src/engine/orchestrator.ts` shows 2 or fewer function definitions (Orchestrator class methods + initializeState)
- [ ] `propagateFailure`, `shouldSkipMerge`, `computeMaxConcurrency` exist in `src/engine/orchestrator/phases.ts` (not orchestrator.ts)
- [ ] `resumeState` exists in `src/engine/orchestrator/plan-lifecycle.ts` (not orchestrator.ts)
- [ ] `executePlans`, `validate`, `finalize` are exported from `src/engine/orchestrator/phases.ts`
- [ ] The `PhaseContext` interface is defined and exported from `phases.ts`
