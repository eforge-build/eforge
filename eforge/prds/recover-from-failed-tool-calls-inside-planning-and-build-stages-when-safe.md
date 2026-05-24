---
title: Recover from Failed Tool Calls Inside Planning and Build Stages When Safe
created: 2026-05-24
profile: gpt-claude-combo
---

# Recover from Failed Tool Calls Inside Planning and Build Stages When Safe

## Problem / Motivation

A transient Pi tool-call or transport failure during compile planning can currently fail the whole queued build even when eforge could safely recover inside the stage.

Observed failed run:

- Run `5a9d47fe-3cc4-4758-ac18-007344b80d39` failed during `compile` after a planner/tool interaction.
- Recovery classified the failure as transient/tool-call infrastructure rather than a code failure.
- The active queue item was later safe to retry because no commits or plan artifacts needed preservation.

Observed symptom:

- A compile run for `conservatively-remove-high-confidence-low-value-automated-tests-to-reduce-execution-time` failed after a planner tool interaction.
- Recovery classified it as retryable/transient and no commits or useful partial state had to be preserved.
- User expectation: this should not require post-failure recovery. eforge should retry or downgrade the failure inside the current stage when it is safe.

Why it matters:

- Planning and review agents use tools heavily.
- A single failed tool transport/infrastructure event should not turn a queue item into `failed` if no irreversible checkpoint has happened.
- Manual recovery/re-enqueue loses time and can cause queue churn even though the PRD itself is valid.

Current evidence from code inspection:

- `packages/engine/src/retry.ts` already has a reusable `withRetry()` wrapper and default retry policies.
- Planner retries `error_transient_transport` only before `planning:submission` / `planning:skip`.
- Evaluator-style agents retry `error_max_turns` and `error_transient_transport`.
- Unregistered roles get a no-retry default.
- `packages/engine/src/harness.ts` defines both `error_transient_transport` and `error_pi_tool_infrastructure`.
- `packages/engine/src/harnesses/pi.ts` can throw `AgentTerminalError('error_pi_tool_infrastructure', ...)` for a narrow theme-init class of tool infrastructure failures.
- Generic Pi tool-call processing failures are not broadly classified as retryable planning-stage failures.
- `packages/engine/src/pipeline/stages/compile-stages.ts` wraps the main `planner` with `withRetry()`, but `pipeline-composer` is run directly before planner retry begins.
- `runReviewCycle()` retries evaluators, while reviewer failures are non-fatal and swallowed without retry.
- `packages/engine/src/agents/builder.ts` already has a late-error downgrade pattern: if a transient transport error occurs after `agent:result` and the worktree HEAD advanced, it emits a warning and completes rather than failing.
- Planning lacks an equivalent checkpoint-aware success path.
- Existing tests encode current behavior:
  - `test/pi-transport-resilience.test.ts`
  - `test/retry.test.ts`
- These tests assert planner does **not** retry after `planning:submission` / `planning:skip`; they need to change to assert “do not rerun, but do not fail” when the authoritative checkpoint is already present.

Classification: **bugfix / focused**.

This is a defect in stage-local resilience for transient/tool-infrastructure failures. It is cross-cutting across retry policy, compile stages, and tests, but a single cohesive plan can cover it without module delegation.

## Goal

eforge should recover from retryable Pi tool-call, tool-infrastructure, and transport failures inside planning/build stages when it is safe.

Before an authoritative stage checkpoint, retry retryable tool/transport infrastructure failures within the existing continuation budget. After an authoritative checkpoint, treat a late retryable infrastructure/transport failure as stage success with an `agent:warning`, not as a build failure.

## Approach

Desired behavior:

- Before an authoritative stage checkpoint, retry retryable tool/transport infrastructure failures within the existing continuation budget.
- After an authoritative checkpoint, treat a late retryable infrastructure/transport failure as stage success with an `agent:warning`, not as a build failure.
- Do not blindly retry after side-effectful checkpoints where rerunning could duplicate work; use checkpoint-specific rules.

Root cause:

1. Planner retry policy is too narrow for Pi tool-call infrastructure failures.
   - `packages/engine/src/retry.ts` planner policy retries `error_max_turns`, dropped submissions, and `error_transient_transport` before planner submission/skip.
   - It does not retry `error_pi_tool_infrastructure`, even though `packages/engine/src/harness.ts` defines that terminal subtype and `packages/engine/src/harnesses/pi.ts` can throw it.

2. Some compile-stage agents are outside the shared retry wrapper.
   - `packages/engine/src/pipeline/stages/compile-stages.ts` wraps the main `planner` via `withRetry()`.
   - The `pipeline-composer` call runs directly before planner retry starts.
   - Its internal retry loop handles JSON/schema parse failures, but not harness/tool/transport failures.
   - `runReviewCycle()` wraps evaluators with retry policies, but reviewer failures are caught and swallowed without retry.
   - This is non-fatal, but less resilient than it could be.

