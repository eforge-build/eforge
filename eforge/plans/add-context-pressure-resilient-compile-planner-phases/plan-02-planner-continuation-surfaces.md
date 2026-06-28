---
id: plan-02-planner-continuation-surfaces
name: Compact Planner Continuation Integration and Surfaces
branch: add-context-pressure-resilient-compile-planner-phases/plan-02-planner-continuation-surfaces
agents:
  builder:
    effort: xhigh
    rationale: This plan integrates the state machine into planner orchestration,
      adds client-owned event schemas, and updates tests across engine, client,
      CLI, and Console surfaces.
  reviewer:
    effort: high
    rationale: Review must check event-shape ownership, retry-loop caps, and
      preservation of hard guard safety nets.
  tester:
    effort: high
    rationale: Regression coverage needs StubHarness-driven multi-call planner flows
      plus client and renderer validation.
---

# Compact Planner Continuation Integration and Surfaces

## Architecture Context

Plan 01 provides internal budget and handoff utilities. This plan wires them into the planner execution path as explicit preparation, bounded inspection, compact evidence capture, synthesis, and fallback phases. Public diagnostics remain owned by `@eforge-build/client`; consumers render shared typed events rather than re-declaring wire shapes.

## Implementation

### Overview

Add a one-shot compact-inspection continuation path to `runPlanner`. During the initial inspection run, the engine observes tool use, turn count, and soft context pressure below the hard guard. If pressure crosses the soft budget before any submission or skip, the engine aborts that inspection attempt, captures a compact summary artifact, emits a typed diagnostic event, and launches a fresh synthesis prompt containing the original normalized build source plus the compact inspection summary. The resumed synthesis uses tighter read-only tools, lower maxTurns, and explicit submission instructions.

### Key Decisions

1. Emit a new client-owned `planning:inspection-summary` event carrying the compact handoff, and extend `planning:continuation.reason` with `compact_inspection` for the automatic continuation attempt.
2. Cap compact continuation loops at one automatic compact attempt per planner invocation; retry policy must not rerun an unbounded inspection loop after a compact-synthesis dropped submission.
3. Preserve the existing oversized-prompt path: prompt hard-guard failures before planner tool use still fail through compile scope/context guidance and do not attempt compact inspection.
4. Use `tools: 'read-only'` plus a synthesis maxTurns cap for resumed synthesis while preserving custom submission tools.
5. Keep hard live-context failures, model-aware guard diagnostics, capped output reserve behavior, and provider context failure translation unchanged as final safety nets.

## Scope

### In Scope

- `runPlanner` phase/state-machine integration for preparation, bounded inspection, compact evidence capture, resumed synthesis, and fallback.
- Typed client schemas, public exports, event registry metadata, and wire-parity fixtures for the compact inspection summary event.
- Retry-policy guardrails that prevent repeated compact-inspection loops after a failed synthesis attempt.
- Recovery guidance text updates for planner context pressure with no artifacts, noting automatic compact-inspection continuation when available or exhausted.
- CLI and Console rendering for the typed compact inspection event.
- StubHarness-driven tests for prolonged inspection, soft pressure before the hard guard, compact evidence preservation, resumed synthesis, no full transcript replay, oversized prompt behavior, and the Fix Removed Queue Coverage Cleanup failure shape.

### Out of Scope

- Changing provider context-window sizes.
- Relaxing or removing the hard live-context guard.
- Wrapper-app scheduling or host workflow orchestration.
- Auto-drain behavior.
- Fixing the queue cleanup backlog item that exposed the planner failure.

## Files

### Create

- `test/planner-compact-continuation.test.ts` — StubHarness scenarios for high-turn/tool inspection, soft threshold handling, compact summary preservation, resumed synthesis prompt shape, tighter synthesis budgets, and successful `submit_plan_set` from synthesis.
- `test/fixtures/planner/fix-removed-queue-coverage-cleanup.md` — Bounded regression fixture representing the captured queue-coverage-cleanup planning shape without real provider calls.

### Modify

