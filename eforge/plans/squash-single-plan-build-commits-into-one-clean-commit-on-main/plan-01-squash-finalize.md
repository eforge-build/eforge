---
id: plan-01-squash-finalize
name: Squash single-plan build commits into one clean commit on main
depends_on: []
branch: squash-single-plan-build-commits-into-one-clean-commit-on-main/squash-finalize
---

# Squash single-plan build commits into one clean commit on main

## Architecture Context

The `builtOnMerge` optimization (commit `f947a97`) lets single-plan builds skip dedicated worktree creation and build directly on the merge worktree's feature branch. This means individual agent commits (builder, review-fixer, validation-fixer) all land as separate commits on the feature branch. When `finalize()` merges the feature branch to base via `mergeFeatureBranchToBase()`, it uses `--ff-only` which preserves all those individual commits.

The fix is to use `git merge --squash` instead of `--ff-only` for single-plan builds, collapsing all feature-branch commits into one clean commit on main.

## Implementation

### Overview

Thread a `squashCommitMessage` parameter from the `finalize` phase through `WorktreeManager.mergeToBase()` to `mergeFeatureBranchToBase()`. When provided, `mergeFeatureBranchToBase` uses `git merge --squash` + `git commit` instead of `--ff-only`. The `finalize` phase computes this message only for single-plan builds (`config.plans.length === 1`).

### Key Decisions

1. **Squash at the finalize phase, not during plan merge** - This keeps the `mergePlan()` path unchanged and localizes the change to the final feature-branch-to-base merge. Multi-plan builds are completely unaffected.
2. **`git merge --squash` + explicit `git commit`** - `--squash` stages all changes but does not create a commit, so we follow with `git commit -m <message>`. This produces exactly one commit with a controlled message.
3. **Conflict resolution reuses existing `mergeResolver` callback** - The squash path calls the resolver the same way the non-FF fallback does today: gather conflict info, invoke resolver, verify resolution, then commit.
4. **Fall back to `git reset --merge` on failure** - Same pattern as the existing non-FF path: if squash merge or conflict resolution fails, reset the merge state before re-throwing.

## Scope

### In Scope
- `squashCommitMessage` parameter on `mergeFeatureBranchToBase()` and `WorktreeManager.mergeToBase()`
- Squash merge path in `mergeFeatureBranchToBase()` when `squashCommitMessage` is provided
- Computing the squash commit message in `finalize()` for single-plan builds
- Tests for single-plan squash, multi-plan preservation, and squash-with-conflict scenarios

### Out of Scope
- Multi-plan build commit behavior (unchanged)
- Builder, review-fixer, or validation-fixer commit logic
- Worktree creation/teardown behavior
- The non-FF fallback path (temporary detached worktree merge) - unchanged

## Files

### Modify
- `src/engine/worktree-ops.ts` - Add `squashCommitMessage` optional parameter to `mergeFeatureBranchToBase()`. When provided: attempt `git merge --squash featureBranch` followed by `git commit -m <squashCommitMessage>` on `repoRoot`. Handle conflicts via existing `mergeResolver` callback (gather conflict info, invoke resolver, verify no remaining conflicts, then `git commit -m <squashCommitMessage>`). On failure, `git reset --merge` before re-throwing. When squash succeeds, return the resulting commit SHA. The existing `--ff-only` and non-FF fallback paths remain unchanged (used when `squashCommitMessage` is not provided).
- `src/engine/worktree-manager.ts` - Add optional `squashCommitMessage` parameter to `mergeToBase()` method. Pass it through to `mergeFeatureBranchToBase()`.
- `src/engine/orchestrator/phases.ts` - In `finalize()`, check `config.plans.length === 1`. If single-plan: compute `feat(${planId}): ${planName}\n\n${ATTRIBUTION}` and pass as `squashCommitMessage` to `ctx.worktreeManager.mergeToBase()`. Import `ATTRIBUTION` from `../git.js`. Multi-plan builds pass no `squashCommitMessage` (existing behavior).

## Verification

- [ ] `mergeFeatureBranchToBase()` accepts an optional `squashCommitMessage` parameter
- [ ] When `squashCommitMessage` is provided, `mergeFeatureBranchToBase()` uses `git merge --squash` followed by `git commit -m <message>` instead of `--ff-only`
- [ ] When `squashCommitMessage` is not provided, `mergeFeatureBranchToBase()` behavior is identical to current (ff-only with non-FF fallback)
- [ ] `WorktreeManager.mergeToBase()` accepts and forwards `squashCommitMessage` to `mergeFeatureBranchToBase()`
- [ ] `finalize()` passes `squashCommitMessage` when `config.plans.length === 1`
- [ ] `finalize()` does not pass `squashCommitMessage` when `config.plans.length > 1`
- [ ] The squash commit message follows the format `feat(planId): planName\n\nCo-Authored-By: forged-by-eforge <noreply@eforge.build>`
- [ ] Merge conflicts during squash invoke the `mergeResolver` callback
- [ ] Failed squash merges call `git reset --merge` before re-throwing
- [ ] `pnpm type-check` passes with zero errors
- [ ] `pnpm test` passes with all existing and new tests green
