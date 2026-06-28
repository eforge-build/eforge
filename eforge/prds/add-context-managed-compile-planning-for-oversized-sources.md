---
title: Add Context-Managed Compile Planning for Oversized Sources
created: 2026-06-28
---

# Add Context-Managed Compile Planning for Oversized Sources

## Problem / Motivation

Recent compile builds are failing in the planner stage after preflight already identifies overflow-risk sources. The latest `add-bounded-recovery-auto-resume-policy` run selected `expedition`, attempted compact-inspection continuation, then still exceeded the planner-family live context guard (`182,534` observed input tokens vs `178,444` limit) before producing compiled artifacts.

The product gap is not that eforge should stop earlier; it is that eforge should be smart enough to handle arbitrarily large planning inputs by decomposing them into bounded planning units and managing context throughout planning. Overflow-risk should trigger a context-managed planning mode, not merely advisory recovery text or a terminal failure.

## Goal

Teach eforge to handle oversized planning work by decomposing it into bounded, dependency-aware planning units and managing planner context deliberately, rather than treating overflow risk as a terminal condition.

When preflight and pipeline composition detect a broad source, the compile phase should enter a context-managed planning strategy that creates a bounded decomposition tree/DAG, plans independent units in parallel when safe, preserves compact handoffs per unit, and synthesizes the resulting architecture/orchestration without any single planner session carrying the whole problem.

## Approach

- Use preflight and pipeline composition as the strategy selector.
- Keep normal and elevated work on the existing direct planner flow.
- Route overflow-risk work into context-managed decomposition planning.
- After preflight and pipeline composition, route oversized work into a decomposition controller instead of a single broad planner session.
- Decompose the source into bounded planning units using source structure, acceptance criteria, subsystem breadth, and codebase evidence.
- Model decomposed planning units as a dependency-aware tree/DAG.
- Plan independent units in parallel when dependencies, acceptance-criteria coverage, shared-file regions, and interface contracts make concurrent planning safe.
- Schedule independent bounded units concurrently up to a config-defined planning parallelism limit.
- Default planning-unit parallelism to `2` when no explicit config is provided.
- Respect dependencies and shared-file/interface constraints during scheduling.
- Treat planner context as a scheduled resource.
- Give every unit prompt/source caps, live usage limits, compact handoff limits, and a maximum local exploration budget.
- Support recursive decomposition when a unit still exceeds planning budgets.
- Use foundation/interface units to establish shared contracts before dependent vertical units when shared data models, route contracts, or file ownership would otherwise be ambiguous.
- Require coverage tracking so every acceptance criterion/source requirement is assigned to one or more units or explicitly marked unresolved with evidence.
- Run planner/inspection passes per bounded unit with strict context budgets and compact handoff artifacts.
- Preserve compact-inspection continuation as a per-unit salvage mechanism, not a second monolithic root planning attempt.
- Synthesize bounded unit outputs into the existing compile artifacts, including `architecture`, module definitions, plan files, and/or `orchestration.yaml`, where appropriate.
- Emit typed, replayable decomposition and scheduling events so recovery and Console can explain what was planned, what waited, what ran in parallel, what was omitted, and where context pressure remains.
- Classify decomposition exhaustion as a decomposition-planning failure with actionable evidence, not as a generic context-window error.
- Preserve engine boundary discipline.
- Keep decomposition internal to compile artifacts.
- Do not auto-author or auto-enqueue new external successor PRDs without an explicit host/user workflow.
- Keep product-level reprioritization and successor PRD authoring outside the engine.
- Keep route/wire shape duplication outside `@eforge-build/client`.

Likely implementation areas:

