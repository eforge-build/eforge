---
id: plan-01-hook-drain-and-session-guarantees
name: Hook Drain Timeout and Session Lifecycle Guarantees
depends_on: []
branch: fix-session-end-hook-not-firing-on-build-failure/hook-drain-and-session-guarantees
---

# Hook Drain Timeout and Session Lifecycle Guarantees

## Architecture Context

The engine uses an async generator pipeline: `allPhases()` → `runSession()` → `withHooks()` → `withRecording()` → CLI `for-await`. Hooks fire non-blocking in the background and are drained in `withHooks`'s `finally` block. When the drain timeout expires before a hook completes, `process.exit()` kills it mid-flight. Three gaps in the lifecycle guarantee chain allow `session:end` hooks to be silently lost.

## Implementation

### Overview

Three fixes in two files - all tightly coupled around session lifecycle guarantees:

1. Derive the hook drain timeout from the maximum configured hook timeout (+ 1s grace) instead of hardcoding 3s.
2. Wrap the per-PRD compile+build section in `runQueue()` with `try/finally` so `session:end` fires even if `compile()`, `build()`, or `updatePrdStatus()` throws.
3. Move `validatePlanSetName()`, `createTracingContext()`, and `tracing.setInput()` inside the `try` block in both `compile()` and `build()` so `phase:end` is always emitted from the `finally` block.

### Key Decisions

1. **Drain timeout = max(hook timeouts) + 1000ms** — matches the PRD's approach. The 1s grace covers scheduling jitter without being wasteful. `Math.max(...hooks.map(h => h.timeout), 0)` handles the edge case of an empty `hooks` array (though `withHooks` already short-circuits on `hooks.length === 0`).
2. **`let tracing` before `try`, assigned inside** — `createTracingContext()` can fail (Langfuse config issues), so it must be inside `try`. But `tracing` is used in `finally` for `setOutput` and `flush`, so it needs `let` scope outside. Guard the `finally` calls with `tracing?.setOutput()` / `tracing?.flush()`.
3. **Queue mode: default `prdResult` to failed** — initialize with `{ status: 'failed', summary: 'Session terminated abnormally' }` before `try`, update on success. The `finally` block unconditionally yields `session:end` with whatever `prdResult` holds.

## Scope

### In Scope
- `src/engine/hooks.ts` — derive drain timeout from hook config
- `src/engine/eforge.ts` — `compile()`, `build()`, and `runQueue()` lifecycle hardening
- `test/hooks.test.ts` — new test verifying drain timeout derivation

### Out of Scope
- Changes to `runSession()` in `src/engine/session.ts` (already has `try/finally`)
- Hook execution logic (subprocess spawning, timeout killing)
- Monitor or CLI rendering changes

## Files

### Modify
- `src/engine/hooks.ts` — Replace hardcoded `3000` drain timeout with `Math.max(...hooks.map(h => h.timeout), 0) + 1000`. Update the JSDoc comment on `withHooks` to reflect the change.
- `src/engine/eforge.ts` — Three changes:
  1. **`compile()` (~line 180-257)**: Move `validatePlanSetName(planSetName)` (line 183), `const tracing = createTracingContext(...)` (line 184), and `tracing.setInput(...)` (line 198) inside the `try` block. Change `const tracing` to `let tracing: ReturnType<typeof createTracingContext> | undefined` declared before `try`. Guard `finally` block's `tracing.setOutput()` and `tracing.flush()` with optional chaining.
  2. **`build()` (~line 324-)**: Same pattern — move `validatePlanSetName(planSet)` (line 325), `const tracing = createTracingContext(...)` (line 327), and `tracing.setInput(...)` (line 341) inside the `try` block. `let tracing` before `try`, optional chaining in `finally`.
  3. **`runQueue()` (~line 619-695)**: Wrap the per-PRD section (from `updatePrdStatus(prd.filePath, 'running')` through `session:end` + `queue:prd:complete`) in a `try/catch/finally`. Initialize `prdResult` as `{ status: 'failed', summary: 'Session terminated abnormally' }`. In `catch`, capture the error message. In `finally`, call `updatePrdStatus` (wrapped in `try/catch` to prevent double-throw) and yield `session:end`. Move `queue:prd:complete` after the `finally` block.
- `test/hooks.test.ts` — Add a test verifying the drain timeout is derived from hook config (not hardcoded). The test creates hooks with varying timeouts and asserts the drain waits long enough. Since the drain timeout is internal, test it indirectly: create a hook with `timeout: 100` that writes a file after 50ms, and verify the file exists after drain (proving the drain waited ≥ 100ms + 1000ms grace, which is > 50ms).

## Verification

- [ ] `pnpm type-check` exits with code 0
- [ ] `pnpm test` exits with code 0 (all existing tests pass)
- [ ] In `src/engine/hooks.ts`, the drain `setTimeout` value is computed from `hooks.map(h => h.timeout)`, not a numeric literal
- [ ] In `src/engine/hooks.ts`, the drain timeout includes a 1000ms (1-second) additive grace period
- [ ] `test/hooks.test.ts` contains a test whose name includes "drain timeout" that verifies the timeout derives from hook config
- [ ] In `src/engine/eforge.ts` `compile()`, `validatePlanSetName()` is called inside the `try` block (after the `try {` line, before `catch`)
- [ ] In `src/engine/eforge.ts` `compile()`, `createTracingContext()` is called inside the `try` block
- [ ] In `src/engine/eforge.ts` `build()`, `validatePlanSetName()` is called inside the `try` block
- [ ] In `src/engine/eforge.ts` `build()`, `createTracingContext()` is called inside the `try` block
- [ ] In `src/engine/eforge.ts` `runQueue()`, `session:end` is yielded inside a `finally` block
- [ ] In `src/engine/eforge.ts` `runQueue()`, `updatePrdStatus` inside the `finally` block is wrapped in its own `try/catch`
