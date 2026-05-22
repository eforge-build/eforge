---
id: plan-02-queue-runtime-and-prd-provenance
name: Decouple runtime queue state from git; commit PRD provenance on the eforge
  work branch
branch: branch-aware-landing-and-queue-provenance-split-for-eforge-builds/plan-02-queue-runtime-and-prd-provenance
agents:
  builder:
    effort: xhigh
    rationale: "Touches the most subtle invariants in the project: enqueue commit
      timing, queue-state transitions, and the new committed-then-cleaned PRD
      artifact. Requires careful coordination across enqueue, recovery, and
      orchestrator phases without breaking the daemon snapshot or scheduler
      semantics."
  reviewer:
    effort: high
    rationale: Runtime state mutation invariants and the new commit-then-cleanup
      contract need thorough review.
---

## Architecture Context

This plan implements decision 1 from the source PRD: separating runtime queue state from committed PRD provenance. Today, `enqueuePrd` writes a file to the configured queue dir and `commitEnqueuedPrd` commits it on the user's current branch — which leaks queue noise onto trunk. Subsequent queue mutations (`movePrdToSubdir`, `movePrdFromWaiting`, `setQueuedPrdProfile`, `cleanupCompletedPrd`, `moveAndCommitFailedWithSidecar`) also commit on the user's current branch. With the queue path now under `.eforge/queue` (gitignored, from Plan 01), those commits must stop entirely: there is nothing tracked to mutate.

Provenance must still exist. This plan adds a temporary committed PRD artifact at `eforge/prds/{prdId}.md` on the eforge work branch, materialized in the merge worktree after build setup. The artifact is committed via `forgeCommit` so it appears in the eforge work branch history, and is removed by `cleanupPlanFiles` before final landing. The orchestrator and `buildSinglePrd` path are updated to thread the PRD content/identity into the build.

## Implementation

### Overview

1. Remove the `commitEnqueuedPrd` call from `EforgeEngine.enqueue` so writing a PRD to `.eforge/queue` does not produce a commit on the user's current branch.
2. Convert queue-state mutation helpers in `packages/engine/src/prd-queue.ts` from `git mv` + `forgeCommit` to filesystem-only `rename` operations. Affected helpers: `movePrdToSubdir`, `movePrdFromWaiting`, `setQueuedPrdProfile`, `cleanupCompletedPrd`, `moveAndCommitFailedWithSidecar`. The `commitEnqueuedPrd` helper is removed (no callers remain after the eforge.ts edit).
3. Update `propagateSkip` and `unblockWaiting` to use the new fs-only move helper.
4. Update `packages/engine/src/recovery/apply.ts` similarly: queue-state mutations during recovery apply become filesystem-only.
5. Add a new exported helper `materializePrdArtifact({ mergeWorktreePath, prdId, prdContent, modelTracker }): Promise<{ artifactRelPath: string }>` that writes `eforge/prds/{prdId}.md` in the merge worktree, stages it, and commits via `forgeCommit` with message `build({prdId}): record PRD provenance`. The function returns the relative path so cleanup can remove it.
6. Thread PRD content/identity through the build path: `EforgeEngine.build` accepts an existing `options.prdFilePath`; in `buildSinglePrd` (the queue subprocess path) and in `build` itself, after the merge worktree is created and before the orchestrator runs, call `materializePrdArtifact` and pass the returned `artifactRelPath` to the orchestrator. The orchestrator forwards it to `executeLandingAction` via `cleanupPrdFilePath` (which already exists as a parameter — Plan 03 will wire cleanup to also run during `issue-pr`).
7. Update `cleanupPlanFiles` to accept the new artifact path. The function already accepts an optional `prdFilePath`; this plan repoints that parameter at the materialized `eforge/prds/{prdId}.md` artifact instead of the source queue PRD path. Update the commit message wording to reflect that what is being removed is a temporary provenance artifact, not the source PRD.

### Key Decisions

