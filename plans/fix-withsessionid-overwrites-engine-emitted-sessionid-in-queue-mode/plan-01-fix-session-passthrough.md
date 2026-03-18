---
id: plan-01-fix-session-passthrough
name: Fix withSessionId Queue Mode Passthrough
depends_on: []
branch: fix-withsessionid-overwrites-engine-emitted-sessionid-in-queue-mode/fix-session-passthrough
---

# Fix withSessionId Queue Mode Passthrough

## Architecture Context

`withSessionId()` in `src/engine/session.ts` is middleware that stamps `sessionId` on every event flowing through the pipeline. In queue mode, the engine's `runQueue()` emits `session:start` events with valid sessionIds *before* any `phase:start`, but the middleware only derives sessionId from `phase:start` events (line 34). Combined with the unconditional spread on line 44, engine-emitted sessionIds get overwritten with `undefined` - breaking hook env vars downstream.

## Implementation

### Overview

Two changes in `src/engine/session.ts`:
1. Generalize sessionId derivation to pick up from any event that already carries a sessionId (not just `phase:start`)
2. Use nullish coalescing on the yield spread so events with existing sessionIds are never clobbered by `undefined`

### Key Decisions

1. **Generic sessionId pick-up over event-type-specific**: Rather than adding `session:start` as another special case alongside `phase:start`, check `event.sessionId` on any event type. This is future-proof - any event carrying a sessionId will be respected.
2. **Nullish coalescing on yield**: `sessionId: sessionId ?? event.sessionId` ensures that if the middleware's local sessionId is still `undefined`, the event's own sessionId survives the spread. This is the critical safety net.

### TDD Execution Order

1. Add a failing test in `test/session.test.ts` that simulates queue-mode passthrough (engine-emitted `session:start` with sessionId, `emitSessionStart: false`, `emitSessionEnd: false`, no pre-set sessionId)
2. Run `pnpm test test/session.test.ts` to confirm the test fails (sessionId will be `undefined`)
3. Apply the two-line fix in `src/engine/session.ts`
4. Run tests again to confirm the new test passes and all existing tests still pass
5. Run `pnpm type-check`

## Scope

### In Scope
- Fix sessionId derivation in `withSessionId()` (line 34 area)
- Fix sessionId spread in `withSessionId()` (line 44)
- New test case in `test/session.test.ts` for queue-mode passthrough

### Out of Scope
- CLI layer changes (`src/cli/index.ts`)
- Hooks middleware (`src/engine/hooks.ts`)
- Engine queue runner (`src/engine/eforge.ts`)

## Files

### Modify
- `src/engine/session.ts` - Two changes: (1) generalize sessionId derivation on lines 34-36 to pick up from any event's sessionId before falling back to phase:start runId, (2) use nullish coalescing on line 44 yield to prevent undefined overwrite
- `test/session.test.ts` - Add test case: "preserves engine-emitted sessionId in queue mode passthrough" that sends events with pre-existing sessionIds through withSessionId with `{ emitSessionStart: false, emitSessionEnd: false }` and no pre-set sessionId, asserting all output events retain the engine-emitted sessionId

### Detailed Changes

#### `src/engine/session.ts`

**Change 1** (lines 34-36): Replace `phase:start`-only derivation with generic pick-up:

```typescript
// Before:
if (!sessionId && event.type === 'phase:start') {
  sessionId = event.runId;
}

// After:
if (!sessionId) {
  if (event.sessionId) {
    sessionId = event.sessionId;
  } else if (event.type === 'phase:start') {
    sessionId = event.runId;
  }
}
```

**Change 2** (line 44): Nullish coalescing on yield:

```typescript
// Before:
yield { ...event, sessionId } as EforgeEvent;

// After:
yield { ...event, sessionId: sessionId ?? event.sessionId } as EforgeEvent;
```

#### `test/session.test.ts`

Add test after the existing "suppresses session:start/end" test:

```typescript
it('preserves engine-emitted sessionId in queue mode passthrough', async () => {
  const events: EforgeEvent[] = [
    { type: 'session:start', sessionId: 'queue-session-1', timestamp: '2024-01-01T00:00:00Z' },
    { type: 'phase:start', runId: 'run-1', planSet: 'test', command: 'compile', timestamp: '2024-01-01T00:00:01Z' },
    { type: 'phase:end', runId: 'run-1', result: { status: 'completed', summary: 'done' }, timestamp: '2024-01-01T00:01:00Z' },
    { type: 'session:end', sessionId: 'queue-session-1', result: { status: 'completed', summary: 'done' }, timestamp: '2024-01-01T00:02:00Z' },
  ];

  const result = await collect(withSessionId(asyncIterableFrom(events), {
    emitSessionStart: false,
    emitSessionEnd: false,
  }));

  expect(result).toHaveLength(4);
  expect(result.every(e => e.sessionId === 'queue-session-1')).toBe(true);
});
```

## Verification

- [ ] New test "preserves engine-emitted sessionId in queue mode passthrough" passes
- [ ] All existing tests in `test/session.test.ts` pass (8 tests total including the new one)
- [ ] `pnpm type-check` exits with code 0
- [ ] `pnpm test` passes (full suite)