- `packages/engine/src/compile-resilience/preflight.ts` — expose strategy inputs and risk evidence used to choose context-managed planning.
- `packages/engine/src/compile-resilience/planning-decomposition.ts` — new focused engine module to derive bounded planning units, budgets, recursive split decisions, and synthesis inputs.
- `packages/engine/src/eforge.ts` and/or compile orchestration path — route overflow-risk compile runs through the decomposition controller after pipeline composition.
- `packages/engine/src/agents/planner.ts` — support bounded unit prompts and compact handoff reuse without full-transcript replay.
- `packages/engine/src/agents/module-planner.ts` — support bounded unit prompts and compact handoff reuse without full-transcript replay.
- Planner-inspection helpers — support bounded unit prompts and compact handoff reuse without full-transcript replay.
- `packages/client/src/events/...` — add typed decomposition planning event variants and budget/unit schemas owned by the client package.
- Recovery sidecar code — include decomposition tree/unit evidence and classify decomposition exhaustion separately from raw context-window failures.
- CLI/Console rendering helpers/tests — render decomposition progress and terminal diagnostics using shared client event types.
- Tests near `test/compile-preflight*`, `test/planner-compact-continuation*`, `test/compile-context-recovery*`, `test/recovery-sidecars*`, and event/schema parity fixtures.

Assumptions:

- Current preflight evidence is enough to select context-managed planning: risk score, acceptance-criteria count, subsystem breadth, prompt/source bytes, and selected pipeline scope.
- `expedition` should not mean one large architecture planner must carry the full problem.
- `expedition` can become the root of a bounded dependency-aware decomposition tree/DAG.
- Existing planner/module-planner prompts and compile artifact formats can be adapted to bounded unit planning without changing the external PRD queue model.
- Independent decomposition units can often be planned in parallel.
- Shared contracts or foundation/interface work must serialize dependent units when needed.
- Planning-unit parallelism should be controlled by explicit config with a default of `2`.
- Provider/resource constraints can remain secondary safeguards rather than the primary scheduling policy.
- Some pathological inputs may still exhaust configured decomposition limits.
- Pathological decomposition exhaustion should be rare, typed, and evidence-rich rather than the normal control path.

## Scope

In scope:

- Add a context-managed compile planning strategy for overflow-risk sources.
- After preflight and pipeline composition, route oversized work into a decomposition controller instead of a single broad planner session.
- Decompose the source into bounded planning units using source structure, acceptance criteria, subsystem breadth, and codebase evidence.
- Model decomposed planning units as a dependency-aware tree/DAG so independent units can be planned in parallel when safe.
- Run planner/inspection passes per bounded unit with strict context budgets and compact handoff artifacts.
- Schedule independent bounded units concurrently up to a config-defined planning parallelism limit, defaulting to `2`, while respecting dependencies and shared-file/interface constraints.
- Support recursive decomposition when a unit still exceeds planning budgets.
- Synthesize bounded unit outputs into the existing compile artifacts: architecture/module definitions for expeditions or plan sets/orchestration for excursions where appropriate.
- Emit typed events for decomposition decisions, unit planning progress, parallel scheduling decisions, context budgets, compact handoffs, and synthesis results.
- Preserve engine boundary discipline: the engine can decompose compile work internally, but it should not auto-author or auto-enqueue new external successor PRDs without an explicit host/user workflow.

Out of scope:

- Product-level reprioritization of the source or deciding which requirements to drop.
- Auto-enqueuing follow-up PRDs as separate queue items.
- Changing model metadata guard math as the primary solution.
- Broad Console workflow UX beyond surfacing decomposition progress/details needed to understand a compile run.
- Removing manual recovery controls for true failures.

## Acceptance Criteria

