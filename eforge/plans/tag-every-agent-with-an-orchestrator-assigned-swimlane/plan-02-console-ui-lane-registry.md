---
id: plan-02-console-ui-lane-registry
name: "console-ui: single lane registry and phase-lane consumers"
branch: tag-every-agent-with-an-orchestrator-assigned-swimlane/plan-02-console-ui-lane-registry
agents:
  builder:
    effort: high
    rationale: Introduces a new lane-registry module as the single source of truth
      and re-points three consumers (plan-progress selectors, thread-pipeline
      ordering/PRD-pill, pipeline-colors) plus a coupled re-scope of
      selectPlanningLane. The planning-row data-source change and the
      global/Compile-row PRD-pill move are the subtle parts; missing one blanks
      a row or duplicates the Planning lane.
---

# console-ui: single lane registry and phase-lane consumers

## Architecture Context

The console-ui (the active monitoring dashboard) groups agent threads into swimlanes by the agent-event `planId`. Lane identity is currently scattered: `LIFECYCLE_LANE_NAMES` (`plan-progress.ts:192`) maps only `gap-close`; `abbreviatePlanId` (`pipeline-colors.ts:63`) special-cases `gap-close` + `plan-NN`; extras are sorted alphabetically (`plan-progress.ts:251`), which is an active ordering bug (`final-check`/`final-validation` would sort before `gap-close`). Plan-less threads fall into `__global__` (`thread-pipeline.tsx:84`) and `selectPlanningLane` (`plan-progress.ts:262-265`) currently sources the Now card's PRD-planning row from `!t.planId`.

With plan-01 landed, planning agents carry `planId: 'planning'`, validation agents `'validation'`/`'final-validation'`. This plan introduces a single ordered lane registry as the source of truth for lane label + order, and re-points the consumers so phase lanes render below the plans (consistent with the existing Gap Close lane) instead of re-lighting PRD.

**Lane model:** ordered lanes `planning` (order 0) -> `plan-NN` (order 1, kind `plan`, sub-sorted by plan order) -> `validation` (2) -> `gap-close` (3) -> `final-validation` (4). Lanes are activity-gated: a phase lane renders only when it has agent threads (no synthetic `planStatuses` entries). Display labels: `planning`->"Planning", `validation`->"Validation", `gap-close`->"Gap Close", `final-validation`->"Final Validation".

## Implementation

### Overview

Add `lib/run-state/lane-registry.ts` exporting an ordered registry of `{ id, label, order, kind }` plus `laneLabel(id)` and `laneOrder(id)` helpers with a `plan-NN` fallback (label "Plan NN", order 1). Replace `LIFECYCLE_LANE_NAMES` and the `abbreviatePlanId` special-cases with registry calls. Order `selectPlanLanes` extras and `thread-pipeline` `orderedPlanIds` via `laneOrder` instead of alphabetically, and include thread-only lane keys (currently dropped). Re-scope `selectPlanningLane` from `!t.planId` to `t.planId === 'planning'`, and exclude `planning` from `selectPlanLanes` extras so it is not duplicated. Move the PRD source pill off the nameless global/Compile row onto the planning lane.

### Key Decisions

