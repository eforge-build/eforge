---
title: Downgrade Evaluator Late Transport Errors After Verdict Submission
created: 2026-06-01
---

# Downgrade Evaluator Late Transport Errors After Verdict Submission

## Problem / Motivation

This is a **bugfix / focused** change with high classification confidence. It addresses a concrete build failure where evaluator verdicts had already been submitted, but a late retryable transport error caused the plan to retry and then fail.

### Evidence and relevant code

- Backlog item `.eforge/backlog/items/backlog-2026-06-01-downgrade-evaluator-late-transport-errors-after-verdict-subm.md` records the failed resume run and the intended behavior.
- Monitor DB evidence for run `067e586f-4334-4374-aaee-16df73169019` confirms both evaluator attempts emitted `agent:result` with `resultText: "Verdicts submitted successfully."` immediately before `agent:stop` with `Backend error: WebSocket error`; the first attempt produced `agent:retry` with subtype `error_transient_transport`, and the second exhausted retry budget and emitted `plan:build:failed`.
- `packages/engine/src/agents/builder.ts` contains `builderEvaluate`. It stores structured verdicts through `createEvaluationTools(..., onSubmit)` and accumulates XML/result text, but its catch block returns `{ verdicts: [], source: 'none', failed: true }` whenever a classified terminal subtype is caught, even if structured verdicts or XML verdicts are already available.
- `packages/engine/src/pipeline/stages/build-stages.ts` treats a missing, failed, or empty evaluator result as a plan failure and formats the candidate-file list, which matches the observed failure message.
- `packages/engine/src/retry.ts` already retries evaluator `error_transient_transport` once through `DEFAULT_RETRY_POLICIES.evaluator`, but it has no evaluator-specific terminal-success condition after verdict submission.
- Existing analogous patterns exist: `builderImplement` downgrades retryable post-result infrastructure errors when the builder committed work and HEAD advanced; `runTester` preserves useful result text and warns on late non-abort errors.
- Existing tests cover normal structured evaluation tool submission in `test/agent-wiring.test.ts`, evaluator retry behavior in `test/retry.test.ts`, and tester late-error preservation in `test/tester-wiring.test.ts`. `test/stub-harness.ts` already supports `lateError`, so a regression test can model this failure cheaply.
- Roadmap alignment: this fits `docs/roadmap.md` under Kernel Resilience and Typed Recovery, especially resilient build-engine behavior and honest gates.

A build can fail after the evaluator has already submitted usable verdicts if the agent harness reports a late retryable transport or infrastructure error during shutdown. In the observed resume run `067e586f-4334-4374-aaee-16df73169019`, `plan-07-server-composition-coverage` had two evaluator attempts that each emitted `agent:result` with `resultText: "Verdicts submitted successfully."` and then `agent:stop` with `Backend error: WebSocket error`. The first attempt retried as `error_transient_transport`; the second exhausted the evaluator retry budget and caused `plan:build:failed` with candidate files left for evaluation.

The affected user is anyone relying on review-fix evaluation to accept/reject candidate changes during an eforge build. The failure turns an apparently authoritative evaluator verdict submission into a plan failure, wasting completed agent work and potentially losing salvageable review-fixer changes.

### Confirmed observed reproduction from persisted monitor events

1. Inspect `.eforge/monitor.db` for run `067e586f-4334-4374-aaee-16df73169019` and plan `plan-07-server-composition-coverage`.
2. Observe event `404923`: evaluator `agent:result` with `resultText: "Verdicts submitted successfully."`.
3. Observe event `404924`: same evaluator attempt emits `agent:stop` with `Backend error: WebSocket error`.
4. Observe event `404925`: engine emits `agent:retry` with subtype `error_transient_transport` and label `evaluator-continuation`.
5. Observe event `404989`: retry evaluator `agent:result` with `resultText: "Verdicts submitted successfully."`.
6. Observe event `404990`: retry evaluator emits `agent:stop` with `Backend error: WebSocket error`.
7. Observe event `404991`: engine emits `plan:build:failed` with `Backend error: WebSocket error Candidate files with uncommitted changes: ...`.

### Root cause

