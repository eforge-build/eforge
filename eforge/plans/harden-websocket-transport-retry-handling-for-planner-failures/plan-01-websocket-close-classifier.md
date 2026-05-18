---
id: plan-01-websocket-close-classifier
name: Harden WebSocket Close Transport Classification
branch: harden-websocket-transport-retry-handling-for-planner-failures/plan-01-websocket-close-classifier
---

# Harden WebSocket Close Transport Classification

## Architecture Context

The engine already centralizes agent terminal subtype classification in `packages/engine/src/harness.ts` and retry behavior in `packages/engine/src/retry.ts`. Planner retry safety is enforced by `DEFAULT_RETRY_POLICIES.planner.shouldRetry`, which allows transient transport retries only before `planning:submission` or `planning:skip`. This plan keeps provider SDK details behind harness boundaries, makes no daemon/client API or event schema changes, and avoids duplicating WebSocket matching in agents or pipeline stages.

## Implementation

### Overview

Replace the current narrow substring-only transient transport check with a constrained backend WebSocket-close parser in `packages/engine/src/harness.ts`, then add focused regression tests for the observed `Backend error: WebSocket closed 1000` planner failure. Preserve the existing `1012` close and `Backend error: WebSocket error` behavior, and guard against classifying auth/model/budget/backend application failures as transient transport failures.

### Key Decisions

1. Keep classification centralized in `packages/engine/src/harness.ts`; existing callers such as `classifyAgentTerminalSubtype()` and the Pi harness continue to depend on that helper.
2. Use an explicit `Backend error: WebSocket closed <code>` parser rather than adding only a `closed 1000` substring. The parser must require the backend-error + WebSocket-closed shape so unrelated messages with numbers are not treated as transport closes.
3. Leave `packages/engine/src/retry.ts` planner policy behavior unchanged except for test coverage: planner transient transport retries must still depend on the pre-submission/pre-skip event boundary.
4. Document/audit the no-retry default for unregistered roles in test or code comments, without adding blanket retry policies for roles that lack continuation/checkpoint contracts.

## Scope

### In Scope

- Update `isTransientTransportError()` in `packages/engine/src/harness.ts` to return true for `Backend error: WebSocket closed 1000`.
- Preserve true classification for `Backend error: WebSocket closed 1012` and `Backend error: WebSocket error`.
- Keep false classification for non-transport backend errors including invalid API key, auth, model, and budget-style messages.
- Add regression tests that prove planner pre-submission close-code `1000` emits `agent:retry` and `planning:continuation` through `withRetry()`.
- Add tests that prove transient transport after `planning:submission` and after `planning:skip` is not retried.
- Add or update tests/comments documenting why unregistered roles still default to no retry unless they have safe continuation/checkpoint semantics.

### Out of Scope

- Daemon/client API changes.
- Event schema changes.
- Provider SDK imports outside `packages/engine/src/harnesses/`.
- Duplicate WebSocket string matching in agents or pipeline stages.
- Blanket retries for roles without safe continuation/checkpoint contracts.
- New daemon workflow features or wrapper-app scheduling behavior.

## Files

### Create

- None.

### Modify

- `packages/engine/src/harness.ts` — replace the transient transport helper with a constrained parser for backend WebSocket close messages and keep the existing `Backend error: WebSocket error` condition.
- `test/pi-transport-resilience.test.ts` — extend classifier expectations for close code `1000`, add non-transport guard cases, and update/add planner `withRetry` tests using the exact observed message.
- `test/retry.test.ts` — add policy-level coverage that transient transport is allowed before planner submission/skip but rejected after `planning:submission` and after `planning:skip`; keep the unregistered-role no-retry audit explicit.
- `test/pipeline-error-translator.test.ts` — add coverage that a plain `Error('Backend error: WebSocket closed 1000')` maps to `terminalSubtype: 'error_transient_transport'`.

## Implementation Notes

- A suitable parser shape is a case-insensitive match equivalent to `^\s*Backend error:\s*WebSocket closed\s+(\d+)\b`, applied before lowercased fallback substring checks. The implementation may allow surrounding error context if tests demonstrate the match remains scoped to backend WebSocket-close messages.
- Do not classify arbitrary `WebSocket closed 1000` without the backend-error prefix unless there is already an existing test or code path requiring it.
- Do not add `error_transient_transport` to `DEFAULT_RETRY_POLICIES.planner.retryableSubtypes`; the existing custom `shouldRetry` path is the safety gate for planner transport retry.

## Verification

- [ ] `isTransientTransportError('Backend error: WebSocket closed 1000')` returns `true`.
- [ ] `isTransientTransportError('Backend error: WebSocket closed 1012')` and `isTransientTransportError('Backend error: WebSocket error')` return `true`.
- [ ] Classifier tests assert `false` for invalid API key, auth, model, and budget backend messages.
- [ ] A planner `withRetry()` test using `Backend error: WebSocket closed 1000` before `planning:submission` observes exactly two attempts and emits both `agent:retry` and `planning:continuation`.
- [ ] Planner tests observe one attempt and zero `agent:retry` events when the same transient transport subtype occurs after `planning:submission`.
- [ ] Planner tests observe one attempt and zero `agent:retry` events when the same transient transport subtype occurs after `planning:skip`.
- [ ] `DEFAULT_RETRY_POLICIES.planner.retryableSubtypes` remains limited to `error_max_turns`; transient transport planner retry remains governed by `shouldRetry`.
- [ ] Unregistered roles in `getPolicy()` still return `maxAttempts: 1` and an empty `retryableSubtypes` set.
- [ ] `pnpm test -- test/pi-transport-resilience.test.ts test/pipeline-error-translator.test.ts test/retry.test.ts` passes.
