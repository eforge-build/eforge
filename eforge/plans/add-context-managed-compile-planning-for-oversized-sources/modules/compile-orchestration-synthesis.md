# Compile Orchestration Synthesis

## Architecture Reference

This module implements the **compile-orchestration-synthesis** row from **Implementation Module Boundaries**, plus the **Strategy Selection**, **Context-Managed Planning Flow**, **Compile Stage Contract**, **Artifact Synthesis**, and engine-owned integration parts of the **Recovery Contract**.

Key constraints from architecture:
- The planner compile stage remains the entry point; normal and elevated compile inputs continue through the existing direct `runPlanner()` flow.
- Strategy selection runs after pipeline composition, retry-as-expedition escalation, and preflight recomputation with the selected pipeline scope.
- Overflow-risk inputs whose recommendation is `bounded-decomposition` run through the context-managed decomposition controller and do not invoke one broad root planner session.
- The controller consumes client-owned decomposition event/failure types, the pure decomposition graph/scheduler helpers, and the bounded unit execution facade; it does not redefine wire shapes or agent prompt formats.
- Planning units are scheduled up to `compile.planningUnitParallelism` from resolved limits, defaulting to `2`, while honoring dependencies, interface constraints, shared-file constraints, and recursive split limits.
- Internal decomposition artifacts are written under the plan set `.decomposition/` directory and never create external PRDs or enqueue follow-up work.
- Successful synthesis emits existing compile artifacts: expedition architecture/index/module definitions or excursion plan files plus `orchestration.yaml`.
- Decomposition exhaustion is surfaced as `failureKind: decomposition-exhausted`, `stage: planning-decomposition`, and `source: decomposition` with bounded unit evidence.
- `packages/engine/src/pipeline/stages/compile-stages.ts` and `packages/engine/src/compile-resilience/context-recovery.ts` are shared files; edits must stay in the regions assigned to this module.

## Scope

### In Scope
- Add a post-composer planning strategy selector for `direct` versus `context-managed-decomposition`.
- Add a context-managed compile planning controller that derives the decomposition graph, emits decomposition start/queue/schedule/synthesis events, executes bounded unit planning batches, handles recursive splits, and persists graph/output evidence.
- Bridge `runBoundedPlanningUnit()` into the compile-stage event stream so bounded unit lifecycle, progress, budget, and compact-handoff events are yielded while units run concurrently.
- Convert completed unit outputs into existing compile artifacts for expedition and excursion scopes.
- Populate `ctx.expeditionModules`, `ctx.plans`, `ctx.moduleBuildConfigs`, and context-managed planning metadata needed by downstream compile stages.
- Limit downstream expedition module-planning wave parallelism for context-managed compiles to the resolved planning-unit parallelism value.
- Map `DecompositionPlanningError` values into compile-scope context failures with client-owned decomposition evidence.
- Add tests covering strategy selection, controller scheduling, recursive split handoff, artifact synthesis, stage branching, no monolithic planner invocation, and decomposition exhaustion classification.

### Out of Scope
- Client TypeBox schemas, event registry metadata, config defaults, and public exports; `contracts-config` owns those.
- Pure graph derivation, scheduler policy, budget pressure calculation, and recursive split algorithms; `decomposition-core` owns those.
- Bounded planner/module-planner prompt construction, capture-only submission tools, compact handoff creation, and unit live context guard implementation; `bounded-agent-execution` owns those.
- Console/CLI rendering and user-facing recovery wording; `recovery-rendering` owns those.
- Product-level requirement dropping, successor PRD authoring, queue mutations, and auto-enqueue behavior.
- Provider context-window limit math changes.

## Implementation Approach

### Overview

Add orchestration as a thin layer around the three dependency modules. The planner stage keeps the existing composer and retry-as-expedition logic, then calls a strategy selector. For `direct`, it runs the current `withRetry(runPlannerAttempt)` path unchanged. For `context-managed-decomposition`, it calls a new controller and returns without invoking `runPlannerAttempt()`.

The controller derives a `PlanningDecompositionGraph`, persists an initial graph artifact, emits `planning:decomposition:start` and queued unit events, then repeatedly asks `selectReadyPlanningBatch()` for the next safe batch. Each selected unit is launched concurrently with `runBoundedPlanningUnit()`; an `AsyncEventQueue` multiplexes unit-emitted events into the controller generator. Completed outputs are persisted under `.decomposition/units/<unit-id>/output.json`. Failed over-budget units are sent to `splitOverBudgetPlanningUnit()` when depth and split limits permit; child units are queued and the graph artifact is rewritten. Exhaustion returns a typed decomposition planning error, which the controller maps to a `CompileScopeContextError` after emitting bounded failure events.