- `packages/engine/src/agents/builder.ts` stores structured evaluator verdicts in the local `structuredSubmission` variable through the `createEvaluationTools` callback.
- The same function appends streamed message text and `agent:result.resultText` into `fullText`, which is later parsed as XML fallback verdicts.
- If the harness throws while iterating, the `catch` block classifies the error and immediately emits `plan:build:failed` for terminal subtypes. It then returns `failed: true` with an empty verdict list.
- The catch block does not check whether `structuredSubmission` is already present or whether `fullText` already contains parseable verdict XML.
- `packages/engine/src/pipeline/stages/build-stages.ts` receives the failed/empty result from `withRetry`; after retry exhaustion it restores evaluator snapshot state and emits the formatted plan failure with candidate files.

## Goal

Preserve already-submitted evaluator verdicts when a late retryable infrastructure/transport error arrives after that verdict evidence is available. This should mirror existing late-result resilience patterns without weakening fail-closed behavior for pre-verdict evaluator failures.

## Approach

Implement the fix locally in evaluator result preservation rather than by expanding the general retry policy.

- Add a small helper inside or near `builderEvaluate` that builds a completed `BuilderEvaluationResult` from `structuredSubmission` or `parseEvaluationBlock(fullText)` only when at least one verdict exists.
- In `builderEvaluate`'s catch block, if `classifyAgentTerminalSubtype(err)` is `error_transient_transport` or `error_pi_tool_infrastructure` and completed evaluator verdicts exist, emit an `agent:warning` and return the completed result instead of emitting `plan:build:failed`.
- Preserve the existing fail-closed behavior when no verdicts exist, when the error subtype is not retryable infrastructure/transport, or when the only available content does not parse into verdicts.
- Prefer structured submissions over XML fallback exactly as the current success path does.
- Preserve validated evaluator judgments only after a real verdict submission.
- Do not convert pre-verdict transport failures into success.

### Minimal unit-level reproduction

1. Run `builderEvaluate` with an `evaluatorSnapshot` and a scripted `submit_evaluation_verdicts` tool call that covers the snapshot.
2. Configure the same scripted response with `lateError: new Error('Backend error: WebSocket error')` so the harness throws after `agent:result`.
3. Assert that `builderEvaluate` returns the structured verdicts instead of `{ failed: true, verdicts: [] }`.
4. Assert that a warning is emitted and no `plan:build:failed` event is emitted for the late retryable error.

A pipeline-level regression should verify the retry wrapper does not start a second evaluator attempt when the first attempt already has submitted verdicts and only then sees a late retryable transport error.

### Assumptions and validation

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| The observed failure was evaluator post-verdict late transport, not tester or builder behavior. | Queried `.eforge/monitor.db` for run `067e586f-4334-4374-aaee-16df73169019`; events `404923` and `404989` are evaluator `agent:result` with `Verdicts submitted successfully.`, events `404924` and `404990` are evaluator `agent:stop` with `Backend error: WebSocket error`, and event `404991` is `plan:build:failed`. | high | low | Re-run the same SQLite query or inspect the worker log `.eforge/worker-daemon-1780343462553-4adbdcae5c3e.log`. | Fix could target the wrong agent path. |
| `builderEvaluate` currently discards already-available verdicts on caught terminal subtype errors. | Read `packages/engine/src/agents/builder.ts`; the catch block emits `plan:build:failed` for classified terminal subtypes and returns `verdicts: []` without checking `structuredSubmission` or `fullText`. | high | low | Add a failing unit test with `StubHarness` `lateError` after a structured tool call. | Fix might not address the failing path. |
| Preserving verdicts is safe only when at least one valid structured or XML verdict exists. | Read `packages/engine/src/pipeline/stages/build-stages.ts`; downstream failure behavior is tied to `!result`, `result.failed`, or empty verdicts. Existing validation/application happens after `builderEvaluate` returns. | high | low | Ensure tests cover no-verdict late transport and successful verdict late transport separately. | A too-broad downgrade could mask genuine no-output evaluator failures. |
| `error_pi_tool_infrastructure` should be handled alongside `error_transient_transport`. | `packages/engine/src/retry.ts` groups both as retryable infrastructure subtypes, and builder post-result handling downgrades both transport and Pi tool infrastructure errors after committed work. | high | low | Add test coverage for one subtype directly and keep implementation predicate explicit for both retryable late infrastructure subtypes. | Pi harness late infrastructure errors would remain vulnerable if omitted. |
| No daemon/client wire schema change is needed for the warning event. | Existing `agent:warning` events already carry arbitrary `code` and `message`; analogous warning codes are used by builder, tester, planner, and pipeline-composer paths. | medium | low | Run `pnpm type-check` and targeted event schema tests if new warning fields are added. | A schema mismatch could break event validation or monitor rendering. |
| Direct evaluator wiring and retry tests are enough regression coverage. | Existing tests place `builderEvaluate` behavior in `test/agent-wiring.test.ts` and evaluator retry behavior in `test/retry.test.ts`; `test/stub-harness.ts` supports `lateError`. | high | low | Run targeted tests and add coverage in `test/pi-transport-resilience.test.ts` only if reviewers prefer transport-specific grouping. | Coverage might be placed inconsistently, increasing future maintenance cost. |

