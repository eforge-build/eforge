---
title: Fix parallel PRD builds mixing events in monitor UI
created: 2026-04-01
---



# Fix parallel PRD builds mixing events in monitor UI

## Problem / Motivation

When the daemon runs two PRDs in parallel (`parallelism=2`), the monitor UI shows events from one build bleeding into the other. The root cause is the `withRunId` middleware in `src/engine/session.ts` - it maintains a single `currentRunId` tracker that gets corrupted when `phase:start` events from parallel PRDs interleave in the multiplexed event stream.

`buildSinglePrd()` correctly stamps `sessionId` on each event per-PRD, and `withSessionId` is NOT applied in queue mode (the ternary in `wrapEvents` skips it). But `withRunId` IS unconditionally applied to the multiplexed stream, causing cross-contamination of `runId` between parallel sessions.

Additionally, the recorder's single `bufferedSessionStart` variable gets overwritten when two PRDs emit `session:start` in quick succession, compounding the issue.

## Goal

Ensure that parallel PRD builds produce correctly isolated event streams in the monitor UI, with each build's events carrying the correct `runId` and `sessionId` without cross-contamination.

## Approach

Apply `withRunId` per sub-generator inside `buildSinglePrd` so events are stamped before entering the shared `AsyncEventQueue`. Make the outer `withRunId` and `withSessionId` middlewares defensive by preserving pre-existing values. Fix the recorder's session-start buffering to support concurrent sessions.

### 1. Apply `withRunId` per sub-generator inside `buildSinglePrd` (primary fix)

**File:** `src/engine/eforge.ts` (lines 830-871)

Wrap `this.compile()` and `this.build()` individually with `withRunId` so intermediate events get the correct `runId` BEFORE entering the `AsyncEventQueue` where parallel PRDs interleave:

```typescript
import { withRunId } from './session.js';

// ~line 830: wrap compile
for await (const event of withRunId(this.compile(prd.filePath, { ... }))) {
  yield { ...event, sessionId: prdSessionId } as EforgeEvent;
  // ...
}

// ~line 860: wrap build
for await (const event of withRunId(this.build(planSetName, { ... }))) {
  yield { ...event, sessionId: prdSessionId } as EforgeEvent;
  // ...
}
```

### 2. Make outer `withRunId` preserve existing `runId` (defensive complement)

**File:** `src/engine/session.ts` (lines 59, 66, 72)

Change the three `runId` stamping lines to prefer existing values:

- Line 59 (`phase:end`): `runId: event.runId ?? currentRunId` (already does this via fallback - verify)
- Line 66 (`session:end`): `runId: event.runId ?? lastRunId` (add `event.runId ??` guard)
- Line 72 (general): `runId: event.runId ?? currentRunId` (add `event.runId ??` guard)

This makes the outer middleware a no-op for pre-stamped events (queue mode) while preserving behavior for non-queue modes where events lack `runId`.

### 3. Harden `withSessionId` to preserve existing `sessionId` (defensive)

**File:** `src/engine/session.ts` (line 32)

Change: `sessionId: sessionId ?? event.sessionId`
To: `sessionId: event.sessionId ?? sessionId`

Not required for the queue-mode bug (since `withSessionId` is skipped in queue mode), but prevents future regressions if someone changes `wrapEvents`.

### 4. Fix recorder's `bufferedSessionStart` for parallel sessions

**File:** `src/monitor/recorder.ts` (lines 17, 33-43, 46-48)

Convert the single `bufferedSessionStart` variable to a `Map<string, EforgeEvent>` keyed by `sessionId` so each PRD's `session:start` is buffered independently and flushed with the correct `phase:start`.

### 5. Add tests for interleaved parallel sessions

**File:** `test/with-run-id.test.ts`

Add a test that simulates interleaved events from two parallel PRDs flowing through `withRunId`, verifying that pre-stamped `runId` values are preserved and unstamped events outside phases remain unstamped.

**File:** `test/session.test.ts`

Add a test for `withSessionId` with events carrying heterogeneous `sessionId` values, verifying each event's `sessionId` is preserved.

## Scope

**In scope:**
- Applying `withRunId` per sub-generator inside `buildSinglePrd` in `src/engine/eforge.ts`
- Making `withRunId` in `src/engine/session.ts` preserve pre-existing `runId` values
- Making `withSessionId` in `src/engine/session.ts` preserve pre-existing `sessionId` values
- Converting `bufferedSessionStart` in `src/monitor/recorder.ts` from a single variable to a `Map<string, EforgeEvent>`
- Adding tests for interleaved parallel session events

**Out of scope:**
- Changes to the `wrapEvents` ternary logic in `src/cli/index.ts`
- Broader refactoring of the event pipeline or queue architecture

**Key files:**
- `src/engine/session.ts` - `withRunId` (lines 45-76), `withSessionId` (lines 17-33)
- `src/engine/eforge.ts` - `buildSinglePrd` (lines 729-902), import section
- `src/monitor/recorder.ts` - `bufferedSessionStart` buffering logic (lines 17-77)
- `src/cli/index.ts` - `wrapEvents` (lines 77-89, confirms middleware chain)
- `test/with-run-id.test.ts` - existing `withRunId` tests
- `test/session.test.ts` - existing `withSessionId` / `runSession` tests

## Acceptance Criteria

- `pnpm test` passes - all existing tests pass and new tests pass
- `pnpm type-check` produces no type errors
- New test in `test/with-run-id.test.ts` verifies that interleaved events from two parallel PRDs flowing through `withRunId` preserve pre-stamped `runId` values and leave unstamped events outside phases unstamped
- New test in `test/session.test.ts` verifies that `withSessionId` preserves each event's existing `sessionId`
- Manual verification: running two PRDs with `parallelism: 2` shows them as separate sessions with distinct, non-bleeding events in the monitor UI
