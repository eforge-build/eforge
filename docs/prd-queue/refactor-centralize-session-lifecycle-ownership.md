---
title: Refactor: Centralize session lifecycle ownership
created: 2026-03-18
status: pending
---

## Problem / Motivation

Session lifecycle (`session:start`/`session:end`) is currently split across three layers:

1. **`withSessionId` middleware** (`session.ts`) — stamps events, optionally emits envelope events via `emitSessionStart`/`emitSessionEnd` flags
2. **CLI orchestration** (`cli/index.ts`) — manually coordinates which phase gets which flag, creates the sessionId, has early `process.exit()` paths between phases
3. **Engine queue mode** (`eforge.ts`) — bypasses the middleware entirely and yields `session:start`/`session:end` directly

This fragmentation causes bugs: when the CLI calls `process.exit()` between compile and build (e.g., scope-complete at line 346, compile failure at line 350), `session:end` is never emitted because it's deferred to the build phase's `withSessionId` wrapper which never runs. The monitor records an orphaned session with no end event.

The design is also hard to test — the bug lives in CLI orchestration logic that's only exercisable via integration tests. The middleware itself tests fine in isolation; it's the caller's coordination that breaks.

## Goal

Centralize session lifecycle into a single wrapper so that `session:end` is always emitted — even on early exits — eliminating orphaned sessions and making the composition logic unit-testable.

## Approach

**Single-wrapper model**: One `runSession` call wraps the entire run (all phases). Individual phases don't know about sessions. Early exits yield events (like `plan:skip`) instead of calling `process.exit()`, so the wrapper's finally block always fires.

### 1. New `runSession` helper in `session.ts`

Replace the split `emitSessionStart`/`emitSessionEnd` flags with a single function that accepts an async generator of all events for a session:

```typescript
async function* runSession(
  events: AsyncGenerator<EforgeEvent>,
  sessionId: string,
): AsyncGenerator<EforgeEvent>
```

- Always emits `session:start` before first event
- Always emits `session:end` in finally block
- Stamps every event with sessionId
- No flags, no split ownership

Remove the `emitSessionStart`/`emitSessionEnd` options from `SessionOptions`. Keep `withSessionId` as a simpler stamping-only utility for queue mode (where the engine yields its own envelope events).

### 2. CLI `eforge run` — single session wrapper

Refactor the run command to yield all three phases (enqueue, compile, build) from a single async generator, wrapped once by `runSession`:

```typescript
const sessionId = randomUUID();

async function* allPhases(): AsyncGenerator<EforgeEvent> {
  // Phase 0: Enqueue
  yield* engine.enqueue(source, opts);
  if (!enqueuedFilePath) return; // generator ends → finally fires

  // Phase 1: Compile
  yield* engine.compile(enqueuedFilePath, opts);
  if (planResult === 'failed' || planFiles.length === 0) return;
  if (skipBuild) return; // plan:skip case

  // Phase 2: Build
  yield* engine.build(planSetName, opts);
}

for await (const event of wrapEvents(allPhases(), monitor, hooks, { sessionId })) {
  renderEvent(event);
  // track state from events...
}
process.exit(result === 'completed' ? 0 : 1);
```

No more `process.exit()` in the middle of phases. Early exits become generator returns — the session wrapper's finally block guarantees `session:end`.

### 3. Queue mode — keep engine-level ownership, simplify middleware

Queue mode already manages sessions correctly in `eforge.ts`. The CLI just needs to pass events through. `withSessionId` becomes a pure sessionId-stamping passthrough (no envelope flags to get wrong).

### 4. Tests — test the composition, not just the middleware

Add tests for the `allPhases` generator pattern that verify session lifecycle guarantees across early-exit scenarios. These test the actual composition logic with `StubBackend` + synthetic events, not just `withSessionId` in isolation.

### Files

**Modify:**
- `src/engine/session.ts` — Add `runSession()` helper. Simplify `withSessionId` to stamping-only (remove `emitSessionStart`/`emitSessionEnd` flags)
- `src/cli/index.ts` — Refactor `eforge run` to use single-wrapper `allPhases` generator pattern. Remove `process.exit()` calls between phases. Refactor `eforge run --queue` and `eforge queue run` to use simplified `withSessionId`. Remove `scopeComplete`/`plan:scope` early-exit logic (replace with `plan:skip` if that PRD lands first, otherwise just remove the dead code path)

**Modify (minor):**
- `src/engine/index.ts` — Export `runSession` if needed by CLI

**Update tests:**
- `test/session.test.ts` — Update existing tests for the simplified `withSessionId` API (no `emitSessionStart`/`emitSessionEnd`). Add tests for `runSession` covering early-exit scenarios

**No changes needed:**
- `src/engine/eforge.ts` — Queue mode session handling stays as-is (it already works correctly)
- `src/engine/hooks.ts` — `withHooks` unchanged
- `src/monitor/recorder.ts` — `withRecording` unchanged

## Scope

**In scope:**
- New `runSession` helper that guarantees `session:start`/`session:end` envelope
- Simplifying `withSessionId` to pure sessionId-stamping (removing `emitSessionStart`/`emitSessionEnd` flags)
- Refactoring `eforge run` CLI to use a single `allPhases` generator wrapped by `runSession`
- Removing `process.exit()` calls between phase boundaries in the `run` command
- Simplifying queue-mode CLI paths to use the stamping-only `withSessionId`
- Removing `scopeComplete`/`plan:scope` early-exit logic (dead code or replaced by `plan:skip`)
- Unit tests for `runSession` covering all early-exit scenarios

**Out of scope:**
- Changes to queue mode session handling in `eforge.ts` (already works correctly)
- Changes to `withHooks` or `withRecording` middleware
- Changes to the monitor or recorder

## Acceptance Criteria

- [ ] `pnpm type-check` passes
- [ ] `pnpm test` passes — including new session composition tests
- [ ] `pnpm build` clean
- [ ] New test: compile failure → `session:end` emitted with `failed` result
- [ ] New test: `plan:skip` → `session:end` emitted with `completed` result
- [ ] New test: build agent error → `session:end` emitted with `failed` result
- [ ] New test: normal completion → `session:end` emitted with `completed` result
- [ ] Existing `session.test.ts` tests updated and passing
- [ ] No `emitSessionStart`/`emitSessionEnd` references remain in codebase
- [ ] No `process.exit()` calls between phase boundaries in the `run` command
