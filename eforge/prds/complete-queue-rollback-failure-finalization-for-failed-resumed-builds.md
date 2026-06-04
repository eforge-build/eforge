---
title: Complete queue rollback/failure finalization for failed resumed builds
created: 2026-06-04
depends_on: ["build-extension-platform-foundation-for-kernel-boundary-extraction"]
landing: pr
landing_auto_merge: true
stack_parent: build-extension-platform-foundation-for-kernel-boundary-extraction
---

# Complete queue rollback/failure finalization for failed resumed builds

## Problem / Motivation

This work aligns with the roadmap’s “Kernel Resilience and Typed Recovery” direction: recovery decisions and failure evidence should be typed, inspectable, and repeatable without moving workflow UX into the engine kernel.

A compiled-resume PRD can fail after it has been reactivated from `.eforge/queue/failed/` into the queue root. When that resumed build fails, current rollback restores the root PRD to `failed/` but leaves the old recovery sidecars beside it. Recovery consumers then read stale failure evidence that may refer to the original failed plan instead of the resumed run’s actual failed plan.

This matters because `eforge_read_recovery_sidecar`, `applyRecovery`, queue projections, and human recovery review rely on `<prdId>.recovery.md` and `<prdId>.recovery.json` as the authoritative evidence next to a failed PRD. Stale sidecars make retry/resume decisions inaccurate and can cause users to patch or retry the wrong plan.

Evidence inspected:

- Backlog item `.eforge/backlog/items/backlog-2026-06-04-complete-queue-rollback-failure-finalization-for-failed-resu.md` records observed resumed session `91e3ea31-317c-4359-8129-3d3981c924a3`, where the resumed build later failed on a different plan but the failed queue still had the original recovery sidecars referring to the earlier failure.
- `packages/engine/src/eforge.ts` normal queued PRD failure finalization runs inline recovery in `spawnPrdChild().finalize()` before `moveFailedWithSidecar()`, generating fresh `.recovery.md` and `.recovery.json` files from `buildFailureSummary()` and recovery-analyst output.
- `packages/engine/src/eforge.ts` compiled-resume queue dispatch calls `resumeBuild(..., schedulerOwned: true)` from `buildSinglePrd()`, then the queue parent detects compiled-resume PRDs and calls `rollbackQueuedResume()` on non-completion. That compiled-resume parent branch returns without running the normal inline recovery sidecar path.
- `packages/engine/src/eforge.ts` direct `resumeBuild()` uses `beginQueuedResume()` / `rollbackQueuedResume()` when not scheduler-owned. Its `finally` block rolls back queue files and emits terminal/phase events, but does not regenerate or remove failed-queue recovery sidecars.
- `packages/engine/src/queue/resume-cascade.ts` `rollbackQueuedResume()` restores the root PRD to `failed/`, re-skips waiting descendants, and releases the lock. It intentionally does not touch `.recovery.md` or `.recovery.json` sidecars.
- `docs/architecture.md` currently says failed or ineligible compiled resumes roll the parent back without overwriting queue files and preserve recovery sidecars until success; this now documents the stale-sidecar behavior that should change for failed resumed builds.
- `test/resume-compiled-build-engine.test.ts` explicitly asserts that an ineligible queued resume rollback preserves both original recovery sidecars. That test will need to be updated or split to distinguish ineligible pre-build rollback from resumed-run failure finalization.

Classification: this is a **bugfix / deep** change. The defect affects recovery consumers after failed compiled resumes, and the implementation crosses engine queue finalization, recovery sidecar generation, docs, and tests.

Reproduction steps:

1. A queued PRD fails and lands in `.eforge/queue/failed/<prdId>.md` with `<prdId>.recovery.md` and `<prdId>.recovery.json` describing the original failure.
2. The user queues a compiled resume for the failed PRD.
3. The compiled-resume build reactivates the root PRD and any skipped descendants.
4. The resumed build makes progress, then fails on a later or different plan.
5. Rollback restores `.eforge/queue/failed/<prdId>.md`, but the adjacent recovery sidecars still describe the original failure instead of the resumed-run failure.

