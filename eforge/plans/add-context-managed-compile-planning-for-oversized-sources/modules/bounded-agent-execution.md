# Bounded Agent Execution

## Architecture Reference

This module implements the **bounded-agent-execution** row from **Implementation Module Boundaries**, plus the **Planner and Module Planner Integration** portions of the architecture.

Key constraints from architecture:
- Bounded planner-family runs consume `PlanningDecompositionUnit`, upstream `PlanningUnitOutput`/compact handoff references, unit budgets, and client-owned decomposition event types.
- The module produces `PlanningUnitOutput`, compact handoff artifact references, observed budget pressure, and unit lifecycle/progress events through a controller-provided emitter.
- Unit prompts contain only the unit source slice, unit acceptance criteria, unit subsystem hints, relevant upstream compact handoffs/interface outputs, unit budgets, and local exploration limits.
- Compact-inspection continuation is unit-local; it must not replay or accumulate the root planning transcript.
- Planner-family live context guards use unit budgets rather than root compile defaults when running a bounded unit.
- This module must not select the root planning strategy, derive or schedule the decomposition graph, synthesize final compile artifacts, classify recovery sidecars, or render Console/CLI output.
- `packages/engine/src/pipeline/stages/compile-stages.ts` is shared; this module must not change the strategy branch or controller call sites there.

## Scope

### In Scope
- Add bounded-unit prompt context formatting shared by planner, module-planner, and the bounded execution facade.
- Add capture-only bounded submissions to `runPlanner()` so bounded units can reuse planner validation/submission tools without writing root plan-set or architecture artifacts.
- Add bounded-unit support to `runModulePlanner()` including unit source slices, upstream compact handoffs, a capture-only module-plan submission tool, and unit live context guards.
- Extend planner inspection helpers so unit-local compact handoffs can be written under a controller-supplied artifact directory and identified by unit ID/source hash.
- Add `runBoundedPlanningUnit()` as the controller-facing facade that invokes planner-family agents, emits typed decomposition lifecycle/progress/budget/compact events, and returns a `PlanningUnitOutput`.
- Convert captured planner/module-planner submissions, agent usage, tool-use evidence, and compact handoff summaries into bounded `PlanningUnitOutput` fields.
- Enforce prompt/source/handoff byte caps before invoking a harness, and abort harness runs when live unit context guards fire.
- Cap upstream handoff inclusion by `PlanningUnitBudget.maxCompactHandoffBytes` and include only bounded handoff summaries or references.
- Preserve existing direct planner and direct module-planner behavior when no bounded-unit options are provided.
- Add tests for unit-only prompts, capture-only submissions, unit-local compact continuation, budget diagnostics, and unchanged direct paths.

### Out of Scope
- Selecting `direct` versus `context-managed-decomposition` planning.
- Deriving planning units, assigning criteria coverage, computing dependency edges, selecting schedule batches, or recursively splitting over-budget units.
- Persisting graph/output JSON files under `.decomposition/` beyond unit-local compact handoff files needed by agent continuation.
- Synthesizing `architecture.md`, `index.yaml`, module definitions, plan files, or `orchestration.yaml` from multiple unit outputs.
- Emitting decomposition start, schedule, final synthesis, or recovery sidecar events.
- Console, CLI, monitor, daemon route, or recovery wording changes.
- Auto-authoring or auto-enqueueing external successor PRDs.

## Implementation Approach

### Overview

Create a small bounded-agent facade that later orchestration code can call with a single `PlanningDecompositionUnit`. The facade builds a prompt-safe unit context, invokes `runPlanner()` or `runModulePlanner()` in capture-only mode, observes agent events for budget pressure, emits client-owned `planning:decomposition:*` events via the supplied emitter, and returns a bounded `PlanningUnitOutput`.

The existing planner remains the direct-flow implementation for normal/elevated compile runs. Bounded mode is opt-in through new options and uses the same submission validation schemas, but captured submissions are converted to unit suggestions instead of being written to the root plan set. Module-planner gets an analogous bounded capture tool because direct module planning currently relies on file writes.