Synthesis runs only after all required active units have completed or been explicitly skipped by recursive split lineage. Expedition synthesis writes `architecture.md`, `index.yaml`, and module definitions via `writeArchitecture()`, emits `expedition:architecture:complete`, and fills `ctx.expeditionModules` so existing architecture review, module planning, cohesion review, and `compile-expedition` stages can continue. Excursion synthesis writes plan files through `writePlanSet()`, injects the effective pipeline into `orchestration.yaml`, parses the result, emits `planning:complete`, and fills `ctx.plans`.

### Key Decisions

1. **Use an async-generator controller for compile-stage integration.** The architecture-level controller contract is event-emitter based, but `compile-stages.ts` consumes async generators. Implement `runContextManagedCompilePlanning()` as an async generator returning `ContextManagedCompilePlanningResult` so `yield*` streams decomposition events and returns synthesis data.
2. **Keep direct planner retry logic isolated.** Only the strategy branch decides whether to enter the controller. The direct branch keeps the existing planner retry policy, compact continuation, and retry-as-expedition catch path.
3. **Persist bounded evidence only.** Graph, unit output, and synthesis artifacts include source hashes, slice summaries, criteria IDs, budgets, observed pressure, handoff refs, and artifact paths. They do not store raw root source, root prompt text, transcripts, or unbounded agent output.
4. **Treat unit execution errors as scheduling observations before terminal failure.** A failed unit with reducible budget pressure triggers recursive split. A failed unit with no reducible split becomes `decomposition-exhausted` evidence rather than a provider context-window failure.
5. **Use deterministic fallback synthesis.** If captured unit suggestions are incomplete, synthesis creates deterministic module or plan entries from graph unit IDs, coverage, subsystem hints, dependencies, shared-contract notes, and unresolved requirement evidence. This prevents successful unit runs from depending on one final monolithic synthesis agent.
6. **Backfill pipeline defaults through existing helpers.** Excursion synthesis calls `injectPipelineIntoOrchestrationYaml()` after `writePlanSet()` so plan entries receive `defaultBuild` and `defaultReview` values before artifact validation.
7. **Constrain downstream module-planning only for context-managed compiles.** Normal/elevated expedition compiles keep the current wave parallelism. Context-managed expedition compiles set context metadata that causes module-planning waves to pass `parallelism: limits.parallelism` to `runParallel()`.
8. **Keep recovery mapping data-first.** `context-recovery.ts` only learns how to preserve decomposition evidence and convert a decomposition error shape to `CompileScopeContextFailureInput`; recovery text remains for `recovery-rendering`.

## Files

### Create
- `packages/engine/src/compile-resilience/planning-strategy.ts` — export `CompilePlanningStrategy`, `selectCompilePlanningStrategy()`, and small risk/recommendation helpers used by the planner stage and unit tests.
- `packages/engine/src/compile-resilience/context-managed-planning.ts` — public async-generator controller facade. Own graph initialization, scheduling loop, bounded unit execution bridge, recursive split handling, ctx population, and terminal failure handoff. If this file exceeds 300 lines, use durable semantic `eforge:region` markers for controller setup, scheduling, and terminal mapping sections.
- `packages/engine/src/compile-resilience/context-managed-planning/artifacts.ts` — create `.decomposition/`, write graph/state/output JSON, compute relative artifact refs, read bounded unit source slices from root source, and validate that persisted JSON omits forbidden raw fields.
- `packages/engine/src/compile-resilience/context-managed-planning/events.ts` — map engine graph/unit/output/schedule data to client-owned `planning:decomposition:*` event objects, including risk evidence summaries and synthesis-complete payloads.
- `packages/engine/src/compile-resilience/context-managed-planning/synthesis.ts` — synthesize expedition and excursion artifacts from graph plus `PlanningUnitOutput[]`; export `ContextManagedSynthesisResult` and `synthesizeContextManagedPlanning()`.
- `packages/engine/src/compile-resilience/context-managed-planning/unit-runner.ts` — run one scheduler-selected batch with `AsyncEventQueue`, call `runBoundedPlanningUnit()` with upstream outputs and unit artifact directories, and return per-unit outputs/errors after streaming emitted events.
- `test/compile-planning-strategy.test.ts` — focused selector tests for normal, elevated, retry-as-expedition, bounded-decomposition, manual-reduce-scope, and post-escalation expedition cases.
- `test/context-managed-planning-controller.test.ts` — controller tests with inline sources and `StubHarness` covering queued/schedule events, parallel batch execution, recursive split handling, persisted evidence, and decomposition exhaustion.
- `test/context-managed-planning-synthesis.test.ts` — direct synthesis tests for expedition and excursion artifacts using handcrafted graphs and unit outputs.
- `test/compile-context-managed-orchestration.test.ts` — planner-stage integration tests proving overflow-risk bounded-decomposition enters the controller, skips the broad planner attempt, yields decomposition events, and leaves direct normal/elevated paths unchanged.