3. `withRetry()` currently distinguishes only retry vs propagate; it lacks an explicit stage-checkpoint downgrade hook.
   - Existing tests intentionally assert no planner retry after `planning:submission` / `planning:skip` to avoid duplicate side effects.
   - That prevents unsafe reruns, but the current consequence for a thrown retryable error is propagation/failure rather than “checkpoint reached, do not rerun, treat as success”.
   - Builder has a local late-error downgrade in `packages/engine/src/agents/builder.ts`: after `agent:result` plus HEAD advance, transient transport is downgraded to warning and complete.
   - Planning lacks the same pattern.

4. Pi tool infrastructure classification is intentionally narrow.
   - `isPiToolInfrastructureError()` only matches the known “Theme not initialized” family.
   - The observed failure text was a generic `Pi tool-call infrastructure failure: ...` around a tool result, so it may be classified as transient transport or not classified depending on the throw path.
   - This creates inconsistent retry behavior.

Implementation direction:

- Extend retry policy semantics rather than adding one-off planner catch blocks.
- Add a policy-level checkpoint/downgrade hook to `withRetry()`; for example:
  - `abortSuccessWhen`
  - `successfulTerminalEvents`
- Retryable errors after authoritative completion events should not fail the stage.
- Add `error_pi_tool_infrastructure` to safe retry matching for planning/review agents before authoritative checkpoints.
- Wrap or otherwise make `pipeline-composer` retry harness-level retryable failures, because it has no file-system side effects before `planning:pipeline`.
- Keep side-effect safety:
  - Do not blindly rerun after partially applied artifacts.
  - Either complete from an authoritative checkpoint, retry before checkpoint, or fail with an actionable message when state is ambiguous.

Assumptions and validation:

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|---|---|---:|---:|---|---|
| The observed failed compile was recoverable inside the planning stage because no durable useful work had been produced. | Monitor/recovery summary showed transient/tool-call infrastructure classification, no landed commits, and retry verdict. | high | low | Re-run a similar compile after fix and confirm `agent:retry` / completion. | If wrong, retry could duplicate or overwrite useful planning artifacts. |
| `planning:complete`, `planning:skip`, and `expedition:architecture:complete` are authoritative enough to downgrade later retryable failures to success. | Code inspection: `runPlanner()` emits `planning:complete` after `writePlanSet()` and parsing written files; `planning:skip` returns no artifact work; `expedition:architecture:complete` follows `writeArchitecture()`. | high | low | Add unit tests with thrown retryable errors after these events; inspect any consumers relying on subsequent `agent:stop`. | If wrong, compile could appear successful with missing/invalid plan artifacts. |
| `planning:submission` alone is ambiguous and should not be the success checkpoint unless artifacts are reconstructed. | Code inspection: `planning:submission` is yielded before `writePlanSet()` / `writeArchitecture()`. | high | low | Add regression test proving a post-submission/pre-complete throw does not silently succeed without plan files. | If wrong, eforge could mark compile successful while plan files were never written. |
| Pipeline composer can safely retry transport/tool-infra failures because it does not mutate repo state before `planning:pipeline`. | Code inspection: `composePipeline()` loads prompt, calls harness, parses JSON, then yields `planning:pipeline`; no writes were found. | high | low | Add a StubHarness test where first attempt throws and second emits valid JSON. | If wrong, retry could duplicate a hidden side effect, but current code evidence suggests no side effects. |
| Generic `Pi tool-call infrastructure failure:` can be classified narrowly enough without treating normal tool output as infra failure. | Current predicate is intentionally narrow; observed failure string includes a wrapper. Broader matching needs careful tests. | medium | low | Add classifier tests for wrapper text plus negative cases for ordinary successful tool JSON and command stderr. | If too broad, real tool/application failures could be retried and hidden; if too narrow, this bug persists. |
| Reviewer retries are useful but not required to prevent build failure. | `runReviewCycle()` already swallows reviewer/evaluator failures as non-fatal; evaluators already use `withRetry()`. | high | low | Tests can assert non-fatal behavior remains and optionally add retry for reviewer before swallow. | If omitted, build will not fail, but plan quality could degrade after transient reviewer failures. |

Recommended profile: **Excursion**.

Rationale: this is a focused engine bugfix that touches shared retry policy, Pi error classification, compile-stage composer/planner behavior, and tests. It is cross-cutting but cohesive: a single planner can enumerate the retry/checkpoint contract and affected files. It does not need expedition/module planning.

