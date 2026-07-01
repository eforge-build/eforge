---
title: Planner compiler map-to-reduce pipelining
created: 2026-07-01
depends_on: ["per-invocation-runtime-choice-routing"]
stack_parent: per-invocation-runtime-choice-routing
---

# Planner compiler map-to-reduce pipelining

## Executive Summary

Implement an integrated planner-compiler map/reduce scheduler so the reduce tree is planned up front and eligible reducers can start as soon as their own inputs are complete, instead of waiting for every atom to finish. The work primarily changes `packages/engine/src/planner-compiler/*`, preserves existing atom/reducer agent contracts, event-driven engine boundaries, fail-fast behavior, and residue/repair outputs, and standardizes Console/run-state reduce-tree grouping copy on `level` where surfaced. Out of scope: redesigning decomposition, reducer prompts, source localization, repair-loop semantics, or queue/workstation behavior. Build confidence comes from focused scheduler tests plus existing planner compiler, reduce runner, shared brief, map/reduce event, type-check, and maintainability gates.

## Problem Statement

The bounded planner compiler currently runs map and reduce as two strict phases: `runBoundedPlannerCompiler` awaits `runPlanningAtomMap()` before calling `runPlanningReduce()` in `packages/engine/src/planner-compiler/compiler-runner.ts`. `runPlanningReduce()` is greedy inside the reduce phase, but it consumes a completed `PlanningAtomMapResult`, so reducers sit idle until unrelated atoms finish. This reduces throughput for large plans and delays downstream fail-fast feedback. The goal is to preserve current correctness guarantees while allowing depth-0 reducers to start when their own atom inputs are complete and parent reducers to start when their child reducers finish.

## Scope

In scope:
- Plan the reduce tree before all atom outputs are available, using atom graph/task structure and conservative prompt-budget checks.
- Replace the top-level map-then-reduce barrier with an integrated scheduler that runs atoms and reducers from the same dependency model.
- Start a depth-0 reducer as soon as all of its input atom outputs complete successfully, without waiting for unrelated atoms.
- Start parent reducers greedily once all child reducer outputs complete.
- Preserve shared-brief prerequisites before consumer atoms run, and ensure reducers only consume completed atom/child outputs.
- Preserve fail-fast cancellation and compiler result shapes (`PlanningAtomMapResult`, `PlanningReduceResult`, residue synthesis, repair-loop inputs).
- Keep map/reduce orchestration events accurate and standardize Console/run-state reduce-tree depth grouping terminology on `level` so UI copy does not imply global phase barriers.

Out of scope:
- Redesigning atom decomposition, source localization, reducer prompt schema, agent harnesses, or repair-loop strategy.
- Changing daemon/client API routes or queue behavior.
- Replacing the Console map/reduce board beyond terminology/status correctness.

## Acceptance Criteria

- The reduce tree is derived before all atom outputs are available and is validated against prompt-budget limits.
- A depth-0 reducer begins once all of its input atom outputs complete successfully, even while unrelated atoms are queued/running.
- Parent reducers begin once all child reducers complete, preserving existing greedy reducer scheduling.
- Atom failure cancels running work or prevents dependent reducers according to the existing fail-fast policy.
- Shared-finding/shared-brief prerequisite constraints still gate consumer atoms, and reducers never consume unavailable shared-dependent outputs.
- Existing all-atoms-complete scenarios still produce equivalent successful compiler results.
- Console/run-state status remains accurate when reduce-tree and reducer status events arrive before the map phase is globally complete, and reduce grouping labels consistently use `level` terminology.
- Tests cover pipelined scheduling, failure cancellation, shared-brief constraints, prompt-budget safety, event ordering, Console/run-state terminology, and the legacy all-complete path.

## Code Impact

