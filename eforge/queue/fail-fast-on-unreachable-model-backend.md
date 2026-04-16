---
title: Fail-fast on unreachable model backend
created: 2026-04-16
---

# Fail-fast on unreachable model backend

## Problem / Motivation

When the model backend (e.g. llama.cpp server) becomes unreachable mid-run, eforge silently reports `Build complete` with exit 0:

- Every build-phase agent (builder, test-writer, reviewer, doc-updater, tester, prd-validator) emits 4 turns at ~0 tokens each.
- No source files are modified.
- The PRD validator reports "no gaps" without ever contacting the model.
- Eval harnesses and downstream merge/validation steps cannot distinguish this from a real successful build.

### Root cause

The pi-ai SDK (`@mariozechner/pi-ai` v0.66.1) catches network errors internally and returns an `AssistantMessage` with:
- `usage = { input: 0, output: 0, ... }`
- `stopReason: 'error'`
- `errorMessage: '<the network error>'`

This message is then emitted by `pi-agent-core/agent-loop.js` as a `turn_end` event followed by `agent_end`, with **no top-level exception thrown**.

`packages/engine/src/backends/pi.ts` subscribes to session events and:
- Counts the `turn_end` (tokens come back as 0).
- Only listens for `event.type === 'error'` (line 446) — but the pi-ai SDK never publishes a top-level `error` event through `session.subscribe`; the error is encoded in the `turn_end` message's `stopReason`/`errorMessage`.

So eforge sees `numTurns > 0` and `error == null` → emits a clean `agent:result` and the orchestrator advances. The 4 observed turns are likely the OpenAI client's built-in HTTP retries plus pi's per-tool retry path.

The PRD validator (`packages/engine/src/agents/prd-validator.ts`) compounds the failure: it swallows agent exceptions (line 60-64) and treats "no JSON parsable in output" as `gaps = []` → `passed = true`.

## Goal

Make silent-success impossible when the model backend is unreachable or misbehaving: a dead/unreachable backend must produce a hard, clearly-messaged failure with a non-zero exit code, regardless of which provider misbehaves.

## Approach

Three layered fixes — each independently valuable, and the combination makes silent-success impossible regardless of which provider misbehaves.

### 1. Detect SDK error stopReason in pi backend (primary fix)

**File:** `packages/engine/src/backends/pi.ts`

In the `turn_end` branch of the subscriber (around line 411-443), inspect the turn's assistant message before incrementing `numTurns`:

```ts
if (event.type === 'turn_end') {
  const msg = (event as { message?: { stopReason?: string; errorMessage?: string } }).message;
  if (msg?.stopReason === 'error') {
    error = msg.errorMessage
      ? `Backend error: ${msg.errorMessage}`
      : 'Backend returned an error response with no message';
    session.abort();
    // Do not count this turn and do not emit agent:usage — fall through to abort path.
    return;
  }
  numTurns++;
  // ... existing usage tracking + agent:usage emission
}
```

The `stopReason === 'error'` check is the principled signal — it covers connection refused, timeout, HTTP 5xx, malformed responses, and anything else the SDK already classifies as an error.

### 2. Defensive zero-token backstop in pi backend

**File:** `packages/engine/src/backends/pi.ts`

After the prompt finishes (after line 503, before constructing `resultData`), add a final guard so that providers which don't set `stopReason: 'error'` still get caught:

```ts
if (numTurns > 0 && totalInputTokens === 0 && totalOutputTokens === 0) {
  error = `Agent completed ${numTurns} turn(s) with zero token usage — backend may be unreachable or misconfigured`;
}
```

The existing `if (error) throw new Error(error)` at line 534-536 will then turn this into a hard failure. We still emit `agent:result` first so the monitor sees the zero-token attempt before the throw.

### 3. PRD validator must fail closed

**File:** `packages/engine/src/agents/prd-validator.ts`

Two changes:

a. **Re-throw non-abort exceptions** (line 60-64). If the backend throws during PRD validation, that is now a fatal signal — silence is the bug.

b. **Treat empty/unparseable output as failure**, not as "no gaps". After the for-await loop, before calling `parseGaps`:
   ```ts
   if (!accumulatedText.trim()) {
     throw new Error('PRD validator produced no output — backend may be unreachable');
   }
   ```
   And if `parseGaps` finds no JSON block at all in non-empty output, surface that as a single synthetic gap (`requirement: 'PRD validator output unparseable'`) so the build fails the validation gate rather than passing silently.

**File:** `packages/engine/src/orchestrator/phases.ts`

In `prdValidate` (line 495-535), stop swallowing non-abort errors from the generator. On exception: mark `state.status = 'failed'`, save state, and yield a `plan:progress` message explaining the cause. This is symmetric with how the viability-gate failure path already works (line 510-512).

### Critical files

- `packages/engine/src/backends/pi.ts` — fixes 1 & 2 (turn_end stopReason check + zero-token backstop)
- `packages/engine/src/agents/prd-validator.ts` — fix 3a/3b (fail-closed)
- `packages/engine/src/orchestrator/phases.ts` — fix 3 orchestrator side (don't swallow validator errors)

## Scope

### In scope

- Detect SDK error `stopReason` in pi backend (`packages/engine/src/backends/pi.ts`).
- Zero-token defensive backstop in pi backend (`packages/engine/src/backends/pi.ts`).
- PRD validator fail-closed behavior on exceptions and empty/unparseable output (`packages/engine/src/agents/prd-validator.ts`).
- Orchestrator-side handling so `prdValidate` does not swallow non-abort errors from the validator (`packages/engine/src/orchestrator/phases.ts`).

### Out of scope

- **Pre-flight liveness check.** Tempting, but it adds latency to every run and creates a false sense of security (the server can die mid-run). The three fixes above catch the failure the moment it actually matters.
- **Retry/backoff tuning.** The bug is not "we should retry harder" — it's "we should not pretend silence is success." Retry config stays untouched.
- **Claude SDK backend.** The bug report is specific to the pi backend with llama-cpp. Claude SDK has its own error-throwing semantics; we leave it alone unless a parallel symptom is reported.

## Acceptance Criteria

1. **Unit-style repro of the SDK error shape.** In `test/`, a test constructs a pi-style `turn_end` event with `message.stopReason === 'error'` and confirms the backend yields no `agent:usage` and the run throws. (Hand-craft the event object cast through `unknown` per `AGENTS.md` testing rules — no SDK mocks.)

2. **Manual end-to-end repro** matching the bug report:
   - Configure eforge with `backend: pi`, `provider: llama-cpp`, `id: gemma-4`.
   - Start a fresh fixture build with a PRD that requires code changes.
   - Let compile complete, then **stop the llama.cpp server** before build phase.
   - Expected: build phase fails with a clear "backend unreachable" message, exit code is non-zero, PRD validator never reports "no gaps".

3. **Type check + existing tests.** `pnpm type-check && pnpm test` confirms no regressions in agent wiring or backend shape.

4. **Plugin-side smoke.** Run a successful build against a reachable provider to confirm the new guards don't false-positive on legitimate zero-token edge cases (e.g., a turn that's purely a tool-result with no assistant text — verify usage is non-zero in that case before shipping).
