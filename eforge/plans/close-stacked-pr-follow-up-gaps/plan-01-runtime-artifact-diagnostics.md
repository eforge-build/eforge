---
id: plan-01-runtime-artifact-diagnostics
name: Runtime Artifact Finalization and Completion Diagnostics
branch: close-stacked-pr-follow-up-gaps/plan-01-runtime-artifact-diagnostics
agents:
  builder:
    effort: high
    rationale: Touches artifact registry lifecycle, queue scheduling, and landing
      flows with ordering-sensitive state updates.
  tester:
    effort: high
    rationale: Requires targeted tests covering registry mutation, landing cleanup
      ordering, and dependency diagnostics across queue states.
---

# Runtime Artifact Finalization and Completion Diagnostics

## Architecture Context

Queued PRD builds already write a provider-neutral usable artifact record before landing starts. That pre-landing record unblocks dependents, but cleanup can commit later on the artifact branch and make the stored `commitSha` stale. Dependency validation also cannot identify completed PRD ids that were removed from `.eforge/queue/` and have no usable artifact.

This plan preserves early artifact readiness while adding post-landing convergence and a small terminal completion index for diagnostics. The artifact registry remains the dependency-readiness source of truth; the completion index records known terminal queue outcomes and never makes a dependency ready by itself.

## Implementation

### Overview

Add artifact registry update helpers and invoke them after generic and stacked landing paths. Add a durable completion registry under `.eforge/artifacts/` and record queue terminal outcomes from both scheduler paths. Update dependency validation to use the completion registry after checking active queue files and failed/skipped terminal queue directories.

### Key Decisions

1. Keep `.eforge/artifacts/builds.json` limited to usable build artifacts with `status: 'built'`; add optional landing metadata rather than storing failed builds in this file.
2. Add a separate `.eforge/artifacts/completions.json` index keyed by PRD id for terminal diagnostics (`completed`, `failed`, `skipped`) and artifact availability at completion time.
3. Failed/skipped terminal state has precedence over stale artifacts. A failed/skipped queue directory entry or completion-index entry blocks dependency validation even when an old built record exists. A completed completion-index entry with `artifactAvailable: false` also blocks stale artifacts for that PRD.
4. Refresh artifact `commitSha` only from a committed artifact branch ref after confirming the merge worktree has no uncommitted files. If that check fails, record landing failure/skipped metadata without replacing the pre-landing SHA.

## Scope

### In Scope

- Extend `ArtifactRecord` with optional landing metadata: `landingStatus`, `prUrl`, `landingCompletedAt`, and `landingFailureReason`.
- Add locked partial-update helpers such as `updateArtifactRecord()` or `finalizeArtifactLanding()` in the artifact registry module.
- Add a completion registry module for `.eforge/artifacts/completions.json` with load/save/upsert/lookup helpers.
- Record terminal queue completions in `EforgeEngine.runQueue()` and `QueueScheduler.onComplete()`.
- Update `validateDependsOnExists()` to distinguish active, terminal failed/skipped, completed with usable artifact, completed without usable artifact, and unknown ids.
- Finalize artifact metadata after:
  - generic `landing.action: pr|merge|leave` in `finalize()`;
  - stacked PR landing in `stackLanding()` after `executeStackLanding()` completes or fails;
  - policy-gate or pre-landing skip/failure branches that bypass generic landing.
- Add tests for update helpers, final SHA refresh after cleanup, landing metadata, completion index precedence, and dependency error messages.

### Out of Scope

- Automated post-merge restack/sync.
- New stack providers.
- Restoring `build.onSuccess` or old landing value compatibility.
- Exposing artifact metadata through a new daemon API.
- Retaining completed PRD files in `.eforge/queue/`.

## Files

### Create

- `packages/engine/src/artifacts/completions.ts` — completion index path, schema, atomic load/save/upsert/lookup helpers with the same temp-file and lock conventions as `registry.ts`.

### Modify