Compact continuation stays inside each unit. `runPlanner()` keeps its existing compact-inspection continuation for direct runs, but when a bounded context is present it builds the inspection handoff from unit source context, writes it to the unit artifact directory, restarts from the unit source plus the compact handoff, and never includes root source text or raw tool transcripts. `runModulePlanner()` adds the same unit-local soft-budget handoff path for bounded module planning only.

### Key Decisions

1. **Use capture-only submissions instead of internal temporary root artifacts.** Bounded runs call existing planner submission tools, but `runPlanner()` skips `writePlanSet()`/`writeArchitecture()` and reports captured payloads through callbacks. This prevents unit runs from creating root `planning:complete` or `expedition:architecture:complete` artifacts.
2. **Add a module-plan submission tool only for bounded module-planner runs.** Direct module-planner behavior remains Write-tool based. Bounded mode injects `submit_module_plan` so unit output can be captured without requiring filesystem writes.
3. **Keep large runner edits shallow.** `planner.ts` is already 588 lines and `planner-inspection.ts` is 525 lines; new formatting, output conversion, handoff capping, and event mapping logic goes into new helper files. Edits to existing runners are limited to option types, prompt variable injection, capture callbacks, and calls into helpers.
4. **Filter root planning events at the facade boundary.** `runBoundedPlanningUnit()` emits decomposition lifecycle/progress/budget/handoff events and selected agent tracing events. It does not forward root `planning:start`, root `planning:complete`, or root `expedition:architecture:complete` from bounded capture runs.
5. **Use unit budgets as both hard and soft inputs.** Prompt bytes and prompt-source bytes are checked before harness invocation. Live input-token/turn guards use `PlanningUnitBudget`; compact observer tool-use caps use `maxLocalExplorationToolUses`; handoff text inclusion uses `maxCompactHandoffBytes`.
6. **Treat upstream handoffs as references plus bounded summaries.** The prompt includes upstream unit IDs, covered criteria, shared contract notes, unresolved requirements, and compact handoff references. If a handoff file is read, only the validated compact handoff markdown is included and capped to the unit handoff budget.
7. **Return evidence-rich failed unit outputs for agent-level failures.** Submission validation failures and planner-family context errors produce `PlanningUnitOutput.status = 'failed'` with observed budget pressure and unresolved requirements. Decomposition exhaustion remains the decomposition-core/controller responsibility.

## Files

### Create
- `packages/engine/src/compile-resilience/bounded-planning-context.ts` — bounded prompt context types and helpers. Format unit source slices, criteria coverage, subsystem hints, dependencies, interface/shared-file constraints, upstream output summaries, upstream compact handoff references, budget diagnostics, and capture-only instructions. Include byte-capping helpers and raw-source/transcript field guards for prompt fragments.
- `packages/engine/src/agents/bounded-planning-unit.ts` — controller-facing bounded execution facade. Export `BoundedPlanningUnitInput`, `BoundedPlanningUnitAgentMode`, `BoundedPlanningUnitExecutionResult`, and `runBoundedPlanningUnit()`. Consume `PlanningDecompositionUnit`, `PlanningUnitBudget`, `PlanningUnitOutput`, and `evaluatePlanningUnitBudgetPressure()` from decomposition-core plus decomposition event types from `../events.js`.
- `test/bounded-planning-unit-execution.test.ts` — StubHarness tests for bounded planner/module-planner prompts, capture-only output conversion, compact handoff creation, budget diagnostics, event emission, and direct-path regressions.

