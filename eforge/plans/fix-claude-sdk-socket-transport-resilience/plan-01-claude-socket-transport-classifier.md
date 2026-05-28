---
id: plan-01-claude-socket-transport-classifier
name: Classify Claude SDK Socket Closures as Transient Transport
branch: fix-claude-sdk-socket-transport-resilience/plan-01-claude-socket-transport-classifier
---

# Classify Claude SDK Socket Closures as Transient Transport

## Architecture Context

The engine already has a shared terminal-error classification path in `packages/engine/src/harness.ts`. Build-stage translation (`packages/engine/src/pipeline/error-translator.ts`), builder implementation handling (`packages/engine/src/agents/builder.ts`), and retry orchestration (`packages/engine/src/retry.ts`) consume the classified `terminalSubtype`. The existing retry and downgrade behavior does not need new policy; it needs the observed Claude Code socket-close text to map to `error_transient_transport`.

The matcher must stay conservative. It may recognize the exact Claude Code API/socket closure signature, but it must not classify generic `socket`, generic `API Error`, authentication, model, budget, or generic HTTP/API failures as transient transport.

## Implementation

### Overview

Extend the shared transient transport classifier to recognize the Claude Code socket-close message and add regression tests covering classifier, pipeline translation, builder retry, and builder post-result downgrade behavior.

### Key Decisions

1. Match the Claude Code shape by requiring both the `API Error:` prefix and the phrase `socket connection was closed unexpectedly`. This covers the raw SDK text and the eforge wrapper text (`Claude Code returned an error result: ...`) without matching generic API failures.
2. Apply message-based transient-transport classification to `AgentTerminalError` details as well as plain `Error` values. Claude SDK result errors can wrap the detail in an `AgentTerminalError`; a narrow transport signature in the detail must map to `error_transient_transport` so retry policies can run.
3. Keep all retry budgets and continuation policies unchanged. The builder policy already retries `error_transient_transport`; the builder post-result downgrade path already emits `transient-transport-downgraded` when an agent result was emitted and `HEAD` advanced.

## Scope

### In Scope

- Add a narrowly scoped Claude Code socket-close matcher in `packages/engine/src/harness.ts`.
- Ensure `isTransientTransportError()` returns `true` for the raw and wrapped observed Claude Code socket-close messages.
- Ensure `classifyAgentTerminalSubtype()` returns `error_transient_transport` for the observed message, including when it is carried by an `AgentTerminalError` detail.
- Ensure `toBuildFailedEvent()` includes `terminalSubtype: 'error_transient_transport'` for the observed message.
- Add conservative negative tests for auth, model, budget, generic socket, generic API, and generic HTTP/API text.
- Add builder retry and builder post-result downgrade regressions using the observed Claude Code socket-close message.

### Out of Scope

- No changes to retry budgets, retry attempt counts, or broad recovery policy.
- No Claude SDK request construction changes and no `verbose: true` fetch behavior changes.
- No daemon, client, monitor, route, or wire-protocol changes.
- No generic classification for arbitrary socket, API, authentication, permission, model, or budget failures.

## Files

### Create

- None.

### Modify

- `packages/engine/src/harness.ts` — Add the Claude Code API/socket-close matcher; update `isTransientTransportError()` and, if needed, `classifyAgentTerminalSubtype()` ordering so narrow transport details inside `AgentTerminalError` values map to `error_transient_transport`.
- `test/pi-transport-resilience.test.ts` — Extend existing classifier tests with raw/wrapped Claude Code socket-close positives and API/auth/model/budget/generic negatives; add builder retry regression that emits one `agent:retry` with subtype `error_transient_transport`; add builder post-result downgrade regression that emits `agent:warning` with code `transient-transport-downgraded` after a result and `HEAD` advancement.
- `test/pipeline-error-translator.test.ts` — Add `toBuildFailedEvent()` regression for the observed Claude Code socket-close message and verify `terminalSubtype: 'error_transient_transport'`.

## Verification

- [ ] `isTransientTransportError('API Error: The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()')` returns `true`.
- [ ] `isTransientTransportError('Claude Code returned an error result: API Error: The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()')` returns `true`.
- [ ] `classifyAgentTerminalSubtype(new Error(observedClaudeSocketMessage))` returns `error_transient_transport`.
- [ ] `toBuildFailedEvent('plan-01', new Error(observedClaudeSocketMessage)).terminalSubtype` equals `error_transient_transport`.
- [ ] Existing `Backend error: WebSocket closed <code>` and `Backend error: WebSocket error` classifier cases still return `true`.
- [ ] `isTransientTransportError('API Error: invalid API key')` returns `false`.
- [ ] `isTransientTransportError('Claude Code returned an error result: API Error: authentication failed')` returns `false`.
- [ ] `isTransientTransportError('API Error: model not found')` returns `false`.
- [ ] Builder retry regression emits exactly one `agent:retry` event with `subtype: 'error_transient_transport'` for the observed Claude socket message.
- [ ] Builder post-result downgrade regression emits an `agent:warning` event with `code: 'transient-transport-downgraded'` for the observed Claude socket message after an agent result and committed `HEAD` advancement.
- [ ] `pnpm test -- test/pi-transport-resilience.test.ts test/pipeline-error-translator.test.ts` exits 0.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm maintainability:check` exits 0.
