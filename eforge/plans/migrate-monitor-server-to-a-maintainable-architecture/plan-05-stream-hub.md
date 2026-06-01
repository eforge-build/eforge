---
id: plan-05-stream-hub
name: Extract session and daemon SSE streams, event parsing, polling, heartbeat,
  semantic daemon-event reactions, broadcast, and subscriber cleanup into
  stream-focused modules.
branch: migrate-monitor-server-to-a-maintainable-architecture/stream-hub
---

# Stream Hub

## Architecture Reference

This module implements the architecture sections **Target package layout / `streams/*`**, **StreamHub contract**, **Projection contracts**, and **Module implementation boundaries / `stream-hub`**.

Key constraints from architecture:
- `packages/monitor/src/server.ts` is owned by `server-composition-coverage`; this module creates stream-focused modules and direct tests but does not wire or trim `server.ts`.
- Session and daemon SSE streams must keep the existing `stream:hello` first-frame contract, Last-Event-ID replay semantics, live-only daemon heartbeat behavior, and subscriber cleanup behavior.
- Stream hello snapshots must call projection modules for queue items, stack layers, auto-build state, heartbeat shape, and event hydration so REST and SSE read models cannot drift after final wiring.
- The stream hub owns polling timers, heartbeat timers, per-session subscribers, daemon-event subscribers, semantic daemon-event reactions, broadcast, and cleanup.
- Event parsing must continue to call `safeParseEforgeEvent(value)` through the single helper created by `projections-read-models`; stream modules must not add a second parser implementation.
- No daemon HTTP route, request body, response body, SSE frame shape, or `DAEMON_API_VERSION` change is part of this module.

## Scope

### In Scope
- Create `packages/monitor/src/streams/` modules for:
  - SSE frame formatting and Last-Event-ID parsing helpers;
  - a stream-owned event-parser facade;
  - per-session SSE attach, hello snapshot, replay, live delivery, and terminal-session close behavior;
  - daemon-event SSE attach, hello snapshot, replay, live delivery, heartbeat payload delivery, and stack-sync snapshot inclusion;
  - `createStreamHub(context, options?)` with timers, subscriber sets, semantic daemon-event reactions, broadcast, subscriber counts, heartbeat object construction, and idempotent stop.
- Use `MonitorContext` from `packages/monitor/src/context.ts` and `MonitorStreamHub` / compatibility types from `packages/monitor/src/types.ts`.
- Use projection helpers from `packages/monitor/src/projections/` for event hydration, queue items, stack layers, and auto-build/heartbeat projections.
- Use the existing `writeHello` helper from `packages/monitor/src/sse-handshake.ts` for every stream hello frame.
- Use the existing `reactToDaemonEvent` helper from `packages/monitor/src/daemon-event-reactions.ts` for semantic daemon-event side effects.
- Add direct tests for stream modules using real `MonitorDB`, real Node HTTP servers, and real filesystem fixtures.
- Keep all created implementation files at or below 600 lines; add durable semantic region markers to any created implementation file that exceeds 300 lines.

### Out of Scope
- No edits to `packages/monitor/src/server.ts`.
- No edits to `packages/monitor/src/routes/index.ts` or feature route modules.
- No route registration or route handler migration.
- No changes to `packages/monitor/src/context.ts`, `packages/monitor/src/types.ts`, or `packages/monitor/src/projections/*` unless implementation discovers an unmet dependency and this plan is revised first.
- No duplicate implementation of `parseEventRow` or direct stream-layer calls to `safeParseEforgeEvent`.
- No change to `sse-handshake.ts`, `daemon-event-reactions.ts`, `stack-sync-service.ts`, or `db.ts`.
- No daemon API version bump, DB schema change, recorder change, scheduler change, plugin change, or Pi extension change.

## Implementation Approach

### Overview

Add the stream layer as an unused-but-compiled building block. Later route and final-composition modules will replace the current `server.ts` nested SSE functions with calls to `streamHub.attachSession(req, res, id)` and `streamHub.attachDaemon(req, res)`.

