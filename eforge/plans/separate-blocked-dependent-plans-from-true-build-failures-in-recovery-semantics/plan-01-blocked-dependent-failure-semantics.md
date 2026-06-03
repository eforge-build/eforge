---
id: plan-01-blocked-dependent-failure-semantics
name: Blocked Dependent Failure Semantics
branch: separate-blocked-dependent-plans-from-true-build-failures-in-recovery-semantics/plan-01-blocked-dependent-failure-semantics
agents:
  builder:
    effort: high
    rationale: The implementation is small, but the event-flow change crosses
      orchestration, terminal failure tracking, and recovery-summary tests; high
      effort helps preserve existing true failure semantics while removing only
      dependency-blocked false failures.
---

# Blocked Dependent Failure Semantics

## Architecture Context

The engine emits typed `EforgeEvent`s and consumers reconstruct run state from lifecycle events. `plan:status:change` already carries the distinct `blocked` lifecycle state, while `plan:build:failed` is consumed as true terminal evidence by the build terminal-failure tracker, phase summary handling in `EforgeEngine.build`, and recovery summary synthesis. Dependency blocking must remain visible through lifecycle/error events without masquerading as a plan runner failure.

No event schema, route contract, daemon API version, or UI visual status change is planned. Keep state mutation through existing helpers such as `transitionPlan(...)`/`mutateState(...)`; do not add direct state writes outside existing state-owned code paths.

## Implementation

### Overview

Remove the false `plan:build:failed` emission from dependency-blocked descendants in `propagateFailure`, then update orchestration and recovery regressions to prove that blocked descendants remain visible while terminal failure evidence stays on the upstream plan that actually emitted a build failure.

### Key Decisions

1. Preserve `transitionPlan(state, dep, 'blocked', { error })` for each eligible transitive dependent. This keeps `plan:status:change(blocked)` and `plan:error:set` in the stream.
2. Do not emit `plan:build:failed` for dependency-blocked descendants. True plan failures still originate from plan runners, merge failures, policy blocks, validation-provider failures, and other existing failure sites.
3. Prefer source-level semantic repair over string filtering in terminal failure or recovery code. With the misleading events removed, existing terminal tracker and `EforgeEngine.build` summary updates retain the upstream failure.
4. Add recovery coverage using the post-fix event shape: one upstream `plan:build:failed`, blocked descendant lifecycle/error rows, authoritative `build:terminal-failure` pointing at the upstream plan, and failed `phase:end` naming the upstream plan.
5. If authoritative recovery summaries omit blocked descendant error strings because `buildAuthoritativeFragment` only seeds the terminal plan error, add a bounded enhancement that merges `plan:error:set`/`plan:error:clear` evidence into `summary.plans` while leaving `failingPlans` derived only from true terminal plan evidence.

## Scope

### In Scope

- Remove dependency-blocked descendant `plan:build:failed` emissions from `packages/engine/src/orchestrator/phases.ts`.
- Keep blocked descendant `plan:status:change` events and `plan:error:set` events with `Blocked by failed dependency: <failedPlanId>`.
- Update orchestration tests that assert the old three-events-per-blocked-plan behavior.
- Add or update a three-plan dependency-chain regression that exercises `executePlans` plus terminal failure tracking and asserts one true failed plan event, blocked descendant lifecycle state, terminal failure `planId`, and phase summary text.
- Add recovery-summary coverage for an upstream failed plan with blocked descendants.
- Update recovery authoritative-summary helpers if blocked descendant `plan:error:set` rows need to be carried into `summary.plans` without adding those descendants to `failingPlans`.
- Rediscover test locations with `rg` before editing, because the source notes that test files may have moved.

### Out of Scope

- New event types, new event fields, event schema changes, route changes, or `DAEMON_API_VERSION` changes.
- UI visual-stage semantics for `blocked`; existing monitor/console mapping from blocked lifecycle status to failed visual stage can remain unless tests expose an intentional requirement change.
- Treating dependency-blocked descendants that never ran as true plan build failures.
- Downgrading completed or merged dependents during failure propagation.

## Files

### Create

- None expected.

### Modify

