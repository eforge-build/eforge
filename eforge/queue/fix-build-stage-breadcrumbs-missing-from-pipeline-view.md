---
title: Fix Build Stage Breadcrumbs Missing from Pipeline View
created: 2026-03-29
status: pending
---



# Fix Build Stage Breadcrumbs Missing from Pipeline View

## Problem / Motivation

Build stage breadcrumbs (e.g., `implement > review-cycle > validate`) were added to the pipeline view (c36fe33, with server-side enrichment in 5d0ba96) but are not rendering. The monitor server's `readBuildConfigFromOrchestration` constructs the path to `orchestration.yaml` from `run.cwd` (the main repo root), but since commit ae4ba06 moved the compile phase to run inside the merge worktree (`../{project}-{set}-worktrees/__merge__/`), the planner writes `orchestration.yaml` there instead. The file doesn't exist at the expected path, and the `try/catch` silently swallows the ENOENT error.

## Goal

Resolve `orchestration.yaml` (and related plan directory paths) from both the main repo root and the merge worktree fallback so that build stage breadcrumbs render correctly in the monitor pipeline view.

## Approach

Add an inline helper in `src/monitor/server.ts` that returns candidate paths for `orchestration.yaml` - the main repo path first, then the merge worktree fallback:

```typescript
function candidateOrchestrationPaths(cwd: string, planSet: string): string[] {
  const primary = resolve(cwd, 'plans', planSet, 'orchestration.yaml');
  const project = basename(cwd);
  const worktree = resolve(cwd, '..', `${project}-${planSet}-worktrees`, '__merge__', 'plans', planSet, 'orchestration.yaml');
  return [primary, worktree];
}
```

No engine imports needed - `basename` and `resolve` are already imported. The formula matches `computeWorktreeBase` from `src/engine/worktree.ts:20-23` plus the `__merge__` convention.

### Call sites to update (4 total in `src/monitor/server.ts`):

1. **`readBuildConfigFromOrchestration`** (line 377) - Build/review enrichment for both orchestration and plans endpoints. Try each candidate path until one succeeds.
2. **`resolvePlanBranch`** (line 595) - Branch resolution for diff operations. Same pattern.
3. **Expedition files `planDir`** (line 433) - `readExpeditionFiles` receives `planDir` derived from `cwd`. Need to also try the worktree path for the plan directory (not just `orchestration.yaml`).
4. **Path traversal checks** - Each candidate path should be validated against its own base (main repo base or worktree base).

## Scope

**In scope:**
- Adding `candidateOrchestrationPaths` helper to `src/monitor/server.ts`
- Updating the 4 call sites listed above to try candidate paths
- Path traversal validation for each candidate against its own base

**Out of scope:**
- The UI component (`BuildStageProgress` in `thread-pipeline.tsx`) - already correct
- Engine changes
- DB schema changes

## Acceptance Criteria

1. `pnpm build` succeeds
2. `pnpm test` passes
3. `pnpm type-check` passes
4. Starting a build with worktrees (excursion/expedition profile) shows breadcrumbs on plan rows in the monitor pipeline view