Implementation order:
1. Add small SSE utilities for headers, data-frame serialization, named-frame serialization, and Last-Event-ID parsing.
2. Add `streams/event-parser.ts` as the stream-owned import surface that re-exports the parser/hydration helpers from `projections/event-hydration.ts`.
3. Add `session-stream.ts` for session hello/replay/live-delivery behavior.
4. Add `daemon-stream.ts` for daemon hello/replay/live-delivery and heartbeat object construction.
5. Add `stream-hub.ts` to own subscriber sets, timers, semantic reaction cursor, broadcast, and cleanup.
6. Add direct stream tests that instantiate `MonitorContext` and `StreamHub`, attach them to a tiny Node HTTP server, and assert wire output.

### Key Decisions

1. **Do not edit `server.ts` in this module.**
   - Rationale: final composition owns the large-file rewrite. Keeping this module additive avoids conflicting edits while providing stable imports for route modules and the final composition module.

2. **Use a stream-owned parser facade instead of a second parser implementation.**
   - Rationale: `projections-read-models` owns the one `parseEventRow` implementation during the staged migration. `streams/event-parser.ts` re-exports `parseEventRow`, `hydrateEforgeEvent`, `hydrateRecentDaemonActivity`, and session-status helpers from `projections/event-hydration.ts`, so stream code has the final import path without duplicating `safeParseEforgeEvent` usage.

3. **Keep `stream:hello` as the first write in every attach path.**
   - Rationale: client `subscribeWithSnapshot` captures the cursor from `stream:hello`. `session-stream.ts` and `daemon-stream.ts` call `writeHello()` before replaying historical deltas or registering subscribers.

4. **Preserve current Last-Event-ID parsing semantics.**
   - Rationale: current code uses `parseInt`, accepts non-negative integers, and treats missing, negative, or non-numeric values as an initial connect. The shared helper in `streams/sse.ts` keeps those semantics for both stream kinds.

5. **Keep daemon semantic reactions independent of connected subscribers.**
   - Rationale: auto-build wakeups are driven by persisted daemon events and must fire even when `subscriberCount` is zero. `stream-hub.ts` starts the poll timer at hub creation, initializes the reaction cursor from `db.getMaxDaemonEventId()`, and advances that cursor for every examined row before parsing.

6. **Use projection modules for every stream hello read model.**
   - Rationale: daemon `stream:hello` must match REST payloads for runs, queue, session metadata, auto-build, stack layers, heartbeat liveness, recent activity, and stack-sync status. The hub queries DB rows directly only where `MonitorDB` already returns client-owned wire shapes (`getRuns`, `getSessionMetadataBatch`, `getDaemonEventsAfter`).

7. **Preserve current broadcast scope.**
   - Rationale: `MonitorServer.broadcast()` currently writes named frames such as `monitor:shutdown-pending` to per-session subscribers only. `StreamHub.broadcast(eventName, data)` keeps that scope; daemon-event subscribers receive persisted daemon events and live heartbeats, not monitor shutdown named frames.

8. **Make timer intervals injectable for tests only.**
   - Rationale: production keeps `POLL_INTERVAL_MS = 200` and `HEARTBEAT_INTERVAL_MS = 10_000`. `createStreamHub(context, { pollIntervalMs, heartbeatIntervalMs, clock })` lets direct tests use short intervals and deterministic timestamps without changing the public `MonitorStreamHub` interface consumed by routes.

## Files

### Create

- `packages/monitor/src/streams/sse.ts` — shared SSE utility functions.
  - Export `SSE_HEADERS` or `writeSseHeaders(res)` with the current text/event-stream, no-cache, keep-alive, and CORS headers.
  - Export `parseLastEventIdHeader(headers): number | undefined` using current parse semantics: missing, NaN, non-integer, or negative values return `undefined`; non-negative parsed integers return that value.
  - Export `writeJsonDataFrame(res, payload, id?)` that serializes JSON once, splits multiline JSON into `data:` lines, includes `id:` only when an id is passed, and writes the trailing blank line.
  - Export `writeNamedFrame(res, eventName, data)` for `MonitorServer.broadcast()` named frames.
  - Export `safeEnd(res)` for stop/terminal-session cleanup that swallows end errors.

- `packages/monitor/src/streams/event-parser.ts` — stream-owned parser facade.
  - Re-export `parseEventRow`, `hydrateEforgeEvent`, `hydrateRecentDaemonActivity`, and `deriveSessionStreamStatus` from `../projections/event-hydration.js`.
  - Do not import `safeParseEforgeEvent` in this file.

