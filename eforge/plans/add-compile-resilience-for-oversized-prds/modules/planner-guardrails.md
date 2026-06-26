# Planner Guardrails

## Architecture Reference

This module implements the **planner-guardrails** portions of the architecture:

- **Module Responsibilities / planner-guardrails** — bounded planner tool-validation diagnostics plus prompt/live context guardrails around pipeline-composer, planner, and module-planner runs.
- **Shared Data Model / Bounded Validation Diagnostic** — engine helper functions return client-owned `BoundedValidationDiagnostic` wire-shaped data from `foundation-contracts`.
- **Integration Contracts Between Modules / Planner Guardrails and Diagnostics** — planner-family agents consume compacted source from `preflight-compaction`, validate planner submission tools with bounded diagnostics, and throw a typed context-budget stop when prompt bytes or live usage exceed configured limits.
- **Shared File Registry / Region Declarations** — non-overlapping edits in planner-family agents, compile stages, and pipeline context fields.

Key constraints from architecture:

- Validation failures for `submit_plan_set` and `submit_architecture` must not echo huge submitted arguments back to the model.
- Diagnostics must include schema path, expected type, received type, compact excerpt, payload byte length, SHA-256 hash, omitted bytes, truncation status, and a bounded message.
- Guard thresholds must be named constants/options so tests can assert deterministic boundaries.
- Prompt guardrails apply to pipeline-composer, planner, and module-planner prompts after all prompt append text is assembled and before `harness.run()` starts.
- Live context guardrails observe `agent:usage` events and stop through the scope/context failure path before a provider hard context-window failure.
- This module does not classify provider context-window strings, decide retry-as-expedition/decomposition eligibility, emit recovery sidecars, or validate persisted compile artifacts.
- Existing small and moderate PRD behavior must not change: prompts are not rewritten by this module, and defaults must not trip for normal planner runs.

## Scope

### In Scope

- Add reusable engine helper functions for bounded planner submission diagnostics.
- Replace planner `submit_plan_set` and `submit_architecture` validation-tool output with bounded diagnostics.
- Keep the existing `formatSubmissionValidationError(errors)` export as a compatibility wrapper for plan/architecture/cohesion reviewer tools that import it today.
- Add planner-family prompt guards for pipeline-composer, planner, and module-planner prompt byte budgets.
- Add planner-family live context guards for non-final `agent:usage` events.
- Add an engine-owned `CompileScopeContextError` bridge for proactive live-context guard stops with `source: 'live-context-guard'` and `failureKind: 'context-budget'`.
- Pass preflight risk and guard limits from `PipelineContext` into planner-family agent options.
- Add unit and stub integration tests for huge invalid planner tool payload diagnostics, prompt-budget stops, live usage stops, and unchanged normal runs.

### Out of Scope

- Client-owned schema/event definitions; `foundation-contracts` owns them.
- Source risk scoring, generated inventory detection, prompt source compaction, and prompt-source substitution; `preflight-compaction` owns them.
- Provider context-window/context-length string classification; `context-recovery` owns it.
- Emitting `planning:scope-context:failure`, retry-as-expedition, bounded decomposition, attempt caps, and recovery sidecars; `context-recovery` owns them.
- Final persisted-artifact validation and compile success gating; `artifact-validation` owns it.
- CLI, Console, daemon, Pi, or Claude plugin rendering changes; `surfaces-docs` owns rendering if later needed.
- Adding user-facing config keys for guard thresholds. Tests use explicit engine/helper options rather than config-file knobs.

## Implementation Approach

### Overview

Create two focused engine helper modules under `packages/engine/src/compile-resilience/`:

1. `diagnostics.ts` formats bounded validation diagnostics for planner custom tools. The helper computes a deterministic JSON payload byte count and SHA-256 hash, identifies the failing schema/logical path, derives expected and received type summaries, caps excerpts, and returns both a structured `BoundedValidationDiagnostic` and its bounded message string.
2. `context-guard.ts` owns prompt/live context budget tracking for planner-family agents. It exposes named default limits, a `CompileScopeContextError`, and a small guard object used by `composePipeline`, `runPlanner`, and `runModulePlanner`.

