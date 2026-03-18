---
title: Fix: withSessionId overwrites engine-emitted sessionId in queue mode
created: 2026-03-18
status: pending
---

## Problem / Motivation

In queue mode (`eforge run --queue` or `eforge queue run`), the schaake-os tracker does not receive valid `session:start` notifications because `EFORGE_SESSION_ID` is missing from hook env vars. Direct `eforge run` works fine. The issue is profile-agnostic - it affects all profiles processed via queue mode.

The root cause is in `withSessionId()` middleware behavior. In queue mode, the CLI wraps events with `withSessionId(events, { emitSessionStart: false, emitSessionEnd: false })` and no `sessionId` option (`src/cli/index.ts:238`, `src/cli/index.ts:506`). The middleware's local `sessionId` starts as `undefined`. The engine's `runQueue()` emits `session:start` with a valid `sessionId` (`src/engine/eforge.ts:614`) *before* the first `phase:start` event. On `src/engine/session.ts:44`, `{ ...event, sessionId }` spreads `sessionId: undefined` over the engine's valid value, wiping it out. Downstream, the hooks middleware at `src/engine/hooks.ts:142` checks `event.sessionId` - finds `undefined` - and never sets `EFORGE_SESSION_ID`.

## Goal

Ensure `withSessionId()` never overwrites an engine-emitted `sessionId` with `undefined`, so queue-mode hooks receive valid `EFORGE_SESSION_ID` values just like direct `eforge run`.

## Approach

Two targeted changes in `src/engine/session.ts`:

1. **Generalize sessionId derivation** (lines 33-36): Replace the `phase:start`-only check with a generic pick-up from any event that already carries a `sessionId`. This handles queue-mode `session:start` events arriving before `phase:start`.

```typescript
// Before (only derives from phase:start):
if (!sessionId && event.type === 'phase:start') {
  sessionId = event.runId;
}

// After (derives from any event with sessionId, falls back to phase:start runId):
if (!sessionId) {
  if (event.sessionId) {
    sessionId = event.sessionId;
  } else if (event.type === 'phase:start') {
    sessionId = event.runId;
  }
}
```

2. **Never overwrite with undefined** (line 44): Use nullish coalescing so events that already carry a `sessionId` are not clobbered.

```typescript
// Before:
yield { ...event, sessionId } as EforgeEvent;

// After:
yield { ...event, sessionId: sessionId ?? event.sessionId } as EforgeEvent;
```

Follow TDD execution order:

1. **Add failing test first** in `test/session.test.ts` - a queue-mode passthrough test. Run `pnpm test test/session.test.ts` to confirm it fails (sessionId will be `undefined` on the spread events).
2. **Apply fix** to `src/engine/session.ts` - both changes above.
3. **Run tests again** - confirm the new test passes and all existing tests still pass.
4. `pnpm type-check` - no type errors.
5. Manual: queue an errand PRD, run `eforge run --queue`, confirm schaake-os tracker receives the session.

## Scope

**In scope:**
- Fix `withSessionId()` in `src/engine/session.ts` (two changes)
- Add test in `test/session.test.ts` for queue-mode passthrough preserving engine-emitted sessionIds

**Out of scope:**
- Changes to the CLI layer (`src/cli/index.ts`)
- Changes to hooks middleware (`src/engine/hooks.ts`)
- Changes to engine queue runner (`src/engine/eforge.ts`)

## Acceptance Criteria

- `withSessionId` with `{ emitSessionStart: false, emitSessionEnd: false }` and no pre-set `sessionId` preserves engine-emitted `session:start`/`session:end` sessionIds on all yielded events
- No extra `session:start`/`session:end` events are emitted by the middleware in queue-mode passthrough
- All events in the passthrough carry the engine-emitted `sessionId` (not `undefined`)
- New test in `test/session.test.ts` validates queue-mode passthrough behavior:

```typescript
it('preserves engine-emitted sessionId in queue mode passthrough', async () => {
  const events: EforgeEvent[] = [
    { type: 'session:start', sessionId: 'queue-session-1', timestamp: '...' },
    { type: 'phase:start', runId: 'run-1', planSet: 'test', command: 'compile', timestamp: '...' },
    { type: 'phase:end', runId: 'run-1', result: { status: 'completed', summary: 'done' }, timestamp: '...' },
    { type: 'session:end', sessionId: 'queue-session-1', result: { status: 'completed', summary: 'done' }, timestamp: '...' },
  ];

  const result = await collect(withSessionId(asyncIterableFrom(events), {
    emitSessionStart: false,
    emitSessionEnd: false,
  }));

  expect(result).toHaveLength(4);
  expect(result.every(e => e.sessionId === 'queue-session-1')).toBe(true);
});
```

- Existing session tests continue to pass
- `pnpm type-check` passes with no errors
- Manual verification: queue an errand PRD, run `eforge run --queue`, confirm schaake-os tracker receives `EFORGE_SESSION_ID` in hook env vars
