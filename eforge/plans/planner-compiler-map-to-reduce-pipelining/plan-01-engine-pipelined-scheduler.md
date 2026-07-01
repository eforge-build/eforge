---
id: plan-01-engine-pipelined-scheduler
name: Engine Pipelined Map/Reduce Scheduler
branch: planner-compiler-map-to-reduce-pipelining/plan-01-engine-pipelined-scheduler
agents:
  builder:
    effort: high
    rationale: Concurrent atom/reducer scheduling changes require careful
      preservation of existing planner compiler result shapes, fail-fast
      behavior, and prompt-budget validation.
  tester:
    effort: high
    rationale: Scheduler behavior depends on event order, cancellation, and
      shared-brief gating, which need focused tests with controllable harness
      timing.
  reviewer:
    effort: high
    rationale: Review must check concurrency edge cases and compatibility with
      existing map/reduce contracts.
---

# Engine Pipelined Map/Reduce Scheduler

## Architecture Context

The bounded planner compiler currently performs atom map execution and reduce execution as two top-level phases. This plan introduces an engine-local integrated scheduler that keeps the atom planner and reducer agent contracts unchanged, emits the same typed map/reduce orchestration events, and returns the existing `PlanningAtomMapResult` and `PlanningReduceResult` shapes. The reduce tree is planned from atom task metadata before all atom outputs exist; reducer tasks are still built only from completed atom/child outputs at launch time.

Repair-loop pipelining remains out of scope: the source-localization repair loop may keep using the existing sequential atom-map then reduce runner for affected repair passes.

## Implementation

### Overview

Create a focused pipelined runner under `packages/engine/src/planner-compiler/` and wire `runBoundedPlannerCompiler()` to use it for the first-pass bounded compiler run. Extract shared single-atom and single-reducer execution helpers so validation, agent invocation, retry behavior, status conversion, and abort handling stay single-source between the legacy runners and the new integrated scheduler.

### Key Decisions

1. Plan the reduce tree once from expected atom tasks, not from completed outputs. Node IDs and fan-in ordering must stay deterministic and match the existing tree shape for the same atom order and limits.
2. Keep `depth` as the engine/client wire field for reduce-tree structure. User-facing terminology changes are handled in plan 02.
3. Use one global scheduler capacity (`input.parallelism ?? graph.limits.parallelism`) across running atoms and reducers, so pipelining does not silently multiply agent concurrency.
4. Treat only successfully completed atom outputs with zero validation errors as accepted reducer inputs; skipped, cancelled, or failed atom outputs trigger fail-fast cancellation or block dependent reducers according to the existing fail-fast policy.
5. Validate prompt safety twice: conservatively when planning the upfront tree, and again against actual completed outputs before launching each reducer.

## Scope

### In Scope

- Upfront prompt-safe reduce-tree planning from `PlanningAtomTask` metadata.
- Integrated scheduling for atoms and reducers with shared-brief atom prerequisites.
- Depth-0 reducers launching when their own atom inputs are accepted and scheduler capacity is available, even when unrelated atoms remain queued or running.
- Parent reducers launching after all child reducer outputs complete.
- Fail-fast cancellation across running atoms and reducers, plus terminal status/output records for cancelled or blocked reduce nodes.
- Compiler integration that preserves source inventory, localization, evidence materialization, residue synthesis, repair-loop inputs, status calculation, and event sinks.
- Focused tests for pipelining, multi-level reducers, failures, shared brief constraints, prompt budgets, event ordering, and legacy successful compilation.

### Out of Scope

- Atom decomposition changes.
- Reducer prompt/schema redesign.
- Source localization or repair-loop strategy changes.
- Daemon/client route changes.
- Console terminology updates; plan 02 owns those.

## Files

### Create

- `packages/engine/src/planner-compiler/map-reduce-pipeline-runner.ts` — integrated atom/reducer scheduler, result assembly, chronological event aggregation, and fail-fast handling.
- `packages/engine/src/planner-compiler/atom-execution.ts` — shared single-atom execution helper used by `runPlanningAtomMap()` and the integrated scheduler.
- `packages/engine/src/planner-compiler/reduce-execution.ts` — shared single-reducer execution/task helper used by `runPlanningReduce()` and the integrated scheduler.
- `packages/engine/src/planner-compiler/abort-utils.ts` — shared `composeAbortSignal()` and `isAbortError()` helpers to remove duplicate abort logic.
- `test/planning-map-reduce-pipeline-runner.test.ts` — focused scheduler tests with a controllable harness.