- `packages/monitor/src/streams/session-stream.ts` — per-session stream behavior.
  - Export `SessionSubscriber` with `res`, `sessionId`, and `lastSeenId`.
  - Export `attachSessionStream({ context, subscribers, req, res, id })`.
  - Export `deliverSessionDeltas(context, subscriber)` for the poll loop.
  - Export `buildSessionHello(context, id)` for direct tests; it resolves run IDs through `context.resolveSessionId(id)`, loads all session events, computes `cursor`, computes `status` via projection helpers, and returns raw snapshot events as `{ id, data }` without event hydration.
  - Preserve terminal behavior: sessions with `completed` or `failed` status write `stream:hello`, end the response, and are not added to the subscriber set.
  - Preserve reconnect behavior: when Last-Event-ID is present, replay parsed events with `id > Last-Event-ID` after the hello frame; when absent, set `lastSeenId` to the hello cursor and skip historical replay.

- `packages/monitor/src/streams/daemon-stream.ts` — daemon stream behavior and heartbeat projection adapter.
  - Export `DaemonSubscriber` with `res` and `lastSeenId`.
  - Export `attachDaemonStream({ context, subscribers, req, res, startedAtMs, subscriberCount, clock })`.
  - Export `deliverDaemonDeltas(context, subscriber)` for the poll loop.
  - Export `buildDaemonHello(context, options)` for direct tests; it returns the hello cursor and the snapshot object passed to `writeHello()`.
  - Export `buildHeartbeatObject(context, options)` returning `DaemonStreamSnapshot['liveness']` from the auto-build projection helper.
  - Build `recentActivity` with `hydrateRecentDaemonActivity(db.getDaemonEventsAfter(Math.max(0, helloCursor - 20)), helloCursor)`.
  - Build `queue` with `loadQueueItemsSync(context.queuePaths.queueDir, context.queuePaths.lockDir)` when `context.cwd` and queue paths exist; otherwise `[]`.
  - Build `stackLayers` with `stackLayersToWire(context.cwd)` when `context.cwd` exists; otherwise `[]`.
  - Build `stackSyncStatus` with `loadSyncStatusForRouteSync(context.cwd)` and include the field only when `last` or `current` is present, matching current `server.ts` behavior.
  - Replay only persisted daemon rows from `db.getDaemonEventsAfter(lastEventId)`; heartbeat frames are never replayed because they have no SSE `id:` and are not persisted.

- `packages/monitor/src/streams/stream-hub.ts` — public stream hub factory.
  - Export `StreamHub` extending or aliasing `MonitorStreamHub` from `../types.js`.
  - Export `StreamHubOptions` with optional `pollIntervalMs`, `heartbeatIntervalMs`, and `clock` test seams.
  - Export `createStreamHub(context, options?): StreamHub`.
  - Own `Set<SessionSubscriber>` and `Set<DaemonSubscriber>`.
  - Initialize `reactionCursor` from `context.db.getMaxDaemonEventId()` at creation time.
  - Start a poll timer that first scans daemon events for semantic reactions, then delivers per-session deltas, then delivers daemon deltas.
  - Start a heartbeat timer that returns immediately when the daemon subscriber set is empty and otherwise writes live-only JSON data frames without `id:`.
  - Call `.unref()` on timers when the runtime timer object exposes it.
  - Implement `subscriberCount` as the sum of session and daemon subscriber set sizes.
  - Implement `broadcast(eventName, data)` by writing named frames to per-session subscribers only.
  - Implement `buildHeartbeatObject()` by delegating to `daemon-stream.ts` with the current daemon subscriber count.
  - Implement idempotent `stop()` that clears both timers, ends all responses, clears both subscriber sets, and tolerates repeated calls.

- `packages/monitor/src/__tests__/streams-sse.test.ts` — unit tests for SSE helpers.
  - Test exact data-frame formatting with and without an id.
  - Test named-frame formatting.
  - Test Last-Event-ID parsing for missing, `0`, positive integers, negative values, and non-numeric values.

