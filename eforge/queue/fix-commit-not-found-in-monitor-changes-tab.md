---
title: Fix "Commit not found" in Monitor Changes Tab
created: 2026-03-30
status: pending
---



# Fix "Commit not found" in Monitor Changes Tab

## Problem / Motivation

When selecting a file in the Changes tab of the monitor UI, diffs show "Commit not found" for in-progress builds. The `build:files_changed` event fires after the implement stage so the heatmap populates, but there's no commit SHA or branch to diff against yet.

Root cause in `serveDiff()` (`src/monitor/server.ts`):

1. `resolveCommitSha()` looks for a `merge:complete` event, which doesn't exist for in-progress plans.
2. `resolvePlanBranch()` reads `plan.branch` from `orchestration.yaml`, but the branch **never exists** for sequential builds (concurrency=1) because the orchestrator builds directly on the merge worktree's feature branch.

Verified: for a currently running build, `orchestration.yaml` lists branch `refactor-worktree-management/plan-lifecycle-guards` but only `eforge/refactor-worktree-management` (the feature branch) actually exists in git. The merge worktree at `../{project}-{planSet}-worktrees/__merge__/` has the changes on its checked-out feature branch.

## Goal

Make file diffs in the monitor Changes tab work for in-progress builds by falling back to the feature branch when neither a commit SHA nor the plan branch is available.

## Approach

All changes are in `src/monitor/server.ts`.

### 1. Add `resolveFeatureBranch()` helper (~line 680, before `resolveCwd`)

Resolves the feature branch for a session by finding the merge worktree:

```typescript
async function resolveFeatureBranch(sessionId: string): Promise<{ branch: string; baseBranch: string } | null> {
  const sessionRuns = db.getSessionRuns(sessionId);
  const run = [...sessionRuns].reverse().find((r) => r.cwd && r.planSet);
  if (!run) return null;

  const planBase = options?.planOutputDir ?? 'eforge/plans';
  const candidates = candidateOrchestrationPaths(run.cwd, planBase, run.planSet);

  // Read orchestration.yaml (same pattern as resolvePlanBranch)
  let content: string | null = null;
  for (const candidate of candidates) {
    if (!candidate.path.startsWith(candidate.base + '/')) continue;
    try { content = await readFile(candidate.path, 'utf-8'); break; } catch { /* next */ }
  }
  if (!content) return null;

  const orch = parseYaml(content);
  if (!orch?.base_branch || !orch?.name) return null;

  // Feature branch follows the eforge/{name} convention
  const featureBranch = `eforge/${orch.name}`;

  // Verify the branch exists before returning
  try {
    await execAsync('git', ['rev-parse', '--verify', featureBranch], { cwd: run.cwd });
  } catch { return null; }

  return { branch: featureBranch, baseBranch: orch.base_branch };
}
```

### 2. Update `serveDiff()` fallback chain (lines 725-731)

When `resolveCommitSha` returns null, try the plan branch first, then fall back to the feature branch:

```typescript
if (!commitSha) {
  // Try plan branch first, then feature branch
  let branchInfo = await resolvePlanBranch(sessionId, planId);

  // If plan branch doesn't exist in git, fall back to feature branch
  if (branchInfo) {
    try {
      await execAsync('git', ['rev-parse', '--verify', branchInfo.branch], { cwd });
    } catch {
      branchInfo = null; // Branch doesn't exist, fall through to feature branch
    }
  }

  if (!branchInfo) {
    branchInfo = await resolveFeatureBranch(sessionId);
  }

  if (!branchInfo) {
    res.writeHead(404, ...);
    res.end(JSON.stringify({ error: 'Commit not found' }));
    return;
  }
  // ... existing branch diff logic continues unchanged
}
```

The existing branch diff logic (lines 734-799) works unchanged once `branchInfo` is resolved.

## Scope

**In scope:**
- `src/monitor/server.ts` only:
  - Add `resolveFeatureBranch()` helper
  - Update the `!commitSha` block in `serveDiff()` to verify plan branch exists and fall back to feature branch

**Out of scope:**
- A major worktree management refactor is in progress (see `eforge/queue/refactor-worktree-management.md`). This fix only touches the monitor server-side diff resolution - completely separate from the engine worktree code being refactored.

## Acceptance Criteria

1. `pnpm build` completes with no build errors.
2. While a build is in progress, opening the monitor and clicking files in the Changes heatmap shows diffs (no "Commit not found" error).
3. After a build completes, clicking files still shows diffs via the `commitSha` path.
4. Older completed builds selected from the sidebar still display diffs correctly.
5. `pnpm test` - all existing tests pass.
