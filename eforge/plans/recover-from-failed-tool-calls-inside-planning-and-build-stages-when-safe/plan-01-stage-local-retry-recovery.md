---
id: plan-01-stage-local-retry-recovery
name: Stage-local retry and checkpoint recovery for Pi tool failures
branch: recover-from-failed-tool-calls-inside-planning-and-build-stages-when-safe/plan-01-stage-local-retry-recovery
agents:
  builder:
    effort: high
    rationale: This touches shared retry semantics plus compile/build stage agent
      behavior; the builder needs to preserve safety boundaries around planning
      artifacts and build commits.
  tester:
    effort: high
    rationale: The behavior is checkpoint-sensitive and requires regression tests
      for pre-checkpoint retry, post-checkpoint downgrade, and ambiguous
      submission failures.
  reviewer:
    effort: high
    rationale: Review must verify that retries are limited to roles and checkpoints
      with explicit safety contracts.
---

# Stage-local retry and checkpoint recovery for Pi tool failures

## Architecture Context

The engine already centralizes most continuation behavior in `packages/engine/src/retry.ts`. Planner retry is safety-gated to avoid rerunning after side-effectful planning submissions, evaluator retries are handled through the same wrapper, and the builder has a local late-error downgrade for post-result transient transport failures when HEAD advanced.

This plan extends the existing retry contract rather than adding ad hoc catches. Retry remains opt-in by role. Safe reruns happen before authoritative side-effect checkpoints; late retryable Pi infrastructure/transport failures after authoritative completion checkpoints produce `agent:warning` events and return success instead of failing the run.

## Implementation

### Overview

Implement checkpoint-aware recovery for retryable Pi tool-call infrastructure and transport failures across planning and build-stage agent paths. Preserve the unsafe boundary around `planning:submission` without `planning:complete`, add safe retry for `pipeline-composer`, retry non-mutating compile reviewers once when their harness fails transiently, and broaden Pi infrastructure classification to cover the explicit `Pi tool-call infrastructure failure:` wrapper.

### Key Decisions

1. Add policy-level terminal-success semantics to `withRetry()` so policies can declare authoritative checkpoints that convert a late retryable infrastructure error into a warning and normal return.
2. Keep `planning:submission` as an unsafe/ambiguous boundary. A retryable error after `planning:submission` but before `planning:complete` or `expedition:architecture:complete` must not rerun the planner and must not be downgraded to success.
3. Treat `planning:complete`, `planning:skip`, and `expedition:architecture:complete` as authoritative planner success checkpoints for late `error_transient_transport` and `error_pi_tool_infrastructure` only.
4. Add `error_pi_tool_infrastructure` to safe retry/downgrade handling for builder and evaluator policies, while preserving no-retry defaults for roles without an explicit safety boundary.
5. Retry `pipeline-composer` through an explicit policy because it has no filesystem side effects before `planning:pipeline`.
6. Retry compile reviewers only through `runReviewCycle()` and only for transient/tool-infrastructure terminal subtypes; reviewer failures remain non-fatal if retry exhausts or the error is not classified.

## Scope

### In Scope

- `withRetry()` policy extension for checkpoint-aware terminal success and warning emission.
- Planner pre-checkpoint retry for `error_transient_transport` and `error_pi_tool_infrastructure`.
- Planner post-checkpoint downgrade to `agent:warning` for `planning:complete`, `planning:skip`, and `expedition:architecture:complete`.
- Preserve failure/no-rerun behavior for post-`planning:submission` errors when no authoritative completion event exists.
- Pipeline-composer retry for retryable harness/tool/transport failures before `planning:pipeline`.
- Build-stage retry/downgrade inclusion of `error_pi_tool_infrastructure` where existing builder/evaluator transport safety contracts already exist.
- Non-fatal compile reviewer retry for plan, architecture, and cohesion review cycles.
- Conservative Pi infrastructure classification for the explicit `Pi tool-call infrastructure failure:` wrapper.
- Tests covering the new retry and downgrade contract.

