---
id: plan-01-fail-fast-backend
name: Fail-fast on unreachable model backend
depends_on: []
branch: fail-fast-on-unreachable-model-backend/fail-fast-backend
---

# Fail-fast on unreachable model backend

## Architecture Context

When the pi-ai SDK (`@mariozechner/pi-ai`) cannot reach the model backend (e.g. llama.cpp server down), it does NOT throw. It returns an `AssistantMessage` with `usage = { input: 0, output: 0 }`, `stopReason: 'error'`, and `errorMessage` set. `pi-agent-core` forwards this as a `turn_end` event (followed by `agent_end`) — no top-level `error` event is published through `session.subscribe`.

`packages/engine/src/backends/pi.ts` today:
- Counts the `turn_end` unconditionally (line 411-436), emits a zero-token `agent:usage`.
- Only listens for `event.type === 'error'` (line 446) — which the SDK never sends.
- Emits a clean `agent:result` with `numTurns > 0`, `error == null` — the orchestrator treats this as success.

`packages/engine/src/agents/prd-validator.ts` compounds the failure: it swallows agent exceptions (line 60-64) and treats unparseable output as `gaps = []` → `passed = true` (line 79, 110).

`packages/engine/src/orchestrator/phases.ts` `prdValidate` swallows non-abort errors from the validator generator (line 531-534).

## Implementation

### Overview

Three layered fixes so a dead backend surfaces as a hard failure with a clear message and non-zero exit code:

1. Pi backend: detect `turn_end` messages carrying `stopReason === 'error'` and abort the session, recording the SDK error message.
2. Pi backend: zero-token backstop after prompt completion — if `numTurns > 0` but both token counters are 0, treat as backend failure.
3. PRD validator + orchestrator: fail-closed on exceptions and empty/unparseable output; orchestrator must not swallow non-abort validator errors.

### Key Decisions

1. **Use `stopReason === 'error'` as the primary signal.** This is the pi-ai SDK's own classification — it covers connection refused, timeout, HTTP 5xx, and malformed responses without eforge needing to pattern-match error strings.
2. **Abort session on detection, skip `agent:usage` for the failing turn.** A zero-token turn caused by backend failure is not real usage — emitting it would pollute monitor totals. Let the abort path and the `if (error) throw` at line 534 surface the failure.
3. **Zero-token backstop is a belt-and-suspenders check.** Providers that do not set `stopReason: 'error'` still get caught. Guarded by `numTurns > 0` so legitimate no-op runs are not flagged; legitimate turns always have non-zero input tokens (the prompt itself).
4. **PRD validator fails closed.** Re-throw non-abort exceptions so orchestrator sees them; treat empty output as a thrown error; treat non-empty-but-unparseable output as a single synthetic gap rather than silent pass.
5. **Orchestrator symmetry.** `prdValidate` already has a failure path for the viability gate (line 510-512); extend the catch block (line 531-534) to use the same pattern instead of silently returning.

## Scope

### In Scope

- Detect SDK error `stopReason` in the `turn_end` branch of the pi backend subscriber.
- Zero-token defensive backstop after `promptDone` in the pi backend.
- Re-throw non-abort exceptions and treat empty/unparseable output as failure in `runPrdValidator`.
- Orchestrator-side handling in `prdValidate` so non-abort errors from the validator mark the build failed and emit a `plan:progress` message.
- Unit tests covering (a) SDK-error `turn_end` shape causing the run to throw with no `agent:usage`, (b) zero-token backstop, (c) PRD validator fail-closed behavior, (d) orchestrator `prdValidate` failure handling.

### Out of Scope

- Pre-flight liveness checks against the backend.
- Retry / backoff tuning for the pi backend.
- Changes to `ClaudeSDKBackend` — the bug is pi-specific and Claude SDK has its own error-throwing semantics.
- Changes to the gap closer or merge finalize logic beyond the `prdValidate` failure path.

## Files

### Modify

- `packages/engine/src/backends/pi.ts` — In the `turn_end` branch (around line 411-443), before incrementing `numTurns`: cast the event to access `message.stopReason` / `message.errorMessage`; if `stopReason === 'error'`, set `error = 'Backend error: <msg>'` (or `'Backend returned an error response with no message'` when `errorMessage` is absent), call `session.abort()`, and `return` from the subscriber callback so the failing turn is neither counted nor emitted as `agent:usage`. After `await promptDone` (line 503) but before building `resultData` (line 507), add the zero-token backstop: if `numTurns > 0 && totalInputTokens === 0 && totalOutputTokens === 0` and `error` is not yet set, assign `error = 'Agent completed <n> turn(s) with zero token usage — backend may be unreachable or misconfigured'`. The existing `if (error) throw new Error(error)` at line 534 turns both into hard failures after `agent:result` is emitted.

