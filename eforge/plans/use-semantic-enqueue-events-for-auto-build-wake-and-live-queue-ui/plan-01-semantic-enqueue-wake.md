---
id: plan-01-semantic-enqueue-wake
name: Semantic Enqueue Wake and Queue Projection
branch: use-semantic-enqueue-events-for-auto-build-wake-and-live-queue-ui/plan-01-semantic-enqueue-wake
agents:
  builder:
    effort: high
    rationale: The fix crosses daemon DB polling, scheduler wake semantics, and
      client/UI event projection; careful idempotency and
      subscriber-independence are required.
  reviewer:
    effort: high
    rationale: Review must check that wake side effects no longer depend on worker
      process exit and that run-state authority remains daemon:run:upsert.
  tester:
    effort: high
    rationale: Regression tests must cover asynchronous persisted-event polling
      without connected SSE subscribers and queue projection idempotency.
---

# Semantic Enqueue Wake and Queue Projection

## Architecture Context

The daemon is the orchestration authority for queue wake inputs and live daemon state. The engine and worker subprocesses emit domain events; the daemon records, streams, projects, and reacts to those events. The current enqueue route violates this boundary by tying `notifyQueueMutation('enqueue')` to the enqueue worker process exit callback. The semantic condition for waking auto-build is the persisted `enqueue:complete` event, because that event is emitted after the queue file exists and the enqueue run has completed its domain work.

This plan keeps `daemon:run:upsert` as the sole source for run rows. The new `enqueue:complete` projection only affects `DaemonState.queue`.

## Implementation

### Overview

Add a daemon-owned semantic event reaction path that scans newly persisted daemon-stream events, dedupes by event row id, and calls the auto-build controller when it observes `enqueue:complete`. Remove the enqueue worker-exit wake from `POST /api/enqueue`. Add an idempotent client event-registry projector for `enqueue:complete` so the monitor UI shows a pending queue item immediately, before `queue:prd:discovered` is emitted.

### Key Decisions

1. React to `enqueue:complete` rows from the daemon DB stream, not to worker process lifecycle.
   - The reaction cursor starts at `db.getMaxDaemonEventId()` when the server starts and advances by DB row id. This avoids replaying old enqueue completions on daemon startup; pending files from older events remain the watcher startup scan's responsibility.
2. Keep the reaction path independent of SSE subscribers.
   - Run the reaction scan from server-owned state, either in the existing poll timer before/after subscriber delivery or in a sibling unref'ed timer. Do not put the wake behind `daemonSubscribers.size > 0` or inside `serveDaemonEventsSSE`.
3. Keep worker exit cleanup-only for enqueue.
   - Do not pass an `onExit` callback from the enqueue route for scheduler wake. The `WorkerTracker` interface may keep its optional callback for other commands and cleanup, but enqueue wake must not depend on it.
4. Add queue projection without run projection.
   - `eventRegistry['enqueue:complete'].project` inserts `{ id: event.id, title: event.title, status: 'pending' }` only when no queue item with that id exists. It must not mutate `runs`, `autoBuild`, or heartbeat state.
5. Preserve idempotency with later queue lifecycle events.
   - Duplicate `enqueue:complete` rows and subsequent `queue:prd:discovered` rows must not duplicate queue items. `queue:prd:start` must still transition the item to `running`.

## Scope

### In Scope

- Add a narrow daemon semantic-event reaction helper for `enqueue:complete`.
- Wire the reaction helper into `startServer` with a DB row-id cursor and no SSE dependency.
- Remove the enqueue route's `spawnWorker('enqueue', args, onExitWake)` dependency.
- Add an `enqueue:complete` queue projector in `packages/client/src/event-registry.ts`.
- Update route, registry, reducer, parity, and legacy reducer tests for the new behavior.
- Validate playbook enqueue and apply-recovery route consistency: those paths either keep their synchronous `notifyQueueMutation` calls or receive live queue projection through existing queue/enqueue events.
- Leave `DAEMON_API_VERSION` unchanged unless implementation adds or changes wire fields.

### Out of Scope

- Scheduler algorithm changes.
- Engine enqueue event schema changes.
- UI polling as the primary fix.
- Plugin or Pi command behavior changes.
- Database migrations.

