---
id: plan-01-worktree-isolation
name: Move all git operations to worktrees
dependsOn: []
branch: move-all-eforge-git-operations-out-of-the-main-working-directory/worktree-isolation
---

# Move all git operations to worktrees

## Architecture Context

The eforge engine currently performs git operations (branch creation, checkout, merge, validation) directly in the user's `repoRoot`, switching the checked-out branch mid-build. This disrupts the user's workflow and prevents queuing concurrent builds. The fix introduces a "merge worktree" that persists across compile and build phases, so `repoRoot` is never modified until a final fast-forward merge.

The key invariant: `git branch --show-current` in `repoRoot` returns the same branch at every point throughout a build run.

## Implementation

### Overview

Introduce a merge worktree created at compile start that persists through the build phase. All plan artifact commits, squash merges, and validation happen in this worktree. Plan worktrees branch off the feature branch (in the merge worktree) instead of `baseBranch`. The final merge uses `git merge --ff-only` in `repoRoot` to update the ref and working tree atomically without changing branches.

### Key Decisions

1. **One merge worktree per build** - Created at compile start in `{worktreeBase}/__merge__`, reused during build. Persisted in `EforgeState.mergeWorktreePath` for resume support.
2. **Plan worktrees branch off feature branch, not baseBranch** - So plan builders can see committed plan artifacts from the compile phase.
3. **`planCommitCwd` field on `PipelineContext`** - Separates agent exploration cwd (`repoRoot`) from plan artifact commit cwd (`mergeWorktreePath`). Agents continue to explore the real codebase; only git commits go to the merge worktree.
4. **Fast-forward final merge** - `git merge --ff-only featureBranch` in `repoRoot` updates the ref and working tree without changing which branch is checked out. Non-fast-forward fallback uses a temporary detached worktree + `git update-ref`.
5. **Dynamic git dir resolution for lock files** - `removeStaleIndexLock` uses `git rev-parse --git-dir` to find the actual git directory, supporting both regular repos and worktrees where `.git` is a file.
6. **Rename `repoRoot` to `cwd` in `mergeWorktree()` and `MergeResolver`** - These functions now receive the merge worktree path, not the repo root. The rename clarifies semantics.

## Scope

### In Scope
- `createMergeWorktree()` and `mergeFeatureBranchToBase()` functions in `worktree.ts`
- Renaming `repoRoot` param to `cwd` in `mergeWorktree()` and `MergeResolver` type
- Fixing `removeStaleIndexLock()` to resolve git dir dynamically via `git rev-parse --git-dir`
- Adding `mergeWorktreePath?: string` to `EforgeState` in `events.ts`
- Adding `planCommitCwd?: string` to `PipelineContext` in `pipeline.ts`
- Updating `commitPlanArtifacts()` and `prd-passthrough` stage to use `ctx.planCommitCwd` for git ops
- Updating `runCompilePipeline()` to commit artifacts at `planCommitCwd`
- Creating the merge worktree in `compile()` and persisting to state
- Loading `mergeWorktreePath` in `build()` and passing to the orchestrator
- Adding `mergeWorktreePath` to `OrchestratorOptions`
- Removing feature branch creation from orchestrator (now done by `createMergeWorktree`)
- Changing plan worktree base branch from `baseBranch` to `featureBranch`
- Routing squash merges and validation through merge worktree
- Replacing the final merge with `mergeFeatureBranchToBase()`
- Cleaning up the merge worktree in the finally block
- Adding `cwd` as first parameter to `ValidationFixer` type
- Updating `validationFixer` and `mergeResolver` closures in `eforge.ts`
- Updating existing tests that reference `EforgeState` shape or `ValidationFixer` signature

### Out of Scope
- Changes to enqueue workflow (enqueue commits are small and non-disruptive)
- Changes to agent implementations or prompts
- Changes to the monitor or CLI layers

## Files

### Modify
- `src/engine/worktree.ts` - Add `createMergeWorktree()`, `mergeFeatureBranchToBase()`, rename `repoRoot` to `cwd` in `mergeWorktree()` and `MergeResolver`, rename `repoRoot` to `cwd` in `gatherConflictInfo()`
- `src/engine/git.ts` - Update `removeStaleIndexLock()` to use `git rev-parse --git-dir` for worktree-aware lock path resolution
- `src/engine/events.ts` - Add `mergeWorktreePath?: string` to `EforgeState` interface
- `src/engine/eforge.ts` - Create merge worktree in `compile()`, pass `mergeWorktreePath` to orchestrator in `build()`, add `cwd` param to `validationFixer` closure, rename `repoRoot` to `cwd` in `mergeResolver` closure
- `src/engine/orchestrator.ts` - Add `mergeWorktreePath` to `OrchestratorOptions`, add `cwd: string` to `ValidationFixer` type, remove feature branch creation, change plan worktree base branch to `featureBranch`, route merges/validation/HEAD-reads through merge worktree, replace final merge with `mergeFeatureBranchToBase()`, remove `checkout baseBranch` from finally block, add merge worktree cleanup
- `src/engine/pipeline.ts` - Add `planCommitCwd?: string` to `PipelineContext`, update `commitPlanArtifacts()` to accept `cwd` param, update `prd-passthrough` stage and `runCompilePipeline()` to use `planCommitCwd`
- `test/orchestration-logic.test.ts` - Update `makeState()` helper and `initializeState` tests if `mergeWorktreePath` changes the state shape
- `test/state.test.ts` - Update `makeState()` helper to include `mergeWorktreePath` in `EforgeState` construction

## Verification

- [ ] `pnpm type-check` exits with code 0
- [ ] `pnpm test` exits with code 0 (all existing tests pass)
- [ ] `createMergeWorktree()` creates a worktree at `{worktreeBase}/__merge__` and returns the path
- [ ] `createMergeWorktree()` handles resume (branch already exists) without error
- [ ] `mergeFeatureBranchToBase()` performs `git merge --ff-only` in `repoRoot` without switching branches
- [ ] `mergeFeatureBranchToBase()` falls back to detached-worktree merge when fast-forward is not possible
- [ ] `removeStaleIndexLock()` resolves the correct `.git/index.lock` path inside a worktree (not hardcoded `.git/`)
- [ ] `PipelineContext.planCommitCwd` is set to the merge worktree path during compile
- [ ] Plan artifact commits (`commitPlanArtifacts`, `prd-passthrough`) write to `planCommitCwd`, not `ctx.cwd`
- [ ] `EforgeState.mergeWorktreePath` is persisted during compile and loaded during build
- [ ] `OrchestratorOptions.mergeWorktreePath` is passed from `build()` to the orchestrator
- [ ] The orchestrator does not run `git checkout -b featureBranch` or `git checkout baseBranch` in `repoRoot`
- [ ] Plan worktrees are created with `featureBranch` as the base (not `baseBranch`)
- [ ] Squash merges run in the merge worktree, not `repoRoot`
- [ ] Validation commands run with `cwd: mergeWorktreePath`
- [ ] `ValidationFixer` receives `mergeWorktreePath` as its `cwd` parameter
- [ ] The merge worktree is removed in the finally block via `removeWorktree()`
- [ ] No `git checkout` commands execute with `cwd: repoRoot` during the build phase
