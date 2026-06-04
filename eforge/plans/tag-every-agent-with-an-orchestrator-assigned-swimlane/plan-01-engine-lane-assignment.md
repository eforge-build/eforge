---
id: plan-01-engine-lane-assignment
name: "Engine: assign orchestrator-phase lane ids to plan-less agents"
branch: tag-every-agent-with-an-orchestrator-assigned-swimlane/plan-01-engine-lane-assignment
agents:
  builder:
    effort: high
    rationale: Threads a lane param through 5 planning agents, the validation-fixer
      and prd-validator wiring, and two closure type signatures across
      orchestrator.ts/phases.ts/eforge.ts/prd-validation-wiring.ts. Many small
      coordinated edits with a pre/post-gap-close discrimination that must be
      wired at the exact call sites where ctx.gapClosePerformed is in scope; a
      missed site silently leaves an agent unlabeled.
---

# Engine: assign orchestrator-phase lane ids to plan-less agents

## Architecture Context

Swimlanes in the UI are keyed by the agent-event `planId` field. The harness `run(options, agentRole, planId?)` forwards its 3rd arg onto every emitted agent event (`harnesses/common.ts:71`, `claude-sdk.ts:212`, `pi.ts:452`). The gap-closer already exploits this by passing `planId: 'gap-close'` (`agents/gap-closer.ts:140`), which the UI renders as a dynamic lane. Plan-less orchestrator agents (planning + validation) currently pass NO 3rd arg, so their events carry `planId: undefined` and collapse into the UI's catch-all `__global__` bucket (which also hosts the PRD pill, causing validation to visually "re-light" PRD).

This plan populates the existing `planId` carrier on those agent events. **No wire-schema change**: `events.schemas.ts:713` already types agent-event `planId` as a free-form optional string. `mutateState`/`transitionPlan` drive plan accounting exclusively from dedicated lifecycle events (`plan:status:change`, `merge:worktree:*`), never from agent-event `planId` — confirmed by code inspection — so synthetic lane ids cannot corrupt plan state, worktrees, or completion accounting. `DAEMON_API_VERSION` does NOT bump.

Lane-id assignment per agent:
- Planning agents (pipeline-composer, planner, plan-reviewer, module-planner, dependency-detector) -> `'planning'`
- validation-fixer + prd-validator, pre-gap-close (`!ctx.gapClosePerformed`) -> `'validation'`
- validation-fixer + prd-validator, post-gap-close (`ctx.gapClosePerformed`) -> `'final-validation'`
- gap-closer -> `'gap-close'` (already correct, no change)

## Implementation

### Overview

Add an optional `lane?: string` to each plan-less agent's options interface and forward it as the 3rd arg of `harness.run(...)`, mirroring `agents/gap-closer.ts:140`. Wire `'planning'` at the planning-agent invocation sites. Extend the `ValidationFixer` and `PrdValidator` closure types with a trailing `lane` parameter, and pass `ctx.gapClosePerformed ? 'final-validation' : 'validation'` at the `validate`/`prdValidate` call sites where the flag is in scope.

### Key Decisions

1. **Reuse the `planId` carrier; do NOT rename to `lane`.** It already carries non-plan lane values (`gap-close`). A wire rename would touch every agent event variant + handlers + monitor persistence for marginal clarity. The new lane ids are passed positionally as the harness `run` 3rd arg, exactly like gap-closer.
2. **Pre/post discrimination via `ctx.gapClosePerformed`.** Confirmed against `orchestrator.ts:266-274`: `validate`+`prdValidate` run once with `gapClosePerformed === false`, then (only when gap-close happened) a second time with `gapClosePerformed === true`. Pass the lane from the orchestrator/phases call sites, not reconstructed in the UI.
3. **Thread lane through the existing closure signatures.** `ValidationFixer`/`PrdValidator` (`orchestrator.ts:48-64`) gain a trailing `lane?: string` param; `phases.ts` supplies it; `eforge.ts` closures (two sites: ~765 and ~2810) and `prd-validation-wiring.ts` forward it to the agent run-fn's 3rd harness arg.

## Scope

### In Scope
- Add `lane?: string` to the options interface of: pipeline-composer, planner, plan-reviewer, module-planner, dependency-detector, validation-fixer (`runValidationFixer`), and prd-validator (`runPrdValidator`); each forwards it as the `harness.run` 3rd arg.
- Wire `'planning'` at every planning-agent invocation site: planner (`runPlanner`, `compile-stages.ts:54`), pipeline-composer (`composePipeline`, `compile-stages.ts:242`), plan-reviewer (`runPlanReview`, `compile-stages.ts:318`), and module-planner (`runModulePlanner`, `compile-stages.ts:161`) all live in `packages/engine/src/pipeline/stages/compile-stages.ts`; dependency-detector at `eforge.ts:567`.
- Extend `ValidationFixer` and `PrdValidator` types (`orchestrator.ts`) with a trailing `lane` param; update `phases.ts` `validate` (`:697`) and `prdValidate` (`:785`) call sites to pass `ctx.gapClosePerformed ? 'final-validation' : 'validation'`.
- Update both `validationFixer` closures in `eforge.ts` (~765, ~2810) and `createPrdValidator` in `prd-validation-wiring.ts` to accept and forward the lane.
- Engine tests asserting the lane id on `agent:start` events for each agent class.

