---
id: plan-01-finalize-merge-resolver
name: Add conflict resolution to finalize merge
depends_on: []
branch: add-conflict-resolution-to-finalize-merge/finalize-merge-resolver
---

# Add conflict resolution to finalize merge

## Architecture Context

The orchestrator's plan-level merge step (`mergeWorktree`) already supports a `MergeResolver` callback for conflict resolution. The finalize step (`mergeFeatureBranchToBase`) does not - it fails immediately on any merge conflict. This plan extends the existing pattern to the finalize step so that resolvable conflicts on the base branch don't fail an otherwise successful build.

The `MergeResolver` callback and `gatherConflictInfo` utility already exist in `src/engine/worktree.ts`. The merge-conflict-resolver agent and its event wiring in `eforge.ts` require no changes - the same resolver closure is reused.

## Implementation

### Overview

Add an optional `mergeResolver` parameter to `mergeFeatureBranchToBase` and wrap the non-fast-forward merge in a try/catch that mirrors `mergeWorktree`'s conflict handling pattern. Then pass `this.options.mergeResolver` from the orchestrator.

### Key Decisions

1. **Mirror existing pattern exactly** - The conflict handling in `mergeFeatureBranchToBase` follows the same structure as `mergeWorktree` (lines 153-180): catch merge error, gather conflict info, call resolver, verify no remaining conflicts, commit if resolved, re-throw if not.
2. **Use `--no-edit` for commit after resolution** - Unlike `mergeWorktree` which does a squash merge (requiring a fresh `-m` commit), `mergeFeatureBranchToBase` uses a real merge. Git preserves the merge message in `.git/MERGE_MSG` during conflict state, so `git commit --no-edit` reuses it.
3. **No plan context in conflict info** - At finalize time, there's no single plan being merged (it's the feature branch aggregating all plans). The `MergeConflictInfo.planName`/`otherPlanName` fields are optional and left unset. The resolver agent still gets conflicted files and diffs, which is sufficient.
4. **No cleanup on resolution failure** - The existing `finally` block in `mergeFeatureBranchToBase` already removes the temporary worktree on any error, so no additional cleanup is needed when conflict resolution fails.

## Scope

### In Scope
- Add optional `mergeResolver` parameter to `mergeFeatureBranchToBase` in `src/engine/worktree.ts`
- Add conflict resolution try/catch in the non-fast-forward merge path
- Pass `this.options.mergeResolver` to `mergeFeatureBranchToBase` in `src/engine/orchestrator.ts`

### Out of Scope
- Changes to the `MergeResolver` interface or `MergeConflictInfo` type
- Changes to the merge-conflict-resolver agent
- Changes to event types or event wiring in `eforge.ts`
- Adding plan-specific context to the finalize resolver invocation

## Files

### Modify
- `src/engine/worktree.ts` - Add optional `mergeResolver` parameter to `mergeFeatureBranchToBase` signature. In the non-fast-forward path (after line 279's `git merge` call), wrap the merge in a try/catch that: (1) calls `gatherConflictInfo` on failure, (2) invokes `mergeResolver` if provided, (3) verifies no remaining conflicts via `git diff --name-only --diff-filter=U`, (4) commits with `git commit --no-edit` if resolved, (5) re-throws if unresolved or no resolver provided.
- `src/engine/orchestrator.ts` - At line 674, pass `this.options.mergeResolver` as the fifth argument to `mergeFeatureBranchToBase`.

## Verification

- [ ] `pnpm type-check` exits with code 0
- [ ] `pnpm test` exits with code 0 (all existing tests pass)
- [ ] `mergeFeatureBranchToBase` signature has an optional fifth parameter of type `MergeResolver`
- [ ] The non-fast-forward path in `mergeFeatureBranchToBase` catches merge errors and calls the resolver when provided
- [ ] The orchestrator passes `this.options.mergeResolver` to `mergeFeatureBranchToBase`
- [ ] When no resolver is provided, the function behavior is unchanged (re-throws the merge error)
