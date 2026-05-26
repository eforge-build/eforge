---
id: plan-01-recovery-summary-reconstruction
name: Recovery Summary Multi-Plan Reconstruction
branch: improve-recovery-sidecar-accuracy-and-robustness/plan-01-recovery-summary-reconstruction
agents:
  builder:
    effort: high
    rationale: Run-level event synthesis needs careful SQLite querying,
      backward-compatible shared wire shape extensions, and sidecar rendering
      changes across engine and client types.
  reviewer:
    effort: high
    rationale: Review must verify compatibility of optional schema fields and
      preservation of terminal failure fallback paths.
  test-writer:
    effort: high
    rationale: Regression tests need real monitor DB fixtures that fail against the
      current latest-failure-only query.
---

# Recovery Summary Multi-Plan Reconstruction

## Architecture Context

Recovery sidecars are written from `BuildFailureSummary`, which is a shared wire shape owned by `packages/client/src/events.schemas.ts`. The engine currently synthesizes a summary from `monitor.db` in `packages/engine/src/recovery/event-history.ts`, but the plan-failure path reads only the latest `plan:build:failed` row and creates a one-row `summary.plans` table. This plan fixes deterministic fact reconstruction while preserving `summary.failingPlan` for legacy consumers.

## Implementation

### Overview

Replace latest-failure-only recovery synthesis with run-scoped reconstruction of plan lifecycle facts. The reconstructed summary must include every plan with a latest `plan:status:change` event, every failed plan from `plan:build:failed`, completed or merged state, merge timestamps and commit SHAs, test counts, error details, and per-failed-plan tool-use counts when available. The Markdown and JSON sidecars then expose these complete deterministic facts even when the verdict is manual or degraded.

### Key Decisions

1. Keep `summary.failingPlan` as the latest failed plan for backward compatibility with apply-recovery and existing sidecar readers; add optional `summary.failingPlans` as the complete failed-plan list.
2. Add optional fields only to shared schemas and route response types so legacy sidecars without the new fields still type-check and parse.
3. Scope all database reads by `run_id` and ordered event IDs; do not scan unrelated runs.
4. Preserve the existing PRD-validation, acceptance-validation, and agent-stop fallback branches for runs without `plan:build:failed` events.

## Scope

### In Scope

- `monitor.db` event-history synthesis for all observed plan statuses in the selected run.
- Error enrichment from `plan:error:set` and `plan:build:failed`.
- Merge enrichment from `plan:merge:complete` with `mergedAt` and optional `commitSha`.
- Test enrichment from `plan:build:test:complete` with optional passed/failed counts.
- Tool-use count enrichment for plan entries and failed-plan entries when `agent:tool_use` rows have a plan ID.
- Shared client schema/type additions for optional multi-failure and plan evidence fields.
- Read-sidecar route type compatibility by reusing shared recovery types rather than maintaining a parallel nested summary shape.
- Markdown and JSON sidecar rendering of every failed plan and every reconstructed plan status.
- Regression tests for multi-plan synthesis and fallback/manual sidecar fact retention.

### Out of Scope

- Deterministic verdict policy and analyst invariant validation; those land in `plan-02-deterministic-recovery-verdicts`.
- Database migrations.
- Changing queue apply semantics for retry, split, abandon, or manual verdicts.
- Replacing `summary.failingPlan` with a required multi-failure field.

## Files

### Create

- None.

### Modify

- `packages/engine/src/recovery/event-history.ts` — reconstruct plan facts from all relevant run-scoped events instead of selecting one latest failure; populate `failingPlans` and enriched plan entries.
- `packages/engine/src/recovery/failure-summary.ts` — preserve `eventFragment.failingPlans` and any new optional plan evidence fields when composing the final summary with git data.
- `packages/engine/src/recovery/sidecar.ts` — add a multi-failure section when `summary.failingPlans` is present; keep the primary failing-plan section; ensure the plans table displays all reconstructed statuses for manual fallback verdicts.
- `packages/client/src/events.schemas.ts` — extend `PlanSummaryEntrySchema`, `FailingPlanEntrySchema`, and `BuildFailureSummarySchema` with optional compatible fields such as `failingPlans`, `commitSha`, `testPassed`, `testFailed`, `completedAt`, and `toolUseCount`.
- `packages/client/src/routes.ts` — type `RecoveryVerdictSidecar.summary` and `.verdict` using shared `BuildFailureSummary` and `RecoveryVerdict` exports, preserving schemaVersion compatibility for legacy sidecars.
- `packages/client/src/__tests__/events-schemas.test.ts` — add schema coverage for recovery summaries containing multiple failed plans and enriched plan entries.
- `test/recovery.test.ts` — add a real monitor DB fixture with five completed or merged plans and two failed plans; assert `buildFailureSummary()` returns all latest plan statuses and both failed plan IDs.
- `test/daemon-recovery.test.ts` — add sidecar assertions that Markdown and JSON retain the deterministic multi-plan summary when the verdict is fallback/manual.

## Verification

- [ ] A monitor DB fixture with two `plan:build:failed` rows produces `summary.failingPlans` containing both failed plan IDs.
- [ ] The same fixture produces `summary.plans` containing every plan with a latest `plan:status:change` row.
- [ ] `summary.failingPlan.planId` remains the latest failed plan ID for legacy consumers.
- [ ] Plan entries include merge timestamps or test counts when matching events exist in the fixture.
- [ ] A fallback/manual sidecar JSON contains the full reconstructed plan list and multi-failure list.
- [ ] A fallback/manual sidecar Markdown contains rows for completed or merged plans and both failed plans.
- [ ] Existing acceptance-validation and PRD-validation recovery tests still pass.
- [ ] `packages/client/src/__tests__/events-schemas.test.ts` accepts a `recovery:summary` event containing the new optional fields.