- `packages/monitor/src/__tests__/streams-session-stream.test.ts` — direct tests for per-session stream behavior.
  - Use `openDatabase`, `createMonitorContext`, `createStreamHub`, and a small Node HTTP server that calls `hub.attachSession(req, res, id)`.
  - Test fresh connect to a running session: first block is `event: stream:hello`, no `id:` on hello, snapshot has all raw events, and no historical delta is written without Last-Event-ID.
  - Test terminal completed and failed sessions: hello is written and the server closes the response without increasing `hub.subscriberCount`.
  - Test reconnect with Last-Event-ID: hello is first, only rows with `id > Last-Event-ID` are replayed as data frames, and `lastSeenId` advances through delivered rows.
  - Test run-id resolution by connecting with a run id whose DB row maps to a session id.

- `packages/monitor/src/__tests__/streams-daemon-stream.test.ts` — direct tests for daemon stream behavior.
  - Use real DB rows and a small HTTP server that calls `hub.attachDaemon(req, res)`.
  - Test empty daemon log: hello cursor is `0`, `recentActivity` is `[]`, and no non-hello frame appears before the test timeout.
  - Test populated daemon log: hello cursor equals `db.getMaxDaemonEventId()` and `recentActivity` contains hydrated daemon events with ids at or below the cursor.
  - Test reconnect with Last-Event-ID: hello is first and only daemon rows with higher ids are replayed.
  - Test live polling: a daemon row inserted after connection is delivered to all daemon subscribers.
  - Test malformed daemon rows are skipped in delivery and do not prevent a later valid row in the same poll batch from being delivered.
  - Test heartbeat frames have no `id:`, contain `type: "daemon:heartbeat"`, and include scheduler capacity from context helpers.
  - Test `stackSyncStatus` is omitted when absent and included when `loadSyncStatusForRouteSync` returns `last` or `current`.

- `packages/monitor/src/__tests__/streams-stream-hub.test.ts` — direct tests for hub lifecycle and semantic reactions.
  - Test `subscriberCount` includes both session and daemon subscribers and decrements after request close.
  - Test `broadcast()` writes named frames to session subscribers and does not write the same named frame to daemon subscribers.
  - Test `stop()` clears subscribers, ends open responses, and can be called twice.
  - Test an `enqueue:complete` daemon row inserted after hub creation triggers one `notifyQueueMutation('enqueue')` through `AutoBuildSupervisor` with zero subscribers.
  - Test a pre-existing `enqueue:complete` row does not trigger a reaction because `reactionCursor` starts at `db.getMaxDaemonEventId()`.
  - Test a malformed daemon row advances the reaction cursor and a later valid `enqueue:complete` row still triggers exactly one mutation.

### Modify

No existing production source files are modified by this module.

No shared-file edit regions are required because this module does not edit files listed in the architecture Shared File Registry. If implementation discovers an unavoidable edit to `context.ts`, `types.ts`, `projections/*`, `server.ts`, or `routes/index.ts`, stop and revise this plan with a non-overlapping shared-file region before coding.

## Implementation Details

### Session stream details

`attachSessionStream` uses this sequence:
1. Resolve `id` through `context.resolveSessionId(id)`.
2. Write current SSE headers.
3. Load all session events and session runs.
4. Build `sessionCursor` from the last event id or `0`.
5. Build the snapshot with `status` and raw event rows `{ id, data }`.
6. Call `writeHello(res, sessionCursor, snapshot)` before any replay frame.
7. If status is `completed` or `failed`, end the response and return.
8. Parse Last-Event-ID.
9. Replay parsed events after the cursor only when Last-Event-ID is present.
10. Add the subscriber with `lastSeenId` equal to the replay cursor or hello cursor.
11. Remove the subscriber on request close.

The snapshot intentionally keeps raw `data` strings, matching current `serveSSE` and `SessionStreamSnapshotSchema`. Replay and live delta frames emit hydrated `EforgeEvent` JSON by calling the parser facade.

### Daemon stream details

`attachDaemonStream` uses this sequence:
1. Write current SSE headers.
2. Compute `helloCursor` from `db.getMaxDaemonEventId()`.
3. Build `recentActivity` from daemon rows after `Math.max(0, helloCursor - 20)` and trim entries with `id > helloCursor`.
4. Build liveness, runs, queue, session metadata, auto-build, stack layers, and optional stack-sync status.
5. Call `writeHello(res, helloCursor, snapshot)` before any replay frame.
6. Parse Last-Event-ID.
7. Replay parsed daemon rows after Last-Event-ID only when the header is present.
8. Add the daemon subscriber with `lastSeenId` equal to the replay cursor or hello cursor.
9. Remove the subscriber on request close.

