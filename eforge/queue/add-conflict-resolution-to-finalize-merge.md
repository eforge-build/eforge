---
title: Add conflict resolution to finalize merge
created: 2026-03-29
status: pending
---

# Add conflict resolution to finalize merge

## Problem / Motivation

When the orchestrator finishes building all plans, it merges the feature branch back to the base branch (e.g. `main`). If `main` diverged during the build (e.g. new PRDs were enqueued, adding files to a directory the build renamed), `mergeFeatureBranchToBase()` fails with a merge conflict and the entire build is marked `failed` - even though all plans built, reviewed, and validated successfully.

The plan-level merge step already has conflict resolution via the `MergeResolver` callback and the merge-conflict-resolver agent. The finalize step just needs the same treatment.

This was triggered by a real failure: the "consolidate eforge user-facing files" build renamed `docs/prd-queue/` to `eforge/queue/`, but 3 enqueue commits landed on `main` during the build, adding files to the old directory. The finalize merge hit `CONFLICT (file location)` and gave up.

## Goal

Apply the same `MergeResolver` conflict resolution strategy used for plan-level merges to the finalize merge step, so that resolvable conflicts on the base branch do not cause an otherwise successful build to fail.

## Approach

### 1. `src/engine/worktree.ts` - Add resolver to `mergeFeatureBranchToBase`

Add an optional `mergeResolver` parameter to the function signature:

```typescript
export async function mergeFeatureBranchToBase(
  repoRoot: string,
  featureBranch: string,
  baseBranch: string,
  worktreeBase: string,
  mergeResolver?: MergeResolver,  // NEW parameter
): Promise<string> {
```

In the non-fast-forward path (line 279), change the merge call from a bare `exec` to a try/catch that mirrors `mergeWorktree`'s conflict handling pattern (lines 153-180):

```typescript
// Current (line 279):
await exec('git', ['merge', featureBranch, '-m', `Merge...`], { cwd: tmpMergePath });

// New:
try {
  await exec('git', ['merge', featureBranch, '-m', `Merge...`], { cwd: tmpMergePath });
} catch (mergeErr) {
  if (mergeResolver) {
    const conflictInfo = await gatherConflictInfo(tmpMergePath, featureBranch, baseBranch);
    if (conflictInfo) {
      const resolved = await mergeResolver(tmpMergePath, conflictInfo);
      if (resolved) {
        // Verify no remaining conflicts
        const { stdout } = await exec('git', ['diff', '--name-only', '--diff-filter=U'], { cwd: tmpMergePath });
        if (stdout.trim().length === 0) {
          // Commit the resolved merge
          await exec('git', ['commit', '--no-edit'], { cwd: tmpMergePath });
          // Fall through to SHA extraction and ref update below
        } else {
          throw mergeErr;  // Unresolved conflicts remain
        }
      } else {
        throw mergeErr;  // Resolver returned false
      }
    } else {
      throw mergeErr;  // Couldn't gather conflict info
    }
  } else {
    throw mergeErr;  // No resolver provided
  }
}
```

The merge commit message is already set by the initial `git merge -m ...` command - git preserves it in `.git/MERGE_MSG` during conflict state, so `--no-edit` uses it.

### 2. `src/engine/orchestrator.ts` - Pass resolver to finalize call

At line 674, pass `this.options.mergeResolver` through:

```typescript
// Current:
const commitSha = await mergeFeatureBranchToBase(repoRoot, featureBranch, config.baseBranch, worktreeBase);

// New:
const commitSha = await mergeFeatureBranchToBase(repoRoot, featureBranch, config.baseBranch, worktreeBase, this.options.mergeResolver);
```

The orchestrator already has `this.options.mergeResolver` - it is the same resolver used for plan-level merges. The only difference is that at finalize time, there is no plan context to inject (no `planName` / `otherPlanName`). That is fine - the merge-conflict-resolver agent still gets the conflicted files and diff, which is enough context for most resolution scenarios (file moves, simple content conflicts).

### 3. Event emission during finalize

The orchestrator should yield `merge:resolve:start/complete` events when the finalize merge triggers conflict resolution. No change is needed to event flow - the `mergeResolver` closure in `eforge.ts` already pushes events into `mergeEvents[]`, and the orchestrator's event loop drains them before yielding each orchestrator event. Since the finalize merge is inside the same `execute()` generator, the drain happens naturally.

## Scope

**In scope:**

| File | Change |
|------|--------|
| `src/engine/worktree.ts` | Add optional `mergeResolver` param to `mergeFeatureBranchToBase`, add conflict handling in non-ff path |
| `src/engine/orchestrator.ts` | Pass `this.options.mergeResolver` to `mergeFeatureBranchToBase` call at line 674 |

**Out of scope:**

- Changes to the `MergeResolver` interface or the merge-conflict-resolver agent itself.
- Adding plan-specific context (e.g. `planName` / `otherPlanName`) to the finalize-time resolver invocation.

## Acceptance Criteria

1. `pnpm type-check` passes - the signature change is backwards compatible (new param is optional).
2. `pnpm test` passes - all existing tests continue to pass.
3. Simulated real-world scenario succeeds:
   - Start a build that renames a directory.
   - While it runs, add a file to that directory on `main`.
   - Verify the finalize step resolves the conflict instead of failing the build.