### Profile signal

Recommended profile: **Excursion**.

Rationale: this is a focused engine bugfix with clear targets and regression coverage, but it touches core evaluator/retry behavior where fail-open vs fail-closed semantics matter. It is not an Errand because preserving evaluator verdicts after late transport errors requires careful tests across `builderEvaluate` and retry behavior. It is not an Expedition because a single cohesive plan can cover the change without delegated module planning.

## Scope

### In scope

- `packages/engine/src/agents/builder.ts` for the evaluator late-error downgrade behavior.
- `test/agent-wiring.test.ts` for direct `builderEvaluate` tests around structured verdicts plus late transport errors.
- `test/retry.test.ts` for a retry-wrapper regression confirming no unnecessary continuation after a successful late-error downgrade.
- `test/pi-transport-resilience.test.ts` only if the project prefers transport-specific regression coverage there.
- Handling `error_transient_transport` and `error_pi_tool_infrastructure` as retryable late infrastructure subtypes after evaluator verdicts are available.
- Emitting an `agent:warning` when downgrading a late retryable evaluator transport or infrastructure error after verdict submission.
- Preserving structured `submit_evaluation_verdicts` verdicts over XML fallback when both are present.
- Preserving XML fallback verdicts when no structured submission exists and `parseEvaluationBlock(fullText)` yields at least one verdict.
- Keeping downstream evaluator failure behavior in `packages/engine/src/pipeline/stages/build-stages.ts` tied to missing, failed, or empty evaluator results.

### Out of scope

- General retry policy expansion.
- Converting pre-verdict transport failures into success.
- Converting no-output evaluator failures into success.
- Downgrading non-retryable evaluator terminal subtypes.
- Daemon/client wire schema changes for the warning event.

## Acceptance Criteria

- `builderEvaluate` returns submitted structured evaluator verdicts when `submit_evaluation_verdicts` succeeds and the harness subsequently throws `Backend error: WebSocket error`.
- `builderEvaluate` emits an `agent:warning` when it downgrades a late retryable evaluator transport or infrastructure error after verdict submission.
- `builderEvaluate` emits zero `plan:build:failed` events for a late retryable evaluator transport or infrastructure error after submitted verdicts are available.
- `builderEvaluate` continues to emit a `plan:build:failed` event for a retryable evaluator transport error when no structured verdict submission and no parseable XML verdicts are available.
- `builderEvaluate` continues to prefer structured `submit_evaluation_verdicts` verdicts over XML fallback text when both are present and a late retryable error occurs.
- The evaluator retry wrapper does not emit an `agent:retry` event when the first evaluator attempt submits valid verdicts and then reports a late retryable transport error.
- The evaluator retry wrapper does not start a second evaluator attempt when the first evaluator attempt submits valid verdicts and then reports a late retryable transport error.
- The evaluator retry wrapper still emits an `agent:retry` event when a retryable evaluator transport error occurs before any valid evaluator verdicts are available and unstaged changes remain.
- A `StubHarness` unit-level regression in `test/agent-wiring.test.ts` runs `builderEvaluate` with an `evaluatorSnapshot` and a scripted `submit_evaluation_verdicts` tool call that covers the snapshot.
- The `StubHarness` unit-level regression configures the scripted response with `lateError: new Error('Backend error: WebSocket error')` so the harness throws after `agent:result`.
- The `StubHarness` unit-level regression asserts that `builderEvaluate` returns the structured verdicts instead of `{ failed: true, verdicts: [] }`.
- The `StubHarness` unit-level regression asserts that a warning is emitted for the late retryable error.
- The `StubHarness` unit-level regression asserts that no `plan:build:failed` event is emitted for the late retryable error.
- A retry-wrapper regression in `test/retry.test.ts` verifies no unnecessary continuation after a successful late-error downgrade.
- `pnpm test -- test/agent-wiring.test.ts test/retry.test.ts` exits 0.
- `pnpm type-check` exits 0.