## Files

### Create

- `packages/monitor/src/daemon-event-reactions.ts` — Small daemon-owned reaction helper that maps semantic events to daemon side effects. Define a narrow sink interface such as `{ notifyQueueMutation(reason: AutoBuildQueueMutationReason): void }` and react only to `enqueue:complete` by sending reason `enqueue`.

### Modify

- `packages/monitor/src/server.ts` — Import the reaction helper, initialize a reaction cursor from `db.getMaxDaemonEventId()`, scan `db.getDaemonEventsAfter(cursor)` on the server-owned poll path, parse rows via the existing event parser, advance the cursor by row id, and invoke the reaction helper for parsed events. Clear the reaction timer on `stop()` if a separate timer is used. Change `POST /api/enqueue` so `spawnWorker('enqueue', args)` is called without an enqueue wake callback.
- `packages/monitor/src/__tests__/auto-build-route.test.ts` — Replace the worker-exit wake assertion with regression tests that: (1) the enqueue route does not pass an enqueue wake callback, and (2) inserting a persisted `enqueue:complete` event after server start produces `mutation:enqueue` while `server.subscriberCount` is `0`.
- `packages/client/src/event-registry.ts` — Add a `project` function to `enqueue:complete` that inserts a pending `QueueItem` if absent and leaves all non-queue state unchanged. Keep comments documenting that `daemon:run:upsert` remains authoritative for runs.
- `packages/client/src/__tests__/events-schemas.test.ts` — Add direct event-registry tests for `enqueue:complete` queue insertion, duplicate no-op behavior, and no run mutation.
- `packages/monitor-ui/src/lib/__tests__/daemon-reducer.test.ts` — Add reducer tests showing `ADD_EVENT` for `enqueue:complete` inserts the minimal pending item, appends activity, dedupes an existing queue item, and does not alter existing runs.
- `packages/monitor-ui/test/daemon-reducer-parity.test.ts` — Add parity tests for `enqueue:complete` alone and for `enqueue:complete` followed by `queue:prd:discovered` and `queue:prd:start`.
- `test/monitor-reducer.test.ts` — Update the legacy registry assertion that currently expects `enqueue:complete.project` to be undefined. It must now assert the projector exists for queue projection while `daemon:run:upsert` remains the only run-state projector.

## Implementation Notes

- The reaction scan must update its cursor for every row it examines, including rows that fail event parsing, so one malformed historical row cannot block future enqueue completions.
- Prefer processing reactions before or independently from SSE subscriber delivery. Subscriber delivery errors must not stop the reaction cursor.
- The semantic reaction must be safe when auto-build is disabled; `AutoBuildSupervisor.notifyQueueMutation('enqueue')` already owns disabled/running/inert watcher behavior.
- The `enqueue:complete` projector must use `event.id` for `QueueItem.id`, not `event.planSet` or `event.filePath`.
- Do not bump `packages/client/src/api-version.ts` unless additional wire fields are introduced.

## Verification

- [ ] `POST /api/enqueue` returns `200` and the test worker receives no enqueue wake `onExit` callback.
- [ ] With `server.subscriberCount === 0`, inserting a persisted `enqueue:complete` row after server start causes exactly one observed `mutation:enqueue` call within the test timeout.
- [ ] Duplicate `enqueue:complete` events for the same PRD id leave `state.queue` with one item.
- [ ] `enqueue:complete` followed by `queue:prd:discovered` leaves one pending queue item, then `queue:prd:start` changes that item to `running`.
- [ ] Existing runs remain unchanged after applying an `enqueue:complete` event; `daemon:run:upsert` still updates runs.
- [ ] Playbook enqueue and apply-recovery route coverage confirms those paths emit or trigger a queue mutation without waiting for worker process exit, and their live queue state is represented by existing queue events or the new `enqueue:complete` projector.
- [ ] Targeted tests pass: `pnpm vitest run packages/monitor/src/__tests__/auto-build-route.test.ts packages/client/src/__tests__/events-schemas.test.ts packages/monitor-ui/src/lib/__tests__/daemon-reducer.test.ts packages/monitor-ui/test/daemon-reducer-parity.test.ts test/monitor-reducer.test.ts`.
- [ ] `pnpm type-check` passes.
