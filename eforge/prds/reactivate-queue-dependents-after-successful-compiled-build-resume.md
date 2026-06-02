---
title: Reactivate queue dependents after successful compiled-build resume
created: 2026-06-02
landing: pr
landing_auto_merge: true
---

# Reactivate queue dependents after successful compiled-build resume

## Problem / Motivation

Backlog source: `.eforge/backlog/items/backlog-2026-06-02-reactivate-queue-dependents-after-successful-compiled-build-.md`.

Roadmap alignment: `docs/roadmap.md` lists Kernel Resilience and Typed Recovery as active direction, including typed retry/recovery/queue-cascade recovery paths and honest gates. This work fits that roadmap by making compiled-build resume a complete recovery path for queued dependency cascades.

Initial classification: **bugfix / focused** with high confidence. The reported behavior is an incorrect recovery/dependency outcome in existing queue/resume flows. The required dimensions are problem statement, reproduction steps, root cause, acceptance criteria, and assumptions/validation. Extra code-impact detail is included because this is recovery-sensitive engine work.

A queued PRD can fail after compile, causing queued descendants that depend on it to be moved from `.eforge/queue/waiting/` to `.eforge/queue/skipped/`. If the failed PRD is then resumed from compiled artifacts and the resume succeeds, the recovery is incomplete: descendants remain skipped, the original PRD can still appear under `.eforge/queue/failed/`, and stale failed/skipped completion state may continue to block dependency checks.

Affected users: anyone using `depends_on` / stacked queued builds with compiled-build resume after a failed upstream.

Why it matters: a successful resume should restore the queue dependency graph to a healthy state. Otherwise downstream queued work requires manual queue-cascade repair even though the upstream has successfully recovered.

Confirmed current behavior and evidence:

- `packages/engine/src/queue/scheduler.ts` handles normal queued PRD completion. On `queue:prd:complete` with `completed`, it writes `.eforge/artifacts/completions.json`, checks `.eforge/artifacts/builds.json`, and calls `unblockWaiting(...)`. On `failed` or `skipped`, it calls `propagateSkip(...)` and marks in-memory dependents blocked.
- `packages/engine/src/prd-queue.ts` implements `propagateSkip(...)`, which moves waiting dependents into `.eforge/queue/skipped/`, and `unblockWaiting(...)`, which only scans `.eforge/queue/waiting/` and only unblocks when all dependencies are inactive and have usable artifact records.
- `packages/engine/src/eforge.ts` `resumeBuild()` emits `build:resume:start`, `build:resume:state`, `build:resume:artifacts`, and `build:resume:complete` for successful compiled-build resume, but it does not emit `queue:prd:complete` and does not call queue unblock/reactivation helpers.
- `packages/engine/src/eforge.ts` resume orchestration currently constructs `new Orchestrator(...)` without `prdId`. `packages/engine/src/orchestrator/phases.ts` `recordArtifact(...)` only records queue artifacts when `ctx.prdId` is present, so resumed builds likely do not currently create/update the durable artifact record for the original queued PRD id.
- `packages/engine/src/artifacts/completions.ts` says failed/skipped completion entries block stale artifacts; scheduler dependency checks inspect failed/skipped completion entries before checking artifact registry. A successful resume must therefore replace a stale failed/skipped completion entry with `completed` and `artifactAvailable: true`, not just create an artifact record.
- `packages/engine/src/queue/recovery-cascade.ts` already contains graph traversal and guarded file moves for manual retry/reactivation, with tests in `test/queue-recovery-cascade.test.ts`. It is explicit/manual and moves the failed parent back to queue for retry; it is not currently the desired automatic post-resume-success behavior.
- `packages/monitor/src/routes/resume.ts` and `packages/monitor/src/routes/resume-service.ts` spawn the CLI `resume` worker. No route-level post-success queue mutation is visible; any automatic behavior should happen in the engine/worker stream on successful resume, not depend on Console or Pi observing events.

Static reproduction scenario validated by code inspection:

1. Queue PRD `parent` and PRD `child` with `child` frontmatter containing `depends_on: [parent]`.
2. Let `parent` fail while `child` is waiting. `QueueScheduler.onComplete()` handles `queue:prd:complete` with `failed` and calls `propagateSkip(...)`, which recursively moves waiting dependents into `.eforge/queue/skipped/`.
3. Start compiled-build resume for `parent` using `eforge resume parent` or the daemon `resumeBuild` route.
4. Let resume finish successfully. `resumeBuild()` emits `build:resume:complete` but does not emit `queue:prd:complete` and does not call any queue-cascade reactivation helper.
5. Observe that `.eforge/queue/skipped/child.md` remains skipped, `.eforge/queue/failed/parent.md` and sidecars may remain present, and dependency checks may still see failed/skipped completion state for `parent`.

Root causes:

1. **Resume is not integrated with queue terminal completion.** Normal queue processing updates completion state and unblocks or skips dependents from `QueueScheduler.onComplete()` in `packages/engine/src/queue/scheduler.ts`. Compiled-build resume in `packages/engine/src/eforge.ts` is a separate worker path that emits `build:resume:complete` but does not invoke the queue completion path.
2. **Resume does not currently provide `prdId` to artifact recording.** `recordArtifact(ctx)` in `packages/engine/src/orchestrator/phases.ts` returns early unless `ctx.prdId` exists. The normal queued build path passes `prdId: options.prdId` to `Orchestrator`; the resume path does not. Therefore a successful resume likely does not write a usable `.eforge/artifacts/builds.json` record for the original queue PRD id.
3. **Failed/skipped completion records can remain authoritative blockers.** Dependency checks in scheduler and queue validation treat completion records with `status: failed` or `status: skipped` as unsatisfied before checking for artifacts. A successful resume must replace the original failed/skipped completion record with `completed` and `artifactAvailable: true` after the artifact is durably recorded.
4. **Existing queue-cascade recovery is manual retry-oriented.** `packages/engine/src/queue/recovery-cascade.ts` can move failed upstreams back to queue and reactivate skipped descendants, but its current operation model is for retrying the failed parent, not for finalizing a successful resume where the parent should be retired from `failed/` and descendants should be reactivated based on the completed artifact.

## Goal

A successful compiled-build resume for a failed queued PRD should restore the queue dependency graph to a healthy state by recording the upstream as completed, retiring stale failed state, and reactivating skipped descendants according to normal dependency semantics.

The recovery path should be automatic inside the engine/worker resume stream and should not require manual queue-cascade repair or Console/Pi observation.

## Approach

Implement the recovery inside the engine resume path.

Likely implementation targets:

- `packages/engine/src/eforge.ts`
  - Pass `prdId` into the resume `Orchestrator` so `recordArtifact(ctx)` records the resumed upstream as a durable queue artifact.
  - After resume status is `completed`, run a dedicated post-resume queue finalization step before or immediately around `build:resume:complete` emission.
- `packages/engine/src/queue/recovery-cascade.ts` or a new nearby helper module
  - Add a successful-resume finalization helper that is distinct from manual retry recovery.
  - Validate safe `prdId`.
  - Ensure a usable artifact exists for `prdId`.
  - Upsert completion record to `completed` with `artifactAvailable: true`.
  - Remove `.eforge/queue/failed/<prdId>.md`.
  - Remove `.recovery.md` and `.recovery.json` sidecars.
  - Traverse skipped descendants.
  - Move each descendant to queue root when all dependencies are satisfied or to waiting when some dependencies are still active/unsatisfied.
  - Reuse existing queue snapshot, descendant traversal, dependency satisfaction, safe path, and target-collision patterns where practical.
- `packages/engine/src/artifacts/completions.ts`
  - No API change appears necessary; existing `upsertCompletion(...)` can replace stale failed/skipped entries.
- Tests
  - Add focused engine tests, probably alongside `test/queue-recovery-cascade.test.ts`.
  - Cover successful-resume finalization with failed parent cleanup.
  - Cover sidecar cleanup.
  - Cover stale completion replacement.
  - Cover descendant reactivation to queue root.
  - Cover descendant reactivation to waiting when another dependency is still active/missing.
  - Cover guarded no-op/block behavior when no usable artifact exists.
- Documentation / UI
  - No user-facing route shape change is required if finalization happens inside the resume worker.
  - Console copy may not need changes unless it currently promises manual-only cascade recovery.
  - If docs mention compiled-build resume semantics, update that section to state that successful resume retires the failed queue entry and reactivates skipped descendants.

Design decisions:

- **Treat resume start as reactivation of the queued PRD.** When compiled-build resume starts for a failed queued PRD, move `.eforge/queue/failed/<prdId>.md` back to the queue root and claim the PRD lock so the queue/projection sees it as active/running rather than failed.
- **Claim before exposing the root queue file.** The resume worker should create/own `.eforge/queue-locks/<prdId>.lock` before or atomically with moving the PRD to root. This prevents the auto-build scheduler from rediscovering the root PRD and launching a duplicate normal queue worker while resume is running.
- **Unskip descendants immediately, but keep them blocked by normal dependency semantics.** When resume starts, move skipped descendants of the resumed PRD from `.eforge/queue/skipped/` to `.eforge/queue/waiting/`. They should no longer be terminally skipped, but they should not start until the resumed upstream completes and records a usable artifact.
- **Preserve recovery sidecars until the resume outcome is known.** Moving the failed PRD markdown out of `failed/` removes the visible failed queue item. Keep `.recovery.md` and `.recovery.json` sidecars until resume succeeds so recovery evidence is not lost if resume fails or crashes. Remove sidecars only during successful finalization.
- **On successful resume, finalize like a completed queued upstream.** Require a usable artifact record for `prdId`, upsert completion state to `completed` with `artifactAvailable: true`, remove the active root queue PRD file, remove stale failed sidecars, release the PRD lock, and call normal waiting-unblock logic so immediately unskipped descendants can move from waiting to the queue root when all dependencies are satisfied.
- **On failed or ineligible resume, roll back to failed semantics.** Release the PRD lock, move the root PRD back to `failed/`, and propagate skip for waiting descendants that depend on the resumed PRD. Existing sidecars can remain as recovery evidence unless the implementation generates newer sidecars.
- **Keep manual queue-cascade recovery separate.** Existing retry/reactivation routes should remain explicit manual recovery tools. The new resume-start/reactivation and resume-success/failure finalization helpers can share internal graph/path code but should not overload `applyQueueRecovery(...)` semantics because that API moves the failed parent back to queue for manual retry.
- **Prefer filesystem helper tests over agent/integration tests.** The critical behavior is deterministic queue/artifact/completion/lock state mutation. Tests can seed queue files and registries directly without invoking agent harnesses.

A focused test can reproduce the scenario without running real agents by directly seeding `.eforge/queue/failed/parent.md`, `.eforge/queue/skipped/child.md`, `.eforge/artifacts/builds.json`, and `.eforge/artifacts/completions.json`, then invoking the new post-resume-success helper.

Recommended profile: **Excursion**.

Profile rationale: this is a cohesive engine bugfix involving queue state, resume finalization, artifact/completion registries, and tests. A single planner can enumerate the required changes and dependencies; it does not require delegated module planning. It is more than an Errand because the ordering and safety invariants around artifacts, completions, failed files, and skipped descendants matter.