### Out of Scope

- Broad retry for roles that lack a role-specific safety boundary.
- Rerunning planner attempts after `planning:submission` without an authoritative completion event.
- Retry of application/tool command failures that are not classified as Pi infrastructure or transient transport failures.
- Database schema changes.
- User-facing documentation changes.

## Files

### Create

No new production files are required. Add new test cases to existing test files unless a small focused test file is clearer for the builder.

### Modify

- `packages/engine/src/retry.ts` — Add retry policy fields for terminal success after checkpoints; add helpers for retryable infrastructure/transport subtypes; update planner, builder, evaluator, plan-evaluator, cohesion-evaluator, and architecture-evaluator policies; add an explicit pipeline-composer policy; keep no-retry fallback for unregistered roles.
- `packages/engine/src/pipeline/stages/compile-stages.ts` — Wrap the pipeline-composer call in `withRetry()` using the new explicit policy and preserve context updates from `planning:pipeline`; keep planner retry flow using the updated planner policy.
- `packages/engine/src/pipeline/runners.ts` — Retry compile reviewers once for `error_transient_transport` and `error_pi_tool_infrastructure` before swallowing the review failure; keep evaluator retry behavior intact.
- `packages/engine/src/agents/builder.ts` — Extend the existing post-`agent:result` plus HEAD-advanced downgrade path to include `error_pi_tool_infrastructure` with a distinct warning code/message while preserving current transient transport behavior.
- `packages/engine/src/harness.ts` — Broaden `isPiToolInfrastructureError()` to match explicit wrapper messages such as `Pi tool-call infrastructure failure: ...` while retaining existing negative cases for normal tool output and backend application errors.
- `test/retry.test.ts` — Update policy assertions, unregistered-role expectations, and `withRetry()` tests for planner pre-checkpoint pi-infra retry, post-checkpoint downgrade, ambiguous post-submission failure, and pipeline-composer policy behavior.
- `test/pi-transport-resilience.test.ts` — Update planner post-checkpoint transient tests from throw expectations to warning/success expectations after authoritative checkpoints; add pi-infrastructure planner and builder coverage.
- `test/pi-harness-tool-error-classification.test.ts` — Add positive wrapper-classification cases and negative ordinary tool-result/application-error cases.
- `test/pipeline-composer.test.ts` — Add a harness-level transient/tool-infrastructure failure test that verifies composer retry emits `agent:retry` and eventually emits `planning:pipeline`.
- `test/compile-evaluator-enforcement.test.ts` or the most focused existing review-cycle test file — Add coverage that evaluator retries still use immutable snapshots and reviewer failures remain non-fatal after retry exhaustion.

## Implementation Notes

### Retry policy extension

Add a small policy hook to `RetryPolicy<Input>`, for example:

```ts
terminalSuccessWhen?: (info: RetryAttemptInfo<Input>) => boolean | Promise<boolean>;
onTerminalSuccess?: (info: RetryAttemptInfo<Input>) => EforgeEvent[];
```

`withRetry()` must evaluate this hook after classifying a terminal subtype and before deciding to retry or propagate. When it returns true:

- emit any `onTerminalSuccess` events, including an `agent:warning` with a stable code;
- do not emit `agent:retry`;
- do not start another attempt;
- drop any held-back terminal failure event;
- return the latest successful result value, if one exists.

Use helper functions to extract an `agentId` from attempt events, with a deterministic fallback like `${policy.agent}-unknown` for tests that omit `agent:start`.

### Planner checkpoints

Add helpers equivalent to:

- `hasAuthoritativePlannerCheckpoint(events)` — true for `planning:complete`, `planning:skip`, or `expedition:architecture:complete`.
- `isBeforePlannerSubmissionBoundary(events)` — true only when none of `planning:submission`, `planning:skip`, `planning:complete`, or `expedition:architecture:complete` appeared.
- `isRetryableInfrastructureSubtype(subtype)` — true for `error_transient_transport` and `error_pi_tool_infrastructure`.

