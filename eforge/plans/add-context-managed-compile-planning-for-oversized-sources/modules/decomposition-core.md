# Decomposition Core

## Architecture Reference

This module implements the **decomposition-model-scheduler** row from **Implementation Module Boundaries**, plus the engine-owned portions of **Shared Data Model**, **Decomposition Derivation**, **Scheduling**, and **Recursive Decomposition**.

Key constraints from architecture:
- The module is pure engine logic: no agent invocation, no compile-stage branching, no filesystem artifact writing, no event emission, no Console/CLI rendering, and no recovery wording.
- Client-owned contracts from `contracts-config` are consumed for `PlanningDecompositionLimits`, budget/pressure/failure evidence shapes, and scheduling event-compatible payload types. This module must not redeclare client wire event variants.
- Graph derivation, unit IDs, coverage assignment, dependency edges, recursive child IDs, and scheduler batches must be deterministic for the same source hash, source content, preflight risk, pipeline composition, and limits.
- Every extracted acceptance criterion must appear in one or more active unit coverage lists or in `coverage.unresolvedCriteria` with bounded evidence.
- The scheduler must treat planner context as a resource slot: running units plus selected units must never exceed the resolved planning-unit parallelism.
- Units with unmet dependencies, failed dependencies, skipped dependencies, overlapping unresolved interface constraints, or overlapping unresolved shared-file constraints must not be selected in the same batch.
- Recursive splitting must stop at configured depth and split-attempt limits, and must return `DecompositionPlanningError` with `kind: 'decomposition-exhausted'`, `stage: 'planning-decomposition'`, and bounded unit evidence when no smaller child graph can be produced.
- New implementation files must stay under 600 lines; files over 300 lines must include durable semantic region markers.

## Scope

### In Scope
- Add a pure planning-decomposition model facade under `packages/engine/src/compile-resilience/planning-decomposition.ts`.
- Define engine-internal graph/unit/source-slice/output interfaces that extend or consume client-owned budget, limit, schedule, pressure, and failure evidence types.
- Derive bounded planning-unit graphs from markdown source structure, acceptance criteria, preflight subsystem breadth, selected pipeline scope, and deterministic text evidence.
- Assign acceptance-criteria coverage, subsystem hints, source slices, dependencies, interface constraints, shared-file constraints, and per-unit budgets.
- Add deterministic foundation/interface unit detection for cross-cutting route, event schema, config, client contract, shared data model, and shared-file evidence.
- Add stable chunking by criteria count, subsystem count, source headings, and source byte caps.
- Add graph validation helpers for duplicate IDs, missing dependencies, cycles, invalid source slices, coverage gaps, and budget violations.
- Add safe scheduling helpers that produce `PlanningScheduleDecision` values with selected batches, ready/running sets, waiting reasons, blocked pairs, and capacity reasons.
- Add budget pressure helpers that compare observed or estimated unit pressure against unit budgets and return triggered limit keys.
- Add recursive split helpers that update the graph immutably, retain parent/child relationships, rewrite downstream dependencies, and preserve coverage evidence.
- Add unit tests for graph derivation, coverage, dependency stability, budget derivation, scheduler constraints, and recursive split exhaustion.

### Out of Scope
- Config schema/default implementation for `compile.planningUnit*` keys; `contracts-config` owns this.
- Compile strategy selection between direct planning and context-managed decomposition.
- Calling `runPlanner()`, `runModulePlanner()`, planner inspection, compact continuation, or any harness.
- Emitting `planning:decomposition:*` events or mapping graph data into event payloads at runtime.
- Persisting `.decomposition/*` artifacts.
- Synthesizing `architecture.md`, module definitions, plan files, `orchestration.yaml`, or downstream compile context fields.
- Recovery sidecar classification, recovery text, CLI output, or Console timeline rendering.
- Product-level requirement dropping, successor PRD authoring, or queue enqueue behavior.

## Implementation Approach

### Overview

Implement a small public facade plus focused pure helper files. The facade exports the engine-internal model and the functions downstream modules call. Helper files keep parsing, graph construction, scheduling, and recursive splitting separate so each implementation file remains below the project line ceiling.

The initial graph derivation flow is:

1. Parse the markdown source into line records, heading ranges, heading paths, and source byte offsets.
2. Extract acceptance criteria with existing `extractExpectedAcceptanceCriteria()` and locate each criterion back to a markdown line/range by normalized raw text and source order.
3. Build requirement records with criterion ID/text, heading path, source slice candidate, subsystem hints, interface constraint keys, shared-file constraint keys, and bounded evidence strings.
4. Detect a foundation/interface unit when cross-cutting contract evidence appears across multiple subsystems or multiple units would share unresolved interface/shared-file keys.
5. Cluster non-foundation criteria by primary subsystem, then chunk each cluster by `maxCriteriaPerUnit`, `maxSubsystemsPerUnit`, and prompt source byte estimates.
6. Build `PlanningDecompositionUnit` records with stable `unit-*` IDs, bounded `PlanningSourceSlice` entries, per-unit budgets, dependency IDs, constraints, and `queued` status.
7. Build dependency edges from each `dependsOn` relationship, compute coverage from active units, validate acyclicity, and return a `PlanningDecompositionGraph` with `parallelism: limits.parallelism`.

The scheduler remains side-effect free. It accepts a graph plus completed/running/failed/skipped unit ID sets, computes dependency-ready units in topological order, filters candidates against running and selected units for overlapping unresolved constraints, applies the remaining capacity, and returns one `PlanningScheduleDecision`.

Recursive splitting accepts a graph, one over-budget unit, observed budget pressure, and limits. It attempts deterministic splits in this order: criteria chunks, subsystem chunks, heading/source-slice chunks, then byte-range chunks. A split succeeds only when it creates at least two children and every child has lower estimated pressure than the parent for at least one triggered limit. On success, the parent is retained as `skipped`, children are inserted as `queued`, downstream dependencies on the parent are rewritten to depend on all child IDs, coverage is recomputed, and the split attempt is recorded. On failure, the helper returns a `DecompositionPlanningError` instead of throwing.

### Key Decisions

1. **Public facade plus helper modules.** Use `planning-decomposition.ts` as the stable import path for later modules, with implementation delegated to `planning-decomposition/source-analysis.ts`, `graph-builders.ts`, `scheduler.ts`, and `splitting.ts` when needed for line-count limits.
2. **Criteria IDs stay positional.** Reuse `extractExpectedAcceptanceCriteria()` so decomposition coverage IDs match the rest of the engine (`ac-001`, `ac-002`, ...). A local locator adds line and heading evidence without changing validation module ownership.
3. **Constraint keys are normalized without reason prefixes.** Store interface keys such as `event-schemas`, `config-contract`, `route-contracts`, `client-api`, and `data-model`; store shared-file keys as normalized repository paths. Scheduler waiting reasons add `interface-contract:` or `shared-file:` prefixes.
4. **Foundation units serialize ambiguity, not all broad work.** Create a foundation/interface unit only when cross-cutting contract or shared-file evidence would make independent vertical planning unsafe. Broad sources with independent subsystem clusters can still produce parallel-ready vertical units.
5. **Coverage is computed from active leaf units.** Parent units that were recursively split are retained for lineage but omitted from `coverageByUnit` once they are marked `skipped`; their children carry the assigned criteria.
6. **Graph updates are immutable.** Split helpers return a new graph object and child IDs. The compile controller can persist both parent and child states without hidden mutations.
7. **Scheduler inputs override unit status.** `completedUnitIds`, `failedUnitIds`, `runningUnitIds`, and `skippedUnitIds` are the source of truth during scheduling so a controller can replay state from events or artifacts without mutating the graph object.
8. **Decomposition exhaustion is typed data.** Recursive split failure returns a `DecompositionPlanningError` with client-owned `DecompositionFailureEvidence`; it is never represented as a provider context-window error in this module.

## Files

### Create
- `packages/engine/src/compile-resilience/planning-decomposition.ts` — public facade for decomposition graph types and helpers. Export `PlanningDecompositionGraph`, `PlanningDecompositionUnit`, `PlanningSourceSlice`, `PlanningCriterionCoverage`, `PlanningCoverageSummary`, `PlanningUnitOutput`, `DecompositionPlanningError`, `derivePlanningDecompositionGraph()`, `selectReadyPlanningBatch()`, `splitOverBudgetPlanningUnit()`, `evaluatePlanningUnitBudgetPressure()`, `summarizePlanningCoverage()`, and `validatePlanningDecompositionGraph()`.
- `packages/engine/src/compile-resilience/planning-decomposition/source-analysis.ts` — internal markdown line/heading parsing, criteria line location, subsystem inference, interface/shared-file constraint extraction, source-slice construction, stable slug helpers, byte-length/hash helpers, and bounded evidence helpers.
- `packages/engine/src/compile-resilience/planning-decomposition/graph-builders.ts` — internal graph derivation orchestration, unit clustering/chunking, foundation/interface unit detection, budget derivation, edge construction, coverage recomputation, topological sorting, and graph validation.
- `packages/engine/src/compile-resilience/planning-decomposition/scheduler.ts` — internal implementation for `selectReadyPlanningBatch()`, including dependency waiting reasons, capacity waiting reasons, running-unit blockers, selected-batch blockers, and blocked-pair records.
- `packages/engine/src/compile-resilience/planning-decomposition/splitting.ts` — internal recursive split implementation, split-attempt recording, downstream dependency rewrites, child budget derivation, progress checks, and decomposition-exhausted error construction.
- `test/planning-decomposition-core.test.ts` — pure unit tests for derivation, coverage, scheduling, budget pressure, recursive splitting, and decomposition exhaustion. Construct sources inline; no fixtures or harness mocks are needed.

