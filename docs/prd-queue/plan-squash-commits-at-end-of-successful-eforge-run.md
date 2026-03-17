---
title: Plan: Squash commits at end of successful eforge run
created: 2026-03-17
status: pending
---

# Squash Commits at End of Successful Eforge Run

## Problem / Motivation

Parallel build stages (implement + doc-update) produce two commits per build — one from the builder agent, one auto-committed by the pipeline for the doc-updater's changes. Combined with plan artifact commits, merge commits, and cleanup commits, a single run produces 5-8 commits:

```
enqueue(prd-id): title                              ← main branch
plan(planSetName): initial planning artifacts        ← main branch
feat(plan-id): plan-name                             ← worktree (builder)
chore(plan-id): post-parallel-group auto-commit      ← worktree (pipeline)
feat(plan-id): plan-name                             ← worktree (evaluator, if review ran)
Merge {branch} into {baseBranch}                     ← main branch (--no-ff)
cleanup(planSet): remove plan files...               ← main branch
cleanup(prdId): remove completed PRD                 ← main branch (CLI layer)
```

This clutters git history with intermediate artifacts that have no value after a successful run.

## Goal

Collapse all intermediate commits from a successful eforge run into exactly two clean commits: one content commit (plan files + code + docs squashed together with a detailed message) and one cleanup commit (plan files and PRD removed) — preserving planning artifacts in git history for quality review while keeping the working tree clean.

Target final state:

```
feat(planSetName): detailed description              ← squashed: everything above the cleanup commits
cleanup(planSetName): remove plan files and PRD      ← single cleanup commit
```

## Approach

### 1. Add event types — `src/engine/events.ts`

Add to the `EforgeEvent` union:
```typescript
| { type: 'squash:start'; planSet: string; commitCount: number }
| { type: 'squash:complete'; planSet: string; commitHash: string }
```

Add fields to `BuildOptions`:
```typescript
squashBaseHash?: string;  // HEAD before enqueue — squash base
prdFilePath?: string;     // PRD file path for consolidated cleanup
```

These are optional at the engine layer since `build()` is a public API that doesn't inherently know about PRDs. Both actual callers (CLI `run` and `runQueue()`) always provide them. When `squashBaseHash` is present, squash runs. When `prdFilePath` is present, cleanup includes the PRD.

### 2. Implement squash + consolidated cleanup — `src/engine/eforge.ts`

**New function: `squashRunCommits()`** (private, alongside `cleanupPlanFiles()`):

```typescript
async function* squashRunCommits(
  cwd: string,
  planSet: string,
  baseHash: string,
  orchConfig: OrchestrationConfig,
): AsyncGenerator<EforgeEvent> {
  // Count commits to squash
  const { stdout } = await exec('git', ['rev-list', '--count', `${baseHash}..HEAD`], { cwd });
  const commitCount = parseInt(stdout.trim(), 10);
  if (commitCount <= 1) return; // Nothing to squash

  yield { type: 'squash:start', planSet, commitCount };

  const message = composeSquashMessage(planSet, orchConfig);
  await exec('git', ['reset', '--soft', baseHash], { cwd });
  await exec('git', ['commit', '-m', message], { cwd });

  const { stdout: hash } = await exec('git', ['rev-parse', '--short', 'HEAD'], { cwd });
  yield { type: 'squash:complete', planSet, commitHash: hash.trim() };
}
```

**New function: `composeSquashMessage()`** — uses `OrchestrationConfig` fields: `mode` determines prefix (`errand` → `fix`, else `feat`), `name` is scope, `description` is subject line. Body lists plan names:

```
feat(plan-set-name): Orchestration description

Plans:
- Plan name one (plan-01)
- Plan name two (plan-02)
```

**Modify `cleanupPlanFiles()`** — add optional `prdFilePath` parameter. When provided, also `git rm` the PRD file (and its empty parent dir) before committing. This consolidates plan file + PRD removal into one commit. Commit message: `cleanup(planSet): remove plan files and PRD` (or just `remove plan files` when no PRD path).

**Modify `build()` method** (line ~476):