Code-level reproduction hook already exists in `test/resume-compiled-build-engine.test.ts`, which seeds old recovery sidecars and verifies queued-resume rollback behavior. The existing ineligible-resume test currently asserts that old sidecars remain, which matches current behavior for pre-build ineligibility but should not be the only covered failed-resume behavior.

Expected behavior: after a resumed run fails after meaningful resume execution, the failed queue directory contains either freshly regenerated recovery sidecars for the resumed run or an explicit stale/removed-sidecar state that prevents consumers from treating old evidence as current.

Actual behavior: compiled-resume rollback preserves the old sidecars unchanged.

Root cause:

- Normal queued PRD failures go through `packages/engine/src/eforge.ts` `spawnPrdChild().finalize()`. When `moveTo === 'failed'`, that path builds a fresh `BuildFailureSummary`, runs the recovery analyst, and calls `moveFailedWithSidecar()` so the failed PRD and recovery sidecars are updated together.
- Compiled-resume PRDs take a separate branch in `spawnPrdChild().finalize()`: when `isCompiledResumePrd` is true, non-completed statuses call `rollbackQueuedResume()` and then return before the normal inline recovery sidecar branch can run.
- Direct `resumeBuild()` has a similar gap: its `finally` block calls `rollbackQueuedResume()` when a non-scheduler-owned queued resume was started and not finalized, then emits terminal and phase-end events without regenerating or invalidating sidecars.
- `packages/engine/src/queue/resume-cascade.ts` `rollbackQueuedResume()` only moves queue files and releases locks; it does not create, remove, or mark recovery sidecars.
- `docs/architecture.md` documents the current preservation behavior for failed/ineligible resumes, so the documentation is stale once the behavior is fixed.

Related latent distinction: ineligible resumes that fail before a resumed run produces new failure evidence may reasonably preserve the prior sidecars, but resumed-run failures with `build:resume:start`, `build:resume:artifacts`, plan failure, or failed `phase:end` evidence should not preserve stale sidecars as if they were current.

## Goal

Failed compiled-resume builds should leave recovery sidecars that reflect the resumed-run failure, or explicitly invalidate stale evidence when a current summary cannot be trusted. This behavior must apply to both scheduler-owned compiled-resume queue dispatch and direct `resumeBuild(prdId)` rollback paths while preserving queue rollback safety.

## Approach

Implementation targets:

- Update `packages/engine/src/eforge.ts` to add shared failed compiled-resume finalization for both direct `resumeBuild()` rollback and scheduler-owned compiled-resume child finalization.
- Run the failed compiled-resume finalization helper only after rollback has restored the PRD to `failed/`.
- Use the compiled-resume `setName`, `featureBranch`, and `baseBranch` metadata when generating current recovery sidecars.
- Write current sidecars, or explicitly remove or mark stale sidecars if current summary generation cannot be trusted.
- Keep `packages/engine/src/queue/resume-cascade.ts` `rollbackQueuedResume()` as a pure queue-file transition helper unless implementation evidence shows a cleaner boundary.
- Avoid mixing recovery-agent side effects into `packages/engine/src/queue/resume-cascade.ts` unless coupling becomes unavoidable.
- Do not add a parallel summary mechanism when existing recovery summary support can be reused.
- Reuse `packages/engine/src/recovery/failure-summary.ts` and `packages/engine/src/recovery/event-history.ts`; no behavior change is expected because `synthesizeFromEvents()` already considers failed `resume` runs and `buildFailureSummary()` already accepts `featureBranch` and `baseBranch` overrides.
- Update `test/resume-compiled-build-engine.test.ts` to add or adjust coverage for direct `resumeBuild()` failure after resume activation so stale sidecars are replaced or invalidated.
- Preserve separate coverage for ineligible pre-build rollback if that behavior intentionally keeps previous sidecars.
- Add scheduler-owned coverage in the queue/scheduler or resume engine suite for a compiled-resume PRD dispatched through the queue child path, proving parent finalization does not return before sidecar finalization.
- Use an existing harness seam around compiled-resume finalization if a full child-process integration test is too heavy.
- Update `docs/architecture.md` so failed resumed runs describe refreshed or invalidated sidecars rather than unconditional sidecar preservation.

Existing patterns to reuse:

- Normal queued failure inline recovery in `spawnPrdChild().finalize()`.
- `moveFailedWithSidecar()` / `writeRecoverySidecar()` for sidecar writing.
- `buildFailureSummary({ setName, prdId, cwd, dbPath, featureBranch, baseBranch, trunkBranch })` for resumed-run summary reconstruction.
- `determineRecoveryRecommendation()` and `selectFinalVerdict()` for deterministic and analyst verdict selection.

Risks and constraints:

- Recovery finalization must not overwrite a colliding failed PRD path or mask rollback failures.
- Queue rollback safety remains the first priority.
- Sidecar finalization should run only after a safe rollback state exists.
- Direct and scheduler-owned resume paths can diverge if the fix is added to only one path.
- Coverage is required for both resume paths or a shared helper used by both.
- Running the recovery analyst from the queue parent finalizer can add latency and depends on monitor DB flush timing.
- Recovery analyst latency risk is acceptable because normal queued failure finalization already uses the same pattern after child exit.
- Ineligible resumes may not have useful resumed-run evidence.
- The implementation should distinguish pre-build ineligibility from post-activation resumed-run failure or write an explicit degraded manual sidecar rather than preserving stale evidence silently.
- The sidecar write path should not regress successful resume cleanup, which currently removes root/failed PRD files, sidecars, locks, and unblocks descendants only after a usable artifact is recorded.
- Documentation and tests must be updated together so future maintainers do not reintroduce unconditional sidecar preservation as an intentional invariant.

Assumptions and validation:

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| The stale sidecar defect exists in current `main`. | Backlog observation names a concrete resumed session. Code inspection confirmed both compiled-resume rollback paths call `rollbackQueuedResume()` without sidecar regeneration, and `rollbackQueuedResume()` does not touch sidecars. | high | low | Add a failing unit/integration test that seeds an old sidecar, triggers a post-activation resumed failure, and reads the sidecar after rollback. | If wrong, the fix may duplicate existing behavior or update only tests/docs. |
| Normal queued failure finalization is the correct pattern to reuse. | `spawnPrdChild().finalize()` already builds a failure summary, runs the recovery analyst with timeout, and calls `moveFailedWithSidecar()` for normal queued PRD failures. | high | low | Reuse or extract this logic and run existing queue failure/recovery tests. | If wrong, compiled-resume finalization may drift from normal recovery semantics. |
| `buildFailureSummary()` can synthesize resumed-run evidence. | `packages/engine/src/recovery/event-history.ts` selects failed runs where `command IN ('build', 'resume')`, and `buildFailureSummary()` accepts `featureBranch` and `baseBranch` overrides. | high | low | Add a test with failed `resume` monitor events and assert the sidecar summary names the resumed failed plan. | If wrong, regenerated sidecars could still point at stale or partial evidence. |
| `rollbackQueuedResume()` should remain a pure queue transition helper. | The module is scoped to queue transitions and currently avoids agent/recovery side effects; normal sidecar generation lives in engine finalization code. | medium | low | During implementation, compare helper extraction options and keep recovery-agent imports out of `queue/resume-cascade.ts` unless coupling becomes unavoidable. | If wrong, implementation may be more complex than necessary or duplicate rollback state checks. |
| Ineligible pre-build resumes should not be treated the same as post-activation resumed-run failures. | Existing test coverage asserts old sidecars remain after an ineligible resume rollback, and pre-build ineligibility may lack new failure evidence. | medium | low | Preserve or adjust the existing ineligible test to assert either old-sidecar preservation or a degraded manual sidecar with explicit invalidation, based on the final chosen behavior. | If wrong, the fix might erase useful prior recovery evidence without replacing it with actionable resumed-run evidence. |
| Parent finalization can safely read monitor DB evidence after a compiled-resume child exits. | Normal queued failure finalization already runs inline recovery from the parent after child exit and reads monitor DB/git evidence. | high | medium | Add a scheduler-owned compiled-resume test if practical; otherwise add a focused helper-level test and keep the normal failure tests passing. | If wrong, scheduler-owned sidecars may be partial or miss the latest child events. |

No low-confidence, high-impact assumptions remain. The only medium-confidence points are implementation-boundary choices and ineligible-resume semantics, both have low-cost validation paths and are captured in acceptance criteria/tests.

