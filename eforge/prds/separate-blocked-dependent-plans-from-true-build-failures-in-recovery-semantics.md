---
title: Separate Blocked Dependent Plans from True Build Failures in Recovery Semantics
created: 2026-06-03
depends_on: []
landing: pr
landing_auto_merge: true
---

# Separate Blocked Dependent Plans from True Build Failures in Recovery Semantics

## Problem / Motivation

This plan promotes backlog item `.eforge/backlog/items/backlog-2026-06-03-separate-blocked-dependent-plans-from-true-build-failures-in.md`.

A dependency-chain build can misreport a blocked descendant as the terminal failing plan. When an upstream plan fails, `propagateFailure` marks transitive dependents as `blocked`, but it also emits `plan:build:failed` for those dependents even though no worktree was acquired and the plan runner never executed for them.

Terminal failure tracking and build phase summaries consume every `plan:build:failed` as true plan failure evidence, so the last blocked descendant can replace the upstream root failure in `build:terminal-failure`, `phase:end`, and recovery sidecars.

This affects build operators and recovery workflows because the recovery analyst is steered toward a plan that never ran. In the observed `agent-assisted-acceptance-criteria-canonicalization` build, plan 1 failed with real review/evaluation blockers, but plans 2 and 3 were dependency-blocked and also emitted `plan:build:failed`; recovery then selected plan 3 as the authoritative failing plan and treated plan 1 as ambiguous.

The backlog claim is validated: `packages/engine/src/orchestrator/phases.ts` `propagateFailure` transitions transitive dependents to `blocked` and then emits `plan:build:failed` for each blocked dependent. Existing tests in `test/orchestration-logic.test.ts` explicitly expect three events per blocked dependent: `plan:status:change`, `plan:error:set`, and `plan:build:failed`.

Validated facts:

- `propagateFailure` emits `plan:status:change(blocked)`, `plan:error:set`, and `plan:build:failed` for blocked dependents.
- Terminal failure tracking records every `plan:build:failed` and later same-priority plan failures overwrite earlier ones.
- The failed build's monitor DB contains plan 1 as the true failed plan and plans 2/3 as blocked dependents that also emitted `plan:build:failed`.
- Recovery sidecar ambiguity followed from the terminal failure focusing on plan 3 rather than plan 1.
- Existing tests must be updated because current behavior is intentionally asserted.

Confirmed reproduction from existing persisted telemetry:

1. Inspect `.eforge/monitor.db` for the latest build run whose plan set is `agent-assisted-acceptance-criteria-canonicalization` and command is `build`.
2. Observe event sequence 424494 through 424502: plan 1 emits a real `plan:build:failed`; plans 2 and 3 then emit `plan:status:change` with `status=blocked`, `plan:error:set`, and `plan:build:failed` with `Blocked by failed dependency: plan-01-deterministic-ac-inventory`.
3. Observe event 424504: `build:terminal-failure` records `planId=plan-03-enqueue-build-integration` and `message=Blocked by failed dependency: plan-01-deterministic-ac-inventory`.
4. Observe event 424505: `phase:end` records summary `Build failed for plan-03-enqueue-build-integration`.
5. Compare `.eforge/queue/failed/agent-assisted-acceptance-criteria-canonicalization.recovery.json`: recovery summary reports plan 3 as `failingPlan`, while plan 1 is listed only as a failed plan with passing tests and no root error in the authoritative path.

Confirmed root cause:

- `packages/engine/src/orchestrator/phases.ts` `propagateFailure` conflates dependency blocking with build failure. For every non-completed, non-merged transitive dependent, it calls `transitionPlan(..., 'blocked', { error })` and then emits `plan:build:failed` with the same dependency-blocked message. The code comment says it returns build failed events for each blocked plan, and `test/orchestration-logic.test.ts` currently asserts that behavior.
- `packages/engine/src/terminal-failure.ts` treats all `plan:build:failed` events as plan-scoped terminal evidence. Its `update` helper accepts later evidence when priority is equal, so a later blocked dependent `plan:build:failed` supersedes the earlier real upstream `plan:build:failed`.
- `packages/engine/src/eforge.ts` updates the build phase status and summary on every `plan:build:failed`, so a dependency-blocked descendant can overwrite `Build failed for <upstream>` with `Build failed for <downstream>`.
- `packages/engine/src/recovery/terminal-failure-history.ts` builds authoritative recovery summaries around the single `build:terminal-failure` plan. Once the terminal event points at the blocked descendant, recovery focuses on that blocked descendant and loses the upstream review/evaluation failure as the primary root cause.

Related consumer behavior should be considered but is likely secondary. The client event schema already has a distinct `blocked` plan status. Console run-state currently maps `blocked` to the failed visual stage for UI display, and monitor run summary tests currently project blocked lifecycle status as `failed` for plan summaries. The core build/recovery fix can preserve blocked status emission while changing whether blocked dependents are treated as true build failures.

## Goal

Dependency-blocked dependents should remain visible as blocked plans without being treated as true plan build failures.

Terminal failure tracking, phase summaries, and recovery summaries should identify the upstream plan that actually failed rather than a downstream blocked plan that never ran.

## Approach

Change `propagateFailure` so dependency-blocked dependents continue to receive lifecycle state and error events but do not emit `plan:build:failed`.

Keep `transitionPlan(..., 'blocked', { error })` for dependency-blocked dependents.

Update orchestration tests that currently expect `plan:build:failed` for blocked dependents.

Add regression coverage for a three-plan chain that verifies terminal failure and phase summary preserve the true upstream failed plan.

Add recovery-summary coverage, preferably in `test/recovery-terminal-failure.test.ts` or `test/recovery.test.ts`, that seeds an upstream failure plus blocked dependents and verifies `failingPlan`/`failingPlans` exclude blocked descendants while `plans` still includes their blocked status.

Review monitor/console projection expectations for blocked status. First-party UI reducers already use `plan:status:change` as the status driver, so the build event removal should not require a new wire event. Some run-summary tests may need updates if they relied on `plan:build:failed` for blocked rows rather than lifecycle status.

Minimal unit reproduction to add or update:

1. Construct an orchestration graph `plan-a -> plan-b -> plan-c`.
2. Make `plan-a`'s runner yield one real `plan:build:failed` event.
3. Run `executePlans` or the smallest orchestration surface that exercises `propagateFailure` plus terminal failure tracking.
4. Assert that `plan-b` and `plan-c` receive `plan:status:change` with `status=blocked` and `plan:error:set` with the dependency-blocked error.
5. Assert that only `plan-a` emits `plan:build:failed`.
6. Assert that `build:terminal-failure` and `phase:end` identify `plan-a`, not `plan-c`.

Primary files:

- `packages/engine/src/orchestrator/phases.ts`: remove `plan:build:failed` emission from `propagateFailure` for dependency-blocked descendants; keep `transitionPlan(..., 'blocked', { error })`.
- `test/orchestration-logic.test.ts`: update `propagateFailure` tests to expect two events per blocked dependent (`plan:status:change` and `plan:error:set`) and no `plan:build:failed` for blocked descendants.
- `test/recovery-terminal-failure.test.ts` or `test/recovery.test.ts`: add a regression proving authoritative terminal failure remains the upstream failed plan when descendants are blocked.
- `packages/engine/src/eforge.ts`: review whether no code change is needed after removing descendant `plan:build:failed`. If the event is removed at the source, existing summary handling should retain the upstream plan failure; add a regression to guard this behavior.
- `packages/engine/src/recovery/terminal-failure-history.ts`: review whether authoritative summary behavior is correct once terminal failure points to the upstream plan. A small defensive enhancement may be warranted to populate blocked descendant errors from `plan:error:set` without adding them to `failingPlans`.

Secondary files to check and update if tests show drift:

- `packages/monitor/src/__tests__/projections-run-summary.test.ts`: blocked lifecycle status is currently projected as failed in at least one test; decide whether that UI summary projection should continue to show blocked as failed or expose blocked distinctly.
- `packages/console-ui/src/lib/run-state/handlers/handle-plan-lifecycle.ts` and `packages/monitor-ui/src/lib/reducer/handle-plan-lifecycle.ts`: these map blocked to failed visual stage; likely no implementation change is required unless the build intentionally changes UI semantics.
- `packages/client/src/events.schemas.ts`: no schema change is expected if the fix removes misleading events and keeps existing `PlanStatusSchema` `blocked`. Only update schema/API version if the implementation introduces a new event field or event type.

Note: this plan is expected to run after a currently running large test refactor. Test file paths named here are evidence-backed current locations, but they may become stale before build time. The implementation agent should rediscover the current test locations with search if any referenced test file has moved, been split, or been renamed.

Assumptions and validation:

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| Dependency-blocked dependents should remain visible as blocked plans even if they no longer emit `plan:build:failed`. | `PlanStatusSchema` already includes `blocked`; `propagateFailure` already emits `plan:status:change(blocked)` and `plan:error:set`; console and monitor-ui lifecycle reducers use `plan:status:change` as the status driver. | high | low | Update orchestration tests and run targeted UI/monitor projection tests if changed. | If wrong, consumers that only watch `plan:build:failed` for dependent visibility could lose blocked-plan display. |
| Removing dependency-blocked `plan:build:failed` events is safer than adding a subtype or teaching recovery to special-case the error string. | The false root-cause selection starts at event semantics; existing event schema already has a distinct blocked lifecycle state; no new data shape is needed to represent blocked dependents. | high | low | Implement source-level removal and confirm terminal failure/phase summary/recovery tests pass. | If wrong, compatibility constraints might require a transitional field such as a terminal subtype or explicit blocked event metadata. |
| Once blocked descendant `plan:build:failed` events stop, terminal failure tracking will preserve the upstream real failed plan. | `terminal-failure.ts` only overwrites on observed terminal evidence; the observed overwrite happened because blocked descendants emitted `plan:build:failed`; `eforge.ts` phase summary also updates only on `plan:build:failed`. | high | low | Add a three-plan build regression exercising `createBuildTerminalFailureTracker` through `EforgeEngine.build` or orchestrator execution. | If wrong, a separate summary or terminal tracker change will be required. |
| Recovery authoritative summary will focus on the upstream failed plan after terminal failure points to the upstream failed plan. | `terminal-failure-history.ts` builds `failingPlan` from the authoritative terminal event's plan ID; the bad sidecar focused on plan 3 because the terminal event focused on plan 3. | high | low | Seed monitor DB with upstream failed plan plus blocked descendants and call `buildFailureSummary`. | If wrong, recovery summary code will need direct filtering of blocked descendants in addition to event emission changes. |
| Existing UI projections may intentionally continue showing blocked plans as failed visual stages. | Console and monitor-ui lifecycle handlers currently map `blocked` to `failed`; monitor run summary has a test projecting blocked lifecycle status as failed. This is display behavior, not core failure semantics. | medium | low | Run or update `packages/monitor/src/__tests__/projections-run-summary.test.ts` and relevant console/monitor-ui reducer tests if touched. | If wrong, the implementation may need a broader UI status change or docs update to expose blocked distinctly. |
| No daemon API version bump is required if the fix only removes misleading events and does not change schemas or route wire shapes. | `packages/client/src/events.schemas.ts` already supports `blocked` plan status and no new schema field is planned. Project policy requires API version bumps for breaking HTTP/schema contract changes, not every event-count behavior fix. | medium | low | Check maintainer expectations during implementation; bump `DAEMON_API_VERSION` only if a schema/event contract change is introduced. | If wrong, stale first-party clients could rely on old event-count semantics and require a version gate. |
| Referenced test file paths may be stale by build time because another currently running build is performing a large test refactor. | User explicitly noted the sequencing risk after the plan was marked ready. Current file references were validated before that refactor completed. | high | low | Before editing tests, use `rg` for `propagateFailure`, `build:terminal-failure`, `recovery summary`, and blocked-plan assertions to locate the current test files. | If wrong or ignored, the build agent may edit deleted/renamed tests or miss the new canonical regression-test location. |

