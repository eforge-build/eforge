---
id: plan-01-gap-close-runtime-and-fatal-stop
name: Fix Gap-Close Runtime Inheritance and Builder Stop Failures
branch: fix-gap-close-runtime-profile-inheritance-and-fatal-agent-stop-handling/plan-01-gap-close-runtime-and-fatal-stop
---

# Fix Gap-Close Runtime Inheritance and Builder Stop Failures

## Architecture Context

Gap-close is a continuation phase of a parent build session. Its first stage uses the `gap-closer` role to generate a synthetic remediation plan, but its second stage executes normal build roles through `runBuildPipeline`. Runtime selection for those build roles must use the parent session's full `AgentRuntimeRegistry`, not a singleton wrapper around the planning-tier gap-closer harness.

The builder agent currently handles thrown harness errors as build failures, but a harness can also yield an `agent:stop` event with `error` and then end the stream without throwing. That event path must be mapped to `plan:build:failed` when no successful builder result was emitted.

## Implementation

### Overview

Update gap-close orchestration to pass the parent `AgentRuntimeRegistry` into `runGapCloser` and use it in the synthetic `BuildStageContext`. Keep the `gap-closer` harness only for plan generation. Update `builderImplement` to detect a non-throwing builder `agent:stop.error` stream with no `agent:result`, emit `plan:build:failed`, and return before implementation completion. Update gap-close completion logic so any synthetic pipeline `plan:build:failed` event produces `gap_close:complete` with `passed: false`.

### Key Decisions

1. Extend `GapCloserContext.pipelineContext` with `agentRuntimes: AgentRuntimeRegistry` rather than adding a new profile resolution path. This reuses the same runtime contract already consumed by `BuildStageContext`.
2. Remove production use of `singletonRegistry(options.harness)` from `gap-closer.ts`. `singletonRegistry` remains available for tests and single-harness adapters outside production gap-close execution.
3. Treat builder `agent:stop.error` as a fatal implementation result only when no successful builder `agent:result` was observed. This targets the observed Pi configuration failure path without changing the existing post-result transient transport downgrade behavior for thrown errors.
4. Track `plan:build:failed` while iterating `runBuildPipeline(buildCtx)` instead of relying only on thrown errors. This preserves all pipeline events and makes gap-close pass/fail reflect non-throwing pipeline failures.

## Scope

### In Scope

- Gap-close runtime wiring in `packages/engine/src/eforge.ts` and `packages/engine/src/agents/gap-closer.ts`.
- Synthetic `BuildStageContext.agentRuntimes` construction for plan id `gap-close`.
- Builder handling for harness streams that yield `agent:stop` with `error` and no builder `agent:result`.
- Gap-close completion when the synthetic pipeline yields `plan:build:failed` without throwing.
- Unit tests for registry inheritance, builder non-throwing stop-error failure, and gap-close failed-event completion.

### Out of Scope

- New profile formats or tier-resolution precedence changes.
- Event schema changes; the existing `agent:stop.error` and `plan:build:failed` fields are sufficient.
- Changing non-builder agent wrappers unless required by TypeScript fallout from the in-scope changes.
- Documentation updates; this is an internal engine bugfix with no user-facing command or configuration change.

## Files

### Create

- None.

### Modify

- `packages/engine/src/eforge.ts` — pass the parent `agentRuntimes` registry into `runGapCloser` through the pipeline context while continuing to pass `agentRuntimes.forRole('gap-closer')` as the generation harness.
- `packages/engine/src/agents/gap-closer.ts` — import/use `AgentRuntimeRegistry` in `GapCloserContext`, remove `singletonRegistry` from synthetic build execution, set `buildCtx.agentRuntimes` to the inherited registry, and record whether `runBuildPipeline` yields `plan:build:failed` before emitting `gap_close:complete`.
- `packages/engine/src/agents/builder.ts` — record builder `agent:stop.error` events during the harness stream; after the stream, emit `plan:build:failed` and return when an error was recorded and no builder `agent:result` was recorded. Reuse `classifyAgentTerminalSubtype` for the optional `terminalSubtype` field.
- `test/gap-closer.test.ts` — update test helpers for the new registry field; add a mixed-registry inheritance test asserting `builder` and `review-fixer` resolve to the implementation harness, `reviewer` resolves to the review harness, and `evaluator` resolves to the evaluation harness; add a test where `runBuildPipeline` yields `plan:build:failed` and `gap_close:complete.passed` is `false`.
- `test/agent-wiring.test.ts` — add a `builderImplement` test using a harness that yields `agent:start` then `agent:stop` with `error` and returns without throwing or yielding `agent:result`; assert one `plan:build:failed` event and zero `plan:build:implement:complete` events.
- `test/pi-transport-resilience.test.ts` — adjust only if the new builder stop-error handling affects existing transient transport expectations; keep the post-result thrown transient close downgrade tests passing.

## Implementation Notes

- In `gap-closer.ts`, destructure `agentRuntimes` from `options.pipelineContext` and assign it directly in the synthetic `BuildStageContext`.
- In `eforge.ts`, add `agentRuntimes` to the `pipelineContext` object passed to `runGapCloser`.
- In the gap-close pipeline execution block, replace `yield* options.runBuildPipeline(buildCtx)` with a `for await` loop that yields each event and sets `sawBuildFailure = true` for `event.type === 'plan:build:failed'`. After the loop, emit `gap_close:complete` with `passed: false` and return when `sawBuildFailure` is true.
- Preserve existing AbortError behavior in both gap-close generation and synthetic build execution by rethrowing AbortError from catch blocks.
- In `builderImplement`, capture the stop error only for `event.type === 'agent:stop' && event.agent === 'builder' && event.error`. Continue yielding always-yielded agent events before returning a failure after stream completion.

## Verification

- [ ] `packages/engine/src/agents/gap-closer.ts` contains no production call to `singletonRegistry(options.harness)` for the synthetic build context.
- [ ] The new gap-close inheritance test observes the synthetic `BuildStageContext.agentRuntimes.forRoleResolved('builder')` harness as the inherited implementation harness, not the gap-closer harness.
- [ ] The new gap-close failed-event test emits `gap_close:complete` with `passed: false` after a non-throwing `plan:build:failed` from `runBuildPipeline`.
- [ ] The new builder stop-error test emits `plan:build:failed` with the stop error text and emits no `plan:build:implement:complete` event.
- [ ] Existing AbortError tests in `test/gap-closer.test.ts` continue to rethrow and emit no `gap_close:complete` event.
- [ ] `pnpm type-check` exits with status 0.
- [ ] `pnpm vitest run test/gap-closer.test.ts test/agent-wiring.test.ts test/pi-transport-resilience.test.ts test/agent-runtime-registry.test.ts` exits with status 0.