Assumptions and validation:

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| Passing `prdId` into the resume `Orchestrator` is sufficient to make `recordArtifact(ctx)` write the resumed PRD artifact. | `resumeBuild()` constructs `Orchestrator` without `prdId`; normal build path passes `prdId: options.prdId`; `recordArtifact(ctx)` returns early when `ctx.prdId` is absent and uses `ctx.prdId` for `upsertArtifact`. | high | low | Add a focused unit/integration test around resume orchestration or inspect emitted artifact registry after a resume fixture. | If wrong, the finalization helper would need to upsert the artifact directly or receive artifact details from resume eligibility. |
| A root queue PRD with a live lock will be treated as active/running and not launched by the scheduler. | `packages/monitor/src/projections/queue-items.ts` reports root queue items with a lock as `running`; `QueueScheduler.discoverNewPrds()` calls reconciliation after discovery; scheduler comments describe promoting pending PRDs with live locks to running. | high | low | Add a scheduler/helper test where a failed PRD is moved to root with a live lock and verify no duplicate spawn occurs on queue mutation. | Resume start could accidentally launch a duplicate normal queue worker. |
| Unskipping descendants at resume start should move them to waiting, not queue root. | While the upstream is actively resuming it is not dependency-satisfied yet. Existing queue semantics use `waiting/` for held dependents and `unblockWaiting(...)` moves them to root after upstream completion plus usable artifact. | high | low | Test start-resume transition moves skipped descendants to waiting, then success finalization unblocks only satisfied descendants. | Descendants could start too early or remain unnecessarily terminal. |
| Stale failed/skipped completion records must be replaced after successful resume. | Scheduler and queue validation check `completionRecord.status === failed/skipped` before accepting artifact readiness; `completions.ts` documents that failed/skipped entries block stale artifacts. | high | low | Add a test with `completions.json` seeded as failed and verify dependency checks pass only after upsert to completed/artifactAvailable. | Descendants may remain blocked even after artifact recording. |
| Successful-resume queue transitions should live in the engine resume path, not in monitor routes or UI. | Resume can be started from CLI, daemon route, Pi, or plugin; only the engine resume generator knows the authoritative final status across all entry points. | high | low | Verify all resume entry points call `EforgeEngine.resumeBuild()`, already confirmed for CLI and daemon spawn route. | Some entry points would fail to reactivate dependents if finalization lived outside the engine. |
| Preserving recovery sidecars until resume outcome is known is safer than deleting them at resume start. | User wants the failed queue item cleaned up at resume start. Moving the `.md` file removes the visible failed queue item; sidecars alone are not projected as failed queue items. Sidecars contain recovery evidence that remains useful if resume fails or crashes. | medium | low | Confirm Console/queue projections ignore sidecars without `.md`; already validated in `queue-items.ts` because loaders only include `.md` files. | If product expectations require an entirely empty `failed/` directory during resume, sidecars would need to move to a temporary resume metadata location or be deleted earlier. |
| Failed or ineligible resume should roll queue state back to failed/skipped semantics. | Normal queue failure calls `propagateSkip(...)`; preserving this behavior avoids leaving descendants waiting on an upstream that is terminally failed again. | high | low | Test resume failure helper path with root parent and waiting child. | Descendants could remain unskipped after the upstream failed again. |

No low-confidence/high-impact assumptions remain. The main behavioral assumptions were validated by static inspection of queue scheduler, queue projection, resume, artifact, completion, and recovery-cascade code paths. Runtime validation should be added as focused tests during implementation.

## Scope

In scope:

- Integrating compiled-build resume success with queue dependency recovery.
- Passing the original queue `prdId` into resumed orchestration so queue artifacts can be recorded.
- Adding resume-start queue reactivation behavior for failed queued PRDs.
- Creating and owning `.eforge/queue-locks/<prdId>.lock` during resume.
- Moving failed PRD markdown from `.eforge/queue/failed/` to the queue root when resume starts.
- Moving skipped descendants of the resumed PRD into `.eforge/queue/waiting/` when resume starts.
- Preserving `.recovery.md` and `.recovery.json` sidecars until resume outcome is known.
- Adding successful-resume finalization that requires a usable artifact, updates completion state, removes stale failed state and sidecars, releases the lock, and unblocks waiting descendants through normal dependency semantics.
- Adding failed or ineligible resume rollback that releases the lock, moves the PRD back to failed, and propagates skip to waiting descendants that depend on the resumed PRD.
- Reusing existing queue snapshot, graph traversal, dependency satisfaction, safe path, guarded file move, and target-collision patterns where practical.
- Adding focused filesystem/helper tests for queue/artifact/completion/lock state mutation.
- Updating compiled-build resume documentation if existing docs mention those semantics.

Out of scope:

- Changing user-facing daemon route shapes.
- Depending on Console or Pi event observation for automatic queue mutation.
- Overloading `applyQueueRecovery(...)` manual retry semantics.
- Replacing the explicit/manual queue-cascade recovery routes.
- Requiring agent harness or full integration tests for the deterministic queue/artifact/completion/lock mutations.
- Changing `packages/engine/src/artifacts/completions.ts` APIs unless implementation proves it necessary.
- Changing Console copy unless it currently promises manual-only cascade recovery.

## Acceptance Criteria

