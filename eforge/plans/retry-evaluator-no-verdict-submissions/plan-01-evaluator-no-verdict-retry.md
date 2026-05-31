---
id: plan-01-evaluator-no-verdict-retry
name: Retry Build Evaluator No-Verdict Completions
branch: retry-evaluator-no-verdict-submissions/plan-01-evaluator-no-verdict-retry
agents:
  builder:
    effort: high
    rationale: The change is small but touches retry lifecycle control flow in
      oversized engine files and must preserve fail-closed safety.
  reviewer:
    effort: high
    rationale: Review must check that the retry trigger is typed, local to the build
      evaluator, and does not weaken evaluator enforcement.
  tester:
    effort: high
    rationale: Regression coverage must distinguish retry success, retry exhaustion,
      and non-retryable evaluator failures.
---

# Retry Build Evaluator No-Verdict Completions

## Architecture Context

Build review cycles use a strict separation between agents and the engine: the review fixer may leave candidate changes in the working tree, the evaluator judges an immutable `EvaluationSnapshot`, and the engine alone applies accepted verdicts and creates the evaluation commit. The current evaluator retry wrapper already preserves `evaluationSnapshot` through `buildEvaluatorContinuationInput(...)`, emits `agent:retry`, and emits `plan:build:evaluate:continuation`, but it only runs when an evaluator attempt terminates with a retryable subtype. A normal evaluator completion with `source: 'none'` and zero verdicts bypasses the retry wrapper and fails after `withRetry(...)` returns.

This plan converts that specific normal no-verdict completion into a typed internal retry signal before `withRetry(...)` returns. It keeps the signal scoped to build evaluator orchestration, does not add public event subtypes, and preserves the existing final no-verdict failure after the evaluator retry budget is exhausted.

## Implementation

### Overview

Add a narrow internal no-verdict marker for build evaluator attempts, throw it from `runEvaluatorAttempt(...)` when the evaluator completes normally with no structured/XML verdicts for a non-empty snapshot, and teach the evaluator retry policy to retry only that marker. The retry must reuse `buildEvaluatorContinuationInput(...)`, so the second attempt receives the original immutable `evaluationSnapshot` plus the continuation prompt context. After retry exhaustion, `evaluateStageInner(...)` must continue to restore the original builder commit state, keep candidate changes in the working tree for recovery, and emit the current no-verdict failure text with the candidate file list.

### Key Decisions

1. Use a typed internal signal such as `EvaluatorNoVerdictsError` plus an `isEvaluatorNoVerdictsError(...)` type guard instead of matching the human-facing `Evaluator produced no verdicts` message.
2. Classify the typed signal through an existing terminal subtype such as `error_during_execution` for the generic `withRetry(...)` contract, then let the evaluator policy `shouldRetry` predicate decide retryability from the typed error object.
3. Detect no-verdict completion close to `runEvaluatorAttempt(...)`, after `builderEvaluate(...)` returns, with a condition equivalent to: `!result.failed && result.source === 'none' && result.verdicts.length === 0 && input.evaluationSnapshot?.files.length > 0`.
4. Do not add a new `AgentTerminalSubtype`, client event schema variant, or broad result-value retry hook in `withRetry(...)`.
5. Keep planning/cohesion/architecture evaluator policies unchanged unless the implementation needs shared type definitions; only the build evaluator throws the no-verdict signal in this plan.

## Scope

### In Scope

- Retry one build evaluator no-verdict completion when the immutable evaluation snapshot contains candidate files.
- Preserve the original `EvaluationSnapshot` across the evaluator continuation.
- Emit existing `agent:retry` and `plan:build:evaluate:continuation` events for the no-verdict retry.
- Apply accepting verdicts and create the evaluation commit when the retry submits verdicts.
- Preserve no-verdict fail-closed behavior after both allowed evaluator attempts produce no verdicts.
- Preserve non-retryable evaluator backend failure behavior and candidate file reporting.
- Update regression coverage in `test/build-evaluator-enforcement.test.ts`.

### Out of Scope

- Matching retryability from user-facing error strings.
- Adding public event schema values or a new public terminal subtype.
- Adding generic result-value retry support to `withRetry(...)`.
- Extending no-verdict retries to planning, cohesion, or architecture evaluators.
- Documentation updates; this is an internal engine bugfix with no user-facing command/API change.

## Files

### Create

- None.

### Modify

- `packages/engine/src/retry.ts` — export a typed no-verdict signal/type guard, classify it for the retry wrapper without a public schema change, and add an evaluator-policy `shouldRetry` predicate that only matches the typed signal.
- `packages/engine/src/pipeline/stages/build-stages.ts` — import the signal, detect normal build evaluator no-verdict results in `runEvaluatorAttempt(...)`, throw the signal before the retry wrapper returns, and leave the existing final failure handling in `evaluateStageInner(...)` intact after retry exhaustion.
- `test/build-evaluator-enforcement.test.ts` — add a retry-success regression where the first evaluator response has no verdicts and the second calls `submit_evaluation_verdicts`; update no-verdict failure tests so they script two no-verdict evaluator attempts and assert candidate preservation after exhaustion.
- `test/retry.test.ts` — only modify if the retry helper/type guard is exported and needs direct policy coverage; keep the existing retryable subtype tests for `error_max_turns`, `error_transient_transport`, and `error_pi_tool_infrastructure` passing.

## Database Migration

None.

## Verification

- [ ] `pnpm maintainability:check` exits 0.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm exec vitest run test/build-evaluator-enforcement.test.ts test/retry.test.ts` exits 0.
- [ ] The retry-success regression emits exactly one `agent:retry` event with `agent: 'evaluator'`, `label: 'evaluator-continuation'`, and the current `planId`.
- [ ] The retry-success regression emits exactly one `plan:build:evaluate:continuation` event with the current `planId`.
- [ ] The retry-success regression emits `plan:build:evaluate:complete`, commits the accepted candidate file contents at `HEAD`, emits no `plan:build:failed`, and leaves `ctx.buildFailed` unset.
- [ ] The two-no-verdict exhaustion regression emits `plan:build:failed` with an error containing `Evaluator produced no verdicts`, keeps `HEAD` at the builder commit, and leaves the candidate review-fixer changes in the working tree.
- [ ] Non-retryable evaluator backend failure coverage observes no `agent:retry` event and a `plan:build:failed` error that contains the candidate file path.