Planner policy behavior:

- retry `PlannerSubmissionError` dropped submissions as today;
- retry `error_transient_transport` and `error_pi_tool_infrastructure` only before the submission boundary;
- downgrade `error_transient_transport` and `error_pi_tool_infrastructure` only after an authoritative planner checkpoint;
- propagate errors after `planning:submission` when no authoritative checkpoint exists.

Keep `planning:continuation.reason` values within the current event schema (`max_turns` or `dropped_submission`). For infrastructure retries before any submission, use the existing dropped-submission continuation path because no plan artifacts were written.

### Pipeline composer

Register an explicit policy for `pipeline-composer` with a small retry budget matching existing composer attempts where practical. Retry only `error_transient_transport` and `error_pi_tool_infrastructure`. Because `composePipeline()` does not write files before `planning:pipeline`, the retry can reuse the same input. Treat `planning:pipeline` as the composer success checkpoint if a synthetic late infrastructure error occurs after the event.

### Reviewer cycle

In `runReviewCycle()`, wrap `config.reviewer.run()` with a local or registry-backed policy for the known compile reviewer roles (`plan-reviewer`, `architecture-reviewer`, `cohesion-reviewer`). Retry only transient/tool-infrastructure subtypes. If retries exhaust, swallow the failure as the function does today and skip evaluation. Do not retry after reviewer completion events that have already applied fixes unless the implementation proves no duplicate writes can occur.

### Build-stage agents

Add `error_pi_tool_infrastructure` to builder and evaluator retry subtype sets. For `builderImplement()`, update the late downgrade guard to accept both transient transport and pi tool infrastructure when all existing safety checks are true:

- terminal subtype is retryable infrastructure/transport;
- `agent:result` was seen;
- an agent id is known;
- HEAD advanced since the stage started.

Emit a warning code that distinguishes transport from pi-infrastructure failures.

### Pi classification

Update `isPiToolInfrastructureError()` conservatively:

- Keep matching the existing `Theme not initialized` family.
- Also match explicit wrapper messages that start with optional whitespace and optional `Error:` followed by `Pi tool-call infrastructure failure:`.
- Do not match JSON tool results, normal command stderr, backend auth/model/budget errors, or arbitrary text that merely contains similar words inside a payload.

## Verification

- [ ] `isPiToolInfrastructureError()` returns true for `Pi tool-call infrastructure failure: ...` wrapper messages and false for JSON tool output, normal stderr text, and backend application errors.
- [ ] A planner attempt that throws `error_pi_tool_infrastructure` or `error_transient_transport` before `planning:submission` runs a second attempt and emits one `agent:retry` plus one `planning:continuation` event.
- [ ] A planner attempt that yields `planning:complete`, `planning:skip`, or `expedition:architecture:complete` and then throws a retryable infrastructure/transport error emits one `agent:warning`, starts no second attempt, and propagates no error.
- [ ] A planner attempt that yields `planning:submission` without a later authoritative completion event and then throws a retryable infrastructure/transport error starts no second attempt and propagates the original error.
- [ ] Pipeline composer retries a first-attempt retryable infrastructure/transport failure, emits `agent:retry`, and emits `planning:pipeline` from a later attempt.
- [ ] Builder retry policies include `error_pi_tool_infrastructure`; late post-result pi-infrastructure failures with HEAD advance emit a warning and complete the implement stage.
- [ ] Compile reviewers remain non-fatal when retry exhausts; evaluator retry tests still pass and preserve immutable evaluation snapshots.
- [ ] No default retry is added for unregistered roles without an explicit policy.
- [ ] `pnpm vitest run test/retry.test.ts test/pi-transport-resilience.test.ts test/pi-harness-tool-error-classification.test.ts test/pipeline-composer.test.ts test/compile-evaluator-enforcement.test.ts` passes.
- [ ] `pnpm type-check`, `pnpm test`, and `pnpm build` pass.