1. **Single lane registry as source of truth.** One ordered `{id,label,order,kind}` table replaces `LIFECYCLE_LANE_NAMES`, the `abbreviatePlanId` special-cases, and alphabetical extras sorting — fixing the ordering bug by construction and preventing drift. Inline-document on the module that agent-event `planId` IS the lane key (planning/validation/gap-close/final-validation are phase lanes, not plans).
2. **Activity-gated phase lanes.** Phase lanes appear only when they have threads; do NOT synthesize `planStatuses` entries. Consequence: `thread-pipeline.orderedPlanIds` must include thread-only keys (`threadsByPlan.keys()` excluding `__global__`).
3. **Planning keeps a dedicated row; data source is re-scoped, not removed.** `selectPlanningLane` re-scopes to `t.planId === 'planning'` (keeps the Now card's PRD-badged planning row populated with planning agents only); `planning` is excluded from `selectPlanLanes` extras to avoid a duplicate lane. `hasPlanningRow` (`lib/selectors/now.ts:709`) is derived from `earlyOrchestration`/`planning:` events — independent of `selectPlanningLane` content — so the row does not blank (verified). Keep the existing yellow PRD badge on the planning row (the PRD source artifact lives in this phase).
4. **PRD pill moves to the planning lane.** After the change the `__global__` bucket is empty in normal runs; move the PRD pill from the global/Compile row onto the planning lane (or a planning header). Keep the resume-case `Source` row (`thread-pipeline.tsx:241-257`) intact for runs with no global threads.
5. **Stepper untouched.** `active-build-card.tsx` lifecycle stepper is a separate event-derived indicator and not the source of confusion.

## Scope

### In Scope
- New `lane-registry.ts` with ordered registry + `laneLabel`/`laneOrder` (plan-NN fallback).
- `plan-progress.ts`: replace `LIFECYCLE_LANE_NAMES` with `laneLabel`; order `selectPlanLanes` extras via `laneOrder`; exclude `planning` from extras; re-scope `selectPlanningLane` to `t.planId === 'planning'`.
- `pipeline-colors.ts`: `abbreviatePlanId` delegates to `laneLabel`; add color entries for `planning`/`validation`/`final-validation` consistent with the existing `gap-close` styling.
- `thread-pipeline.tsx`: `orderedPlanIds` includes `threadsByPlan` keys (excluding `__global__`) and orders by `laneOrder`; move the PRD pill onto the planning lane / header; preserve the resume `Source` path.
- Tests for registry labels/order, selector ordering and gating, planning re-scope, thread-pipeline thread-only keys, and PRD-pill host.
- README/inline doc updates for the lane model.

### Out of Scope
- Engine lane assignment (plan-01).
- The Now dashboard lifecycle stepper.
- `packages/monitor-ui/` (legacy) — leave unchanged; note the intentional divergence.

## Files

### Create
- `packages/console-ui/src/lib/run-state/lane-registry.ts` — ordered `LANE_REGISTRY` of `{ id, label, order, kind: 'phase' | 'plan' }` for `planning`(0), plan(1,`plan`), `validation`(2), `gap-close`(3), `final-validation`(4); `laneLabel(id)` and `laneOrder(id)` with `plan-NN` fallback ("Plan NN", order 1, sub-sorted by existing plan order). Inline doc that agent-event `planId` is the lane key.

### Modify
- `packages/console-ui/src/lib/run-state/selectors/plan-progress.ts` — delete `LIFECYCLE_LANE_NAMES`; `selectPlanLanes` labels extras via `laneLabel` and orders them via `laneOrder` (not `.sort()`), excluding `'planning'` from extras; re-scope `selectPlanningLane` filter from `!t.planId` to `t.planId === 'planning'`.
- `packages/console-ui/src/components/pipeline/pipeline-colors.ts` — `abbreviatePlanId` delegates to `laneLabel`; add `AGENT_COLORS`/lane color entries for `planning`/`validation`/`final-validation` near the existing `gap-closer` entry (`:28`).
- `packages/console-ui/src/components/pipeline/thread-pipeline.tsx` — `orderedPlanIds` (`:107-121`) also adds `threadsByPlan.keys()` excluding `__global__`, then sorts the full set by `laneOrder`; move the PRD pill (`:222-240`) onto the planning lane / dedicated header so it is not hosted by the nameless global row; keep the resume `Source` row (`:241-257`).
- `packages/console-ui/src/lib/run-state/index.ts` — export `laneLabel`/`laneOrder`/registry if consumed across modules.
- `packages/console-ui/src/components/pipeline/plan-row.tsx` — verify phase lanes (no build-stage sequence) render cleanly via `abbreviatePlanId`/`prdPillClass`; adjust only if needed for the planning-lane pill host.
- `packages/console-ui/README.md` — if it documents the pipeline/swimlane data flow, add the lane model (lane = orchestrator phase) and the lane registry as the source of truth for labels/order.

### Tests (add to existing dirs)
- `packages/console-ui/src/lib/run-state/__tests__/` — registry label/order tests and `selectPlanLanes`/`selectPlanningLane` tests.
- `packages/console-ui/src/components/pipeline/__tests__/` — thread-pipeline ordered-lane-keys and PRD-pill-host tests.

## Verification

- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm build` completes without errors.
- [ ] `pnpm test` exits 0.
- [ ] `pnpm maintainability:check` exits 0.
- [ ] `grep` for `LIFECYCLE_LANE_NAMES` in `packages/console-ui/src` returns zero matches.
- [ ] A test asserts `laneLabel('planning')` === "Planning", `laneLabel('validation')` === "Validation", `laneLabel('gap-close')` === "Gap Close", and `laneLabel('final-validation')` === "Final Validation" via the single lane registry.
- [ ] A test asserts `selectPlanLanes` returns lanes ordered plans, then validation, then gap-close, then final-validation, when threads for all those lane kinds are present.
- [ ] A test asserts `selectPlanLanes` omits the gap-close and final-validation lanes when no threads carry those lane ids.
- [ ] A test asserts `selectPlanLanes` does NOT emit a `planning` lane, and DOES emit `validation`, `gap-close`, and `final-validation` lanes when their threads exist.
- [ ] A test asserts the run-detail pipeline's ordered lane ids include a `validation` lane key when only validation threads (no `planStatuses` entry) exist for it.
- [ ] A test asserts no planning or validation thread is grouped under the `__global__`/PRD bucket once lane ids are assigned.
- [ ] A test asserts `selectPlanningLane` includes the planning agents (planId `'planning'`) and excludes validation-fixer/prd-validator threads (planId `'validation'`/`'final-validation'`).
- [ ] A test asserts the PRD source pill renders on the planning lane (or a planning header) and that the global/Compile row is not the pill host when planning threads exist.
- [ ] Post-build manual verification (gated AC, not a pipeline gate): run the console-ui dashboard against a recorded/live multi-plan build with gap-close; confirm the Now card shows the planning row populated with planning agents only, validation rendered as its own lane below the plans, no duplicate Planning row, and the PRD lane not re-lighting during validation.