### Modify

- `packages/engine/src/planner-compiler/compiler-runner.ts` — replace the first-pass sequential `runPlanningAtomMap()` then `runPlanningReduce()` calls with the integrated scheduler result; keep repair loop, residue synthesis, validation errors, and status calculation intact.
- `packages/engine/src/planner-compiler/atom-map-runner.ts` — delegate single-atom execution and terminal status helpers to the extracted module; keep public input/result contracts unchanged.
- `packages/engine/src/planner-compiler/reduce-runner.ts` — delegate single-node reducer execution to the extracted module; keep the legacy reduce-phase runner for repair passes and existing direct tests.
- `packages/engine/src/planner-compiler/reduce-contracts.ts` — add task-metadata reduce-tree construction, sharing validation and node ID generation with the existing output-based tree builder.
- `packages/engine/src/planner-compiler/prompt-budget-planner.ts` — add prompt-safe upfront tree planning from atom tasks and launch-time prompt validation support.
- `packages/engine/src/planner-compiler/orchestration-events.ts` — verify snapshot timing assumptions in comments and keep event wire shapes unchanged.
- `packages/engine/src/planner-compiler.ts` — export the new runner and upfront tree planner only as needed by tests.
- `packages/engine/src/planner-compiler/source-localization-repair.ts` — update imports only if extraction moves helper types; repair behavior remains sequential.
- `test/planning-reduce-runner.test.ts` — add/adjust coverage for task-metadata reduce-tree planning and prompt budget safety without regressing the legacy reduce runner.
- `test/planning-compiler-runner.test.ts` — assert the compiler uses the pipelined first pass while preserving successful result status and repair-loop inputs.
- `test/planning-shared-brief.test.ts` — add integrated scheduler coverage for primary shared evidence owners gating consumer atoms.
- `test/planning-map-reduce-events.test.ts` — assert reduce-tree and reducer status events can appear before global map completion and still validate with `safeParseEforgeEvent()`.

## Implementation Notes

- The upfront tree planner can reuse the existing chunking/tree validation algorithm by feeding traces from `PlanningAtomTask` (`atomId`, `criterionIds`, `aspectIds`) instead of completed output artifacts.
- The integrated scheduler must emit `planning:map-reduce:atoms` and `planning:map-reduce:reduce-tree` before any reducer status event. The live `onEvent` stream must preserve chronological interleaving between atom and reducer status/agent events.
- `PlanningAtomMapResult.events` may contain atom-related events and `PlanningReduceResult.events` may contain reduce-related events, but `BoundedPlannerCompilerResult.events` for a no-repair run must use the integrated chronological event list.
- Reducer readiness requires every `inputAtomId` to have an accepted atom output and every `inputNodeId` to have a completed reducer output. Reducers must not receive missing atom outputs or missing child outputs.
- On atom or reducer failure, abort the composed controller, mark running work with failed status/reason, and mark not-started reduce nodes that can no longer run as incomplete with a reason naming the failed atom/child dependency.

## Verification

- [ ] A new scheduler test records a depth-0 reducer `running` event after only that reducer's input atoms complete, while at least one unrelated atom is still queued or running.
- [ ] A multi-level scheduler test records a parent reducer `running` event immediately after all of its child reducers complete, without waiting for unrelated atoms outside that parent subtree when capacity exists.
- [ ] An atom failure test records abort/cancel status for running atom/reducer work and terminal incomplete or failed status for reducer nodes blocked by the failed atom.
- [ ] A shared-brief scheduler test records no consumer atom `running` event before its primary owner atom completes and makes accepted shared findings available.
- [ ] A prompt-budget test validates the upfront tree before all atom outputs exist and verifies every launched reducer prompt byte length is less than or equal to `maxReducePromptBytes`.
- [ ] Existing all-atoms-complete compiler tests return `status: "complete"`, `map.mapComplete: true`, `reduce.reduceComplete: true`, and an empty residue candidate list.
- [ ] Map/reduce orchestration events emitted by the pipelined compiler pass `safeParseEforgeEvent()` and the live sink order matches reducer eligibility order.
- [ ] `pnpm test -- planning-map-reduce-pipeline-runner.test.ts planning-reduce-runner.test.ts planning-compiler-runner.test.ts planning-shared-brief.test.ts planning-map-reduce-events.test.ts` passes.