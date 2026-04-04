---
title: Fix dirty working tree causing final merge failure after gap close
created: 2026-04-04
---

# Fix dirty working tree causing final merge failure after gap close

## Problem / Motivation

After a large build with PRD gap close, the repoRoot (main branch) had many deleted files - a dirty working tree that caused the final `git merge --no-ff` to fail. The feature branch was intact and could be ff-merged manually, so no work was lost. No external processes were running and no other concurrent builds were active - the eforge build itself caused the dirty state.

An exhaustive trace of every `exec('git', ...)` call in the engine with `cwd: repoRoot` showed that the ONLY operations on the repoRoot working tree are the final merge itself (`git merge --no-ff`) and its failure cleanup (`git reset --merge`). All plan execution, validation, gap close, and evaluator operations correctly use `mergeWorktreePath`.

However, the evaluator agent prompt instructs Claude Code to run `git reset --soft` and `git checkout -- .` via shell commands. The agent runs with `cwd: mergeWorktreePath`, but the agent subprocess (Claude Code in `bypassPermissions` mode) has unrestricted shell access. If the agent subprocess somehow executed git commands against the repoRoot instead of the worktree - due to a cwd handling issue in the Claude Agent SDK, or the agent navigating to the main repo - it would explain the deleted files on the main branch.

No definitive code-level bug was found in the engine, but the most likely scenario is:

1. During the gap closer's review-cycle, the evaluator agent (or builder/reviewer) ran a git operation against the repoRoot working tree instead of the merge worktree
2. This left tracked files missing from the repoRoot working tree (showing as "deleted" in `git status`)
3. The final `git merge --no-ff` failed because the dirty working tree conflicted with the merge

Additionally, the `git checkout baseBranch` in the merge worktree (lines 556, 560 in `phases.ts`) always fails because the base branch is already checked out in repoRoot (git prevents the same branch in two worktrees). The catch block at line 557 currently swallows errors from `cleanupPlanFiles` too.

## Goal

Add guard rails that detect and recover from a dirty repoRoot before merge (preventing the failure regardless of cause), and add diagnostics so the exact agent/command can be identified if it happens again.

## Approach

The fix strategy has four parts:

### Fix 1: Detect and auto-recover dirty repoRoot before finalize merge

**File:** `src/engine/orchestrator/phases.ts` - inside `finalize()`, after `merge:finalize:start` yield (line 546), before the cleanup block

Before attempting the merge, check `git status --porcelain` on repoRoot. If dirty:
1. Emit a diagnostic `plan:progress` event with the dirty file list (critical for debugging)
2. Attempt auto-recovery via `git checkout -- .` (restores tracked files to match HEAD)
3. If recovery succeeds, emit success event and continue to merge
4. If recovery fails, fail finalize with a clear error message

```typescript
// Pre-merge integrity check: ensure repoRoot working tree is clean
const { stdout: preStatus } = await exec('git', ['status', '--porcelain'], { cwd: ctx.repoRoot });
if (preStatus.trim().length > 0) {
  const lines = preStatus.trim().split('\n');
  const preview = lines.slice(0, 20).join('\n');
  yield {
    timestamp: new Date().toISOString(), type: 'plan:progress',
    message: `WARNING: repoRoot has ${lines.length} unexpected dirty files before final merge. Attempting auto-recovery.\n${preview}`,
  };
  try {
    await exec('git', ['checkout', '--', '.'], { cwd: ctx.repoRoot });
    // Also clean untracked files that could interfere
    await exec('git', ['clean', '-fd'], { cwd: ctx.repoRoot });
  } catch {}
  // Verify recovery
  const { stdout: postStatus } = await exec('git', ['status', '--porcelain'], { cwd: ctx.repoRoot });
  if (postStatus.trim().length > 0) {
    throw new Error(`repoRoot working tree could not be restored. Remaining:\n${postStatus.trim()}`);
  }
  yield { timestamp: new Date().toISOString(), type: 'plan:progress', message: 'Auto-recovery succeeded: repoRoot restored to clean state.' };
}
```

### Fix 2: Add dirty tree guard in `mergeFeatureBranchToBase()`

**File:** `src/engine/worktree-ops.ts:260` (after the branch guard, before the merge try block)

Defense-in-depth: even if Fix 1 is somehow bypassed, the merge function itself rejects a dirty tree.

```typescript
const { stdout: statusOut } = await exec('git', ['status', '--porcelain'], { cwd: repoRoot });
if (statusOut.trim().length > 0) {
  const lines = statusOut.trim().split('\n');
  const preview = lines.slice(0, 10).join('\n');
  const suffix = lines.length > 10 ? `\n...(${lines.length - 10} more)` : '';
  throw new Error(
    `Cannot merge ${featureBranch}: repoRoot working tree is dirty.\n${preview}${suffix}`,
  );
}
```

### Fix 3: Remove the always-failing `git checkout baseBranch` in merge worktree

**File:** `src/engine/orchestrator/phases.ts:556,560`

Remove the `git checkout config.baseBranch` in the merge worktree (lines 556 and 560). This always fails because the base branch is already checked out in repoRoot and git prevents the same branch in two worktrees. The merge worktree stays on featureBranch, which is fine because:
- The final merge runs in repoRoot, not the merge worktree
- The merge worktree is removed in the finally block anyway
- The catch block at line 557 currently swallows errors from `cleanupPlanFiles` too

### Fix 4: Improve `git reset --merge` error reporting

**File:** `src/engine/worktree-ops.ts:292-296`

When merge fails and `git reset --merge` also fails, augment the original error with reset failure details and recovery instructions.

```typescript
try {
  await exec('git', ['reset', '--merge'], { cwd: repoRoot });
} catch (resetErr) {
  const originalMsg = (err as Error).message ?? String(err);
  const resetMsg = (resetErr as Error).message ?? String(resetErr);
  (err as Error).message = `${originalMsg}\nAdditionally, git reset --merge failed: ${resetMsg}\nRun 'git merge --abort' in ${repoRoot} to recover.`;
}
```

## Scope

**In scope:**
- Pre-merge dirty tree detection and auto-recovery in `finalize()` (Fix 1)
- Defense-in-depth dirty tree guard in `mergeFeatureBranchToBase()` (Fix 2)
- Removing the always-failing `git checkout baseBranch` in merge worktree (Fix 3)
- Improved error reporting when `git reset --merge` fails (Fix 4)

**Out of scope:**
- Root-causing the exact agent/command that dirties the repoRoot (the diagnostics in Fix 1 will help identify this if it recurs)
- Changes to agent subprocess cwd handling or the Claude Agent SDK
- Changes to evaluator agent prompts

**Files to modify:**
- `src/engine/worktree-ops.ts` - Fixes 2 and 4
- `src/engine/orchestrator/phases.ts` - Fixes 1 and 3

## Acceptance Criteria

- Pre-merge integrity check in `finalize()` detects a dirty repoRoot via `git status --porcelain` and emits a diagnostic `plan:progress` event with the dirty file list before attempting auto-recovery
- Auto-recovery via `git checkout -- .` and `git clean -fd` restores a clean repoRoot; if recovery fails, finalize throws a clear error with the remaining dirty files
- `mergeFeatureBranchToBase()` independently rejects a dirty repoRoot working tree with an error listing the dirty files
- The always-failing `git checkout baseBranch` calls (lines 556, 560 in `phases.ts`) are removed
- When `git reset --merge` fails after a failed merge, the error message includes both the original merge failure and the reset failure, plus a recovery instruction to run `git merge --abort`
- `pnpm test` passes (existing worktree tests)
- `pnpm type-check` passes with no type errors