Planner custom-tool handlers call the diagnostic helper for both TypeBox schema failures and post-parse semantic validation failures. Agent runners construct a guard from optional agent options, check prompt byte size after prompt construction, and observe non-final `agent:usage` events while streaming harness events.

The compile stage does not inspect raw provider payloads. It only passes `ctx.compilePreflight`, optional `ctx.compileContextGuardLimits`, and the stage name into planner-family agent options. When the guard throws, existing `withRetry` treats the error as non-agent-terminal and rethrows. The downstream `context-recovery` module catches `CompileScopeContextError`, enriches artifact/recovery metadata if needed, emits `planning:scope-context:failure`, and decides recovery guidance.

### Key Decisions

1. **Bound diagnostics inside custom-tool handlers.**  
   The model receives the handler string directly, so bounding must happen before Claude/Pi sees the tool result. Event-stream truncation alone is not sufficient.

2. **Use one helper for schema and semantic validation failures.**  
   TypeBox parse errors and cross-field validation errors both become `BoundedValidationDiagnostic` messages. TypeBox failures derive expected type from the submitted schema at the error path; semantic failures use the logical path and a domain expected type such as `valid plan-set submission`.

3. **Report one primary diagnostic plus omitted-error count.**  
   A huge invalid `submit_plan_set` payload can generate many schema errors. The tool result uses the first deterministic error as the primary diagnostic and appends `additionalErrors=N` inside the bounded message when more errors exist.

4. **Keep reviewer tool compatibility.**  
   `plan-reviewer`, `architecture-reviewer`, and `cohesion-reviewer` import `formatSubmissionValidationError(errors)` from `planner.ts`. That export remains available. Planner submission tools use the new payload-aware formatter so they include payload length/hash and avoid raw echo.

5. **Guard defaults are conservative and option-overridable.**  
   Defaults are high enough that small/moderate PRDs do not stop. Tests pass low `CompileContextGuardLimits` through direct agent options or a constructed `PipelineContext`.

6. **Guard final usage does not convert completed runs into failures.**  
   The guard records `agent:usage` events with `final: true` but only throws on prompt checks and non-final live usage events. This avoids failing after an agent has already reached a successful result.

7. **Throw typed engine errors, not agent terminal errors.**  
   Context-budget stops are compile-scope failures, not SDK terminal failures. `CompileScopeContextError` intentionally does not extend `AgentTerminalError`, so planner max-turns/transport continuation policies do not retry it as an agent failure.

8. **Use schema-valid but non-final recovery metadata in guard errors.**  
   `CompileScopeContextError.failure` is a `CompileScopeContextFailure` so downstream modules can consume one shape. The guard fills recovery/artifact fields with bounded placeholders and the preflight recommendation when present; `context-recovery` later owns eligibility, attempts, artifact summaries, event emission, and sidecar data.

### Helper Contracts

Keep the helper contracts close to the architecture contracts and engine-only:

```ts
// --- eforge:region plan-03-planner-guardrails ---
export interface PlannerToolValidationDiagnosticInput {
  toolName: 'submit_plan_set' | 'submit_architecture' | string;
  schemaPath: string;
  expectedType: string;
  receivedValue: unknown;
  fullPayload: unknown;
  additionalErrorCount?: number;
  options?: Partial<BoundedDiagnosticOptions>;
}

export function formatPlannerToolValidationDiagnostic(
  input: PlannerToolValidationDiagnosticInput,
): BoundedValidationDiagnostic;

export function formatPlannerToolSchemaValidationError(input: {
  toolName: string;
  schema: TSchema;
  errors: readonly ValueError[];
  fullPayload: unknown;
  options?: Partial<BoundedDiagnosticOptions>;
}): string;

export interface CompileContextGuardLimits {
  maxPromptBytes: number;
  maxObservedInputTokens: number;
  maxObservedTurns?: number;
  maxExplanationBytes: number;
}

export interface CompileContextGuardOptions {
  stage: 'pipeline-composer' | 'planner' | 'module-planner';
  risk?: CompilePreflightRisk;
  limits?: Partial<CompileContextGuardLimits>;
}

export class CompileScopeContextError extends Error {
  readonly failure: CompileScopeContextFailure;
}

export function createCompileContextGuard(
  options?: CompileContextGuardOptions,
): {
  assertPrompt(prompt: string): void;
  observe(event: EforgeEvent): void;
};
// --- eforge:endregion plan-03-planner-guardrails ---
```

The final code may split schema-specific helper names differently, but it must keep a payload-aware public formatter and a guard constructor exported for tests and downstream recovery code.

### Diagnostic Formatting Details

- Compute payload text with JSON serialization and use `Buffer.byteLength(payloadText, 'utf8')` for `payloadBytes`.
- Compute `payloadSha256` from the serialized submitted argument object using lowercase hex SHA-256.
- Convert JSON-pointer paths such as `/plans/0/body` to dot paths such as `plans.0.body`; use `(root)` for an empty path.
- Look up `receivedValue` from `fullPayload` by JSON-pointer path for TypeBox failures.
- Derive `expectedType` from the TypeBox node at the JSON-pointer path when available; fall back to the TypeBox error message when traversal cannot resolve the node.
- Summarize received values without raw bulk:
  - primitives below `maxExcerptBytes` can include a capped excerpt;
  - long strings become `string(<bytes> bytes, sha256=<hash>, excerpt=<prefix>)` with the prefix capped;
  - arrays become `array(length=<n>, firstTypes=[...])`;
  - objects become `object(keys=<n>, sampleKeys=[...])`.
- Cap the final message by UTF-8 bytes to `maxMessageBytes` and set `truncated: true` plus `omittedBytes > 0` when truncation occurs.
- Include the standing planner instruction lines in the bounded message: the payload was rejected, fix the issue, and call the submission tool again rather than Write.

### Context Guard Details

- Prompt checks run after `loadPrompt()` and after all prompt append/retry text is included.
- `assertPrompt(prompt)` compares UTF-8 prompt bytes against `maxPromptBytes` and throws before `harness.run()` starts.
- `observe(event)` only inspects `agent:usage` for the matching planner-family agent run.
- Non-final usage events update an observed cumulative snapshot and throw when observed input-token budget or turn budget crosses a threshold.
- Final usage events update the snapshot but do not throw.
- Claude SDK `task_progress` events sometimes report `usage.total` with `usage.input === 0`; the guard uses `usage.input` when positive and falls back to `usage.total` for budget comparison in that case.
- Pi emits per-turn non-final deltas; the guard accumulates deltas.
- Explanations are capped to `maxExplanationBytes` and include stage, prompt bytes, observed token/turn counts, risk level/score when present, and recovery action from preflight risk when present.
- If an `AbortController` is available in the agent options, the agent runner aborts it immediately before throwing the guard error.

## Files

### Create

- `packages/engine/src/compile-resilience/diagnostics.ts` — payload hashing, UTF-8 byte caps, JSON-pointer lookup, schema expected-type derivation, received-value summarization, and bounded planner tool diagnostic formatting.
- `packages/engine/src/compile-resilience/context-guard.ts` — named guard limits, `CompileScopeContextError`, schema-valid live-context failure construction, prompt byte checks, usage-event observation, and guard option helpers.
- `test/planner-guardrails-diagnostics.test.ts` — unit and stub-agent tests for bounded planner custom-tool diagnostics.
- `test/planner-context-guard.test.ts` — unit and stub-agent tests for prompt and live usage context guardrails.

