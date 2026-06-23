---
id: plan-02-engine-item-audit-reducer
name: Engine Item Audit and Reducer Agents
branch: context-safe-backlog-curation-analysis/plan-02-engine-item-audit-reducer
agents:
  builder:
    effort: high
    rationale: Adds two strict agent runners, prompt contracts, bounded repair
      behavior, and shared submission tooling without changing the generic
      planner path.
  reviewer:
    effort: high
    rationale: Agent isolation, schema enforcement, and failure degradation need
      careful review against context-safety requirements.
---

# Engine Item Audit and Reducer Agents

## Architecture Context

The current engine agent entry point for extension planning tasks is `packages/engine/src/agents/extension-planning-task.ts`. It loads `eforge-plan-planning-draft.md`, injects a single `sourceText`, and accepts one `submit_eforge_plan_planning_result` call. Map/reduce curation needs two focused agent units:

- An isolated item audit agent that receives exactly one validated item packet and returns a compact finding.
- A reducer agent that receives only global summaries, dependency/recommendation summaries, and compact per-item outcomes, then submits the existing `EforgePlanPlanningDraftResult` shape.

## Implementation

### Overview

Add engine runners and prompts for backlog-curation item audits and final reduction. Reuse the planner runtime/model role for the first slice, but ensure item audit and reducer prompts run without repository tools so agent context is limited to the supplied packet or reducer input. Extract common strict submit/progress plumbing from the current extension planning task where reuse avoids drift.

### Key Decisions

1. Use the existing `planner` role for model/runtime resolution. Model routing specialization remains deferred.
2. Set `tools: "none"` for item-audit and reducer agent runs, with only the submit/progress custom tools injected. This prevents item audits from reading other backlog files or raw evidence from the repository.
3. Validate item findings with the shared client schema and explicit byte/count caps before accepting a submission.
4. Validate reducer submissions with the existing planning-result schema, then allow at most one bounded repair turn when the first reducer submission fails schema validation or a caller-supplied validation callback returns errors.
5. Return a bounded top-level `decision: "needs-input"` planning result after the single repair attempt fails, rather than looping or failing the whole daemon task.

## Scope

### In Scope

- Engine item-audit agent runner with strict submit tool.
- Engine reducer agent runner with strict planning-result submit tool.
- Shared helper for planning-result submit validation so the generic extension planning task and reducer use the same parser.
- Bounded single repair support for reducer validation errors.
- Prompts that encode closure authority rules, compact output requirements, no raw evidence, and existing result-shape compatibility.
- Engine tests with `StubHarness` for isolation, output validation, reducer input caps, repair, and abort propagation.

### Out of Scope

- Cache storage and lookup.
- Source bundle construction.
- Daemon orchestration across all packets.
- Apply-preview validation implementation; this plan exposes a reducer validation callback hook for the daemon integration plan.

## Files

### Create

- `packages/engine/src/agents/extension-planning-submit-tools.ts` — helper functions for creating planning-result submit tools, progress tools, sanitized progress updates, and bounded rejection messages used by both generic planning and the reducer.
- `packages/engine/src/agents/backlog-curation-map-reduce.ts` — exported item audit runner, reducer runner, reducer repair wrapper, bounded needs-input result helper, and utility functions for finding byte lengths and enforcing caps.
- `packages/engine/src/prompts/eforge-plan-backlog-curation-item-audit.md` — item audit prompt that consumes one item packet and emits a compact finding only.
- `packages/engine/src/prompts/eforge-plan-backlog-curation-reducer.md` — reducer prompt that consumes capped reducer input and emits the existing planning draft result shape.
- `test/extension-backlog-curation-map-reduce.test.ts` — direct engine runner tests using `StubHarness`.

### Modify

- `packages/engine/src/agents/extension-planning-task.ts` — move reusable submit/progress code into `extension-planning-submit-tools.ts` and keep the public `runEforgePlanPlanningDraftTask` behavior unchanged for ordinary planning tasks.
- `packages/engine/src/prompts/eforge-plan-planning-draft.md` — limit edits to references that would conflict with the new dedicated reducer prompt; keep generic backlog curation guidance available for legacy or non-map/reduce tasks.
- `test/extension-planning-task.test.ts` — adjust expectations only for helper extraction side effects; existing generic planning, curation draft acceptance, progress, and malformed-submission tests must continue to pass.

## Implementation Details

- `runBacklogCurationItemAuditTask` accepts a single validated packet object, prompt/runtime metadata, an abort controller, and an optional progress callback. It serializes only that packet into the prompt.
- The item audit submit tool rejects findings with mismatched `sourceFingerprint`, `itemId`, `packetHash`, `bodySha256`, prompt version, oversized JSON, excessive citations, excessive recommendation signals, excessive diagnostics, or unknown properties.
- Item audit failures surface as thrown errors from the runner. The monitor integration plan converts those errors into bounded per-item degraded outcomes.
- `runBacklogCurationReducerTask` accepts a capped reducer input object, requested output sections, optional validation callback, and bounded repair configuration.
- Reducer repair prompt input contains the same capped reducer input plus a capped list of validation errors; it does not include raw packets or raw evidence.
- The reducer submit tool preserves existing `backlogCurationDraft`, `recommendations`, top-level `needs-input`, skip, and needs-input semantics by returning `EforgePlanPlanningDraftResult`.
- Prompt tests must assert that item audit prompts contain the target item id and omit sentinel strings from unrelated item bodies/evidence.

## Verification

- [ ] Engine tests assert item audit agent prompts contain one packet and omit unrelated item body sentinel strings.
- [ ] Engine tests assert item audit runs use `tools: "none"` and include only the item finding submit tool plus telemetry tools.
- [ ] Engine tests assert invalid item findings are rejected by the submit tool and do not produce an accepted result.
- [ ] Engine tests assert reducer prompt input length is less than or equal to the reducer input cap.
- [ ] Engine tests assert reducer prompt input excludes raw `gitDelta`, raw `fullImplementationAudit`, and full item body sentinel strings.
- [ ] Engine tests assert a first invalid reducer submission triggers one repair run and a second invalid submission returns a bounded top-level needs-input result.
- [ ] Engine tests assert abort signals are passed to every harness run.
- [ ] Existing `test/extension-planning-task.test.ts` cases pass without changing the generic planner task output contract.
- [ ] `pnpm --filter @eforge-build/engine type-check` exits 0.
- [ ] `pnpm maintainability:check` exits 0.
