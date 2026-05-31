---
title: Retry evaluator no-verdict submissions
created: 2026-05-31
---

# Retry evaluator no-verdict submissions

## Problem / Motivation

This is a **bugfix / focused** change with high confidence. It supports the roadmap's Integration & Maturity goal by improving lifecycle robustness and reducing avoidable manual recovery from agent contract misses.

The build evaluator can complete normally without submitting structured verdicts for review-fixer candidate changes. When this happens, eforge fails the plan closed after the evaluator attempt instead of retrying the evaluator once with the existing continuation mechanism.

Evidence from failed build `provider-encapsulated-stacked-landing-conflict-recovery`:

- Run `6a085433-530a-4e10-aef2-f38fe543e5e9` failed at `2026-05-31T23:11:05.770Z`.
- `plan-01-provider-recovery-foundation` implemented and tested successfully, including two test-complete events reporting `6570` passed and `0` failed.
- The review fixer changed `packages/engine/src/stacking/git-spice.ts`, `packages/engine/src/stacking/landing-conflict-recovery.ts`, and `packages/engine/src/stacking/provider-events.ts`.
- The second build evaluator inspected the candidate diffs but ended with agent result text `Evaluating captured fixes and submitting verdicts.` and did not call `submit_evaluation_verdicts`.
- The build failed closed with `Evaluator produced no verdicts; review-fixer changes remain uncommitted. Candidate files with uncommitted changes: ...`.
- `plan-02-landing-integration-docs` was blocked only because `plan-01-provider-recovery-foundation` failed.

Code evidence:

- `packages/engine/src/agents/builder.ts` returns `{ verdicts: [], source: 'none', failed: false }` when the evaluator exits normally without structured submission or parseable XML verdicts.
- `packages/engine/src/pipeline/stages/build-stages.ts` wraps evaluator attempts with `withRetry(...)`, but after the wrapper returns it fails closed when `!result || result.failed || result.verdicts.length === 0`.
- `packages/engine/src/retry.ts` already has an evaluator retry policy with `maxAttempts: 2`, continuation events, and `buildEvaluatorContinuationInput(...)` that preserves the immutable `evaluationSnapshot`.
- `withRetry(...)` currently retries on retryable terminal subtypes or policy `shouldRetry`; normal completion with empty verdicts is not classified as retryable.
- `test/build-evaluator-enforcement.test.ts` already asserts current fail-closed no-verdict behavior and is the natural regression-test location.

Reproduction steps:

1. Run a build that reaches a review-fixer/evaluator cycle.
2. Have the review fixer modify candidate files after reviewer issues are found.
3. Have the evaluator inspect candidate diffs but exit without calling `submit_evaluation_verdicts` and without emitting parseable XML verdicts.
4. Observe that `builderEvaluate(...)` returns an empty verdict result with `source: 'none'`.
5. Observe that `withRetry(...)` treats this as normal completion because no retryable terminal subtype was emitted.
6. Observe that `evaluateStageInner(...)` fails closed with `Evaluator produced no verdicts; review-fixer changes remain uncommitted` and preserves candidate files in the dirty worktree.

Affected users are eforge builds that rely on review-fixer/evaluator cycles. The failure is expensive because the candidate fixes remain uncommitted and the queue recovery path must split/resume work manually.

## Goal

When a build evaluator exits normally without submitting verdicts for candidate snapshot files, eforge should retry once using the existing evaluator continuation mechanism while preserving the immutable evaluation snapshot. If the retry submits verdicts, eforge should apply them and continue normally; if the retry also produces no verdicts, eforge should preserve the current fail-closed behavior.

## Approach

Root cause:

- `packages/engine/src/agents/builder.ts` only classifies thrown evaluator failures with `classifyAgentTerminalSubtype(...)`.
- If the evaluator exits normally but submits no verdicts, `packages/engine/src/agents/builder.ts` returns `{ verdicts: [], source: 'none', failed: false }`.
- `packages/engine/src/retry.ts` retries evaluator attempts only when `withRetry(...)` observes a retryable terminal subtype or policy `shouldRetry` match.
- Empty verdicts are currently a normal return value, not a terminal retry condition.
- `packages/engine/src/pipeline/stages/build-stages.ts` detects the empty verdict result only after `withRetry(...)` has completed, so the retry policy no longer has a chance to continue.