### Modify

- `packages/engine/src/agents/planner.ts` — add optional `contextGuard?: CompileContextGuardOptions` to `PlannerOptions`, keep the existing compatibility `formatSubmissionValidationError(errors)` export, replace `submit_plan_set`/`submit_architecture` schema and semantic validation output with bounded diagnostics, check prompt bytes before each planner harness run, and observe non-final `agent:usage` events during the harness loop `[region: planner-guardrails, PlannerOptions guard field, validation formatter block, submission-tool handlers, and harness.run loop guard calls; do not edit preflight-owned prompt-source substitution]`.
- `packages/engine/src/agents/pipeline-composer.ts` — add optional `contextGuard?: CompileContextGuardOptions`, check the fully assembled composer prompt before `harness.run()`, and observe non-final `agent:usage` events in the composer harness loop `[region: planner-guardrails, PipelineComposerOptions guard field plus prompt/context guard calls around the existing prompt retry loop; do not edit preflight-owned source substitution]`.
- `packages/engine/src/agents/module-planner.ts` — add optional `contextGuard?: CompileContextGuardOptions`, check the fully assembled module-planner prompt before `harness.run()`, and observe non-final `agent:usage` events in the module-planner harness loop `[region: planner-guardrails, ModulePlannerOptions guard field plus prompt/context guard calls; do not edit preflight-owned source substitution]`.
- `packages/engine/src/pipeline/types.ts` — add optional `compileContextGuardLimits?: Partial<CompileContextGuardLimits>` to `PipelineContext` for tests/future engine callers that need deterministic guard thresholds `[region: planner-guardrails, after preflight-compaction compile-preflight fields and before mutable state fields]`.
- `packages/engine/src/pipeline/stages/compile-stages.ts` — import the context-guard option helper and pass guard options to `composePipeline`, `runPlanner`, and `runModulePlanner` using `ctx.compilePreflight` and `ctx.compileContextGuardLimits` `[region: planner-guardrails, import section plus composerOptions, runPlannerAttempt options, and runModulePlannerAttempt options; do not alter context-recovery retry/escalation blocks]`.

## Testing Strategy

### Unit Tests

Add `test/planner-guardrails-diagnostics.test.ts` cases for:

- `formatPlannerToolValidationDiagnostic()` returns a message below `DEFAULT_BOUNDED_DIAGNOSTIC_OPTIONS.maxMessageBytes` for a large object containing a multi-hundred-KB plan body.
- The diagnostic includes `schemaPath`, `expectedType`, `receivedType`, `payloadBytes`, a 64-character lowercase hex `payloadSha256`, `omittedBytes`, `truncated`, and an excerpt summary.
- The diagnostic message excludes a sentinel string placed beyond the allowed excerpt window in the huge submitted plan body.
- `formatPlannerToolSchemaValidationError()` converts `/plans/0/body` to `plans.0.body` and reports the received value type from the payload at that path.
- Semantic validation errors from `validatePlanSetSubmission()` use logical paths such as `orchestration.plans` and include payload hash/length details.

Add `test/planner-context-guard.test.ts` unit cases for:

- `createCompileContextGuard({ limits: { maxPromptBytes: N } }).assertPrompt(prompt)` throws `CompileScopeContextError` when `Buffer.byteLength(prompt) > N`.
- The thrown error contains `failure.source === 'live-context-guard'`, `failure.failureKind === 'context-budget'`, the configured stage, `observed.promptBytes`, and an explanation below `maxExplanationBytes`.
- Non-final `agent:usage` deltas accumulate and throw when the input-token budget is crossed.
- A non-final usage event with `usage.input === 0` and `usage.total > limit` throws using total tokens as the input-budget fallback.
- A final `agent:usage` event above the threshold records observed usage but does not throw.
- A normal small prompt with no usage over the threshold completes `assertPrompt()` and `observe()` without throwing.

### Integration / Stub Tests

