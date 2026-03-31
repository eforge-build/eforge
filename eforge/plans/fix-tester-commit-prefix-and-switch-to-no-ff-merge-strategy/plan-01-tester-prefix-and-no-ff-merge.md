---
id: plan-01-tester-prefix-and-no-ff-merge
name: Fix tester commit prefix and switch to --no-ff merge strategy
dependsOn: []
branch: fix-tester-commit-prefix-and-switch-to-no-ff-merge-strategy/tester-prefix-and-no-ff-merge
---

# Fix Tester Commit Prefix and Switch to --no-ff Merge Strategy

## Architecture Context

The eforge build pipeline has two merge levels: plan branches squash-merge into the feature branch (via `mergeWorktree` in `worktree-manager.ts`), and the feature branch merges into the base branch (via `mergeFeatureBranchToBase` in `worktree-ops.ts`, called through `WorktreeManager.mergeToBase`). This plan changes only the feature-to-base merge strategy and the tester prompt prefix. The plan-to-feature squash merge is unchanged.

## Implementation

### Overview

Two changes:
1. Replace `fix({{plan_id}})` with `test({{plan_id}})` in the tester prompt to match conventional commit semantics.
2. Replace the multi-strategy `mergeFeatureBranchToBase` (squash + ff-only + detached-worktree fallback) with a single `--no-ff` merge path. Update the `WorktreeManager.mergeToBase` signature and `finalize()` in `phases.ts` to always produce a merge commit message.

### Key Decisions

1. **Single `--no-ff` path** - Removes three code paths (squash, ff-only, detached-worktree fallback) in favor of one. The `--no-ff` merge preserves individual branch commits for traceability while keeping the base branch's first-parent history clean with merge commits only.
2. **`commitMessage` is now required** - Since `--no-ff` always creates a merge commit, the message parameter is no longer optional. It moves before `mergeResolver` in the parameter list.
3. **`worktreeBase` parameter removed from `mergeFeatureBranchToBase`** - The detached-worktree fallback was the only consumer of `worktreeBase`. With `--no-ff`, there's no need for temporary worktrees since the merge happens directly on the checked-out base branch.
4. **Merge commit message format varies by plan count** - Single-plan builds use `feat(plan-id): plan name`. Multi-plan builds use `feat(set-name): description` with a body listing the profile and all plans. Errand mode uses `fix` prefix instead of `feat`.

## Scope

### In Scope
- Tester prompt commit prefix change (`fix` -> `test`)
- Replacing all merge strategies in `mergeFeatureBranchToBase` with `--no-ff`
- Removing the `worktreeBase` parameter from `mergeFeatureBranchToBase`
- Updating `WorktreeManager.mergeToBase` signature to `mergeToBase(baseBranch, commitMessage, mergeResolver?)`
- Updating `finalize()` to always produce a merge commit message (single-plan and multi-plan formats)
- Updating five existing integration tests to assert merge commits (2 parents)
- Updating documentation in `CLAUDE.md`, `README.md`, and `docs/architecture.md`

### Out of Scope
- Plan-to-feature-branch squash merge (unchanged)
- Other agent prompts beyond tester
- New test additions

## Files