Recommended profile: **Excursion**.

Rationale: this bugfix spans several engine/recovery paths and needs careful tests, but one cohesive plan can enumerate the code changes, sidecar semantics, and validation strategy. It does not need delegated module planning or cross-module architecture design, so Expedition would add overhead without improving plan quality.

## Scope

In scope:

- Failed compiled-resume rollback behavior after resume activation.
- Scheduler-owned compiled-resume queue dispatch through `buildSinglePrd()` and `spawnPrdChild().finalize()`.
- Direct `resumeBuild(prdId)` rollback behavior when a queued resume starts and then fails before successful finalization.
- Recovery sidecar refresh, removal, or explicit stale-evidence marking for failed resumed builds.
- Distinguishing ineligible pre-build rollback from post-activation resumed-run failure.
- Preserving successful compiled-resume cleanup semantics.
- Preserving waiting-descendant rollback to `skipped/`.
- Preserving queue rollback collision protections.
- Updating `packages/engine/src/eforge.ts`.
- Keeping `packages/engine/src/queue/resume-cascade.ts` focused on queue-file transitions unless implementation evidence shows otherwise.
- Reusing existing recovery summary and event-history capabilities.
- Updating `test/resume-compiled-build-engine.test.ts`.
- Adding scheduler-owned queue path coverage or focused helper-level coverage.
- Updating `docs/architecture.md`.

Out of scope:

- Moving workflow UX into the engine kernel.
- Adding scheduling, triggers, approvals, notifications, or richer workflow orchestration to the engine.
- Adding a parallel failure summary mechanism when `buildFailureSummary()` and `synthesizeFromEvents()` can be reused.
- Changing `packages/engine/src/recovery/failure-summary.ts` or `packages/engine/src/recovery/event-history.ts` behavior unless implementation evidence shows it is required.
- Adding recovery-agent side effects to `packages/engine/src/queue/resume-cascade.ts` unless implementation evidence shows a cleaner boundary.

## Acceptance Criteria

- After a compiled-resume build fails after resume activation, `.eforge/queue/failed/<prdId>.recovery.json` contains a `summary.setName` matching the resumed plan set.
- After a compiled-resume build fails after resume activation, `.eforge/queue/failed/<prdId>.recovery.json` contains a `summary.failingPlan.planId` derived from the resumed failed run rather than the pre-resume sidecar.
- After a compiled-resume build fails after resume activation, `.eforge/queue/failed/<prdId>.recovery.md` is rewritten so the human-readable report corresponds to the same resumed-run failure as the JSON sidecar.
- A scheduler-owned compiled-resume queue-path test verifies that failed-resume sidecar finalization runs after `rollbackQueuedResume()` restores the root PRD to `.eforge/queue/failed/<prdId>.md`.
- A scheduler-owned compiled-resume queue-path test verifies that parent finalization does not return before failed-resume sidecar finalization completes.
- When a non-scheduler-owned queued resume has started and exits without successful finalization, the direct `resumeBuild(prdId)` path refreshes failed queue sidecars for the resumed run or explicitly invalidates stale sidecars.
- A compiled-resume rollback that becomes ineligible before resumed-run evidence exists preserves previous sidecars or writes an explicit degraded manual sidecar with invalidation.
- A compiled-resume rollback that becomes ineligible before resumed-run evidence exists does not replace the previous sidecar with unrelated resumed-run evidence.
- Successful compiled-resume finalization removes the queue root PRD after a usable artifact is recorded.
- Successful compiled-resume finalization removes the failed PRD after a usable artifact is recorded.
- Successful compiled-resume finalization removes recovery sidecars after a usable artifact is recorded.
- Successful compiled-resume finalization removes the PRD lock after a usable artifact is recorded.
- Waiting descendants reactivated during compiled resume are moved back to `skipped/` when the resumed build fails.
- Existing queue rollback collision protections prevent overwriting colliding queue files.
- Existing queue rollback collision protections prevent overwriting colliding failed files.
- `docs/architecture.md` describes refreshed or invalidated sidecars for failed compiled-resume runs instead of unconditional sidecar preservation.
- `pnpm test -- resume-compiled-build-engine queue-recovery-cascade` exits 0.
- `pnpm type-check` exits 0.