### Modify
- `packages/engine/src/agents/planner.ts` — add optional bounded-unit context and capture-only submission options; inject bounded prompt context; use unit-local context guard limits and inspection budgets; write compact handoffs to unit artifact directories; suppress artifact writes and root completion events in capture-only mode; preserve direct behavior with bounded options omitted.
- `packages/engine/src/agents/module-planner.ts` — add optional bounded-unit context, upstream handoff context, capture-only `submit_module_plan` tool, unit-local compact inspection continuation for bounded mode, unit context guard wiring, and bounded prompt variables. Direct mode continues to use the existing file-writing prompt.
- `packages/engine/src/compile-resilience/planner-inspection.ts` — add unit artifact directory support to `writePlannerInspectionHandoffArtifact()`, allow source identifiers to carry unit IDs via existing bounded fields, expose a helper for byte-size/hash diagnostics on handoff artifacts, and keep existing direct handoff paths unchanged.
- `packages/engine/src/prompts/planner.md` — add an optional `{{bounded_unit_context}}` section immediately after the Source block so bounded runs state that the full root source/transcript is unavailable by design. Direct runs pass an empty string.
- `packages/engine/src/prompts/module-planner.md` — add an optional `{{bounded_unit_context}}` section after dependency module plans. In bounded mode the section names the `submit_module_plan` tool and forbids root source/transcript assumptions; direct runs pass an empty string.
- `test/planner-compact-continuation.test.ts` — add a regression asserting direct compact continuation still writes the default `planner-inspection-handoff.json` path and still includes the original direct source in synthesis prompts.
- `test/planner-context-guard.test.ts` — add bounded planner/module-planner prompt-guard tests that assert oversized unit prompts throw before harness invocation and that small unit prompts invoke the harness once.
- `test/prompts.test.ts` — update full-variable prompt rendering coverage if the new `bounded_unit_context` placeholders require explicit empty values in existing prompt tests.

### Shared File Notes
- `packages/engine/src/pipeline/stages/compile-stages.ts` is intentionally not modified by this module. The next module, `compile-orchestration-synthesis`, owns the post-composer strategy branch and controller call sites. If implementation discovers unavoidable bounded option threading through existing helper signatures in this shared file, constrain edits to `[region: bounded-agent-execution, helper signatures/options that pass bounded source slices and compact handoffs into planner-family agents]` and do not touch the strategy branch.

## Detailed Function Contracts

### `BoundedPlanningPromptContext`

Add a shared context shape in `bounded-planning-context.ts`:

```ts
interface BoundedPlanningPromptContext {
  unit: PlanningDecompositionUnit;
  unitSourceContent: string;
  sourceHash: string;
  upstreamOutputs: PlanningUnitOutput[];
  upstreamCompactHandoffRefs: string[];
  budgets: PlanningUnitBudget;
  artifactDir: string;
  submitToolName?: string;
}
```

`formatBoundedPlanningPromptContext(context)` must produce markdown containing:
- Unit ID, parent ID, depth, dependencies, interface constraints, and shared-file constraints.
- Covered and unresolved criteria IDs with bounded evidence.
- Subsystem hints.
- Source slice summaries plus the bounded unit source content.
- Budget limits and local exploration cap.
- Upstream compact handoff refs and bounded upstream output summaries.
- An explicit statement that root source, root transcript, and full prior tool results are unavailable.

The helper must reject prompt fragments containing fields named `rawSource`, `sourceContent`, `prompt`, `transcript`, or `rawTranscript` when those fields come from upstream JSON objects rather than the current unit source string.

### `runPlanner()` bounded options

Add optional planner options:

```ts
interface PlannerBoundedCaptureOptions {
  mode: 'capture-only';
  unitId: string;
  artifactDir: string;
  onPlanSetSubmission?: (payload: PlanSetSubmission) => void;
  onArchitectureSubmission?: (payload: ArchitectureSubmission) => void;
}
```

When `boundedUnit` and capture-only mode are present:
- `source` and `promptSourceContent` are the unit source, not `ctx.sourceContent`.
- `bounded_unit_context` is rendered into the prompt.
- Harness tool preset is `read-only` for inspection and synthesis calls; custom submission tools remain available.
- Existing plan-set/architecture validators run before capture callbacks fire.
- `writePlanSet()` and `writeArchitecture()` are not called.
- Root `planning:complete` and `expedition:architecture:complete` are not emitted.
- Compact continuation uses unit source context and writes handoff files under `artifactDir`.

### `runModulePlanner()` bounded options

Add optional module-planner options:

```ts
interface ModulePlannerBoundedCaptureOptions {
  mode: 'capture-only';
  unitId: string;
  artifactDir: string;
  submitToolName?: 'submit_module_plan';
  onModulePlanSubmission: (payload: { markdown: string; buildConfigBlock?: string }) => void;
}
```

