---
id: plan-05-resume-reconciliation
name: Resume Reconciliation
depends_on: [plan-04-phase-decomposition]
branch: refactor-worktree-management/resume-reconciliation
---

# Resume Reconciliation

## Architecture Context

When a build is interrupted mid-execution (process kill, crash, OOM), the persisted state in `.eforge/state.json` may not match the filesystem. Plans may be marked as `running` but their worktrees could be missing or corrupt. The current `resumeState()` function resets `running` plans to `pending` but never validates that the worktrees actually exist or are on the correct branches.

This plan adds a `reconcile()` method to `WorktreeManager` that cross-references persisted state with the actual filesystem and git state, producing a `ReconciliationReport` that describes what was found and what was corrected.

## Implementation

### Overview

1. Add `WorktreeManager.reconcile(state: EforgeState)` method
2. The method checks: does the merge worktree exist and is it on the feature branch? For each plan with `worktreePath` set, does the worktree exist and is it on the declared branch?
3. Missing worktrees for `running`/`pending` plans get their `worktreePath` cleared so they'll be re-created on retry
4. Corrupt worktrees (wrong branch, detached HEAD) are removed and `worktreePath` cleared
5. Call `reconcile()` early in `execute()` when resuming (after `initializeState` detects a resumable state)
6. Emit `reconciliation:start` and `reconciliation:complete` events with the report

### Key Decisions

1. **Reconcile is a WorktreeManager method** - it needs access to git operations (`git worktree list`, `git branch --show-current`) and the tracked worktree map. The manager is the right owner.
2. **Report, don't fix silently** - `reconcile()` returns a `ReconciliationReport` with `{ valid: string[], missing: string[], corrupt: string[], cleared: string[] }`. The orchestrator yields events from the report so operators can see what happened.
3. **Conservative correction** - missing or corrupt worktrees have their `worktreePath` cleared in state and are reset to `pending` (via `transitionPlan`). They'll be re-created by `executePlans()`. We don't attempt to repair corrupt worktrees.
4. **New events** - `reconciliation:start` and `reconciliation:complete` are added to `EforgeEvent` union. `reconciliation:complete` carries the full report.

## Scope

### In Scope
- Adding `reconcile()` method to `WorktreeManager`
- Adding `ReconciliationReport` type
- Adding `reconciliation:start` and `reconciliation:complete` event types to `events.ts`
- Calling `reconcile()` in the resume path of `execute()` (or `executePlans()`)
- Integration tests for resume scenarios: missing worktree, corrupt worktree (wrong branch), intact worktree

### Out of Scope
- Changing the plan lifecycle transitions (handled in plan-01)
- Repairing corrupt worktrees (we clear and re-create)
- Validating merge worktree state beyond branch check (merge worktree is created during compile and should be stable)

## Files

### Create
- `test/worktree-reconciliation.test.ts` - Integration tests for reconcile method: missing worktree scenario, corrupt worktree scenario, all-valid scenario

### Modify
- `src/engine/worktree-manager.ts` - Add `reconcile(state: EforgeState): Promise<ReconciliationReport>` method. Add `ReconciliationReport` interface export.
- `src/engine/events.ts` - Add `reconciliation:start` and `reconciliation:complete` event types to `EforgeEvent` union type
- `src/engine/orchestrator/phases.ts` - In `executePlans()`, call `worktreeManager.reconcile(state)` when state was resumed (a boolean flag or check on state). Yield `reconciliation:start` and `reconciliation:complete` events.
- `src/engine/index.ts` - Add re-export of `ReconciliationReport` type from `./worktree-manager.js`

## Verification

- [ ] `pnpm type-check` passes with zero errors
- [ ] `pnpm test` passes (all existing tests plus new reconciliation tests)
- [ ] `WorktreeManager.reconcile()` returns a `ReconciliationReport` with `valid`, `missing`, `corrupt`, and `cleared` arrays
- [ ] Missing worktree test: create a worktree, delete its directory, call reconcile - the plan's `worktreePath` is cleared in state, report lists planId in `missing`
- [ ] Corrupt worktree test: create a worktree, checkout a different branch in it, call reconcile - the worktree is removed, plan's `worktreePath` is cleared, report lists planId in `corrupt`
- [ ] All-valid test: create worktrees that match state, call reconcile - report has all planIds in `valid` and empty `missing`/`corrupt`/`cleared` arrays
- [ ] `reconciliation:start` event is emitted before reconcile runs
- [ ] `reconciliation:complete` event carries the `ReconciliationReport` data
