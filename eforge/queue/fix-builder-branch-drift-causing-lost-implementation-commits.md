---
title: Fix builder branch drift causing lost implementation commits
created: 2026-03-30
status: pending
---

# Fix builder branch drift causing lost implementation commits

## Problem / Motivation

A build of `add-eforge-config-init-cli-command` completed successfully - all agents ran, all validation passed ($1.27 in compute) - but the implementation was lost during merge finalize. The builder agent ran `git checkout -b add-eforge-config-init-cli-command/config-init` inside the merge worktree, switching off the feature branch. The orchestrator's `builtOnMergeWorktree` merge path blindly assumes HEAD is on the feature branch, so it captured the plan commit SHA instead of the implementation commit SHA. The fast-forward merge to main advanced only to the plan commit, orphaning the implementation.

Two contributing factors:

1. The builder prompt includes `- **Branch**: {{plan_branch}}` which signals the agent to create that branch.
2. The `builtOnMergeWorktree` merge path has no drift detection.

## Goal

Prevent builder agents from drifting off the feature branch, add defensive drift recovery to the orchestrator's merge path, and resurrect the lost `eforge config init` implementation commits.

## Approach

### 0. Resurrect the lost `eforge config init` implementation

The implementation commits are still in the object store as dangling (unreachable) commits:
- `d1b31fa` - `feat(plan-01-config-init): Add eforge config init CLI command` (70 lines in `src/cli/index.ts`)
- `a3c301d` - `chore(plan-01-config-init): post-parallel-group auto-commit` (doc updates to CLAUDE.md, README.md, docs/config.md)

Cherry-pick both onto main in order:
```
git cherry-pick d1b31fa a3c301d
```

Verify the result compiles and tests pass before proceeding with the bug fix changes.

### 1. Remove `{{plan_branch}}` from builder prompt (preventive)

**`src/engine/prompts/builder.md`**
- Remove line 11: `- **Branch**: {{plan_branch}}`
- Add to `## Constraints` section (as first bullet): `- **No branch operations** - do not create, checkout, or switch git branches. The orchestrator manages all branching.`

**`src/engine/agents/builder.ts`** (~line 126)
- Remove `plan_branch: plan.branch,` from the `loadPrompt` call

### 2. Extract drift recovery into `worktree.ts` and use from orchestrator (defensive)

**`src/engine/worktree.ts`** - new exported function:

```typescript
/**
 * Detect and recover when a worktree has drifted off its expected branch.
 * Agents may create/switch branches during a build. If the worktree HEAD
 * is no longer on expectedBranch, squash-merge the drift back.
 * Returns true if recovery was needed, false if already on expectedBranch.
 */
export async function recoverDriftedWorktree(
  cwd: string,
  expectedBranch: string,
  commitMessage: string,
): Promise<boolean> {
  const { stdout: currentBranchRaw } = await exec('git', ['branch', '--show-current'], { cwd });
  const currentBranch = currentBranchRaw.trim();

  if (currentBranch === expectedBranch) return false;

  let driftBranch: string;
  if (!currentBranch) {
    // Detached HEAD - create temp branch to merge from
    driftBranch = `eforge/drift-recovery`;
    await exec('git', ['checkout', '-B', driftBranch], { cwd });
  } else {
    driftBranch = currentBranch;
  }

  await mergeWorktree(cwd, driftBranch, expectedBranch, commitMessage);

  // Clean up drift branch
  try { await exec('git', ['branch', '-D', driftBranch], { cwd }); } catch { /* best-effort */ }

  return true;
}
```

Key details:
- `mergeWorktree` is already imported (used internally by `recoverDriftedWorktree`)
- Uses `-B` (force-create) for temp branch to avoid collision errors
- After recovery, worktree is on `expectedBranch` (`mergeWorktree` does `checkout baseBranch` first)
- No-op when already on the correct branch (returns false)
- Extracted to `worktree.ts` so it can be unit-tested with real git repos without the full orchestrator

**`src/engine/orchestrator.ts`** (lines 509-520) - replace the `builtOnMergeWorktree` block:

```typescript
if (builtOnMergeWorktree.has(planId)) {
  const prefix = config.mode === 'errand' ? 'fix' : 'feat';
  const commitMessage = `${prefix}(${plan.id}): ${plan.name}\n\n${ATTRIBUTION}`;
  await recoverDriftedWorktree(mergeWorktreePath, featureBranch, commitMessage);

  const { stdout: shaOut } = await exec('git', ['rev-parse', 'HEAD'], { cwd: mergeWorktreePath });
  const commitSha = shaOut.trim();

  updatePlanStatus(state, planId, 'merged');
  planState.merged = true;
  recentlyMergedIds.push(planId);
  saveState(stateDir, state);

  yield { timestamp: ts(), type: 'merge:complete', planId, commitSha };
}
```

Add `recoverDriftedWorktree` to the import from `./worktree.js` (line 16-24). `ATTRIBUTION` is already imported from `./git.js` (line 26).

### 3. Tests

**`test/worktree-drift.test.ts`** (new file) - tests `recoverDriftedWorktree` directly with real git repos.

Uses `useTempDir()` from `test/test-tmpdir.ts`. Each test creates a minimal git repo + worktree, simulates drift, calls `recoverDriftedWorktree`, and asserts on git state.

Three test cases:

1. **No drift (happy path)**: Worktree stays on feature branch. `recoverDriftedWorktree` returns `false`. Feature branch HEAD unchanged.
2. **Branch drift**: `git checkout -b other-branch` + commit in worktree. `recoverDriftedWorktree` returns `true`. Assert worktree is back on feature branch, feature branch contains the implementation file (squash-merged), drift branch is deleted.
3. **Detached HEAD drift**: `git checkout --detach` + commit in worktree. `recoverDriftedWorktree` returns `true`. Assert same as case 2 (worktree on feature branch, changes present).

Test setup helper:
```typescript
async function setupRepo(baseDir: string) {
  const repoRoot = join(baseDir, 'repo');
  mkdirSync(repoRoot, { recursive: true });
  await exec('git', ['-C', repoRoot, 'init']);
  await exec('git', ['-C', repoRoot, 'commit', '--allow-empty', '-m', 'initial']);
  await exec('git', ['-C', repoRoot, 'branch', '-M', 'main']);
  const featureBranch = 'eforge/test-feature';
  await exec('git', ['-C', repoRoot, 'branch', featureBranch]);
  const wtPath = join(baseDir, 'wt');
  await exec('git', ['-C', repoRoot, 'worktree', 'add', wtPath, featureBranch]);
  return { repoRoot, wtPath, featureBranch };
}
```

## Scope

**In scope:**
- Resurrecting lost `eforge config init` implementation commits (`d1b31fa`, `a3c301d`)
- Removing `{{plan_branch}}` template variable from builder prompt and agent code
- Adding explicit "no branch operations" constraint to builder prompt
- New `recoverDriftedWorktree` function in `src/engine/worktree.ts`
- Updating `builtOnMergeWorktree` merge path in `src/engine/orchestrator.ts` to use drift recovery
- New test file `test/worktree-drift.test.ts` covering no-drift, branch drift, and detached HEAD drift scenarios

**Out of scope:**
- N/A

## Acceptance Criteria

- Lost implementation commits (`d1b31fa`, `a3c301d`) are cherry-picked onto main and the result compiles and tests pass
- `src/engine/prompts/builder.md` no longer contains `{{plan_branch}}`
- `src/engine/prompts/builder.md` contains a constraint: "No branch operations - do not create, checkout, or switch git branches. The orchestrator manages all branching."
- `src/engine/agents/builder.ts` no longer passes `plan_branch` to `loadPrompt`
- `recoverDriftedWorktree` is exported from `src/engine/worktree.ts` and handles: no drift (no-op), branch drift (squash-merge back), and detached HEAD drift (temp branch + squash-merge back)
- `src/engine/orchestrator.ts` `builtOnMergeWorktree` block calls `recoverDriftedWorktree` before capturing the commit SHA
- `test/worktree-drift.test.ts` exists with three passing test cases (no drift, branch drift, detached HEAD drift)
- `pnpm type-check` passes
- `pnpm test` passes (existing + new tests)
- `pnpm build` succeeds