### Modify
- `packages/engine/src/pipeline/types.ts` — add optional context-managed planning metadata to `PipelineContext`, such as decomposition artifact directory, graph ID, unit-to-module map, unit outputs, and resolved planning parallelism.
- `packages/engine/src/pipeline/stages/compile-stages.ts` — route post-composer bounded-decomposition runs into the controller and return without `runPlannerAttempt()`; cap `module-planning` wave `runParallel()` only when context-managed metadata is present `[region: compile-orchestration-synthesis, post-composer strategy branch and modulePlanningStage runParallel callsite]`.
- `packages/engine/src/compile-resilience/context-recovery.ts` — preserve optional `decompositionEvidence` through `CompileScopeContextFailureInput`, `toCompileScopeContextError()`, and `buildCompileScopeContextFailure()`; add a `toDecompositionCompileScopeFailure()` conversion helper for `DecompositionPlanningError` `[region: compile-orchestration-synthesis, near toCompileScopeContextError() and failure-building callsites]`.
- `packages/engine/src/compile-resilience/artifact-validation.ts` — no schema changes; add narrow test-facing assertions only if synthesized artifacts expose an existing validation gap. Prefer no edit.
- `packages/engine/src/index.ts` or existing export facades — export the new strategy/controller modules only if tests or downstream packages need stable import paths beyond the package wildcard export.
- `test/compile-context-recovery.test.ts` — add decomposition-exhausted mapping assertions if they fit the existing recovery test grouping; otherwise keep the new assertions in `test/context-managed-planning-controller.test.ts`.
- `test/pipeline-compile.test.ts` — add a regression under the existing planner-stage expedition group only if sharing its setup reduces duplicate harness fixtures; otherwise keep integration coverage in `test/compile-context-managed-orchestration.test.ts`.

## Testing Strategy

### Unit Tests
- `selectCompilePlanningStrategy()` returns `direct` for absent risk, `normal`, `elevated`, `retry-as-expedition`, and `manual-reduce-scope` inputs.
- `selectCompilePlanningStrategy()` returns `context-managed-decomposition` for `overflow-risk` plus `bounded-decomposition` after composer-selected expedition and after retry-as-expedition escalation.
- Event mappers produce client-schema-valid `planning:decomposition:start`, `planning:decomposition:schedule`, `planning:decomposition:unit:queued`, `planning:decomposition:unit:skipped`, and `planning:decomposition:synthesis:complete` events.
- Artifact helpers write `.decomposition/graph.json` and unit `output.json` files with graph IDs, source slice summaries, coverage, budgets, observed pressure, and compact handoff refs.
- Artifact helper tests reject persisted objects containing `sourceContent`, `rawSource`, `prompt`, `transcript`, or `rawTranscript` fields.
- Synthesis tests convert unit outputs with module suggestions into `architecture.md` and `index.yaml` that `parseExpeditionIndex()` accepts.
- Synthesis tests convert unit outputs with plan suggestions into plan files and `orchestration.yaml` that `parseOrchestrationConfig()` and `parsePlanFile()` accept after pipeline injection.
- Fallback synthesis creates deterministic module IDs or plan IDs from unit IDs and preserves graph dependency order in `dependsOn` arrays.
- Decomposition error mapping preserves `decompositionEvidence.unitId`, `depth`, `budgets`, `observedPressure`, `assignedCriteria`, `unresolvedCriteria`, `blockers`, and `splitAttempts` in the compile-scope failure.