Implementation direction:

- Add a narrow typed internal signal for build evaluator no-verdict completion while candidate snapshot files remain.
- Avoid string-matching failure messages such as `Evaluator produced no verdicts` as the retry trigger.
- Avoid broad changes to generic `withRetry(...)` result handling unless the implementation proves there is no clean local alternative.
- Prefer a small internal error/class or structured marker such as `EvaluatorNoVerdictsError`, thrown or returned through a narrowly wrapped path from `runEvaluatorAttempt(...)` when `result.source === 'none' && result.verdicts.length === 0 && input.evaluationSnapshot.files.length > 0`.
- Add an evaluator-policy `shouldRetry` predicate that checks the typed internal signal, not a human-facing error string.
- Reuse the existing evaluator retry policy, `agent:retry` event, `plan:build:evaluate:continuation` event, and `buildEvaluatorContinuationInput(...)` snapshot-preservation path.
- Preserve fail-closed behavior after retry exhaustion or when the evaluator backend actually fails in a non-retryable way.
- A held-back terminal event may be used only as an internal retry mechanism if it remains encapsulated and is surfaced to users only after retry exhaustion.
- Do not make no-verdict retry depend on brittle message parsing or public wire-schema expansion unless there is a strong reason.

Primary code targets:

- `packages/engine/src/pipeline/stages/build-stages.ts`
  - Detect build evaluator no-verdict completion before the retry wrapper returns final failure.
  - Use a typed internal no-verdict signal such as `EvaluatorNoVerdictsError` or an equivalent local structured marker.
  - Keep the no-verdict retry trigger close to `runEvaluatorAttempt(...)` / evaluator stage orchestration rather than moving evaluator-specific semantics into generic retry control flow.
  - Preserve the existing final failure message after retry exhaustion.

- `packages/engine/src/retry.ts`
  - Add a narrow evaluator policy `shouldRetry` predicate only if needed for the typed no-verdict signal.
  - The predicate must inspect the typed signal/class/marker, not match a human-readable error string.
  - Prefer not to add a new `AgentTerminalSubtype` unless necessary because `AgentTerminalSubtypeSchema` is a shared wire schema in `packages/client/src/events.schemas.ts`.
  - Avoid generic `withRetry(...)` result-value retry hooks unless they are clearly necessary and well tested.

- `packages/engine/src/agents/builder.ts`
  - Likely no semantic change required because `builderEvaluate(...)` already reports `source: 'none'` and preserves continuation prompt support.
  - Only update if a small exported/internal helper or type improves clarity for detecting no-verdict completion.

- `test/build-evaluator-enforcement.test.ts`
  - Update or supplement the current no-verdict test.
  - Add a regression where first evaluator attempt returns no verdicts and second attempt calls `submit_evaluation_verdicts`.
  - Assert `agent:retry` and `plan:build:evaluate:continuation` are emitted.
  - Assert accepted changes are committed and `ctx.buildFailed` is not set.
  - Keep a test proving two no-verdict attempts still fail closed and preserve candidate changes.

Existing test analogue:

- `test/build-evaluator-enforcement.test.ts` has `fails the build without an evaluation commit when there are candidate changes but the evaluator produces no verdicts`, which currently encodes the fail-closed behavior and can be updated or paired with a new retry-success regression test.