```typescript
// After orchestrator completes successfully, before cleanup:
if (status === 'completed') {
  // Squash all intermediate commits into one (when base hash provided by caller)
  if (options.squashBaseHash) {
    yield* squashRunCommits(cwd, planSet, options.squashBaseHash, orchConfig);
  }

  // Cleanup plan files (and PRD when provided)
  const shouldCleanup = options.cleanup ?? this.config.build.cleanupPlanFiles;
  if (shouldCleanup) {
    yield* cleanupPlanFiles(cwd, planSet, options.prdFilePath);
  }
}
```

**Modify `runQueue()`** — capture HEAD before each PRD's compile, pass `squashBaseHash` and `prdFilePath` (from `prd.filePath`) to `this.build()`.

### 3. Thread base hash + PRD path from CLI — `src/cli/index.ts`

In the `run` command handler (line ~282):

- Before `engine.enqueue()`: capture `const squashBaseHash = await getHeadHash(process.cwd())`
- Capture `enqueuedFilePath` (already done at line 296)
- Pass both to `engine.build()`:
  ```typescript
  engine.build(planSetName, {
    ...existing options,
    squashBaseHash,
    prdFilePath: enqueuedFilePath,
  })
  ```
- **Remove** the separate `cleanupCompletedPrd()` call at lines 362-368 — cleanup is now consolidated inside `build()`.

### 4. Render new events — `src/cli/display.ts`

Add cases after the cleanup events (~line 490):

```typescript
case 'squash:start':
  startSpinner('squash', `Squashing ${event.commitCount} commits...`);
  break;
case 'squash:complete':
  succeedSpinner('squash', `Squashed to ${chalk.dim(event.commitHash)}`);
  break;
```

### 5. Reuse `getHeadHash` — `src/engine/prd-queue.ts`

`getHeadHash()` already exists in `prd-queue.ts:234` and is exported. Import it in `eforge.ts` and `cli/index.ts`.

### Files to modify

| File | Change |
|------|--------|
| `src/engine/events.ts` | Add `squash:start`/`squash:complete` events, extend `BuildOptions` |
| `src/engine/eforge.ts` | Add `squashRunCommits()`, `composeSquashMessage()`, modify `build()`, `runQueue()`, `cleanupPlanFiles()` |
| `src/cli/index.ts` | Capture base hash, pass to build, remove separate PRD cleanup |
| `src/cli/display.ts` | Render squash events |

## Scope

**In scope:**
- Squashing all intermediate commits into one content commit after a successful run
- Consolidating plan file and PRD cleanup into a single cleanup commit
- New `squash:start`/`squash:complete` engine events and CLI rendering
- Threading `squashBaseHash` and `prdFilePath` through `BuildOptions`
- Both CLI `run` and `runQueue()` code paths

**Out of scope:**
- Squash on failed runs — intermediate commits remain for debugging
- Squash-specific unit tests (pure git ops, verified manually)
- Changes to the monitor or other consumers

## Acceptance Criteria

- `pnpm type-check` passes with the new `squash:start`/`squash:complete` event types and extended `BuildOptions`.
- `pnpm build` succeeds.
- `pnpm test` — all existing tests pass.
- After a successful `eforge run` on a test PRD, `git log --oneline -5` shows exactly two new commits: one content commit and one cleanup commit.
- The content commit (`HEAD~1`) contains plan files + code changes: verified via `git show --stat HEAD~1`.
- The cleanup commit (`HEAD`) only removes plan files + PRD: verified via `git show --stat HEAD`.
- `git diff HEAD~2..HEAD` shows no net plan files (added then removed).
- When a run produces only a single commit (trivial errand), squash is a no-op (`commitCount <= 1` guard).
- When a run fails (`status !== 'completed'`), no squash occurs and intermediate commits remain intact.
- When `--no-cleanup` is used, squash still fires (collapses history) but no cleanup commit is produced — plan files remain in tree and history.
- The squash commit message uses the format: prefix from `mode` (`errand` → `fix`, else `feat`), scope from `name`, subject from `description`, body listing plan names.
- The cleanup commit message reads `cleanup(planSet): remove plan files and PRD` when a PRD path is present, or `cleanup(planSet): remove plan files` when not.
- The separate `cleanupCompletedPrd()` call in the CLI `run` handler is removed — PRD cleanup is consolidated inside `build()`.