- `packages/engine/src/agents/planner.ts` — Add planner phases, soft pressure detection, compact summary emission/artifact writing, one-shot resumed synthesis, tighter synthesis tools/maxTurns, and explicit submit-objective prompt text.
- `packages/engine/src/pipeline/stages/compile-stages.ts` — Track emitted compact inspection summaries on `PipelineContext` and pass any needed budget overrides through planner attempts.
- `packages/engine/src/pipeline/types.ts` — Add optional compact planner inspection summary state for recovery diagnostics.
- `packages/engine/src/retry.ts` — Extend planner continuation reason typing/events and block generic dropped-submission retries after a compact-inspection continuation already ran.
- `packages/engine/src/compile-resilience/context-recovery.ts` — Update no-artifact planner context-pressure recovery reasons to mention compact-inspection continuation availability or exhaustion without replacing existing retry-as-expedition and bounded-decomposition safeguards.
- `packages/client/src/events/shared/compile-resilience.ts` — Add `PlannerInspectionSummarySchema`, budget diagnostics schema, bounded summary field schemas, and exported types.
- `packages/client/src/events/variants/session-planning.ts` — Add `planning:inspection-summary` and extend `planning:continuation.reason` with `compact_inspection`.
- `packages/client/src/events/root.ts` — Export compact inspection summary types and event aliases.
- `packages/client/src/events.ts` — Re-export compact inspection schemas and types from the public events facade.
- `packages/client/src/index.ts` — Re-export compact inspection schemas and types from the main client barrel.
- `packages/client/src/browser.ts` — Re-export compact inspection schemas and types from the browser-safe barrel.
- `packages/client/src/event-registry.ts` — Register concise metadata and summary for `planning:inspection-summary`.
- `packages/client/src/__tests__/events-wire-parity-valid-fixtures.ts` — Add a valid compact inspection event fixture.
- `packages/client/src/__tests__/compile-resilience-contracts.test.ts` — Validate parse/serialization, caps, exports, and registry summary for the new event/schema.
- `packages/eforge/src/cli/display.ts` — Render compact inspection summary events in the compile spinner flow.
- `packages/eforge/src/cli/compile-resilience-display.ts` — Add formatting helpers for compact inspection summaries and the new continuation reason label.
- `test/cli-display-render-event.test.ts` — Assert top-level CLI rendering for compact inspection summary events.
- `packages/console-ui/src/lib/compile-resilience-format.ts` — Add compact inspection summary/detail formatting helpers.
- `packages/console-ui/src/components/timeline/event-card.tsx` — Render compact inspection event summary and expandable details.
- `packages/console-ui/src/lib/run-state/handlers/index.ts` — Add the new event to ignored reducer events so exhaustiveness remains satisfied.
- `packages/console-ui/src/__tests__/compile-resilience-format.test.ts` — Assert summary/detail formatting for compact inspection summaries.
- `packages/console-ui/src/components/timeline/__tests__/event-card.test.ts` — Assert timeline rendering for compact inspection events.
- `test/stub-harness.ts` — Allow scripted responses to emit interleaved usage/progress/tool events before result while preserving existing behavior.
- `test/compile-context-recovery-engine.test.ts` — Add an integration case proving oversized initial prompts still use existing compile scope/context failure guidance and no compact inspection attempt occurs.

## Verification

- [ ] A StubHarness planner that emits repeated read/bash tool calls and usage below the hard guard emits `planning:inspection-summary` before any hard `CompileScopeContextError`.
- [ ] A StubHarness planner that stays below the soft input-token threshold but exceeds the inspection turn/tool budget captures a compact summary and resumes synthesis.
- [ ] The compact inspection summary event includes relevant files, observed facts, important findings, inferred implementation areas, unresolved questions, source/build context, budget diagnostics, and incomplete-inspection caveats.
- [ ] The resumed synthesis prompt contains the original normalized build source and a compact inspection summary section.
- [ ] The resumed synthesis prompt excludes the full inspection tool transcript and omits sentinel text placed beyond summary caps.
- [ ] The resumed synthesis call uses `tools: 'read-only'` and a lower maxTurns value than the initial inspection call.
- [ ] A valid `submit_plan_set` call during resumed synthesis writes plan files and emits `planning:complete`.
- [ ] A genuinely oversized prompt trips the existing prompt hard guard before harness execution and emits no compact inspection summary.
- [ ] The Fix Removed Queue Coverage Cleanup fixture test triggers soft pressure through bounded synthetic events and uses no real provider calls.
- [ ] `safeParseEforgeEvent` accepts valid compact inspection events and rejects oversized compact summary arrays.
- [ ] CLI and Console tests render compact inspection summaries from shared client types.
- [ ] Existing retry-as-expedition, bounded-decomposition, prompt-source compaction, model-aware guard diagnostics, capped output reserve, and provider context failure tests continue to pass.