Assumptions and validation:

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| The failed build was caused by the build evaluator not submitting verdicts after review-fixer changes. | `.eforge/monitor.db` events show the evaluator inspected candidate diffs, ended with result text but no `submit_evaluation_verdicts`, then `plan:build:failed` reported `Evaluator produced no verdicts; review-fixer changes remain uncommitted`. | high | low | Re-query run `6a085433-530a-4e10-aef2-f38fe543e5e9` events or inspect recovery sidecars. | If wrong, the plan may address a symptom rather than the true failure path. |
| Reusing the existing evaluator continuation mechanism is safe for no-verdict completion. | `buildEvaluatorContinuationInput(...)` preserves `evaluationSnapshot`, `builderEvaluate(...)` has continuation prompt text, and evaluator policy already allows two attempts. | high | low | Add a regression test that first attempt has no verdicts and second attempt submits verdicts against the same snapshot. | If wrong, retry could apply stale or mismatched candidate diffs. |
| A typed internal no-verdict signal is maintainable and avoids brittle message matching. | `withRetry(...)` already supports typed thrown errors and policy predicates; user-facing failure text is currently only assembled after retry wrapper completion. | high | low | Implement a local `EvaluatorNoVerdictsError` or equivalent marker and assert retry behavior without checking message text as the trigger. | If wrong, the implementation may require a broader retry hook or risk brittle string-based retry classification. |
| No new public event subtype is required. | Existing `agent:retry` and `plan:build:evaluate:continuation` events can represent the retry; `AgentTerminalSubtypeSchema` is shared wire surface and should not be expanded unnecessarily. | medium | low | Implement with an existing subtype plus typed policy predicate, then run event/schema tests if touched. | If wrong, implementation may either overload an existing subtype unclearly or require schema/reference updates. |
| The fix should primarily target build evaluator behavior, not all planning evaluators. | The observed incident is in `plan:build:evaluate:*`; planning evaluators have similar concepts but different completion/error behavior in `plan-evaluator.ts`. | medium | medium | Search for no-verdict planning evaluator incidents or add a separate follow-up if needed. | If wrong, similar no-verdict failures may remain in planning/cohesion/architecture review flows. |
| The current no-verdict fail-closed tests should be updated rather than removed. | `test/build-evaluator-enforcement.test.ts` already covers no-verdict hard failure and candidate preservation. | high | low | Modify tests to distinguish retry-success from retry-exhaustion failure. | If wrong, regression coverage may lose the guarantee that unreviewed changes never commit silently. |

## Scope

In scope:

- Build evaluator no-verdict completion during review-fixer/evaluator cycles.
- Retrying a no-verdict build evaluator attempt once through the existing evaluator retry policy and continuation path.
- Preserving the same immutable `evaluationSnapshot` for evaluator continuation.
- Preserving fail-closed behavior after retry exhaustion.
- Preserving fail-closed behavior for non-retryable evaluator backend failures.
- Updating `packages/engine/src/pipeline/stages/build-stages.ts`.
- Updating `packages/engine/src/retry.ts` only if needed for a typed no-verdict `shouldRetry` predicate.
- Updating `packages/engine/src/agents/builder.ts` only if a small exported/internal helper or type improves clarity.
- Updating or supplementing `test/build-evaluator-enforcement.test.ts`.
- Running `pnpm type-check`.
- Running `pnpm exec vitest run test/build-evaluator-enforcement.test.ts test/retry.test.ts`.

Out of scope:

- String-matching user-facing failure messages to classify retryability.
- Introducing a broad public event/schema change unless a typed internal signal cannot satisfy the retry contract.
- Adding a new public `AgentTerminalSubtype` unless necessary.
- Moving evaluator-specific no-verdict semantics into generic `withRetry(...)` result handling unless clearly necessary and well tested.
- Broadly changing `packages/engine/src/agents/builder.ts` semantics.
- Extending no-verdict retry behavior to planning/cohesion/architecture evaluators unless the current build-focused implementation naturally supports it without broader risk.

Maintainability constraints:

- Do not classify retryability from user-facing failure message text.
- Do not introduce a broad public event/schema change for this local control-flow issue unless the typed internal signal cannot satisfy the retry contract.
- Keep no-verdict behavior scoped to the build evaluator unless extending it to planning evaluators is a small, deliberate, tested addition.

Related but out of primary scope:

- Planning evaluators in `packages/engine/src/agents/plan-evaluator.ts` also have continuation text and retry policies.
- This incident involved the build evaluator.
- Extending the same no-verdict retry behavior to planning/cohesion/architecture evaluators can be considered only if the current build-focused implementation naturally supports it without broader risk.

Profile signal:

- Recommended profile: **Excursion**.
- Rationale: this is a focused engine bugfix touching evaluator orchestration, retry policy behavior, and tests.
- It is not an Errand because it changes build lifecycle control flow and must preserve fail-closed safety.
- It is not an Expedition because one cohesive plan can cover the build evaluator retry path, tests, and validation without delegated module planning.

## Acceptance Criteria

- When a build evaluator attempt completes with candidate snapshot files and zero verdicts from source `none`, eforge starts one evaluator continuation instead of immediately failing the plan.
- The first no-verdict evaluator completion triggers a retry/continuation while preserving the same immutable evaluation snapshot.
- If the retry submits verdicts, eforge applies those verdicts and commits accepted candidate changes.
- If the retry also produces no verdicts, eforge keeps the current fail-closed behavior.
- The no-verdict retry trigger uses a typed internal signal or structured marker instead of matching a human-readable failure message string.
- The no-verdict retry implementation does not add a new public `AgentTerminalSubtype` value unless tests demonstrate that a local typed signal cannot satisfy the retry contract.
- The no-verdict retry implementation keeps evaluator-specific no-verdict semantics out of generic `withRetry(...)` result handling unless a focused test justifies the broader hook.
- The evaluator continuation reuses the original immutable evaluation snapshot rather than recapturing candidate diffs.
- The evaluator continuation emits an `agent:retry` event with `agent: 'evaluator'`.
- The evaluator continuation emits an `agent:retry` event with `label: 'evaluator-continuation'`.
- The evaluator continuation emits a `plan:build:evaluate:continuation` event with the current `planId`.
- When the second evaluator attempt submits accepting verdicts, eforge applies the accepted candidate changes.
- When the second evaluator attempt submits accepting verdicts, eforge creates the normal evaluation commit.
- When the second evaluator attempt submits accepting verdicts, `plan:build:evaluate:complete` is emitted.
- When the second evaluator attempt submits accepting verdicts, `ctx.buildFailed` is not set.
- When all allowed evaluator attempts complete with zero verdicts, eforge emits `plan:build:failed` with an error containing `Evaluator produced no verdicts`.
- When all allowed evaluator attempts complete with zero verdicts, eforge preserves the candidate review-fixer changes in the working tree for recovery.
- Existing evaluator retries for `error_max_turns` continue to emit their existing retry and continuation events.
- Existing evaluator retries for `error_transient_transport` continue to emit their existing retry and continuation events.
- Existing evaluator retries for `error_pi_tool_infrastructure` continue to emit their existing retry and continuation events.
- Non-retryable evaluator backend failures continue to fail closed with the candidate file list in the failure message.
- `test/build-evaluator-enforcement.test.ts` includes a regression where the first evaluator attempt returns no verdicts and the second evaluator attempt calls `submit_evaluation_verdicts`.
- `test/build-evaluator-enforcement.test.ts` asserts that `agent:retry` is emitted for the no-verdict retry-success regression.
- `test/build-evaluator-enforcement.test.ts` asserts that `plan:build:evaluate:continuation` is emitted for the no-verdict retry-success regression.
- `test/build-evaluator-enforcement.test.ts` asserts that accepted changes are committed for the no-verdict retry-success regression.
- `test/build-evaluator-enforcement.test.ts` asserts that `ctx.buildFailed` is not set for the no-verdict retry-success regression.
- `test/build-evaluator-enforcement.test.ts` keeps a test proving two no-verdict attempts still fail closed.
- `test/build-evaluator-enforcement.test.ts` keeps a test proving two no-verdict attempts preserve candidate changes.
- `pnpm type-check` exits 0.
- `pnpm exec vitest run test/build-evaluator-enforcement.test.ts test/retry.test.ts` exits 0.