### Integration Tests
- A planner-stage run with overflow-risk preflight, composer-selected `expedition`, and recommendation `bounded-decomposition` yields `planning:decomposition:start` before any bounded unit completion event.
- The overflow-risk planner-stage run does not yield root `planning:complete` or root `expedition:architecture:complete` events from `runPlannerAttempt()`; the only expedition architecture event comes from synthesis.
- A `StubHarness` that throws when a prompt contains a root-source sentinel completes the context-managed run when bounded unit prompts omit that sentinel.
- The context-managed controller schedules two independent units concurrently when limits parallelism is `2`, and its schedule event has `selectedBatch.length === 2`.
- A valid override `compile.planningUnitParallelism: 3` leads to a schedule event with `parallelism === 3` and at most three selected units.
- A graph with an incomplete dependency yields a schedule event whose waiting reason includes `dependency:<unit-id>` and excludes the dependent unit from `selectedBatch`.
- A graph with overlapping interface or shared-file constraints emits blocked-pair evidence and schedules only one blocked unit in the batch.
- A bounded unit failure with reducible budget pressure causes child units to be queued and the parent unit to emit a skipped lifecycle event.
- A split failure at maximum depth throws `CompileScopeContextError` with `failure.failureKind === 'decomposition-exhausted'`, `failure.source === 'decomposition'`, and `failure.stage === 'planning-decomposition'`.
- Context-managed expedition synthesis fills `ctx.expeditionModules`; the existing `compile-expedition` guard still throws when the effective pipeline omits `compile-expedition`.
- Context-managed excursion synthesis fills `ctx.plans` and emits `planning:complete` with plan IDs that match files on disk.
- Normal and elevated risk planner-stage tests still consume the direct planner harness response and write artifacts through the existing direct path.
- Context-managed module-planning waves pass the resolved parallelism to `runParallel()`; direct expedition module-planning waves keep the previous default behavior.

## Verification

- [ ] `selectCompilePlanningStrategy({ risk: undefined, selectedScope: 'excursion' })` returns `direct`.
- [ ] `selectCompilePlanningStrategy()` returns `direct` for `risk.level: 'elevated'`.
- [ ] `selectCompilePlanningStrategy()` returns `direct` for `risk.recommendation.action: 'retry-as-expedition'`.
- [ ] `selectCompilePlanningStrategy()` returns `context-managed-decomposition` for `risk.level: 'overflow-risk'` and `risk.recommendation.action: 'bounded-decomposition'`.
- [ ] A bounded-decomposition planner-stage run records `planning:decomposition:start` and at least one `planning:decomposition:schedule` event.
- [ ] The same run records zero broad root planner artifact submissions from `runPlannerAttempt()`.
- [ ] The same run records bounded unit planner calls with prompts containing the unit ID and excluding a configured root-source sentinel.
- [ ] The first schedule event for two independent units has `parallelism === 2` when no config override is present.
- [ ] A config override of `planningUnitParallelism: 3` produces a schedule event with `parallelism === 3`.
- [ ] A waiting dependent unit has a waiting reason string equal to `dependency:<upstream-unit-id>`.
- [ ] Two units sharing an unresolved interface key are not both present in one `selectedBatch`.
- [ ] Two units sharing an unresolved shared-file key are not both present in one `selectedBatch`.
- [ ] A recursive split writes an updated `.decomposition/graph.json` containing child unit IDs and a skipped parent unit.
- [ ] `.decomposition/units/<unit-id>/output.json` contains `unitId`, `status`, `coveredCriteria`, `synthesisNotes`, and `observedBudget` when observed pressure exists.
- [ ] No `.decomposition/*.json` artifact contains keys named `sourceContent`, `rawSource`, `prompt`, `transcript`, or `rawTranscript`.
- [ ] Expedition synthesis writes `architecture.md` and `index.yaml` under the plan set directory.
- [ ] `parseExpeditionIndex()` accepts the synthesized expedition `index.yaml`.
- [ ] Expedition synthesis emits `planning:decomposition:synthesis:complete` with `artifactPaths` containing `architecture.md` and `index.yaml`.
- [ ] Excursion synthesis writes `orchestration.yaml` and at least one `plan-XX-*.md` file.
- [ ] `parseOrchestrationConfig()` accepts the synthesized excursion `orchestration.yaml` after pipeline injection.
- [ ] `validateCompileArtifacts()` returns `ok: true` for synthesized excursion artifacts.
- [ ] Decomposition exhaustion emits a unit failed event before the controller throws.
- [ ] Decomposition exhaustion throws `CompileScopeContextError` with `failure.decompositionEvidence.unitId` matching the exhausted unit.
- [ ] `compileScopeContextRecoveryOption()` preserves `source: 'decomposition'` and `failureKind: 'decomposition-exhausted'` once contracts-config evidence fields exist.
- [ ] Direct normal-risk planner-stage tests still yield a direct `planning:complete` event from the planner path.
- [ ] Direct elevated-risk planner-stage tests still invoke `runPlannerAttempt()` once.
- [ ] `pnpm test -- compile-planning-strategy context-managed-planning` exits 0.
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
