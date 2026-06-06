---
id: plan-01-transport-terminal-subtypes
name: Classify Codex SSE Timeouts and Preserve Terminal Subtypes
branch: fix-recovery-sidecar-sse-timeout-classification-and-resume-recommendation/plan-01-transport-terminal-subtypes
agents:
  builder:
    effort: high
    rationale: This plan changes a client-owned event contract and the authoritative
      recovery-summary path; careful propagation is required to avoid degrading
      terminal subtype evidence.
  reviewer:
    effort: high
    rationale: The review needs to check wire compatibility, event-schema
      validation, and recovery summary precedence.
---

# Classify Codex SSE Timeouts and Preserve Terminal Subtypes

## Architecture Context

The client package owns shared transport classification and closed event schemas. The engine emits `plan:build:failed` and a single authoritative `build:terminal-failure` event; recovery summary synthesis gives that authoritative event precedence. This plan fixes the subtype evidence path without changing the `RecoveryVerdict` union or compiled-build resume behavior.

## Implementation

### Overview

Add a narrow Codex SSE response-header timeout classifier, then preserve `terminalSubtype` from `plan:build:failed` into `build:terminal-failure` and authoritative recovery summaries.

### Key Decisions

1. Match only the backend Codex SSE prefix: `Backend error: Codex SSE response headers timed out after <N>ms`. Generic timeout strings remain non-transient.
2. Add `failure.terminalSubtype` as an optional `AgentTerminalSubtypeSchema` field on `build:terminal-failure` for backward compatibility with existing events.
3. Treat authoritative terminal events as the primary source, with best-effort fallback to a referenced `plan:build:failed` row when the authoritative event lacks `failure.terminalSubtype` and the source row carries it.
4. Propagate subtype into `summary.terminalFailure`, `summary.failingPlan`, `summary.failingPlans`, and the failed entry in `summary.plans` for plan-scoped authoritative fragments.

## Scope

### In Scope

- Codex SSE response-header timeout classification.
- `build:terminal-failure.failure.terminalSubtype` optional wire field.
- Terminal subtype preservation in the engine terminal failure tracker and recovery history synthesis.
- Regression tests for classifier cases, event schema validation, deterministic recommendation outcomes, and recovery summary subtype preservation.

### Out of Scope

- Adding `resume` to `RecoveryVerdict`.
- Changing retry policy for failed plans with non-zero tool-use counts.
- Broad timeout classification for shell commands, validation commands, daemon requests, or generic SSE text without the backend Codex prefix.
- Sidecar compiled-build resume recommendation fields; those are handled in plan-02.

## Files

### Create

- None.

### Modify

- `packages/client/src/transient-transport.ts` — add a narrow `backend error: codex sse response headers timed out after \d+ms` classifier branch and keep existing WebSocket/Claude matches.
- `packages/client/src/events/shared/schemas.ts` — add optional `terminalSubtype: AgentTerminalSubtypeSchema` to `TerminalFailureEnvelopeSchema`.
- `packages/engine/src/terminal-failure.ts` — add optional `terminalSubtype` to internal failure evidence, copy it from `plan:build:failed`, and emit it on `build:terminal-failure.failure`.
- `packages/engine/src/recovery/terminal-failure-history.ts` — parse authoritative `failure.terminalSubtype`, optionally recover it from referenced `plan:build:failed` rows, and propagate it through `buildAuthoritativeFragment()`.
- `test/pi-transport-resilience.test.ts` — add direct `isTransientTransportError()` and `classifyAgentTerminalSubtype()` coverage for the Codex SSE timeout and negative timeout shapes.
- `test/pipeline-error-translator.test.ts` — add `toBuildFailedEvent()` coverage for the Codex SSE timeout.
- `packages/client/src/__tests__/terminal-failure-event.test.ts` — add safe-parse acceptance and rejection coverage for `build:terminal-failure.failure.terminalSubtype`.
- `packages/client/src/__tests__/events-schemas.test.ts` — add coverage here only if the existing event-schema suite needs a fixture for terminal failure subtype validation.
- `test/recovery-terminal-failure.test.ts` — add authoritative event tests asserting subtype preservation in `failingPlan`, `failingPlans[0]`, `plans[]`, and `terminalFailure`.
- `test/recovery-recommendation.test.ts` — add deterministic recommendation coverage for zero-tool-use transient failures returning `split` when completed or merged work exists, non-zero failed-plan tool use returning `manual`, and the legacy no-authoritative `plan:build:failed.terminalSubtype` regression if existing coverage does not exercise the Codex SSE subtype path.

## Verification

- [ ] `isTransientTransportError("Backend error: Codex SSE response headers timed out after 10000ms")` returns `true`.
- [ ] `isTransientTransportError("command timed out after 10000ms")` returns `false`.
- [ ] `isTransientTransportError("SSE response headers timed out after 10000ms")` returns `false`.
- [ ] `classifyAgentTerminalSubtype(new Error("Backend error: Codex SSE response headers timed out after 10000ms"))` returns `error_transient_transport`.
- [ ] `toBuildFailedEvent("plan-03", new Error("Backend error: Codex SSE response headers timed out after 10000ms"))` has `terminalSubtype: "error_transient_transport"`.
- [ ] A tracker fed a `plan:build:failed` event with `terminalSubtype: "error_transient_transport"` emits `build:terminal-failure.failure.terminalSubtype === "error_transient_transport"`.
- [ ] `safeParseEforgeEvent()` accepts a `build:terminal-failure` event with `failure.terminalSubtype: "error_transient_transport"`.
- [ ] `safeParseEforgeEvent()` rejects a `build:terminal-failure` event with `failure.terminalSubtype: "not-a-subtype"`.
- [ ] `synthesizeFromEvents()` preserves `error_transient_transport` in `failingPlan`, `failingPlans[0]`, and the matching `plans[]` entry when an authoritative terminal event carries the subtype.
- [ ] `synthesizeFromEvents()` preserves `error_transient_transport` for a legacy run with `plan:build:failed.terminalSubtype` and no authoritative terminal event.
- [ ] `determineRecoveryRecommendation()` returns `split` for a non-partial summary with completed or merged work, a failed plan with `terminalSubtype: "error_transient_transport"`, and zero failed-plan tool-use count.
- [ ] `determineRecoveryRecommendation()` returns `manual` for a non-partial summary with a failed plan with `terminalSubtype: "error_transient_transport"` and failed-plan `toolUseCount > 0`.