## Scope

In scope:

- Retry policy updates in `packages/engine/src/retry.ts`.
- Pi tool-call infrastructure subtype handling for `error_pi_tool_infrastructure`.
- Checkpoint-aware success/downgrade behavior in `withRetry()`.
- Planning-stage recovery for retryable tool/transport failures.
- Safe retry behavior for `pipeline-composer` before `planning:pipeline`.
- Review-cycle resilience where safe:
  - Plan/architecture/cohesion reviewer failures remain non-fatal.
  - Where retry is added, it must not duplicate submitted fixes.
  - Evaluator retry behavior remains intact.
- Updates to existing tests:
  - `test/pi-transport-resilience.test.ts`
  - `test/retry.test.ts`
- New targeted tests for:
  - Planner pre-checkpoint retry.
  - Planner post-checkpoint downgrade.
  - Pipeline-composer retry.
  - Pi tool-infra subtype handling.

Out of scope:

- Broad retry for unregistered roles.
- Broad retry for side-effectful roles without a policy-specific safety boundary.
- Blind reruns after side-effectful checkpoints where duplicate work could occur.
- Treating `planning:submission` alone as a fully authoritative success unless implementation also proves/reconstructs the written artifacts.

## Acceptance Criteria

- A planner attempt that fails with `error_transient_transport` or `error_pi_tool_infrastructure` before any authoritative planning checkpoint is retried within the existing planner continuation budget and emits `agent:retry` plus `planning:continuation`.
- A planner attempt that has already emitted an authoritative completion checkpoint (`planning:complete`, `planning:skip`, or `expedition:architecture:complete`) and then hits a retryable transport/tool-infra failure does not fail the compile run and does not rerun the planner; it emits a warning or equivalent observable event and completes the stage.
- `planning:submission` alone is not treated as a fully authoritative success unless implementation also proves/reconstructs the written artifacts; tests must encode the chosen safe boundary explicitly.
- `pipeline-composer` recovers from retryable harness/tool/transport failures before `planning:pipeline`, retrying safely because it has no filesystem side effects before success.
- Plan/architecture/cohesion reviewer failures remain non-fatal; where retry is added, it must not duplicate submitted fixes.
- Evaluator retry behavior remains intact.
- Pi tool-call infrastructure classification covers the observed generic `Pi tool-call infrastructure failure:` wrapper when safe, without misclassifying ordinary tool-result text or application errors.
- Existing tests that currently expect planner post-submission transient errors to throw are updated to the new safe behavior:
  - Success after authoritative checkpoint.
  - No blind rerun after ambiguous partial submission.
- New targeted tests cover:
  - Planner pre-checkpoint retry.
  - Planner post-checkpoint downgrade.
  - Pipeline-composer retry.
  - Pi tool-infra subtype handling.
- No broad retry is added for unregistered or side-effectful roles without a policy-specific safety boundary.
- `pnpm test`, `pnpm type-check`, and `pnpm build` pass.

Reproduction steps to validate:

1. Enqueue or run compile for a PRD using a Pi profile.
2. During planning, the planner invokes a tool producing a large/normal result.
3. Pi/tool infrastructure or transport fails while processing the tool interaction.
4. Current behavior: compile emits/records a failed run and the PRD moves to failed queue, even though recovery later judges the cause retryable and no code changes landed.
5. Expected behavior: compile remains inside the same stage, emits `agent:retry` / continuation or `agent:warning` as appropriate, and either completes or only fails after retry exhaustion / unrecoverable state.

Unit-level reproductions to add or update:

- `withRetry` planner case:
  - A planner attempt throws `AgentTerminalError('error_pi_tool_infrastructure', ...)` or a broadly classified Pi tool-call infrastructure error before `planning:complete`.
  - Assert a retry occurs and a second attempt can complete.
- `withRetry` planner late-checkpoint case:
  - An attempt yields `planning:complete` or `planning:skip` and then throws retryable transport/tool-infra.
  - Assert no retry is launched, no error is propagated, and a warning/abort-success path completes.
- Pipeline composer case:
  - First composer attempt throws retryable transport/tool-infra before `planning:pipeline`.
  - Assert the composer retries and eventually emits `planning:pipeline` rather than failing compile.
- Review-cycle case:
  - Reviewer/evaluator transient tool failure remains non-fatal.
  - Where safe, reviewer is retried once before the cycle is skipped.

Validation commands after implementation:

```bash
pnpm vitest test/retry.test.ts test/pi-transport-resilience.test.ts test/pi-harness-tool-error-classification.test.ts test/pipeline-composer.test.ts test/compile-evaluator-enforcement.test.ts
pnpm test
pnpm type-check
pnpm build
```
