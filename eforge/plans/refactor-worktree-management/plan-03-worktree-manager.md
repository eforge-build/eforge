---
id: plan-03-worktree-manager
name: WorktreeManager Extraction
depends_on: [plan-02-worktree-integration-tests]
branch: refactor-worktree-management/worktree-manager
---

# WorktreeManager Extraction

## Architecture Context

The orchestrator currently makes direct calls to 6 worktree functions (`createWorktree`, `removeWorktree`, `mergeWorktree`, `recoverDriftedWorktree`, `cleanupWorktrees`, `computeWorktreeBase`) and tracks worktree state via ad-hoc data structures: a `builtOnMergeWorktree` Set, a `recentlyMergedIds` array, and a `failedMerges` Set. Cleanup is spread across three patterns in the `finally` block.

This plan extracts all worktree lifecycle into a `WorktreeManager` class that owns creation, tracking, merging, and cleanup. The orchestrator passes the manager around but no longer calls worktree functions directly.

## Implementation

### Overview

1. Rename `worktree.ts` to `worktree-ops.ts` (pure git operations stay unchanged)
2. Create `worktree-manager.ts` with `WorktreeManager` class that wraps worktree-ops functions
3. Update orchestrator to use `WorktreeManager` instead of direct worktree function calls
4. Un-export worktree-ops functions from `engine/index.ts` that are now internal to WorktreeManager

### Key Decisions

1. **Rename, don't rewrite** - `worktree.ts` becomes `worktree-ops.ts` with zero code changes. The manager wraps these functions; it doesn't replace them.
2. **`ManagedWorktree` tracking** - the manager maintains a `Map<string, ManagedWorktree>` that records every worktree it creates (type, planId, path, branch, status). This makes cleanup deterministic - iterate the map and remove everything with status 'active'.
3. **`acquireForPlan()` encapsulates the concurrency decision** - when `needsPlanWorktrees` is false (maxConcurrency=1), returns the merge worktree path and records the plan as `builtOnMerge: true`. When true, calls `createWorktree()`. The caller doesn't need to know which path was taken.
4. **`mergePlan()` encapsulates the two merge paths** - checks `builtOnMerge` for the plan and dispatches to drift recovery or squash merge. Eliminates the `builtOnMergeWorktree` Set and the merge if/else block from the orchestrator.
5. **`cleanupAll()` returns a structured `CleanupReport`** - reports what was removed, what fell back to force removal, and what failed. Replaces silent try/catch blocks with data the caller can yield as events.
6. **`removeWorktree` in worktree-ops.ts gets structured return** - returns `{ removed: boolean; fallback: boolean }` instead of void, so the manager can build its cleanup report from real data.

## Scope

### In Scope
- Renaming `worktree.ts` to `worktree-ops.ts`
- Updating all 4 import sites (`orchestrator.ts`, `eforge.ts`, `engine/index.ts`, `agents/merge-conflict-resolver.ts`)
- Creating `WorktreeManager` class in `worktree-manager.ts`
- Replacing direct worktree function calls in `orchestrator.ts` with manager methods
- Removing `builtOnMergeWorktree` Set, three cleanup patterns from orchestrator
- Changing `removeWorktree` return type from `void` to `{ removed: boolean; fallback: boolean }`
- Un-exporting `createWorktree`, `removeWorktree`, `mergeWorktree`, `cleanupWorktrees` from `engine/index.ts`
- Keeping `MergeConflictInfo`, `MergeResolver`, and `computeWorktreeBase` exported (used externally)
- Tests for WorktreeManager using real git repos

### Out of Scope
- Changing the merge logic itself (squash merge, drift recovery behavior stays identical)
- Changes to `concurrency.ts`, `state.ts`, or `git.ts`
- Phase decomposition of `execute()` (that's plan-04)

## Files

### Create
- `src/engine/worktree-manager.ts` - `WorktreeManager` class with `ManagedWorktree` interface, `CleanupReport` type, and methods: `acquireForPlan()`, `releaseForPlan()`, `mergePlan()`, `mergeToBase()`, `cleanupAll()`
- `test/worktree-manager.test.ts` - Integration tests for WorktreeManager methods using real git repos

### Modify
- `src/engine/worktree.ts` -> rename to `src/engine/worktree-ops.ts` - Change `removeWorktree` return type from `Promise<void>` to `Promise<{ removed: boolean; fallback: boolean }>`. All other functions unchanged.
- `src/engine/orchestrator.ts` - Replace imports from `./worktree.js` with imports from `./worktree-manager.js` and `./worktree-ops.js`. Replace direct worktree function calls with `WorktreeManager` method calls. Remove `builtOnMergeWorktree` Set. Remove the three cleanup patterns in the `finally` block (replaced by `wm.cleanupAll()`). Accept `WorktreeManager` as a constructor parameter or create it internally.
- `src/engine/eforge.ts` - Update import from `./worktree.js` to `./worktree-ops.js` for `computeWorktreeBase` and `createMergeWorktree`
- `src/engine/index.ts` - Update import path from `./worktree.js` to `./worktree-ops.js`. Remove re-exports of `createWorktree`, `removeWorktree`, `mergeWorktree`, `cleanupWorktrees`. Keep `computeWorktreeBase` and type exports (`MergeResolver`, `MergeConflictInfo`). Add re-export of `WorktreeManager` and `CleanupReport` from `./worktree-manager.js`.
- `src/engine/agents/merge-conflict-resolver.ts` - Update import from `../worktree.js` to `../worktree-ops.js`
- `test/worktree-drift.test.ts` - Update import from worktree to worktree-ops
- `test/worktree-integration.test.ts` - Update imports from worktree to worktree-ops

## Verification

- [ ] `pnpm type-check` passes with zero errors
- [ ] `pnpm test` passes (all existing tests including worktree-drift and worktree-integration)
- [ ] `grep -r "from.*worktree\.js" src/` returns zero matches (all imports updated to worktree-ops.js or worktree-manager.js)
- [ ] `grep -r "builtOnMergeWorktree" src/engine/orchestrator.ts` returns zero matches
- [ ] `WorktreeManager.cleanupAll()` returns a `CleanupReport` with `removed`, `fallback`, and `failed` arrays
- [ ] `removeWorktree()` in worktree-ops.ts returns `{ removed: boolean; fallback: boolean }` instead of void
- [ ] `engine/index.ts` does NOT export `createWorktree`, `removeWorktree`, `mergeWorktree`, or `cleanupWorktrees`
- [ ] `engine/index.ts` DOES export `WorktreeManager`, `CleanupReport`, `computeWorktreeBase`, `MergeResolver`, `MergeConflictInfo`