### Modify
- None. This module must not edit files in the architecture shared file registry. If implementation discovers a required edit to `compile-stages.ts`, `context-recovery.ts`, `session-planning.ts`, or Console/CLI rendering, move that edit to the owning module or update the shared registry before implementation.

## Detailed Function Contracts

The public facade must expose these contracts using existing project naming conventions:

- `derivePlanningDecompositionGraph(input)`
  - Input: source `{ content, hash, path? }`, `CompilePreflightRisk`, `PipelineComposition`, and `PlanningDecompositionLimits` from `contracts-config`.
  - Output: `PlanningDecompositionGraph` containing `graphId`, `rootUnitId`, sorted `units`, sorted `edges`, recomputed `coverage`, `parallelism`, `limits`, and split-attempt metadata.
  - Required invariants: unique unit IDs, no dependency cycles, every edge endpoint exists, every unit budget derives from limits, every active criterion appears in coverage, and no active unit exceeds `maxCriteriaPerUnit` unless it has an unresolved coverage evidence entry.

- `selectReadyPlanningBatch(input)`
  - Input: graph, completed/failed/running/skipped unit IDs, and requested parallelism.
  - Output: `PlanningScheduleDecision` from client-owned contracts.
  - Required invariants: `selectedBatch.length <= max(0, parallelism - runningUnitIds.length)`, no selected unit depends on an incomplete unit, no selected unit overlaps unresolved constraints with a running unit or another selected unit, and waiting units include structured reason strings.

- `splitOverBudgetPlanningUnit(input)`
  - Input: graph, unit, observed pressure, and limits.
  - Output: either `{ graph, childUnitIds }` or `DecompositionPlanningError`.
  - Required invariants for success: child IDs are stable, children have `parentId` set to the split unit, children have `depth = parent.depth + 1`, parent status is `skipped`, downstream dependencies on the parent are rewritten to all child IDs, and coverage contains the same assigned criterion IDs after recomputation.
  - Required invariants for failure: `kind` equals `decomposition-exhausted`, `stage` equals `planning-decomposition`, `source` equals `decomposition`, and evidence contains unit ID, depth, budgets, observed pressure, assigned criteria, unresolved criteria, blockers, and split attempts.

- `evaluatePlanningUnitBudgetPressure(input)`
  - Input: unit and optional observed counters.
  - Output: `PlanningObservedBudgetPressure` with deterministic `triggeredLimitKeys` for exceeded prompt/source bytes, observed input tokens, observed turns, compact handoff bytes, local exploration tool uses, criteria count, or subsystem count.

- `validatePlanningDecompositionGraph(graph)`
  - Output: `{ ok: true; errors: [] }` or `{ ok: false; errors: string[] }`.
  - Required checks: duplicate unit IDs, missing dependencies, missing edge endpoints, dependency cycles, invalid parent references, negative slice byte counts, invalid line ranges, missing budgets, and criteria coverage gaps.

## Testing Strategy