- `packages/engine/src/artifacts/registry.ts` — add optional landing metadata fields and locked partial-update/finalization helpers.
- `packages/engine/src/artifacts/index.ts` — export new registry update helpers and completion registry helpers/types.
- `packages/engine/src/orchestrator/phases.ts` — finalize artifact metadata after landing paths and preserve the pre-landing record when landing metadata update fails.
- `packages/engine/src/stacking/landing.ts` — return or surface stack PR landing metadata (`landingSucceeded`, `prUrl`, failure reason) so `stackLanding()` can update the artifact registry.
- `packages/engine/src/landing.ts` — ensure generic landing returns enough metadata for finalization; document that `commitSha` in `LandingResult` is not the artifact-branch SHA for `merge`.
- `packages/engine/src/prd-queue.ts` — load completion index in `validateDependsOnExists()` and add the completed-without-artifact diagnostic branch.
- `packages/engine/src/queue/scheduler.ts` — record completion index entries in `onComplete()` before unblocking waiting PRDs or propagating skips.
- `packages/engine/src/eforge.ts` — record completion index entries in the legacy `runQueue()` event path and any direct dispatch failure helper that emits `queue:prd:complete`.
- `test/artifact-registry.test.ts` — cover landing metadata schema and partial updates preserving `recordedAt`.
- `test/stack-artifact-recording.test.ts` and/or a new `test/artifact-finalization.test.ts` — assert cleanup-created commits are reflected in final `commitSha` for non-stacked and stacked builds.
- `test/stack-landing-cleanup.test.ts` — assert stacked PR landing result exposes PR URL/status when needed by finalization.
- `test/queue-piggyback.test.ts` and/or `test/artifact-aware-scheduler.test.ts` — cover completion index diagnostics and stale-artifact precedence.

## Implementation Notes

- Reuse the existing artifact registry lock pattern for both `builds.json` updates and `completions.json` writes.
- Completion record fields can be minimal: `prdId`, `status`, `artifactAvailable`, optional `artifactBranch`, `completedAt`, and `updatedAt`.
- In dependency validation, use this precedence:
  1. Active root/waiting queue item: accept.
  2. Failed/skipped queue directory item: throw an error containing `artifact`.
  3. Completion index status `failed` or `skipped`: throw an error containing `artifact`.
  4. Completion index status `completed` with `artifactAvailable: false`: throw an error containing `artifact`.
  5. Usable artifact registry record: accept.
  6. Completion index status `completed`: throw an error containing `artifact`.
  7. Otherwise: throw an error containing `unknown queue item`.
- For final artifact SHA, prefer `getRefSha(ctx.repoRoot, ctx.featureBranch)` after landing/cleanup, not merge-result SHA from the base branch.
- Before replacing `commitSha`, call `getWorktreeDirtyFiles(ctx.mergeWorktreePath)` and skip SHA replacement if uncommitted files are present.

## Verification

- [ ] A queued build still writes a `status: 'built'` artifact before landing begins.
- [ ] After cleanup commits on the artifact branch, the registry record for that PRD has `commitSha` equal to `git rev-parse <featureBranch>`.
- [ ] A stacked PR landing records `landingStatus: 'complete'` and `prUrl` when the provider output or `gh pr view` yields a URL.
- [ ] A landing failure records `landingStatus: 'failed'` or `landingStatus: 'skipped'` while `hasUsableArtifact(registry, prdId)` remains true for the pre-landing build artifact.
- [ ] `validateDependsOnExists(['known-completed-no-artifact'], ...)` rejects with a message containing `artifact`, not `unknown queue item`.
- [ ] A completed/no-artifact completion index entry rejects even when `builds.json` contains an old built record for the same PRD.
- [ ] A failed/skipped completion index entry rejects even when `builds.json` contains an old built record for the same PRD.
- [ ] `pnpm vitest run test/artifact-registry.test.ts test/stack-artifact-recording.test.ts test/stack-landing-cleanup.test.ts test/artifact-aware-scheduler.test.ts test/queue-piggyback.test.ts` passes.