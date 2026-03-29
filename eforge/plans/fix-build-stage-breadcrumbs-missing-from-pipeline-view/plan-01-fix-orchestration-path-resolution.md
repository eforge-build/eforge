---
id: plan-01-fix-orchestration-path-resolution
name: Fix Orchestration Path Resolution for Worktree Builds
depends_on: []
branch: fix-build-stage-breadcrumbs-missing-from-pipeline-view/fix-orchestration-path-resolution
---

# Fix Orchestration Path Resolution for Worktree Builds

## Architecture Context

Since commit ae4ba06, the compile phase runs inside the merge worktree (`../{project}-{set}-worktrees/__merge__/`), so `orchestration.yaml` and plan directories are written there. The monitor server's path resolution in `src/monitor/server.ts` only checks the main repo root (`run.cwd`), causing silent ENOENT failures that prevent build stage breadcrumbs from rendering.

The worktree path formula follows `computeWorktreeBase` from `src/engine/worktree.ts:20-23`: `resolve(repoRoot, '..', '${basename(repoRoot)}-${setName}-worktrees')`, plus the `__merge__` convention for the merge worktree.

## Implementation

### Overview

Add a `candidateOrchestrationPaths` helper that returns an array of candidate paths (main repo first, merge worktree fallback second). Update all 4 call sites in `server.ts` to iterate candidates until one resolves. Also add a `candidatePlanDirs` helper for the expedition files case which needs a directory path rather than a file path.

### Key Decisions

1. **Inline helper, no engine imports** - `basename` and `resolve` are already imported in `server.ts`. The worktree path formula is simple enough to duplicate rather than importing from the engine (which would create a dependency from monitor to engine internals).
2. **Try-first-then-fallback pattern** - Each call site already has try/catch. The change wraps the file read in a loop over candidates, breaking on first success. This preserves the existing silent-failure semantics when neither path exists.
3. **Per-candidate path traversal validation** - Each candidate path is validated against its own base directory (main repo base or worktree base), not a single shared base.

## Scope

### In Scope
- Adding `candidateOrchestrationPaths(cwd, planBase, planSet)` helper to `src/monitor/server.ts`
- Adding `candidatePlanDirs(cwd, planBase, planSet)` helper for expedition directory resolution
- Updating `readBuildConfigFromOrchestration` to try candidate paths
- Updating `resolvePlanBranch` to try candidate paths
- Updating expedition files `planDir` resolution to try candidate directories
- Path traversal checks for each candidate against its own base

### Out of Scope
- UI component changes (`BuildStageProgress` in `thread-pipeline.tsx`) - already renders correctly when data is present
- Engine changes - the engine writes to the correct location
- DB schema changes
- Adding tests - this is a path resolution fix in server glue code with no existing test coverage for these functions

## Files

### Modify
- `src/monitor/server.ts` - Add `candidateOrchestrationPaths` and `candidatePlanDirs` helpers; update `readBuildConfigFromOrchestration` (line ~376), `resolvePlanBranch` (line ~595), and expedition `planDir` resolution (line ~435) to try candidate paths with per-candidate traversal validation

## Verification

- [ ] `pnpm type-check` passes with zero errors
- [ ] `pnpm test` passes with zero failures
- [ ] `pnpm build` succeeds
- [ ] `candidateOrchestrationPaths` returns exactly 2 paths: main repo path first, merge worktree path second
- [ ] `candidatePlanDirs` returns exactly 2 paths following the same pattern
- [ ] `readBuildConfigFromOrchestration` tries the worktree fallback when the main repo path fails
- [ ] `resolvePlanBranch` tries the worktree fallback when the main repo path fails
- [ ] Expedition `planDir` resolution tries the worktree fallback when the main repo path fails
- [ ] Each candidate path is validated for traversal against its own base directory (not a shared base)
