---
title: Fix: Stale state.json from failed run poisons re-runs (GH #1)
created: 2026-03-18
status: pending
---

## Problem / Motivation

When an eforge run fails (e.g., `error_max_turns`), `.eforge/state.json` records `status: 'failed'`. If the user resets HEAD and re-runs the same PRD, the orchestrator loads stale state, sees it's non-resumable, and immediately returns without running the builder - silently producing no implementation.

The root cause is `initializeState()` in `orchestrator.ts:525-538`: when existing state matches `setName` but is non-resumable (failed/completed), it returns the old state as-is. Then `execute()` at line 169 sees `status !== 'running'` and short-circuits.

## Goal

Ensure that re-running a PRD after a failed or completed run creates fresh state instead of short-circuiting, so the builder actually executes.

## Approach

Remove the `return existing` on the non-resumable branch in `initializeState()` so it falls through to fresh state creation. Extract the private method as an exported standalone function for testability. Follow TDD - write failing tests first, then implement the fix.

### TDD Steps

#### 1. Write failing tests in `test/orchestration-logic.test.ts`

Add imports:
- `initializeState` from `../src/engine/orchestrator.js`
- `saveState` from `../src/engine/state.js`
- `useTempDir` from `./test-tmpdir.js`

Add a `makeConfig()` helper using `BUILTIN_PROFILES.errand` from `../src/engine/config.js` for the profile field.

Add `describe('initializeState', ...)` with these tests:

| Test | Setup | Assertion |
|------|-------|-----------|
| creates fresh state when none exists | empty temp dir | `status: 'running'`, all plans `pending` |
| **creates fresh state when existing is `failed`** | save state with `status: 'failed'`, matching `setName` | returns `status: 'running'`, all plans `pending` |
| **creates fresh state when existing is `completed`** | save state with `status: 'completed'`, matching `setName` | returns `status: 'running'`, all plans `pending` |
| resumes when existing state is resumable | save running state with plan-a `completed`, plan-b `pending` | plan-a stays `completed`, plan-b stays `pending`, status `running` |
| creates fresh state when setName differs | save state with `setName: 'old-set'` | returns fresh state with `setName` matching config |

Tests will fail initially because `initializeState` isn't exported yet.

#### 2. Extract and export `initializeState` in `src/engine/orchestrator.ts`

Add a standalone exported function near the other exported helpers (`propagateFailure`, `resumeState`, `shouldSkipMerge`):

```typescript
export function initializeState(
  stateDir: string,
  config: OrchestrationConfig,
  repoRoot: string,
): EforgeState {
  const existing = loadState(stateDir);

  if (existing && existing.setName === config.name) {
    if (isResumable(existing)) {
      resumeState(existing);
      saveState(stateDir, existing);
      return existing;
    }
    // Non-resumable (completed/failed) — fall through to fresh state
  }

  // Create fresh state
  const worktreeBase = computeWorktreeBase(repoRoot, config.name);
  const plans: Record<string, PlanState> = {};
  for (const plan of config.plans) {
    plans[plan.id] = {
      status: 'pending',
      branch: plan.branch,
      dependsOn: plan.dependsOn,
      merged: false,
    };
  }
  const state: EforgeState = {
    setName: config.name,
    status: 'running',
    startedAt: new Date().toISOString(),
    baseBranch: config.baseBranch,
    worktreeBase,
    plans,
    completedPlans: [],
  };
  saveState(stateDir, state);
  return state;
}
```

The key fix: **remove `return existing;` on line 537** so the non-resumable branch falls through to fresh state creation.

#### 3. Update the Orchestrator class private method

Replace the body of the private `initializeState` method (lines 525-565) with delegation:

```typescript
private initializeState(config: OrchestrationConfig, repoRoot: string): EforgeState {
  return initializeState(this.options.stateDir, config, repoRoot);
}
```

#### 4. Run tests

```bash
pnpm test test/orchestration-logic.test.ts
pnpm test
```

## Scope

**In scope:**
- `test/orchestration-logic.test.ts` - add 5 new tests + imports + `makeConfig` helper
- `src/engine/orchestrator.ts` - extract `initializeState` as exported function, fix non-resumable branch, thin out private method

**Out of scope (unchanged, reference only):**
- `src/engine/state.ts` - `loadState`, `saveState`, `isResumable` are all correct as-is
- `src/engine/events.ts` - types unchanged
- `src/engine/config.ts` - `BUILTIN_PROFILES` used in test helper

## Acceptance Criteria

- `pnpm test` passes, including all 5 new `initializeState` tests:
  - creates fresh state when none exists
  - creates fresh state when existing state is `failed`
  - creates fresh state when existing state is `completed`
  - resumes when existing state is resumable (plan-a `completed` stays completed, plan-b `pending` stays pending)
  - creates fresh state when `setName` differs from config
- `pnpm type-check` passes with no type errors
- Manual reproduction scenario works: fail a run → reset HEAD → re-run the same PRD → builder executes with fresh state instead of short-circuiting