When bounded capture mode is present:
- `source` is the unit source plus bounded context, not the full root PRD.
- `dependencyPlans` is built from upstream output summaries and compact handoff refs, not concatenated full dependency plan files.
- The injected `submit_module_plan` custom tool captures module markdown and optional build config text.
- The harness uses `read-only` tools and custom submission; direct file writing is not required.
- Unit-local compact continuation is available once per bounded module-planner run and restarts with read-only tools plus the unit compact handoff.

### `runBoundedPlanningUnit()`

The facade input extends the architecture contract with explicit runner dependencies:

```ts
interface BoundedPlanningUnitInput {
  unit: PlanningDecompositionUnit;
  unitSourceContent: string;
  sourceHash: string;
  upstreamOutputs: PlanningUnitOutput[];
  upstreamCompactHandoffRefs: string[];
  budgets: PlanningUnitBudget;
  artifactDir: string;
  cwd: string;
  planSetName: string;
  pipelineScope: CompilePipelineScope;
  outputDir: string;
  baseBranch?: string;
  defaultBuild?: BuildStageSpec[];
  defaultReview?: ReviewProfileConfig;
  harness: AgentHarness;
  agentMode: 'planner' | 'module-planner';
  agentOptions: SdkPassthroughConfig & { maxTurns?: number };
  auto?: boolean;
  verbose?: boolean;
  abortController?: AbortController;
  onClarification?: (questions: ClarificationQuestion[]) => Promise<Record<string, string>>;
  emit: (event: EforgeEvent) => void | Promise<void>;
}
```

Return `PlanningUnitOutput` with:
- `unitId` equal to `unit.id`.
- `status` from captured success/failure.
- `coveredCriteria` from unit coverage and captured submission evidence.
- `discoveredFiles` from read/list tool calls and compact handoff relevant files.
- `sharedContractNotes` from upstream output summaries and unit constraint summaries.
- `moduleSuggestions` populated from captured architecture modules when `pipelineScope === 'expedition'`.
- `planSuggestions` populated from captured plan-set submissions or bounded module-plan markdown.
- `unresolvedRequirements` seeded from unit unresolved criteria plus capture failures.
- `compactHandoffRef` when unit compact continuation writes a handoff artifact.
- `synthesisNotes` describing the capture mode, submission type, and bounded source hash.
- `observedBudget` from `evaluatePlanningUnitBudgetPressure()`.

The facade emits:
- `planning:decomposition:unit:running` before the harness is invoked.
- `planning:decomposition:unit:progress` for prompt construction, compact continuation, submission capture, and failure messages.
- `planning:decomposition:budget` after prompt construction and after each agent run attempt.
- `planning:decomposition:compact-handoff` after a unit handoff artifact is written.
- `planning:decomposition:unit:completed` or `planning:decomposition:unit:failed` before returning or throwing.

It does not emit decomposition start, schedule, or synthesis-complete events.

## Testing Strategy

### Unit Tests
- Bounded prompt context formatting includes unit ID, criteria IDs, subsystem hints, dependencies, interface/shared-file constraints, budgets, upstream output summaries, and the unit source hash.
- Bounded prompt context formatting excludes a root-source sentinel when `unitSourceContent` omits that sentinel.
- Upstream handoff formatting caps included markdown at `maxCompactHandoffBytes` and keeps the handoff reference visible after capping.
- Capture-only planner mode accepts a valid plan-set submission, does not write `orchestration.yaml`, and returns `planSuggestions` with one captured plan.
- Capture-only planner mode accepts a valid architecture submission, does not write `architecture.md`, and returns `moduleSuggestions` with captured modules.
- Capture-only planner mode rejects an invalid submission through the existing schema/semantic validation path and returns a failed unit output with unresolved requirement evidence.
- Bounded module-planner mode injects `submit_module_plan`, captures markdown through the custom tool, and does not require a module file to exist on disk.
- Unit context guard throws before harness invocation when the rendered bounded prompt exceeds `budgets.maxPromptBytes`.
- Budget pressure collection records prompt bytes, prompt source bytes, observed input tokens, local exploration tool uses, compact handoff bytes, and triggered limit keys.
- Unit-local compact continuation writes a handoff artifact under the supplied unit artifact directory and emits `planning:decomposition:compact-handoff` with artifact reference, hash, byte size, and covered criteria.
- Unit-local compact continuation restarts with a synthesis prompt containing the unit source and compact handoff markdown while excluding an oversized raw tool-result sentinel.
- Direct `runPlanner()` compact continuation still writes the default plan-set handoff path and emits `planning:inspection-summary`.
- Direct `runModulePlanner()` without bounded options renders the existing source and does not inject `submit_module_plan`.

