---
id: plan-01-dirty-tree-guards
name: Dirty working tree detection, recovery, and merge hardening
depends_on: []
branch: fix-dirty-working-tree-causing-final-merge-failure-after-gap-close/dirty-tree-guards
---

# Dirty working tree detection, recovery, and merge hardening

## Architecture Context

The eforge engine orchestrates builds across git worktrees. The final step merges the feature branch back to the base branch in repoRoot. A bug caused the repoRoot working tree to become dirty (deleted files) during gap close, which made the final `git merge --no-ff` fail. Additionally, the cleanup code in `finalize()` attempts `git checkout baseBranch` in the merge worktree, which always fails because git prevents the same branch from being checked out in two worktrees simultaneously.

This plan adds guard rails at two layers (finalize phase and merge function), removes the always-failing checkout, and improves error reporting when merge recovery fails.

## Implementation

### Overview

Four changes across two files:
1. Pre-merge dirty tree detection and auto-recovery in `finalize()` (phases.ts)
2. Defense-in-depth dirty tree rejection in `mergeFeatureBranchToBase()` (worktree-ops.ts)
3. Remove always-failing `git checkout baseBranch` calls in merge worktree (phases.ts)
4. Augment error message when `git reset --merge` fails after a failed merge (worktree-ops.ts)

### Key Decisions

1. Auto-recovery uses `git checkout -- .` then `git clean -fd` rather than `git reset --hard HEAD` because checkout+clean is more predictable and doesn't affect the index
2. The dirty tree check in `mergeFeatureBranchToBase()` throws rather than auto-recovering, because at that layer the caller should have already ensured a clean tree - a dirty tree at merge time indicates a logic error
3. The `git checkout baseBranch` removal is safe because the merge worktree is removed in the finally block and the final merge runs in repoRoot, not the worktree

## Scope

### In Scope
- Pre-merge `git status --porcelain` check in `finalize()` with diagnostic event emission and auto-recovery
- Dirty tree guard in `mergeFeatureBranchToBase()` that throws with file list preview
- Removal of `git checkout config.baseBranch` at lines 556 and 560 in phases.ts
- Enhanced error message in the `git reset --merge` catch block in worktree-ops.ts

### Out of Scope
- Root-causing which agent subprocess dirties the repoRoot
- Changes to agent subprocess cwd handling or the Claude Agent SDK
- Changes to evaluator agent prompts
- New tests (no testable unit boundary - these are git operation guard rails in orchestration code)

## Files

### Modify
- `src/engine/orchestrator/phases.ts` - Add pre-merge dirty tree detection and auto-recovery after the `merge:finalize:start` yield (before the cleanup block). Remove the two `git checkout config.baseBranch` calls (lines 556 and 560) that always fail because the base branch is already checked out in repoRoot.
- `src/engine/worktree-ops.ts` - Add dirty tree guard after the branch guard in `mergeFeatureBranchToBase()` (between lines 260-263). Replace the silent `catch {}` on `git reset --merge` (lines 292-296) with error augmentation that appends the reset failure details and recovery instructions to the original error.

## Verification

- [ ] `pnpm type-check` passes with zero errors
- [ ] `pnpm test` passes (all existing tests)
- [ ] In `finalize()`: before the cleanup block and merge call, there is a `git status --porcelain` check on `ctx.repoRoot` that emits a `plan:progress` event with dirty file count and preview when dirty files are found
- [ ] In `finalize()`: auto-recovery runs `git checkout -- .` and `git clean -fd` on `ctx.repoRoot`, then verifies with a second `git status --porcelain`; throws `Error` with remaining dirty files if recovery fails
- [ ] In `finalize()`: the two `exec('git', ['checkout', config.baseBranch], { cwd: ctx.mergeWorktreePath })` calls are removed
- [ ] In `mergeFeatureBranchToBase()`: between the branch guard and the merge try block, a `git status --porcelain` check throws `Error` with a preview of up to 10 dirty files plus a count of remaining files
- [ ] In `mergeFeatureBranchToBase()`: when `git reset --merge` fails, the original error's `.message` is augmented with the reset failure message and a recovery instruction to run `git merge --abort`