- `packages/engine/src/orchestrator/phases.ts` — change `propagateFailure` so it only pushes lifecycle/error events returned by `transitionPlan(...)` for blocked dependents; remove the subsequent `plan:build:failed` object; update the function comment and nearby inline comment to describe blocked lifecycle events rather than build-failed events.
- `test/orchestration-state-helpers.test.ts` — update direct `propagateFailure` tests from three events per blocked plan to two events per blocked plan; add negative assertions that blocked dependents have no `plan:build:failed` events; keep completed/merged dependent expectations at zero events.
- `test/orchestration-execute-plans.test.ts` — update execution tests that currently expect dependent `plan:build:failed` emissions. Add a three-plan chain regression if this is the best current location: `plan-a -> plan-b -> plan-c`, runner yields one real `plan:build:failed` for `plan-a`, filtered failed events contain only `plan-a`, `plan-b`/`plan-c` receive blocked status and error-set events, and terminal/phase summary derived from the event stream names `plan-a`.
- `test/recovery-terminal-failure.test.ts` or `test/recovery-failure-summary.test.ts` — seed a failed monitor DB run with upstream `plan:build:failed`, blocked descendant `plan:status:change` and `plan:error:set`, authoritative `build:terminal-failure` for the upstream plan, and `phase:end` summary for the upstream plan. Assert `failingPlan.planId === 'plan-a'`, `failingPlans` contains only `plan-a`, and `plans` contains `plan-b`/`plan-c` with `status === 'blocked'`.
- `packages/engine/src/recovery/terminal-failure-history.ts` — only if needed for the recovery regression, add a helper or optional argument that merges lifecycle error evidence into authoritative `summary.plans`; do not let blocked lifecycle errors populate `failingPlans`.
- `packages/engine/src/recovery/event-history.ts` — only if the previous item is implemented, query `plan:error:set`/`plan:error:clear` rows in the authoritative terminal-failure path and pass the derived error map to the authoritative fragment builder.

### Inspect / Update Only If Tests Expose Drift

- `packages/engine/src/eforge.ts` — confirm the existing `plan:build:failed` summary update now retains the upstream failure after blocked descendant events disappear. Avoid editing unless the regression shows a separate summary bug.
- `packages/monitor/src/__tests__/projections-run-summary.test.ts` and `packages/monitor/src/projections/run-summary.ts` — run targeted tests if monitor expectations fail. Keep blocked lifecycle projection unchanged unless a test demonstrates dependency on the removed false build-failed event.
- `packages/console-ui/src/lib/run-state/handlers/handle-plan-lifecycle.ts` and `packages/monitor-ui/src/lib/reducer/handle-plan-lifecycle.ts` — no planned change; inspect only if first-party UI reducer tests fail.

## Implementation Notes

- Use a shared local `blockedError` string in `propagateFailure` to avoid diverging status/error text.
- Preserve BFS traversal through the dependency graph so transitive dependents are still considered even when an intermediate dependent is completed or merged; only the lifecycle transition for completed/merged plans is skipped.
- Existing true failure sites in `phases.ts` must continue emitting `plan:build:failed` for the plan that ran or attempted to merge.
- When adding recovery tests, use current helpers such as `openDatabase`, `buildFailureSummary`/`synthesizeFromEvents`, and `useTempDir` from nearby tests.
- For oversized files, use bounded exact edits. Do not rewrite whole test files or `eforge.ts`.

## Verification

- [ ] Direct `propagateFailure` tests expect exactly 2 events for one blocked dependent, 4 events for a two-plan blocked chain, and 6 events for three blocked dependents in diamond/multi-dependent cases.
- [ ] Direct `propagateFailure` tests assert zero `plan:build:failed` events for blocked descendants.
- [ ] Execution regression for `plan-a -> plan-b -> plan-c` filters `plan:build:failed` events to exactly one event with `planId === 'plan-a'`.
- [ ] The same execution regression observes `plan:status:change` with `status === 'blocked'` for `plan-b` and `plan-c`.
- [ ] The same execution regression observes `plan:error:set` for `plan-b` and `plan-c` with `Blocked by failed dependency: plan-a`.
- [ ] The same execution regression produces `build:terminal-failure.failure.planId === 'plan-a'`.
- [ ] The same execution regression produces a failed phase summary equal to or containing `Build failed for plan-a` and not containing `plan-c`.
- [ ] Recovery summary test returns `failingPlan.planId === 'plan-a'`.
- [ ] Recovery summary test returns `failingPlans.map(p => p.planId)` equal to `['plan-a']`.
- [ ] Recovery summary test includes `plans` entries for `plan-b` and `plan-c` with `status === 'blocked'`.
- [ ] Existing tests for completed and merged dependents verify those dependents remain completed/merged after propagation.
- [ ] `pnpm exec vitest run test/orchestration-state-helpers.test.ts test/orchestration-execute-plans.test.ts test/recovery-terminal-failure.test.ts test/recovery-failure-summary.test.ts` exits 0.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm maintainability:check` exits 0.