### Integration Tests
- Use `StubHarness` to run `runBoundedPlanningUnit()` with `agentMode: 'planner'` and verify the emitted decomposition event order: running, progress, budget, completed.
- Use `StubHarness` to run `runBoundedPlanningUnit()` with a soft-budget usage event followed by capture-only synthesis and verify two harness calls, read-only tools in both calls, one compact-handoff event, and a completed unit output.
- Use `StubHarness` to run a failed bounded unit and verify a failed unit lifecycle event plus a `PlanningUnitOutput` whose `status` is `failed` and whose `observedBudget.triggeredLimitKeys` contains the exceeded limit.
- Import `runBoundedPlanningUnit` from `@eforge-build/engine/agents/bounded-planning-unit` in tests to lock the public facade path for `compile-orchestration-synthesis`.

## Verification

- [ ] `runBoundedPlanningUnit()` with a unit containing `ac-001` and `ac-002` returns `coveredCriteria: ['ac-001', 'ac-002']` for a valid capture-only plan-set submission.
- [ ] A bounded planner prompt contains `Unit ID: unit-engine-contracts` and does not contain the root sentinel string `ROOT-SOURCE-SHOULD-NOT-APPEAR`.
- [ ] A bounded planner prompt contains `Full root source and full root transcript are unavailable by design`.
- [ ] Capture-only planner mode leaves `${outputDir}/${planSetName}/orchestration.yaml` absent after a valid plan-set submission.
- [ ] Capture-only expedition planner mode leaves `${outputDir}/${planSetName}/architecture.md` absent after a valid architecture submission.
- [ ] `runBoundedPlanningUnit()` with `pipelineScope: 'expedition'` returns `moduleSuggestions.length === capturedArchitecture.modules.length`.
- [ ] `runBoundedPlanningUnit()` with `pipelineScope: 'excursion'` returns `planSuggestions.length === capturedPlanSet.plans.length`.
- [ ] Bounded module-planner mode exposes a custom tool named `submit_module_plan` to the harness.
- [ ] Bounded module-planner mode returns a `planSuggestions` entry containing the submitted module markdown.
- [ ] A unit prompt exceeding `budgets.maxPromptBytes` rejects with `CompileScopeContextError` and the stub harness records zero calls.
- [ ] A bounded run with observed input tokens above `budgets.maxObservedInputTokens` emits `planning:decomposition:budget` with `triggeredLimitKeys` containing `maxObservedInputTokens`.
- [ ] A bounded run with more tool uses than `budgets.maxLocalExplorationToolUses` emits a unit compact handoff before a synthesis retry.
- [ ] The unit compact handoff artifact path contains `.decomposition/units/unit-engine-contracts/` or the configured unit artifact directory.
- [ ] The compact synthesis prompt contains `Planner Inspection Handoff` and does not contain the raw tool-result sentinel `RAW-TRANSCRIPT-SHOULD-NOT-APPEAR`.
- [ ] Bounded planner and bounded module-planner harness calls use `tools: 'read-only'`.
- [ ] Direct `runPlanner()` without bounded options still emits `planning:complete` for a valid plan-set submission.
- [ ] Direct `runModulePlanner()` without bounded options does not include `submit_module_plan` in `customTools`.
- [ ] `planning:decomposition:unit:running` is emitted before the first bounded harness `agent:start` event reaches the facade emitter.
- [ ] `planning:decomposition:unit:completed` is emitted after a captured valid submission and includes the unit ID.
- [ ] A bounded invalid submission emits `planning:decomposition:unit:failed` and returns or throws evidence containing the unit ID and at least one unresolved requirement.
- [ ] `pnpm test -- bounded-planning-unit-execution` exits 0.
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