All cheap validations requested by the backlog item were performed: the backlog file was read, the failed build's monitor DB was queried, relevant engine/recovery/UI files were inspected, and tests asserting the old behavior were identified. No low-confidence, high-impact assumption remains unresolved before build handoff.

Recommended profile: **Excursion**.

This is a cohesive bug fix that crosses orchestration, terminal failure tracking, recovery-summary tests, and possibly monitor projection expectations. A single planner can enumerate the implementation targets and dependency order without delegated module planning. Errand is too small because the change alters event semantics and requires recovery regression coverage. Expedition is unnecessary because the affected modules share one data-flow problem and do not require independent subsystem planning.

## Scope

In scope:

- Remove misleading `plan:build:failed` emissions for dependency-blocked descendants in `packages/engine/src/orchestrator/phases.ts`.
- Preserve `plan:status:change` with `status=blocked` for dependency-blocked descendants.
- Preserve `plan:error:set` with `Blocked by failed dependency: <failedPlanId>` for dependency-blocked descendants.
- Update orchestration tests that intentionally assert the old blocked-dependent `plan:build:failed` behavior.
- Add a three-plan dependency-chain regression for terminal failure and phase summary behavior.
- Add recovery-summary coverage for an upstream failed plan with blocked descendants.
- Review `packages/engine/src/eforge.ts` summary handling after descendant `plan:build:failed` events are removed.
- Review `packages/engine/src/recovery/terminal-failure-history.ts` authoritative summary behavior after terminal failure points to the upstream plan.
- Check and update monitor/console projection expectations if tests show drift.
- Rediscover current test locations with search if referenced test files have moved, been split, or been renamed.

Out of scope:

- Introducing a new wire event, event field, or schema/API version change unless the implementation introduces a new event shape.
- Changing UI blocked-plan visual semantics unless the build intentionally changes UI semantics.
- Treating dependency-blocked descendants that never ran as true plan build failures.
- Downgrading existing completed or merged dependents when an upstream failure is propagated.

## Acceptance Criteria

- `propagateFailure` emits `plan:status:change` with `status=blocked` for each non-completed, non-merged transitive dependent of a failed plan.
- `propagateFailure` emits `plan:error:set` with `Blocked by failed dependency: <failedPlanId>` for each non-completed, non-merged transitive dependent of a failed plan.
- `propagateFailure` emits zero `plan:build:failed` events for dependency-blocked dependents that never ran.
- A three-plan dependency chain where plan 1 fails produces exactly one `plan:build:failed` event for plan 1.
- A three-plan dependency chain where plan 1 fails leaves plan 2 and plan 3 in `blocked` lifecycle state.
- A three-plan dependency chain where plan 1 fails emits `build:terminal-failure` with `failure.planId` equal to plan 1.
- A three-plan dependency chain where plan 1 fails emits `phase:end` with a summary that names plan 1 rather than a blocked descendant.
- Recovery summary synthesis for an upstream failed plan with blocked descendants sets `failingPlan.planId` to the upstream failed plan.
- Recovery summary synthesis for an upstream failed plan with blocked descendants excludes blocked descendants from `failingPlans`.
- Recovery summary synthesis for an upstream failed plan with blocked descendants preserves blocked descendant entries in `plans` with `status=blocked`.
- Existing true plan build failures still emit `plan:build:failed` with their original error message.
- Existing completed or merged dependents are not downgraded when an upstream failure is propagated.
- `pnpm exec vitest run test/orchestration-logic.test.ts test/recovery-terminal-failure.test.ts` exits 0.
- `pnpm type-check` exits 0.
- `pnpm maintainability:check` exits 0.
