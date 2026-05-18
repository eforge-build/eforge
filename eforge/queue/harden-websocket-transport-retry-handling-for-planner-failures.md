---
title: Harden WebSocket Transport Retry Handling for Planner Failures
created: 2026-05-18
profile: gpt-claude-combo
---

# Harden WebSocket Transport Retry Handling for Planner Failures

## Problem / Motivation

A compile-stage planner run can fail terminally on a backend WebSocket close even though eforge has transient transport retry machinery. The observed failure was `Backend error: WebSocket closed 1000` during planning for `improve-monitor-daemon-scheduler-fsm-card-reporting`.

Affected users: anyone running eforge builds through a backend/harness that can close the transport after expensive planner exploration but before the planner submission tool event is received.

Why it matters now:

- The failure consumed ~5 minutes, ~2M tokens, and manual recovery/retry.
- The existing resilience code gave an expectation that transient WebSocket failures would be retried, but classifier coverage missed this close form.
- A planner failure before authoritative `planning:submission` is safe to retry through the existing continuation path; failing outright wastes work and undermines trust in automated builds.

Evidence from the failed run and code inspection:

- Runtime failure: monitor DB run `80f70fd2-f881-4008-983a-37a4266d46d5` (`compile`, plan set `improve-monitor-daemon-scheduler-fsm-card-reporting`) failed during planner execution with `Backend error: WebSocket closed 1000` before any `planning:submission` or `planning:complete` event. No `agent:retry` was emitted.
- Current retry machinery already has the right planner safety shape: `packages/engine/src/retry.ts` retries planner `error_transient_transport` only before `planning:submission` / `planning:skip`, then uses the existing dropped-submission continuation path. This prevents blind reruns after an authoritative submission.
- The immediate confirmed gap is classification: `packages/engine/src/harness.ts` currently classifies only messages containing `websocket closed 1012` or `backend error: websocket error`; it does not classify `Backend error: WebSocket closed 1000`.
- Current tests in `test/pi-transport-resilience.test.ts` cover `Backend error: WebSocket closed 1012` and `Backend error: WebSocket error`, including planner pre-submission retry and post-submission non-retry, but do not cover close code `1000` or a more general WebSocket close parser.
- Prior fixes from git log:
  - `9aa413e9 feat(plan-01-transport-resilience)` introduced the transient subtype/classifier and builder/planner coverage.
  - `7d1db790 feat(generalize-transient-transport-retry-handling-across-eforge-agents)` added evaluator-family transient retry.
  - The current source includes both, so this is not merely a stale-daemon-code issue.
- Roadmap alignment: this is an Integration & Maturity hardening bugfix. It does not introduce new daemon workflow features or wrapper-app scheduling behavior.
- Project constraints from `AGENTS.md`: event shapes stay centralized, engine mutations go through existing helpers, and agent/provider SDK details remain behind harness boundaries. The likely fix should stay in engine retry/classification and tests; no daemon/client API change appears necessary.

Observed reproduction from the failed run:

1. Enqueue/compile a PRD using a profile whose planning tier uses a backend that reports WebSocket transport failures.
2. Planner starts and performs codebase exploration.
3. Backend stream closes before the planner submission tool event reaches eforge.
4. The harness/agent reports `Backend error: WebSocket closed 1000`.

Actual behavior:

- `agent:stop` records the planner error.
- `phase:end` records compile failure with summary `Backend error: WebSocket closed 1000`.
- No `agent:retry` event is emitted.
- The PRD requires manual recovery/retry.

Confirmed root cause: the transient transport classifier is too narrow.

Current implementation in `packages/engine/src/harness.ts`:

- `isTransientTransportError()` lowercases the message and returns true only for:
  - `websocket closed 1012`
  - `backend error: websocket error`
- `classifyAgentTerminalSubtype()` maps messages matched by that helper to `error_transient_transport`.

The observed message, `Backend error: WebSocket closed 1000`, does not match either condition. Therefore `withRetry()` cannot classify it, treats it as non-retryable, and rethrows immediately.

Related latent issue:

- Retry coverage is intentionally uneven by role. Builder and evaluator-family roles have continuation/checkpoint behavior; unregistered roles default to no retry. This should be audited and documented, but not fixed by blanket retries in this bugfix because many roles may mutate files or lack continuation semantics.

## Goal

Classify `Backend error: WebSocket closed 1000` as a transient transport failure and ensure planner retries occur only before authoritative `planning:submission` or `planning:skip` events.

The outcome should preserve existing post-submission safety behavior, existing `1012` / `Backend error: WebSocket error` handling, and avoid broadening retry behavior for unrelated backend/auth/model/budget failures.

## Approach

Implement a focused engine-side classifier and retry coverage hardening:

- Update the centralized transient transport classifier in `packages/engine/src/harness.ts`.
- Prefer a small, explicit parser for backend WebSocket close messages such as `Backend error: WebSocket closed <code>` over adding only another exact substring.
- Ensure the parser remains constrained to backend/WebSocket-close transport failures and does not classify unrelated auth/model/budget failures as transient.
- Keep retry behavior in the existing `withRetry()` / `DEFAULT_RETRY_POLICIES.planner` path.
- Do not add duplicate WebSocket string matching in agents or pipeline stages.
- Keep provider SDK details behind harness boundaries.
- Do not change daemon/client API surface or event schemas.
- Keep engine state mutation and event-shape constraints aligned with `AGENTS.md`.

Planner retry policy behavior to preserve:

- `DEFAULT_RETRY_POLICIES.planner.retryableSubtypes` remains max-turns only.
- `shouldRetry` explicitly allows `error_transient_transport` when `isBeforePlannerSubmission(events)` is true.
- `isBeforePlannerSubmission()` checks that no `planning:submission` or `planning:skip` has occurred.
- This remains the correct side-effect boundary for planner retries.