1. **Filesystem-only queue mutations** — Now that `.eforge/queue` is gitignored, `git mv` and `forgeCommit` would be no-ops at best and error-prone at worst (e.g. when the file is untracked). Use `node:fs/promises#rename` and `mkdir({ recursive: true })`. No fallback to `git add`.
2. **Artifact path** — Use `eforge/prds/{prdId}.md` as the temporary committed path. `eforge/` is normal tracked space (it carries the team-side `eforge/profiles/`, `eforge/config.yaml`, `eforge/plans/`). The `prds/` subfolder is dedicated to build-time provenance and is removed before landing.
3. **Materialization timing** — Commit the artifact on the eforge work branch (the merge worktree's HEAD) after worktree creation but before the orchestrator starts. This guarantees the artifact appears early in the eforge work branch history so it is part of every PR diff window before cleanup runs.
4. **`cleanupPrdFilePath` is now the artifact, not the queue file** — Conceptually this parameter changes meaning. The queue file in `.eforge/queue` is no longer tracked, so cleanup never needs to remove it. The artifact in `eforge/prds/` is the only thing cleanup must remove. The parameter is repurposed rather than renamed in this plan to minimize blast radius; Plan 03 may rename it as part of the landing rework if it improves clarity.
5. **Recovery sidecars** — Today `moveAndCommitFailedWithSidecar` commits the `git mv` and both sidecar JSON/MD files in one `forgeCommit`. With queue state gitignored, the move becomes a filesystem rename and the sidecars are no longer committed. They live alongside the failed PRD under `.eforge/queue/failed/` as runtime state.
6. **Test artifacts in `playbook-api.test.ts`** — A test that runs `git status --porcelain eforge/queue/` to verify enqueue is committed becomes inverted: it now asserts that `git status --porcelain` reports no changes under `eforge/queue/` AND that the queue file lives at `.eforge/queue/{slug}.md`.

## Scope

### In Scope

- Remove the `commitEnqueuedPrd` import and call from `packages/engine/src/eforge.ts` enqueue path. Delete the `commitEnqueuedPrd` export from `packages/engine/src/prd-queue.ts`.
- Convert `movePrdToSubdir`, `movePrdFromWaiting`, `setQueuedPrdProfile`, `cleanupCompletedPrd`, `moveAndCommitFailedWithSidecar` in `packages/engine/src/prd-queue.ts` to filesystem-only operations. Drop the `forgeCommit` calls. The `moveAndCommitFailedWithSidecar` is renamed to `moveFailedWithSidecar` (no commit happens) and its return shape preserved.
- Update all callers in `packages/engine/src/eforge.ts` and `packages/engine/src/recovery/apply.ts` to use the renamed/no-commit helper. Update `packages/engine/src/queue/scheduler.ts` if it calls the affected helpers directly.
- Add `materializePrdArtifact` to `packages/engine/src/prd-queue.ts` (or a new `prd-artifact.ts` if cleaner). Export from `packages/engine/src/index.ts`.
- Thread the artifact through `EforgeEngine.build`: accept `options.prdFilePath`, materialize before orchestrator starts when present, pass the resulting `artifactRelPath` into the orchestrator's `cleanupPrdFilePath` slot.
- Update `packages/engine/src/cleanup.ts` so the cleanup commit message changes from `cleanup({planSet}): remove plan files and PRD` to `cleanup({planSet}): remove plan files and PRD provenance artifact` when an artifact path is provided.
- Update tests:
  - `test/prd-queue-enqueue.test.ts` — assert that enqueue does NOT create a commit on the current branch; the queue file exists at the configured (or `.eforge/queue`) path.
  - `test/prd-queue.test.ts` — assert filesystem-only behavior for `movePrdToSubdir` (no commit), `movePrdFromWaiting`, `setQueuedPrdProfile`, `cleanupCompletedPrd`.
  - `test/playbook-api.test.ts` — fix the `git status` assertion to expect no changes under `eforge/queue/` after enqueue and that the file landed under `.eforge/queue/`.
  - New test `test/prd-artifact.test.ts` covering: (a) artifact is created and committed in merge worktree; (b) commit message reads `build({prdId}): record PRD provenance`; (c) `cleanupPlanFiles` with the artifact path removes it and the next `git log` shows both events.
- Update tests that previously asserted commit-side-effects of queue mutations to assert filesystem-only behavior, including `test/queue-piggyback.test.ts` if it inspects commits.

### Out of Scope

- Branch-aware landing policy / non-trunk PR-after-local-merge / cleanup-before-issue-pr — Plan 03.
- Init flow changes for trunk branch and trunk-merge policy — Plan 04.
- Migration tool for historical tracked `eforge/queue` files.
- Changing the recovery sidecar payload schema.

## Files

### Create

- `test/prd-artifact.test.ts` — Integration tests: (a) `materializePrdArtifact` writes and commits `eforge/prds/{prdId}.md` in a temp merge worktree; (b) commit message matches `build({prdId}): record PRD provenance` and carries the `Co-Authored-By: forged-by-eforge` trailer; (c) `cleanupPlanFiles` with the artifact path removes the artifact and commits the removal; (d) the artifact appears in `git log` history of the eforge work branch but not in `HEAD` after cleanup.

### Modify

- `packages/engine/src/prd-queue.ts` — Add `materializePrdArtifact({ mergeWorktreePath, prdId, prdContent, modelTracker })`; remove `commitEnqueuedPrd`; convert `movePrdToSubdir`, `movePrdFromWaiting`, `setQueuedPrdProfile`, `cleanupCompletedPrd` to filesystem-only (drop the `exec('git', ['mv', ...])` and `forgeCommit` calls; use `mkdir({ recursive: true })` + `rename`). Rename `moveAndCommitFailedWithSidecar` to `moveFailedWithSidecar` and drop the `forgeCommit`. Keep the function returning `{ mdPath, jsonPath, destPath }`.
- `packages/engine/src/eforge.ts` — Remove `commitEnqueuedPrd` import and its call in the `enqueue` method (drop the `enqueue:commit-failed` event since there is no commit). In `build`, after `createMergeWorktree(...)` returns `mergeWorktreePath` and before constructing the `Orchestrator`, when `options.prdFilePath` is provided, read the PRD content and call `materializePrdArtifact({ mergeWorktreePath, prdId: planSetName, prdContent, modelTracker: ctx.modelTracker })`. Use the returned `artifactRelPath` as `cleanupPrdFilePath` instead of the source `prdFilePath`. Update the inline-recovery callers that still reference `moveAndCommitFailedWithSidecar` to use the new name.
- `packages/engine/src/recovery/apply.ts` — Update queue-state moves in `retry` and `abandon` paths to filesystem-only operations (no `git rm`, no `forgeCommit`).
- `packages/engine/src/queue/scheduler.ts` — Update any direct call sites for the renamed `moveFailedWithSidecar` helper.
- `packages/engine/src/index.ts` — Re-export `materializePrdArtifact` and update the surface to drop `commitEnqueuedPrd` and `moveAndCommitFailedWithSidecar` if they were exported (replace with `moveFailedWithSidecar`).
- `packages/engine/src/cleanup.ts` — Update commit message in the `prdFilePath` branch to `cleanup({planSet}): remove plan files and PRD provenance artifact`.
- `packages/client/src/daemon-client.ts` — Update the stale `// See the bug report in 'eforge/queue/'.` comment to reference `.eforge/queue/`.
- `test/prd-queue-enqueue.test.ts` — Assert no commit happens on the current branch after enqueue; assert the queue file exists at the configured path; remove any assertions that pre-supposed an enqueue commit.
- `test/prd-queue.test.ts` — Assert filesystem-only semantics for `movePrdToSubdir`, `movePrdFromWaiting`, `setQueuedPrdProfile`, and `cleanupCompletedPrd`. Remove commit-checking asserts.
- `test/playbook-api.test.ts` — Invert the `git status --porcelain eforge/queue/` assertion: it must now show no changes; assert the file landed at `.eforge/queue/{slug}.md`.
- `test/queue-piggyback.test.ts` — If it asserts commit side effects on waiting/skip transitions, update to filesystem-only assertions.

## Verification

- [ ] After `EforgeEngine.enqueue('inline source')` runs in a temp git repo, `git status --porcelain` reports zero changes and no new commits appear via `git log --oneline -1`.
- [ ] The enqueued PRD exists at `<cwd>/.eforge/queue/{slug}.md` and is git-ignored (not appearing in `git status`).
- [ ] After a successful `EforgeEngine.build` (test harness), the merge worktree's git log shows a commit titled `build({planSetName}): record PRD provenance` introducing `eforge/prds/{planSetName}.md`.
- [ ] After cleanup runs (test harness invoking `cleanupPlanFiles` with the artifact path), `eforge/prds/{planSetName}.md` no longer exists in the worktree HEAD and a commit titled `cleanup({planSet}): remove plan files and PRD provenance artifact` is present.
- [ ] `movePrdToSubdir(filePath, 'failed', cwd)` moves the file via `rename` and does NOT produce a new commit; `git log --oneline -1` is unchanged.
- [ ] `cleanupCompletedPrd(filePath, queueDir, cwd)` removes the file via `rm` (or rename) and does NOT produce a new commit.
- [ ] `commitEnqueuedPrd` is no longer exported from `@eforge-build/engine` (grep the public surface).
- [ ] `moveAndCommitFailedWithSidecar` no longer exists; `moveFailedWithSidecar` is the only failed-move helper.
- [ ] `pnpm type-check` and `pnpm test` pass.