`buildHeartbeatObject` computes `runningBuilds`, `queueDepth`, scheduler limit, subscriber count, uptime, and timestamp through the context/projection helpers. Live heartbeat delivery writes only `data: {json}\n\n`; it never writes `id:` or `event:`.

### Poll and reaction details

The stream hub poll tick runs in this order:
1. Semantic daemon-event reaction scan when `context.daemonState` exists.
2. Per-session subscriber delivery.
3. Daemon-event subscriber delivery.

The reaction scan catches all errors and advances `reactionCursor` for every row examined before parsing. This preserves the current behavior where one malformed daemon row cannot block later `enqueue:complete` reactions.

Subscriber delivery catches per-subscriber errors and continues with other subscribers. Parsed-null rows are skipped. `lastSeenId` advances only after a row is successfully written, matching current server behavior.

### Test seams

`StreamHubOptions` are not part of route-facing API. Tests can pass short intervals and a deterministic clock. Production callers omit options and receive current intervals and wall-clock timestamps.

## Testing Strategy

### Unit Tests
- SSE formatting and Last-Event-ID parsing in `streams-sse.test.ts`.
- Session hello construction and replay behavior through a small HTTP server in `streams-session-stream.test.ts`.
- Daemon hello construction, replay behavior, heartbeat payloads, and stack-sync snapshot inclusion through a small HTTP server in `streams-daemon-stream.test.ts`.
- Hub subscriber accounting, broadcast scope, idempotent stop, and semantic daemon-event reactions in `streams-stream-hub.test.ts`.

### Integration Tests
- Existing in-process `startServer` tests remain unchanged in this module because `server.ts` still owns production routing until final composition.
- After final wiring, these existing tests become the behavior gate for the extracted streams:
  - `packages/monitor/src/__tests__/session-sse-handshake.test.ts`;
  - `packages/monitor/src/__tests__/daemon-sse-handshake.test.ts`;
  - `packages/monitor/src/__tests__/stream-hello-parity.test.ts`;
  - `test/daemon-events-stream.test.ts`;
  - auto-build route tests that assert persisted `enqueue:complete` reactions with zero subscribers.

## Verification

- [ ] `packages/monitor/src/streams/stream-hub.ts` exports `createStreamHub(context, options?)`.
- [ ] `createStreamHub(context)` returns an object with `attachSession`, `attachDaemon`, `broadcast`, `subscriberCount`, `stop`, and `buildHeartbeatObject`.
- [ ] `packages/monitor/src/streams/event-parser.ts` imports zero symbols named `safeParseEforgeEvent`.
- [ ] `rg "safeParseEforgeEvent" packages/monitor/src/streams` prints zero lines.
- [ ] `rg "['\"]\/api\/" packages/monitor/src/streams` prints zero lines.
- [ ] `git diff -- packages/monitor/src/server.ts packages/monitor/src/routes/index.ts packages/monitor/src/context.ts packages/monitor/src/types.ts packages/monitor/src/projections` prints no diff for this module.
- [ ] `pnpm vitest run packages/monitor/src/__tests__/streams-sse.test.ts packages/monitor/src/__tests__/streams-session-stream.test.ts packages/monitor/src/__tests__/streams-daemon-stream.test.ts packages/monitor/src/__tests__/streams-stream-hub.test.ts` exits 0.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm maintainability:check` exits 0.
- [ ] `wc -l packages/monitor/src/streams/*.ts` reports every created stream implementation file at or below 600 lines.
- [ ] Every created `packages/monitor/src/streams/*.ts` implementation file over 300 lines contains balanced durable `// --- eforge:region <semantic-slug> ---` and `// --- eforge:endregion <semantic-slug> ---` markers.
- [ ] Direct stream tests assert `stream:hello` is the first SSE block for both session and daemon attach paths.
- [ ] Direct stream tests assert live daemon heartbeat frames contain no `id:` line.
- [ ] Direct stream tests assert `enqueue:complete` semantic reactions fire once for post-start rows and zero times for rows that predate hub creation.

<build-config>
{
  "build": ["implement", "test-cycle", "review-cycle"],
  "review": {
    "strategy": "parallel",
    "perspectives": ["code", "test"],
    "maxRounds": 2,
    "evaluatorStrictness": "standard"
  }
}
</build-config>