- Starting compiled-build resume for a failed queued PRD moves `.eforge/queue/failed/<prdId>.md` to `.eforge/queue/<prdId>.md`.
- Starting compiled-build resume for a failed queued PRD creates a live `.eforge/queue-locks/<prdId>.lock` owned by the resume worker.
- The resume worker claims `.eforge/queue-locks/<prdId>.lock` before or atomically with moving `.eforge/queue/failed/<prdId>.md` to `.eforge/queue/<prdId>.md`.
- A failed queued PRD moved to `.eforge/queue/<prdId>.md` with a live `.eforge/queue-locks/<prdId>.lock` is not launched by the scheduler as a duplicate normal queue worker.
- Starting compiled-build resume for a failed queued PRD moves skipped descendants of `<prdId>` from `.eforge/queue/skipped/` to `.eforge/queue/waiting/`.
- Starting compiled-build resume for a failed queued PRD does not move non-descendant skipped PRDs.
- Starting compiled-build resume preserves `.eforge/queue/failed/<prdId>.recovery.md` until the resume succeeds or explicitly fails.
- Starting compiled-build resume preserves `.eforge/queue/failed/<prdId>.recovery.json` until the resume succeeds or explicitly fails.
- The resume `Orchestrator` is constructed with the original queued PRD id as `prdId`.
- `recordArtifact(ctx)` receives `ctx.prdId` during a successful compiled-build resume for a queued PRD.
- A successful compiled-build resume records a usable artifact for the original queued PRD id in `.eforge/artifacts/builds.json`.
- A successful compiled-build resume upserts `.eforge/artifacts/completions.json` for the original queued PRD id with `status: completed`.
- A successful compiled-build resume upserts `.eforge/artifacts/completions.json` for the original queued PRD id with `artifactAvailable: true`.
- A successful compiled-build resume replaces a stale `failed` completion entry for the original queued PRD id.
- A successful compiled-build resume replaces a stale `skipped` completion entry for the original queued PRD id.
- A successful compiled-build resume removes `.eforge/queue/<prdId>.md` when that active queue file exists.
- A successful compiled-build resume removes `.eforge/queue/failed/<prdId>.md` when that failed queue file exists.
- A successful compiled-build resume removes `.eforge/queue/failed/<prdId>.recovery.md` when that sidecar exists.
- A successful compiled-build resume removes `.eforge/queue/failed/<prdId>.recovery.json` when that sidecar exists.
- A successful compiled-build resume releases `.eforge/queue-locks/<prdId>.lock` when that lock exists.
- Successful-resume finalization calls normal waiting-unblock logic after the usable artifact and completed completion record are durable.
- After successful resume finalization, a waiting descendant whose dependencies all have usable artifacts is moved from `.eforge/queue/waiting/` to the queue root.
- After successful resume finalization, a waiting descendant with at least one dependency that remains active remains in `.eforge/queue/waiting/`.
- After successful resume finalization, a waiting descendant with at least one dependency that lacks a usable artifact remains in `.eforge/queue/waiting/`.
- Successful-resume finalization does not unblock descendants when no usable artifact exists for `<prdId>`.
- Successful-resume finalization handles the no-usable-artifact case as a guarded no-op/block behavior.
- A failed compiled-build resume moves `.eforge/queue/<prdId>.md` back to `.eforge/queue/failed/<prdId>.md` when the active queue file exists.
- An ineligible compiled-build resume moves `.eforge/queue/<prdId>.md` back to `.eforge/queue/failed/<prdId>.md` when the active queue file exists.
- A failed compiled-build resume releases `.eforge/queue-locks/<prdId>.lock` when that lock exists.
- An ineligible compiled-build resume releases `.eforge/queue-locks/<prdId>.lock` when that lock exists.
- A failed compiled-build resume moves waiting descendants that depend on `<prdId>` back to `.eforge/queue/skipped/`.
- An ineligible compiled-build resume moves waiting descendants that depend on `<prdId>` back to `.eforge/queue/skipped/`.
- Existing recovery sidecars remain available as recovery evidence after a failed resume unless the implementation generates newer sidecars.
- Existing recovery sidecars remain available as recovery evidence after an ineligible resume unless the implementation generates newer sidecars.
- Target path collisions during resume start are handled without overwriting existing queue files.
- Target path collisions during successful-resume finalization are handled without overwriting existing queue files.
- Existing manual queue recovery analyze behavior remains covered by tests.
- Existing manual queue recovery apply behavior remains covered by tests.
- Existing manual queue recovery apply behavior still moves a failed parent back to queue for retry.
- A focused test command for resume queue reactivation/finalization exits 0.
- `pnpm type-check` exits 0.