Use `StubHarness` or a small local harness implementing `AgentHarness`:

- `runPlanner()` with a deliberately huge invalid `submit_plan_set` tool call yields an `agent:tool_result` whose output is below the configured diagnostic cap, contains schema path/type/hash/length fields, and does not contain the raw sentinel payload.
- `runPlanner()` with a prompt threshold lower than the assembled prompt bytes throws `CompileScopeContextError` before the stub harness records any call.
- `composePipeline()` with a harness that emits a non-final `agent:usage` over the guard threshold throws `CompileScopeContextError` with `failure.stage === 'pipeline-composer'` and a bounded explanation.
- `runModulePlanner()` with default guard limits and a small source prompt records the exact prompt in the harness and completes without a guard error.
- A planner run with a small valid `submit_plan_set` payload still writes plan files and emits `planning:complete` when no guard threshold is crossed.

## Verification

- [ ] A huge invalid `submit_plan_set` payload produces an `agent:tool_result.output` length less than or equal to the configured maximum diagnostic bytes.
- [ ] The same diagnostic output contains `schemaPath=`, `expectedType=`, `receivedType=`, `payloadBytes=`, and `payloadSha256=` fields.
- [ ] The same diagnostic output omits the sentinel string placed inside the raw oversized plan body beyond the excerpt window.
- [ ] The diagnostic helper returns a `payloadSha256` matching `/^[a-f0-9]{64}$/`.
- [ ] Schema path `/plans/0/body` renders as `plans.0.body` in the diagnostic message.
- [ ] A semantic plan-set validation failure includes the logical path from `validatePlanSetSubmission()` and the full submitted payload hash.
- [ ] `runPlanner()` uses bounded diagnostics for both TypeBox parse errors and post-parse `validatePlanSetSubmission()` errors.
- [ ] `runPlanner()` uses bounded diagnostics for both TypeBox parse errors and post-parse `validateArchitectureSubmission()` errors.
- [ ] A prompt byte limit below the assembled planner prompt throws `CompileScopeContextError` before `StubHarness.calls.length` increases above `0`.
- [ ] A prompt byte limit below the assembled pipeline-composer prompt throws `CompileScopeContextError` before `StubHarness.calls.length` increases above `0`.
- [ ] A prompt byte limit below the assembled module-planner prompt throws `CompileScopeContextError` before `StubHarness.calls.length` increases above `0`.
- [ ] A non-final `agent:usage` event whose effective input tokens exceed the limit throws `CompileScopeContextError` with `failure.observed.inputTokens` greater than the limit.
- [ ] A final `agent:usage` event whose input tokens exceed the limit does not throw from `observe()`.
- [ ] The thrown guard error explanation byte length is less than or equal to `maxExplanationBytes`.
- [ ] The thrown guard error includes `failure.risk.level` when the guard received a preflight risk value.
- [ ] The thrown guard error includes a non-`none` recovery action when preflight risk supplied one.
- [ ] Default guard limits allow the existing small planner stub fixture to emit `planning:complete`.
- [ ] Default guard limits leave the prompt string recorded by `StubHarness.prompts[0]` unchanged for a small source fixture.
- [ ] `packages/engine/src/pipeline/stages/compile-stages.ts` remains at or below its `613` line no-growth ceiling.
- [ ] New implementation files remain at or below `600` lines.
- [ ] New test files remain at or below `1,200` lines.
- [ ] `pnpm test -- test/planner-guardrails-diagnostics.test.ts test/planner-context-guard.test.ts` exits `0`.
- [ ] `pnpm type-check` exits `0`.
- [ ] `pnpm maintainability:check` exits `0`.

<build-config>
{
  "build": ["implement", "test-cycle", "review-cycle"],
  "review": {
    "strategy": "auto",
    "perspectives": ["code", "test"],
    "maxRounds": 1,
    "evaluatorStrictness": "standard"
  }
}
</build-config>