- `packages/engine/src/agents/prd-validator.ts` — In the `catch` block (line 60-64): keep the AbortError re-throw, but replace the silent swallow with `throw err` for all other errors. Before calling `parseGaps` (line 57): if `accumulatedText.trim()` is empty, `throw new Error('PRD validator produced no output — backend may be unreachable')`. In `parseGaps` (line 76-111): when `jsonMatch` is null but the input is non-empty, return a single synthetic gap `{ requirement: 'PRD validator output unparseable', explanation: 'Agent output did not contain a parsable JSON gap-analysis block.' }` so `passed` evaluates to `false`. Leave the `try { JSON.parse ... } catch` branch returning `{ gaps: [], completionPercent: undefined }` replaced with the same synthetic gap (unparseable JSON is the same fail-closed case).

- `packages/engine/src/orchestrator/phases.ts` — In `prdValidate` (line 495-535), replace the current swallowing `catch` (line 531-534). On a non-abort error: yield a `plan:progress` event with `message: 'PRD validation failed: <err.message>'`, set `state.status = 'failed'`, set `state.completedAt = new Date().toISOString()`, and call `saveState(stateDir, state)`. Re-throw AbortError as today. This mirrors the viability-gate failure path at line 510-512.

### Create

- `test/pi-backend-fail-fast.test.ts` — Vitest tests that exercise the pi backend subscriber path by hand-crafting `AgentSessionEvent` values cast through `unknown` (per AGENTS.md rule: no SDK mocks). Cover:
  1. A `turn_end` event whose `message.stopReason === 'error'` with `errorMessage` set causes the generator to throw `Error('Backend error: <errorMessage>')` and emits no `agent:usage` for that turn.
  2. Missing `errorMessage` produces the fallback `'Backend returned an error response with no message'`.
  3. Zero-token backstop: a sequence where every `turn_end` reports zero input/output tokens and no `stopReason: 'error'` (simulating a provider that swallows the error differently) causes the generator to throw the zero-token message after `agent:result` is yielded.
  4. Positive control: a `turn_end` with non-zero input tokens and no error `stopReason` does NOT trigger either guard.
  If direct exercise of the private subscriber is infeasible, use the `StubBackend` pattern plus a dedicated test wrapper that mirrors the subscriber's guard logic; prefer testing the guard logic by constructing the event shape the subscriber receives and asserting on observable outputs (events yielded + thrown error).

- `test/prd-validator-fail-closed.test.ts` — Vitest tests using `StubBackend` (`test/stub-backend.ts`) to feed the validator canned agent output:
  1. Backend throws a non-abort error mid-run → `runPrdValidator` re-throws.
  2. Backend yields AbortError → `runPrdValidator` re-throws AbortError (unchanged behavior).
  3. Backend completes with zero accumulated text → `runPrdValidator` throws `'PRD validator produced no output …'`.
  4. Backend emits non-empty output containing no JSON block → yields `prd_validation:complete` with `passed: false` and a single synthetic gap.
  5. Backend emits output with a valid JSON block and empty `gaps` array → yields `passed: true` (positive control, existing behavior preserved).

## Verification

- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm test` exits 0; all new tests in `test/pi-backend-fail-fast.test.ts` and `test/prd-validator-fail-closed.test.ts` pass.
- [ ] Existing tests `test/pi-backend.test.ts`, `test/prd-validator.test.ts`, `test/prd-validator-diff.test.ts`, `test/agent-wiring.test.ts` continue to pass with no modifications required beyond what this plan specifies.
- [ ] Grep confirms `stopReason === 'error'` check exists in `packages/engine/src/backends/pi.ts` inside the `turn_end` branch.
- [ ] Grep confirms the zero-token backstop string `'zero token usage'` exists in `packages/engine/src/backends/pi.ts` after `await promptDone` and before `yield { ...type: 'agent:result' ... }`.
- [ ] Grep confirms `packages/engine/src/agents/prd-validator.ts` no longer contains a bare `// Agent errors are non-fatal` comment that swallows errors; the catch re-throws non-abort errors.
- [ ] Grep confirms `packages/engine/src/orchestrator/phases.ts` `prdValidate` catch block sets `state.status = 'failed'` and yields a `plan:progress` event on non-abort errors.
- [ ] Manual end-to-end smoke (documented in PR body, not CI): start a build with `backend: pi, provider: llama-cpp, id: gemma-4`; stop the llama.cpp server before the build phase; build terminates with a non-zero exit code, logs include either `'Backend error:'` or `'zero token usage'`, and the PRD validator does not report `passed: true`.
- [ ] Manual positive smoke: run a successful build against a reachable provider; confirm the zero-token backstop does not trigger (verify by inspecting that at least one `turn_end` carries non-zero `input` tokens — the prompt itself guarantees this).