### Modify
- `src/engine/prompts/tester.md` (line 35) - Change `fix({{plan_id}})` to `test({{plan_id}})`
- `src/engine/worktree-ops.ts` - Replace `mergeFeatureBranchToBase` body: remove squash path (lines 264-301), ff-only attempt (lines 304-308), and detached-worktree fallback (lines 310-381). New signature: `(repoRoot, featureBranch, baseBranch, commitMessage, mergeResolver?)`. Core logic: `git merge --no-ff featureBranch -m commitMessage` with conflict resolution fallback using `gatherConflictInfo` + `mergeResolver` + `git commit --no-edit`. Remove `worktreeBase` parameter entirely since the detached-worktree fallback is gone. Remove `join` and `mkdir`/`rm` imports if they become unused.
- `src/engine/worktree-manager.ts` (line 205) - Update `mergeToBase` signature to `mergeToBase(baseBranch, commitMessage, mergeResolver?)`. Update the delegation call to match new `mergeFeatureBranchToBase` signature (no `worktreeBase` arg).
- `src/engine/orchestrator/phases.ts` (lines 518-523) - Replace the conditional squash message logic with always producing a merge commit message. Single-plan: `feat(planId): planName\n\nCo-Authored-By: ...`. Multi-plan: `feat(config.name): config.description\n\nProfile: config.mode\nPlans:\n- planId: planName\n...\n\nCo-Authored-By: ...`. Respect `config.mode === 'errand'` for `fix` prefix. Update `mergeToBase` call to new signature: `mergeToBase(baseBranch, commitMessage, mergeResolver)`.
- `test/worktree-integration.test.ts` - Update five tests:
  - `mergeFeatureBranchToBase fast-forwards base branch` (line 171): Pass required `commitMessage`, remove `worktreeBase`. Assert merge commit (2 parents via `git cat-file -p HEAD`), SHA differs from feature HEAD.
  - `squashes commits when squashCommitMessage` (line 346): Rename to test `--no-ff` behavior. Pass `commitMessage` as 4th arg. Assert merge commit preserves branch history: `git log --first-parent --oneline` shows 2 commits (initial + merge), `git log --oneline` shows all individual commits.
  - `preserves individual commits without squashCommitMessage` (line 409): Pass required `commitMessage`. Assert merge commit at HEAD with 2 parents, individual commits visible in full log.
  - `squash with conflict invokes resolver` (line 452): Update param order - `commitMessage` as 4th arg, `resolver` as 5th. Remove `worktreeBase` from call. Assert conflict resolution produces merge commit.
  - `squash resets on failure without resolver` (line 510): Update param order - `commitMessage` as 4th arg, `undefined` resolver as 5th. Remove `worktreeBase`. Assert reset still works on `--no-ff` conflict.
- `CLAUDE.md` (line 83) - Update orchestration paragraph: change "force-deleted after squash merge" to describe two-level merge (plan branches squash-merge to feature branch, feature branch merges to base via `--no-ff` creating a merge commit).
- `README.md` (line 46) - Update "merging in topological dependency order" to mention `--no-ff` merge commit from feature to base. (line 50) - Update "Completed builds merge back to the branch as ordered commits" to reflect merge commit strategy.
- `docs/architecture.md` - (line 174) Update Mermaid diagram: change `FB -->|"all plans merged"| Base` label to `FB -->|"--no-ff merge"| Base`. (line 183) Update prose: mention `--no-ff` merge commit that preserves branch history while keeping base branch first-parent history clean.

## Verification

- [ ] `pnpm type-check` exits with code 0
- [ ] `pnpm test` exits with code 0
- [ ] `src/engine/prompts/tester.md` line 35 contains `test({{plan_id}})` and does not contain `fix({{plan_id}})`
- [ ] `mergeFeatureBranchToBase` signature has `commitMessage: string` as 4th parameter (no `worktreeBase`)
- [ ] `mergeFeatureBranchToBase` body contains `git merge --no-ff` and does not contain `--ff-only` or `--squash`
- [ ] `mergeFeatureBranchToBase` body does not contain `worktree add` or `update-ref` (detached-worktree fallback removed)
- [ ] `WorktreeManager.mergeToBase` signature is `mergeToBase(baseBranch: string, commitMessage: string, mergeResolver?: MergeResolver)`
- [ ] `finalize()` produces a commit message for both single-plan and multi-plan cases (no `undefined` passed to `mergeToBase`)
- [ ] `finalize()` uses `fix` prefix when `config.mode === 'errand'`
- [ ] All five updated tests in `test/worktree-integration.test.ts` assert merge commits with 2 parents
- [ ] `CLAUDE.md` line 83 area describes `--no-ff` merge strategy
- [ ] `README.md` reflects merge commit strategy
- [ ] `docs/architecture.md` Mermaid diagram and prose mention `--no-ff` merge