- A high-overflow PRD that preflight classifies as `overflow-risk` and pipeline-composer selects as `expedition` enters context-managed decomposition planning.
- A high-overflow PRD that enters context-managed decomposition planning does not run one broad planner session.
- The decomposition controller creates bounded planning units with explicit unit IDs.
- Each bounded planning unit records its source slices.
- Each bounded planning unit records its criteria coverage.
- Each bounded planning unit records subsystem hints.
- Each bounded planning unit records dependencies.
- Each bounded planning unit records context budgets.
- The decomposition controller records a dependency graph/tree for units.
- The decomposition controller identifies which units are safe to plan in parallel.
- Independent units are planned concurrently up to a config-defined limit.
- Units that share unresolved interface constraints are not planned concurrently.
- Units that share unresolved shared-file constraints are not planned concurrently.
- The default planning-unit parallelism is `2` when no explicit config is provided.
- Configured planning-unit parallelism overrides the default when a valid override is provided.
- Dependent units wait for upstream unit outputs before planning.
- Synthesis waits for all required unit outputs.
- Parallel unit planning emits typed scheduling events.
- Parallel unit planning emits typed progress events.
- Scheduling/progress events explain which units ran concurrently.
- Scheduling/progress events explain why waiting units waited.
- Each planning unit is processed with bounded prompts.
- Each planning unit is processed with live context guards.
- No unit planner is expected to carry the full source.
- No unit planner is expected to carry the full transcript.
- Units that still exceed budget are recursively decomposed up to a configured safe limit.
- Recursive decomposition emits typed evidence if decomposition cannot make progress.
- The compile phase synthesizes successful unit outputs into valid existing `architecture` artifacts where appropriate.
- The compile phase synthesizes successful unit outputs into valid existing module definitions where appropriate.
- The compile phase synthesizes successful unit outputs into valid existing plan files where appropriate.
- The compile phase synthesizes successful unit outputs into valid existing `orchestration.yaml` artifacts where appropriate.
- Successful bounded planning does not require external successor PRDs.
- Typed events expose decomposition start.
- Typed events expose unit queued lifecycle state.
- Typed events expose unit running lifecycle state.
- Typed events expose unit completed lifecycle state.
- Typed events expose unit skipped lifecycle state.
- Typed events expose unit failed lifecycle state.
- Typed events expose compact handoff creation.
- Typed events expose budget diagnostics.
- Typed events expose final synthesis.
- Recovery sidecars distinguish true decomposition failure from provider context-window failure.
- Recovery sidecars include bounded unit evidence.
- Existing normal compile paths continue to use the current direct planner flow.
- Existing elevated compile paths continue to use the current direct planner flow.
- Existing compact-inspection continuation remains available within a bounded unit.
- Existing compact-inspection continuation cannot replay the whole root planning transcript.
- Existing compact-inspection continuation cannot accumulate the whole root planning transcript.
- Tests cover the regression shape from the recent failure with many acceptance criteria, broad subsystem breadth, and `expedition` selected.
- The regression test verifies successful bounded planning without invoking an unsafe monolithic planner.
- Unit tests verify strategy selection into direct planning.
- Unit tests verify strategy selection into context-managed planning.
- Decomposition tests verify large sources become bounded units with criteria coverage.
- Decomposition tests verify large sources become bounded units with subsystem coverage.
- Decomposition tests verify large sources become bounded units with stable dependencies.
- Config tests verify planning-unit parallelism defaults to `2`.
- Config tests verify planning-unit parallelism accepts valid overrides.
- Scheduler tests verify independent units can run in parallel up to the configured limit.
- Scheduler tests verify dependent units wait for upstream outputs.
- Scheduler tests verify shared-contract blockers prevent unsafe parallel planning.
- Orchestration tests verify the monolithic planner harness is not invoked for overflow-risk root sources.
- Orchestration tests verify bounded unit planners are invoked for overflow-risk root sources.
- Recursive decomposition tests verify a unit that remains over budget is recursively decomposed.
- Synthesis tests verify bounded unit outputs produce valid architecture artifacts.
- Synthesis tests verify bounded unit outputs produce valid orchestration artifacts.
- Event/schema tests verify decomposition unit lifecycle events.
- Event/schema tests verify parallel scheduling decision events.
- Event/schema tests verify budget diagnostic events.
- Recovery sidecar tests verify decomposition exhaustion is reported with unit evidence.
- Recovery sidecar tests verify decomposition exhaustion is not mislabeled as provider context-window failure.
- A regression fixture similar to the recent failure includes many acceptance criteria.
- A regression fixture similar to the recent failure includes wide subsystem breadth.
- A regression fixture similar to the recent failure includes `expedition` selection.
- `pnpm type-check` exits 0.
- `pnpm test` exits 0.
- `pnpm maintainability:check` exits 0.