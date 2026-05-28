---
title: Fix Claude SDK Socket Transport Resilience
created: 2026-05-28
profile: gpt-claude-combo
landing: pr
landing_auto_merge: true
---

# Fix Claude SDK Socket Transport Resilience

## Problem / Motivation

Evidence from the failed `support-umbrella-session-plan-sets` build shows a Claude SDK builder failure on `plan-01-artifact-protocol` at `2026-05-28T15:29:20Z` with the message:

```text
Claude Code returned an error result: API Error: The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()
```

The emitted `plan:build:failed` event had no `terminalSubtype`, and the run had zero `agent:retry` events. The same socket-error shape also appeared in the earlier `refactor-monitor-server-http-route-handler-complexity` build on `2026-05-27`, also without a terminal subtype.

Claude SDK agent runs can fail with the Claude Code API/socket message `API Error: The socket connection was closed unexpectedly`, but eforge does not classify that message as `error_transient_transport`. As a result, build-stage retry and post-result downgrade policies do not run, even when the failure is an intermittent transport/socket closure.

Observed impact:

- `support-umbrella-session-plan-sets` failed on `plan-01-artifact-protocol` after the Claude SDK builder emitted an error-result with the socket-close message.
- The build emitted `plan:build:failed` without `terminalSubtype` and produced zero `agent:retry` events.
- The same socket-error shape appeared in `refactor-monitor-server-http-route-handler-complexity`, also without terminal subtype classification.

Historical reproduction from monitor DB evidence:

1. Run an eforge build using a profile whose implementation tier uses `claude-sdk`.
2. Have a Claude SDK builder encounter a Claude Code socket closure that surfaces as `API Error: The socket connection was closed unexpectedly`.
3. Observe that the harness emits `agent:result` with the error text, then `agent:stop` with `Claude Code returned an error result: API Error: The socket connection was closed unexpectedly...`.
4. Observe that `plan:build:failed` is emitted without `terminalSubtype`.
5. Observe that no `agent:retry` event is emitted for the run.

Roadmap alignment: this supports the Integration & Maturity goal by improving full lifecycle coverage and provider resilience without adding orchestration responsibilities outside the engine.

Classification: bugfix / focused. The root cause is localized to error classification and retry propagation, but the fix should include targeted regression tests across classifier and pipeline translation behavior.

## Goal

Classify the Claude Code socket-close error shape as `error_transient_transport` so existing build-stage retry, pipeline translation, and post-result downgrade behavior can run for this intermittent transport failure.

## Approach

Relevant code evidence:

- `packages/engine/src/harness.ts` owns `isTransientTransportError()` and `classifyAgentTerminalSubtype()`. It currently recognizes `Backend error: WebSocket closed <code>` and `Backend error: WebSocket error`, but not the Claude Code socket error text.
- `packages/engine/src/harnesses/claude-sdk.ts` turns non-success SDK result messages into `AgentTerminalError(result.subtype, detail)`, where the observed detail contains the Claude Code API/socket message.
- `packages/engine/src/harnesses/pi.ts` already wraps classified transient transport errors as `AgentTerminalError('error_transient_transport', ...)`, which is why the Pi path has better resilience for known transport messages.
- `packages/engine/src/agents/builder.ts` has a post-result/post-commit downgrade path for `error_transient_transport`, but it only runs when the classifier supplies that subtype.
- `test/pi-transport-resilience.test.ts` and `test/pipeline-error-translator.test.ts` already contain transport-classifier and retry-regression patterns to extend.

Confirmed root cause: the shared transport classifier is too narrow for this Claude Code API error shape.

`packages/engine/src/harness.ts` currently matches these transient transport patterns:

- `Backend error: WebSocket closed <code>` via `BACKEND_WS_CLOSE_RE`.
- `Backend error: WebSocket error` via a lower-cased substring check.

The observed Claude SDK failure is instead wrapped as:

```text
Claude Code returned an error result: API Error: The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()
```

Because `isTransientTransportError()` returns false for that message, `classifyAgentTerminalSubtype()` returns `undefined`. That prevents:

- `toBuildFailedEvent()` from including `terminalSubtype: 'error_transient_transport'`.
- `withRetry()` from matching the builder policy's retryable transient-transport subtype.
- `builderImplement()` from using its post-result/post-commit transient-transport downgrade path.

Expected fix shape:

- Add a narrowly scoped Claude Code socket-close matcher in `packages/engine/src/harness.ts`, likely requiring both `API Error:` and `socket connection was closed unexpectedly` to avoid classifying unrelated socket/auth/application errors.
- Add targeted tests in existing transport-classifier/error-translator/retry test files.
- Keep the classifier conservative: do not classify generic `socket`, generic `API Error`, HTTP 500, auth failures, model failures, or budget failures as transient transport without a specific transport-close signature.

Deterministic regression reproduction for implementation:

- Call `isTransientTransportError()` with the observed Claude Code socket message and verify the current code returns `false` before the fix.
- Call `classifyAgentTerminalSubtype(new Error(observedMessage))` and verify it does not currently return `error_transient_transport`.
- Call `toBuildFailedEvent(planId, new Error(observedMessage))` and verify it does not currently include `terminalSubtype`.
- Use an existing builder retry harness pattern to simulate a builder throwing the observed message and verify the retry policy treats it as transient after the fix.

Assumptions and validation:

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| The observed Claude Code socket message is a transient transport failure, not an application/auth/model failure. | The message explicitly says `socket connection was closed unexpectedly`; it appeared as an API/socket closure after a long builder run and lacks auth/model/budget wording. | high | medium | Reproduce against Claude Code with verbose fetch or inspect upstream SDK classification if available. | If wrong, retries could repeat a non-transient failure. Conservative string matching mitigates this. |
| Extending `isTransientTransportError()` is sufficient to activate existing retry and downgrade paths. | `classifyAgentTerminalSubtype()` delegates to `isTransientTransportError()`, `toBuildFailedEvent()` uses `classifyAgentTerminalSubtype()`, and `withRetry()` uses classified subtypes for policy matching. | high | low | Add regression tests for classifier, error translator, builder retry, and builder downgrade. | If wrong, Claude SDK errors may still fail without retry despite classifier coverage. |
| The matcher should require a specific socket-close phrase rather than generic `API Error`. | Existing tests intentionally avoid broad classification of auth/model/budget-style failures; current classifier is conservative. | high | low | Add negative tests for invalid API key, authentication failure, model not found, and generic HTTP/API errors. | A broad matcher could retry deterministic failures and waste budget. |
| No daemon/client API changes are required. | The failure is fully inside engine harness classification and pipeline retry behavior; route contracts are not involved. | high | low | Run type-check and targeted tests after implementation. | If wrong, monitor/recovery views may still lack subtype data for this failure shape. |
| Updating tests in existing transport resilience files is maintainability-safe. | `test/pi-transport-resilience.test.ts` and `test/pipeline-error-translator.test.ts` already cover classifier and translator transport behavior. | high | low | Run targeted tests and maintainability check. | If tests are placed poorly, coverage may be duplicated or hard to maintain. |

Recommended profile: **Excursion**.

Rationale: this is a focused engine bugfix with a localized implementation path and several targeted regression tests. One planner session can fully enumerate the affected files, expected classifier behavior, and validation commands. Expedition is not warranted because no delegated module planning or cross-subsystem design is needed.

## Scope

In scope:

- Extend `isTransientTransportError()` in `packages/engine/src/harness.ts` to recognize the observed Claude Code socket-close message.
- Ensure `classifyAgentTerminalSubtype()` returns `error_transient_transport` for the observed message.
- Ensure `toBuildFailedEvent()` includes `terminalSubtype: 'error_transient_transport'` for the observed message.
- Extend existing transport-classifier and retry-regression patterns in `test/pi-transport-resilience.test.ts` and `test/pipeline-error-translator.test.ts`.
- Add negative tests to keep the classifier conservative for auth, model, budget, generic socket, generic API, and generic HTTP/API error text.
- Add a builder retry regression test for the observed Claude socket message.
- Add a builder post-result downgrade regression test for the observed Claude socket message.

Out of scope:

- Do not change broad recovery policy or automatic failed-PRD recovery behavior.
- Do not introduce new retry budgets.
- Do not rework Claude SDK request construction or verbose fetch behavior.
- Do not classify generic socket/auth/API text broadly enough to catch authentication, permission, model, or budget failures.
- Do not make daemon/client API changes.

## Acceptance Criteria

- `isTransientTransportError()` returns `true` for `API Error: The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()`.
- `isTransientTransportError()` returns `true` for `Claude Code returned an error result: API Error: The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()`.
- `classifyAgentTerminalSubtype(new Error(observedClaudeSocketMessage))` returns `error_transient_transport`.
- `toBuildFailedEvent(planId, new Error(observedClaudeSocketMessage))` includes `terminalSubtype: 'error_transient_transport'`.
- Existing `Backend error: WebSocket closed <code>` classifier tests still pass.
- Existing `Backend error: WebSocket error` classifier tests still pass.
- The classifier returns `false` for `API Error: invalid API key`.
- The classifier returns `false` for `Claude Code returned an error result: API Error: authentication failed`.
- The classifier returns `false` for `API Error: model not found`.
- A builder retry regression test shows the observed Claude socket message emits an `agent:retry` event with `subtype: 'error_transient_transport'` when retry preconditions are met.
- A builder post-result downgrade regression test shows the observed Claude socket message emits `agent:warning` with code `transient-transport-downgraded` when the builder produced an agent result and advanced `HEAD`.
- `pnpm test -- test/pi-transport-resilience.test.ts test/pipeline-error-translator.test.ts` exits 0.
- `pnpm type-check` exits 0.
- `pnpm maintainability:check` exits 0.