Likely engine changes:
- `packages/engine/src/planner-compiler/compiler-runner.ts`: call the integrated scheduler instead of sequential `runPlanningAtomMap()` then `runPlanningReduce()`, while keeping source inventory/localization/evidence, repair loop, residue synthesis, status calculation, and event aggregation intact.
- New focused module such as `packages/engine/src/planner-compiler/map-reduce-pipeline-runner.ts`: own integrated scheduling state, ready checks, result assembly, and fail-fast cancellation without overgrowing existing files.
- `packages/engine/src/planner-compiler/atom-map-runner.ts`: extract or reuse single-atom scheduling/execution helpers so the integrated runner does not duplicate validation, shared-brief, event, or abort behavior.
- `packages/engine/src/planner-compiler/reduce-runner.ts` / `reduce-contracts.ts` / `prompt-budget-planner.ts`: support structural reduce-tree planning from atom graph/task metadata and launching individual reducers when required atom/child outputs are available.
- `packages/engine/src/planner-compiler/orchestration-events.ts`: likely no wire-shape changes, but verify reduce-tree snapshot timing and status reasons remain valid.
- `packages/engine/src/planner-compiler.ts`: export any new public helpers only if tests or downstream code need them.

Likely Console/test changes:
- `packages/console-ui/src/lib/run-state/selectors/map-reduce.ts`, `packages/console-ui/src/components/map-reduce/*`, and related tests/stories: replace reduce depth grouping labels and explanatory copy with `level` terminology, for example `Reduce level`.
- Add focused tests, likely in a new planner-compiler test file, and extend existing `planning-reduce-runner.test.ts`, `planning-compiler-runner.test.ts`, `planning-shared-brief.test.ts`, and `planning-map-reduce-events.test.ts` where behavior overlaps.

Maintainability guardrails:
- Keep any new implementation file under 600 lines; if an existing large file must change, use bounded exact edits.
- Preserve the engine boundary: emit typed events and let consumers render them; do not add stdout behavior.

## Design Decisions

- Plan once, execute greedily: build a stable reduce tree before map completion rather than dynamically rebuilding it as atoms finish. This keeps event snapshots deterministic and avoids moving reducer targets mid-run.
- Use conservative placeholder/atom-task metadata for planning: derive reduce nodes from expected atom IDs, criterion IDs, and aspect IDs available from `buildPlanningAtomTasks()`/coverage metadata, then validate actual reducer prompts at launch with completed outputs.
- Keep agent contracts unchanged: atom planners still submit atom outputs; reducers still receive `PlanningReduceTask` and submit reduce outputs through the existing reducer tool contract.
- Prefer extraction over duplication: factor existing private atom/reducer execution logic only as needed, so validation and retry semantics remain single-source.
- Maintain fail-fast semantics with a composed abort controller shared by running atoms/reducers; terminal results should mark blocked/cancelled dependents rather than leaving queued nodes ambiguous.
- Treat Console `level` labels as presentation of reduce-tree depth, not as scheduler barriers; prefer `Reduce level` consistently across selectors, components, copy, and tests.

## Assumptions And Validation

Assumptions to validate during implementation:
- Conservative upfront reduce planning can be made prompt-safe because atom reduce digests are already budgeted before atom execution.
- `PlanningReduceNode` traceability can be derived from atom-task criteria/aspects before atom outputs exist, then actual outputs can be validated against the same allowed IDs.
- Repair-loop inputs can stay as completed first-pass `map` and `reduce` results; repair pipelining is not required for this session.

Validation plan:
- Add a test with a deliberately slow unrelated atom proving a depth-0 reducer starts after only its own input atoms complete.
- Add a multi-level reducer test proving parent reducers start as soon as child reducer outputs complete.
- Add atom-failure tests proving running reducers are aborted/cancelled and dependent queued reducers become failed/incomplete as expected.
- Add shared-brief tests proving consumer atoms still wait for primary shared evidence owners, while independent reducers can start when eligible.
- Add prompt-budget tests proving the upfront tree and launched reducer prompts remain within configured limits.
- Re-run focused suites: `pnpm test -- planning-reduce-runner.test.ts planning-compiler-runner.test.ts planning-shared-brief.test.ts planning-map-reduce-events.test.ts` plus the new pipelining tests.
- Finish with `pnpm type-check` and `pnpm maintainability:check`.