### Out of Scope
- Any console-ui rendering (plan-02).
- Renaming the wire field `planId` -> `lane`.
- Changing validation/gap-close engine behavior, ordering, or retry logic (display-only).
- `events.schemas.ts` / `DAEMON_API_VERSION` (no change).

## Files

### Modify
- `packages/engine/src/agents/pipeline-composer.ts` — add `lane?: string` to options; pass as 3rd arg of `harness.run(..., 'pipeline-composer', options.lane)` (~:133-142).
- `packages/engine/src/agents/planner.ts` — add `lane?: string`; pass as 3rd arg (~:284-286).
- `packages/engine/src/agents/plan-reviewer.ts` — add `lane?: string`; pass as 3rd arg (~:109-120).
- `packages/engine/src/agents/module-planner.ts` — add `lane?: string`; pass as 3rd arg (~:51-53).
- `packages/engine/src/agents/dependency-detector.ts` — add `lane?: string`; pass as 3rd arg of the `harness.run(..., 'dependency-detector', options.lane)` call (~:78-81).
- `packages/engine/src/agents/validation-fixer.ts` — add `lane?: string` to `ValidationFixerOptions`; pass `options.lane` as 3rd arg in `runValidationFixer` (~:55-65). Leave `runValidationRepairFixer` (already passes `options.planId`) unchanged.
- `packages/engine/src/agents/prd-validator.ts` — add `lane?: string` to its options; forward as the `harness.run` 3rd arg.
- `packages/engine/src/orchestrator.ts` — add a trailing `lane?: string` param to the `ValidationFixer` (`:48`) and `PrdValidator` (`:61`) function types.
- `packages/engine/src/orchestrator/phases.ts` — at the `validationFixer(...)` call in `validate` (`:697`) pass `ctx.gapClosePerformed ? 'final-validation' : 'validation'` as a new trailing arg; at the `prdValidator(...)` call in `prdValidate` (`:785`) pass the same discriminated lane.
- `packages/engine/src/pipeline/stages/compile-stages.ts` — wire `'planning'` at the planning-agent invocation sites: `runPlanner` (`:54`), `runModulePlanner` (`:161`), `composePipeline` (`:242`), and `runPlanReview` (`:318`); each passes `lane: 'planning'` into the agent's options (or as the positional 3rd `harness.run` arg, matching each agent's options shape).
- `packages/engine/src/eforge.ts` — update both `validationFixer` closures (`:765`, `:2810`) to accept the trailing `lane` arg and forward it into `runValidationFixer({ ..., lane })`; ensure `createPrdValidationWiring` (`:837`, `:2881`) produces a `prdValidator` that accepts and forwards `lane`; wire `'planning'` at the dependency-detector invocation site (`runDependencyDetector`, `:567`).
- `packages/engine/src/validation/prd-validation-wiring.ts` — thread `lane` through `createPrdValidator` (`:127`) into the `runPrdValidator({ ..., lane })` call (`:172`).

### Create
- `test/agent-lane-assignment.test.ts` — engine test (uses `StubHarness` from `test/stub-harness.ts`, grouped by logical unit) asserting `agent:start` `planId` values per agent class. Reuse helpers from `test/agent-wiring-helpers.ts` where applicable.

## Verification

- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm build` completes without errors.
- [ ] `pnpm test` exits 0.
- [ ] `pnpm maintainability:check` exits 0.
- [ ] A test asserts the `agent:start` events for pipeline-composer, planner, and plan-reviewer carry `planId: 'planning'`.
- [ ] A test asserts module-planner and dependency-detector `agent:start` events carry `planId: 'planning'`.
- [ ] A test asserts the prd-validator and validation-fixer `agent:start` events carry `planId: 'validation'` when `gapClosePerformed` is false at invocation.
- [ ] A test asserts the prd-validator and validation-fixer `agent:start` events carry `planId: 'final-validation'` when `gapClosePerformed` is true at invocation.
- [ ] A test asserts the gap-closer `agent:start` event still carries `planId: 'gap-close'`.
- [ ] `mutateState`/`transitionPlan` are not modified; plan-state accounting is unchanged (grep gate for `mutateState` single-entry-point still passes).