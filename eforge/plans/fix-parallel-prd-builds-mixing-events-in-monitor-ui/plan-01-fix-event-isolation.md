---
id: plan-01-fix-event-isolation
name: Fix parallel PRD event isolation
depends_on: []
branch: fix-parallel-prd-builds-mixing-events-in-monitor-ui/fix-event-isolation
---

# Fix parallel PRD event isolation

## Architecture Context

When the daemon runs multiple PRDs in parallel (`parallelism=2+`), events from different builds bleed into each other in the monitor UI. The root cause is threefold:

1. `withRunId` in `session.ts` maintains a single `currentRunId` tracker - when applied to the multiplexed stream from `runQueue()`, interleaved `phase:start` events from parallel sessions corrupt it.
2. `withRunId` and `withSessionId` unconditionally overwrite `runId`/`sessionId` on events, even when those values are already set by `buildSinglePrd`.
3. The recorder's `bufferedSessionStart` is a single variable that gets overwritten when two PRDs emit `session:start` in quick succession.

The fix applies `withRunId` per sub-generator inside `buildSinglePrd` (before events enter the shared queue), makes the outer middlewares defensive (preserve pre-existing values), and converts the recorder's buffer to a per-session Map.

## Implementation

### Overview

Apply `withRunId` wrapping per sub-generator inside `buildSinglePrd` so events carry the correct `runId` before entering the shared `AsyncEventQueue`. Make `withRunId` and `withSessionId` preserve pre-existing values so the outer middleware is a no-op for pre-stamped events. Convert the recorder's single `bufferedSessionStart` variable to a `Map<string, EforgeEvent>` keyed by `sessionId`.

### Key Decisions

1. **Wrap per sub-generator, not per-PRD session** - Wrapping `this.compile()` and `this.build()` individually with `withRunId` stamps events at the source, before they enter the `AsyncEventQueue` where parallel PRDs interleave. This is the primary fix.
2. **Defensive outer middleware** - Making `withRunId`/`withSessionId` prefer existing values (via `event.runId ?? currentRunId` pattern) means the outer middleware becomes a safe no-op for queue mode while preserving behavior for non-queue modes (compile/build CLI commands) where events lack `runId`.
3. **Map-based session buffering** - The recorder's `bufferedSessionStart` must support concurrent sessions. A `Map<string, EforgeEvent>` keyed by `sessionId` allows each PRD's `session:start` to be buffered and flushed independently.

## Scope

### In Scope
- Wrapping `this.compile()` and `this.build()` with `withRunId` inside `buildSinglePrd` in `src/engine/eforge.ts`
- Making `withRunId` in `src/engine/session.ts` preserve pre-existing `runId` values on events
- Making `withSessionId` in `src/engine/session.ts` preserve pre-existing `sessionId` values on events
- Converting `bufferedSessionStart` in `src/monitor/recorder.ts` from single variable to `Map<string, EforgeEvent>`
- Adding tests for interleaved parallel session events in `test/with-run-id.test.ts`
- Adding test for `withSessionId` preserving existing `sessionId` in `test/session.test.ts`

### Out of Scope
- Changes to `wrapEvents` ternary logic in `src/cli/index.ts`
- Broader refactoring of the event pipeline or queue architecture

## Files

### Modify
- `src/engine/eforge.ts` - Import `withRunId` from `./session.js`; wrap the `this.compile()` and `this.build()` for-await loops inside `buildSinglePrd` (lines ~830 and ~860) with `withRunId` so events carry the correct `runId` before entering the shared queue
- `src/engine/session.ts` - In `withRunId`: change line 59 to `runId: event.runId ?? currentRunId`, line 66 to `runId: event.runId ?? lastRunId`, line 72 to `runId: event.runId ?? currentRunId`. In `withSessionId`: change line 32 from `sessionId: sessionId ?? event.sessionId` to `sessionId: event.sessionId ?? sessionId`
- `src/monitor/recorder.ts` - Replace `let bufferedSessionStart: EforgeEvent | undefined` (line 17) with `const bufferedSessionStarts = new Map<string, EforgeEvent>()`; update the buffering logic at line 33-43 to use `bufferedSessionStarts.get(event.sessionId)` and `.delete()` instead of single variable assignment; update line 46-48 to use `.set(event.sessionId, event)` instead of `bufferedSessionStart = event`; update the `enqueue:start` flush at lines 65-76 similarly
- `test/with-run-id.test.ts` - Add test for interleaved parallel PRD events flowing through `withRunId`, verifying pre-stamped `runId` values are preserved and unstamped events outside phases remain unstamped
- `test/session.test.ts` - Add test for `withSessionId` preserving each event's existing `sessionId` when events carry heterogeneous sessionIds

## Verification

- [ ] `pnpm type-check` exits with code 0
- [ ] `pnpm test` exits with code 0 (all existing + new tests pass)
- [ ] New test in `test/with-run-id.test.ts` creates two interleaved generators (session A emits `phase:start` with `runId: 'run-A'`, then session B emits `phase:start` with `runId: 'run-B'`, then A emits `plan:start`, then B emits `plan:start`) - asserts A's `plan:start` has `runId: 'run-A'` and B's `plan:start` has `runId: 'run-B'`
- [ ] New test in `test/session.test.ts` sends events with different pre-existing `sessionId` values through `withSessionId` and asserts each event retains its original `sessionId`
- [ ] In `withRunId`, the `phase:end` yield uses `event.runId ?? currentRunId` (not `currentRunId ?? event.runId`)
- [ ] In `withRunId`, the `session:end` yield uses `event.runId ?? lastRunId` (not `lastRunId`)
- [ ] In `withRunId`, the general yield uses `event.runId ?? currentRunId` (not `currentRunId`)
- [ ] In `withSessionId`, the yield uses `event.sessionId ?? sessionId` (not `sessionId ?? event.sessionId`)
- [ ] In `buildSinglePrd`, both `this.compile()` and `this.build()` are wrapped with `withRunId` before yielding
- [ ] In `recorder.ts`, `bufferedSessionStarts` is a `Map<string, EforgeEvent>` and each `session:start` is keyed by its `sessionId`