### Unit Tests
- Graph derivation converts a high-overflow source with more than 20 criteria and six subsystem hints into multiple `unit-*` units, with `graph.parallelism` equal to the supplied limit.
- Graph derivation assigns every extracted criterion ID to `coverage.coverageByUnit` or `coverage.unresolvedCriteria`.
- Graph derivation records at least one source slice with `criteriaIds` and positive `byteLength` for each unit that covers criteria.
- Contract-heavy sources create a `unit-foundation-contracts` unit and dependent vertical units reference it in `dependsOn`.
- Sources with independent subsystem criteria create at least two units that have no shared constraints and no dependency edge between them.
- Unit budgets mirror supplied limits, and `maxRecursiveDepth` equals `limits.maxDepth - unit.depth` with a lower bound of `0`.
- Repeated derivation with identical input returns equal graph IDs, unit IDs, dependency edges, and coverage maps.
- Scheduler selects independent units in deterministic topological order and caps `selectedBatch` at the requested parallelism.
- Scheduler returns `capacity:parallelism-<n>` waiting reasons when ready units exceed remaining slots.
- Scheduler returns `dependency:<unit-id>` waiting reasons for queued units with incomplete upstream dependencies.
- Scheduler returns `dependency-failed:<unit-id>` and no selected downstream unit when an upstream dependency failed.
- Scheduler blocks ready units that overlap an unresolved interface key and records `blockedPairs` with `interface-contract:<key>`.
- Scheduler blocks ready units that overlap a shared-file path and records `blockedPairs` with `shared-file:<path>`.
- Budget pressure helper reports exact triggered keys for source bytes, prompt bytes, observed input tokens, turns, compact handoff bytes, exploration tool uses, criteria count, and subsystem count.
- Recursive splitting of an over-budget unit with five criteria and `maxCriteriaPerUnit: 2` creates three children, marks the parent `skipped`, and preserves all five criterion IDs in active coverage.
- Recursive splitting rewrites an existing downstream dependency on the parent to all child IDs.
- Recursive splitting at `maxDepth` returns `DecompositionPlanningError` with `evidence.unitId`, `evidence.depth`, `evidence.budgets`, `evidence.observedPressure`, and at least one blocker string.
- Recursive splitting of a single-criterion, single-slice unit that cannot reduce any triggered limit returns `DecompositionPlanningError` and does not add child units.
- `validatePlanningDecompositionGraph()` returns `ok: false` for a graph with a missing dependency, duplicate unit ID, cycle, or coverage gap.

### Integration Tests
- No compile-stage, agent, event-registry, Console, CLI, or recovery sidecar integration test belongs to this module.
- Import-level tests may import from `@eforge-build/engine/compile-resilience/planning-decomposition` to verify the public facade path used by later modules.

## Verification

- [ ] `derivePlanningDecompositionGraph()` returns more than one active unit for an inline source with 24 criteria across `engine`, `client`, `console`, `cli`, `input`, and `test` hints.
- [ ] The derived graph for that source has `coverage.totalCriteria` equal to `extractExpectedAcceptanceCriteria(source).length`.
- [ ] The union of active `coverageByUnit` criterion IDs plus unresolved criterion IDs equals every extracted criterion ID for that source.
- [ ] Every derived unit ID starts with `unit-` and remains equal across two identical derivation calls.
- [ ] Every derived edge references existing unit IDs.
- [ ] `validatePlanningDecompositionGraph(derivedGraph).ok` is `true` for the high-overflow test source.
- [ ] A source with event schema, route constant, and config contract criteria produces `unit-foundation-contracts` and at least one dependent unit.
- [ ] `selectReadyPlanningBatch()` with four independent queued units and `parallelism: 2` returns exactly two selected unit IDs.
- [ ] `selectReadyPlanningBatch()` with one running unit and `parallelism: 2` returns at most one selected unit ID.
- [ ] `selectReadyPlanningBatch()` does not select a unit whose dependency is absent from `completedUnitIds`.
- [ ] `selectReadyPlanningBatch()` does not select two units sharing the same interface constraint key.
- [ ] `selectReadyPlanningBatch()` does not select two units sharing the same shared-file constraint key.
- [ ] `evaluatePlanningUnitBudgetPressure()` includes `maxCriteriaPerUnit` when a unit has more covered criteria than its budget.
- [ ] `evaluatePlanningUnitBudgetPressure()` includes `maxObservedInputTokens` when observed input tokens exceed the unit budget.
- [ ] `splitOverBudgetPlanningUnit()` returns child IDs for an over-budget unit with five criteria and a two-criteria unit limit.
- [ ] The split graph preserves the same active criterion ID set that existed before splitting.
- [ ] The split graph marks the parent unit as `skipped` and gives every child `parentId` equal to the parent unit ID.
- [ ] `splitOverBudgetPlanningUnit()` at maximum depth returns `kind: 'decomposition-exhausted'`.
- [ ] Decomposition exhaustion evidence contains no raw source content, prompt text, transcript, or agent output fields.
- [ ] `pnpm test -- planning-decomposition-core` exits 0.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm test` exits 0.
- [ ] `pnpm maintainability:check` exits 0.

<build-config>
{
  "build": ["implement", "test-cycle", "review-cycle"],
  "review": {
    "strategy": "parallel",
    "perspectives": ["code", "test"],
    "maxRounds": 1,
    "evaluatorStrictness": "standard"
  }
}
</build-config>