Expected behavior after the fix:

- The error is centrally classified as `error_transient_transport`.
- Because no `planning:submission` or `planning:skip` has been emitted, the existing planner retry policy emits `agent:retry` and `planning:continuation`.
- A continuation attempt restarts the planner with dropped-submission context.
- If a transient close occurs after authoritative submission/skip, planner still does not blindly rerun.

Test reproduction to add:

- Extend `test/pi-transport-resilience.test.ts` classifier expectations to include `Backend error: WebSocket closed 1000`.
- Add/adjust a planner `withRetry` test using that exact message before `planning:submission` and assert retry occurs.
- Keep the post-`planning:submission` non-retry test intact.

Hypothesis to validate with tests:

- A small centralized WebSocket-close parser that recognizes `Backend error: WebSocket closed <code>` and classifies selected backend transport closes will close the observed gap without broadening non-transport errors.

Assumptions and validation:

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| `Backend error: WebSocket closed 1000` is a transient transport close in this context. | Observed as a backend WebSocket close before planner submission; manual retry progressed past planning; no auth/model/budget indicators in the message. | high | low | Add classifier and planner retry regression tests with the exact message; optionally grep monitor DB for other close codes. | If wrong, eforge could retry a genuinely terminal condition once or twice, wasting time but still bounded by planner max attempts. |
| The existing planner policy is safe for this case. | Code inspection shows retry only before `planning:submission` / `planning:skip`; observed failed run had neither event. Existing tests already verify pre-submission retry and post-submission non-retry for `1012`. | high | low | Add the same test path using close code `1000`. | If wrong, planner could duplicate submitted artifacts; current guard appears to prevent that. |
| A general parser for backend WebSocket close messages is preferable to adding only `closed 1000` as a substring. | Current classifier is a growing list of exact substrings; the failure is another close-code variant. | medium | low | Implement helper with explicit backend/WebSocket-close pattern and tests for accepted and rejected messages. | If too broad, non-transient errors could be misclassified; tests should constrain scope. |
| Broad retry for every agent role is unsafe in this bugfix. | `getPolicy()` intentionally defaults unregistered roles to no retry; roles vary in side effects and continuation support. | high | medium | Audit role registrations and document safe/unsafe retry posture; defer new role policies to follow-up PRDs. | If wrong, we may leave retry holes in read-only/idempotent roles; impact is continued occasional manual retries, not duplicate side effects. |

No unresolved low-confidence/high-impact assumptions remain for the focused classifier/planner regression fix. The broader all-role retry audit is intentionally scoped as assessment/documentation rather than blanket behavior change.

Recommended profile: **Excursion**.

Rationale:

- This is a focused bugfix with one cohesive implementation path: central classifier update plus targeted regression tests.
- One planner session can enumerate all expected changes and validation without delegated module planning.
- It is not an errand because the retry boundary is safety-sensitive and should preserve existing planner post-submission safeguards.
- It is not an expedition because no independent module planning or architecture-level decomposition is needed.

## Scope

In scope:

- Update `packages/engine/src/harness.ts` so `isTransientTransportError()` recognizes the exact observed message `Backend error: WebSocket closed 1000`.
- Prefer a constrained parser for `Backend error: WebSocket closed <code>` over another one-off substring if it can avoid broadening unrelated errors.
- Preserve existing planner retry semantics in `packages/engine/src/retry.ts`.
- Add focused regression coverage in `test/pi-transport-resilience.test.ts`.
- Preserve existing tests for:
  - `Backend error: WebSocket closed 1012`
  - `Backend error: WebSocket error`
  - planner pre-submission retry
  - planner post-submission non-retry
- Add tests/guards for non-transport backend errors such as invalid API key/model/budget/auth failures.
- Add a concise audit note in code comments or tests clarifying why unregistered roles still default to no retry unless they have a safe continuation/checkpoint contract.
- Validate using targeted test commands and type-check if types change.

Out of scope:

- No daemon/client API change.
- No new daemon workflow features.
- No wrapper-app scheduling behavior.
- No event-shape changes outside centralized event/schema ownership.
- No duplicate WebSocket string matching in agents or pipeline stages.
- No provider SDK leakage outside harness boundaries.
- No blanket retries for every agent role.
- No broadening of retry behavior for roles without safe continuation/checkpoint semantics.
- No architecture-level decomposition or independent module planning.

## Acceptance Criteria

- `isTransientTransportError()` recognizes the exact observed message `Backend error: WebSocket closed 1000`.
- The classifier remains centralized in `packages/engine/src/harness.ts`; no new duplicate WebSocket string matching is added in agents or pipeline stages.
- Planner pre-submission WebSocket close `1000` is retried via existing `withRetry()` / `DEFAULT_RETRY_POLICIES.planner` behavior, emitting `agent:retry` and `planning:continuation`.
- Planner post-`planning:submission` or post-`planning:skip` transient transport failures are still not blindly retried.
- Existing `1012` and `Backend error: WebSocket error` behavior continues to pass.
- Non-transport backend errors such as invalid API key/model/budget/auth failures remain non-transient.
- Add tests covering the observed close-code regression and guard against accidental broadening.
- Add a concise audit note in code comments or tests clarifying why unregistered roles still default to no retry unless they have a safe continuation/checkpoint contract.
- Run:

```bash
pnpm test -- test/pi-transport-resilience.test.ts test/pipeline-error-translator.test.ts test/retry.test.ts
```

or the closest project-supported targeted test command, plus type-check if the implementation changes types.
