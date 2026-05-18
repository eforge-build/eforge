---
title: Implement Durable Daemon-Scoped Event Persistence for Live Monitor Queue Updates
created: 2026-05-18
depends_on: ["improve-monitor-daemon-scheduler-fsm-card-reporting"]
profile: gpt-claude-combo
---

# Implement Durable Daemon-Scoped Event Persistence for Live Monitor Queue Updates

## Problem / Motivation

Already-open monitor UI sessions do not show newly queued PRDs until browser reload. A reload works because `stream:hello.queue` reads the queue directory directly, but live subscribers depend on persisted daemon-stream events and currently do not receive parent-level queue/scheduler events.

This matters because the monitor is expected to be live operational state for the daemon. Queue visibility is especially important when auto-build is running, because users need to see new work enter the queue, become running, and leave/failed without manually refreshing.

Classification: **bugfix / focused** with architecture-flavored storage cleanup. Confidence: high.

### Context and Evidence

- Roadmap alignment: `docs/roadmap.md` names the daemon as the single orchestration authority; this fix supports daemon/monitor correctness and does not add a new roadmap feature.
- Live symptom evidence from the active repo: `eforge/queue/improve-monitor-daemon-scheduler-fsm-card-reporting.md` exists on disk and a fresh browser receives it via `stream:hello.queue`, while an already-open browser did not.
- DB evidence from `.eforge/monitor.db`: `enqueue:complete` for `improve-monitor-daemon-scheduler-fsm-card-reporting` exists at event id `234150`, but there are currently `0` persisted `queue:%` or `daemon:scheduler:%` rows. This confirms the live monitor did not have queue lifecycle events to project.
- `packages/client/src/event-registry.ts` already has live queue projectors for `queue:prd:discovered`, `queue:prd:complete`, `queue:complete`, etc.; the UI path is ready if the events reach `/api/daemon-events`.
- `packages/monitor/src/recorder.ts` only calls `db.insertEvent(...)` when `activeRunId` exists. Parent watcher queue/scheduler events usually have no `runId`, so they are not persisted by `withRecording`.
- `packages/monitor/src/db.ts` currently defines `events.run_id TEXT NOT NULL REFERENCES runs(id)`, while comments and `writeDaemonEvent(...)` in `packages/monitor/src/server-main.ts` acknowledge that daemon events are currently stored with a synthetic/unmatched run id and foreign keys disabled.

### Reproduction Steps

Observed reproduction from the current live daemon:

1. Open the monitor UI at `http://localhost:4567/` and leave it open.
2. Enqueue a new PRD while auto-build/monitor remain running.
3. The enqueue session itself appears in the monitor activity/runs while in progress.
4. After enqueue completes, expected: the queue section in the already-open browser shows the new pending PRD.
5. Actual: the already-open browser queue remains stale.
6. Open or reload another browser at the same URL.
7. The fresh browser shows the queued PRD from the `stream:hello.queue` snapshot.

Concrete evidence from the captured incident:

- Queued file exists: `eforge/queue/improve-monitor-daemon-scheduler-fsm-card-reporting.md`.
- DB row exists: `enqueue:complete` for id `improve-monitor-daemon-scheduler-fsm-card-reporting`, title `Improve Monitor Daemon Scheduler FSM Card Reporting`, timestamp `2026-05-18T15:11:35.988Z`.
- DB rows absent: `select count(*) from events where type like 'queue:%' or type like 'daemon:scheduler:%'` returned `0`, so no live queue lifecycle events were available for SSE projection.

### Root Cause

Confirmed root cause: the event recording/storage layer conflates run-correlated events with daemon-owned events.

Code evidence:

- `packages/monitor/src/recorder.ts` computes `const activeRunId = event.runId ?? enqueueRunId` and only persists the event if `activeRunId` is truthy. Parent watcher events such as `queue:prd:discovered`, `daemon:scheduler:dequeued`, `daemon:scheduler:capacity-blocked`, and `queue:complete` generally have no run id, so they are silently dropped by `withRecording`.
- `packages/client/src/event-registry.ts` already marks queue/scheduler events as persisted daemon-stream events and already provides queue projectors. The live UI path is missing the data, not the projection logic.
- `packages/monitor/src/db.ts` makes `events.run_id` `NOT NULL`, forcing non-run daemon events to use synthetic/unmatched ids if they are persisted at all. `packages/monitor/src/server-main.ts::writeDaemonEvent` does exactly that today, and `db.ts` disables FK enforcement to permit it.

## Goal

Implement a durable daemon-scoped event persistence model so live monitor queue updates work without reload.

The desired outcome is that persisted daemon-stream events without a run id, including queue and scheduler lifecycle events, are stored, replayed through `/api/daemon-events`, and projected by already-open monitor UI sessions so live state converges with fresh `stream:hello.queue` snapshots.

## Approach

### Durable Design

1. Make daemon-scoped persisted events first-class in the recorder.
   - Add an explicit helper/predicate based on the shared event registry/allowlist to identify persisted daemon-stream events.
   - In `withRecording`, persist such events even when no `activeRunId` exists.
   - Do not treat this as an enqueue/build run.
   - Do not synthesize `runs` rows for queue/scheduler events.
   - Preserve existing `daemon:run:upsert` behavior as the only source of run-row projection.

2. Fix the storage model explicitly.
   - Migrate `events.run_id` from required to nullable; SQLite requires rebuilding the table to remove `NOT NULL`.
   - Add an explicit storage ownership column, e.g. `origin TEXT NOT NULL DEFAULT 'run' CHECK (origin IN ('run','daemon'))` or equivalently named `owner_kind`.
   - Keep `run_id` for run-correlated events.
   - Store daemon-owned events with `origin='daemon'` and `run_id=NULL`.
   - Replace synthetic-daemon-id insertion paths with a named DB API such as `insertDaemonEvent(...)` so daemon ownership is visible at call sites.
   - Backfill existing rows during migration: preserve normal run events, classify existing synthetic/unmatched daemon rows as daemon-origin, and preferably set their `run_id` to `NULL` while preserving the event JSON payload.

### Design Decisions

1. Storage should represent daemon ownership directly, not by overloading a synthetic run/session id.
   - Decision: use nullable `events.run_id` plus an explicit ownership column such as `origin='run' | 'daemon'`.
   - Rationale: run correlation and daemon ownership are separate concepts. Nullable `run_id` matches reality for queue/scheduler events, while `origin` keeps debugging and cleanup behavior explicit.

2. Use a named daemon insertion path.
   - Decision: add or expose `insertDaemonEvent(...)` instead of requiring callers to pass a fake run id to `insertEvent(...)`.
   - Rationale: API shape should make invalid states hard to create. `insertEvent(...)` can remain the run-correlated path; daemon ownership is explicit at call sites.

3. Preserve existing daemon stream contract unless intentionally changed.
   - Decision: keep `/api/daemon-events` replay eligibility tied to the shared client event registry/allowlist (`DAEMON_EVENT_TYPES`) or a directly equivalent shared helper, rather than inventing a monitor-local list.
   - Rationale: the client registry is already the source of truth for persisted/replayed event types. The storage ownership column should not become a second divergent stream contract.

4. Do not use `enqueue:complete` as the live queue source.
   - Decision: persist and stream actual queue/scheduler lifecycle events instead.
   - Rationale: `enqueue:complete` only proves a file was written; it does not cover running, completion, failed/skipped transitions, dependency unblock, scheduler capacity, or future queue mutations.

5. Backward compatibility should preserve existing DB history.
   - Decision: migration should rebuild the events table, backfill ownership for existing rows, and preserve event ids/data/timestamps.
   - Rationale: SSE cursors, activity history, and diagnostics depend on event ids and event JSON remaining stable.

### Code Impact

Expected implementation areas:

#### `packages/monitor/src/db.ts`

- Migrate `events` schema so `run_id` is nullable.
- Add an explicit ownership column (`origin` or `owner_kind`) for `run` vs `daemon` owned event rows.
- Add a named daemon-event insert API (`insertDaemonEvent`) or equivalent explicit method.
- Keep run-event insertion explicit.
- Add/adjust an event row mapper (`rowToEventRecord`) so nullable `run_id` is represented intentionally instead of hidden by SQL alias casts.
- Preserve `getEvents*` session/run queries for run-correlated events and `getDaemonEventsAfter` / `getMaxDaemonEventId` behavior for daemon stream replay.

#### `packages/monitor/src/recorder.ts`

- Persist daemon-stream events without an active run id via the new daemon-event DB API.
- Continue to persist run-correlated events exactly once.
- Ensure `session:start` buffering and `daemon:run:upsert` behavior are unchanged.

#### `packages/monitor/src/server-main.ts`

- Update `writeDaemonEvent(...)` to use the explicit daemon-event API instead of synthetic `runId` storage.
- Update `wrapWatcherEvents(...)` if `withRecording` needs options for persistence behavior.
- Prefer avoiding a daemon synthetic session id if the DB API can express daemon ownership directly.

#### Tests

- Add recorder coverage for a no-run-id `queue:prd:discovered` being persisted and visible via `getDaemonEventsAfter`.
- Add DB migration/schema tests proving `run_id` can be null for daemon-origin rows and existing run-correlated rows still work.
- Add stream/reducer integration coverage that live application of persisted queue events matches fresh `stream:hello.queue` state for a newly discovered queued PRD.

Potential follow-up docs: none expected unless API/reference docs mention monitor DB internals. If DB schema is documented somewhere, update it.

### Assumptions and Validation

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| Queue/scheduler events are emitted by the engine but not persisted because they lack `runId`. | Code inspection: `QueueScheduler` and `watchQueue` push `queue:prd:discovered` / scheduler events without run ids; `withRecording` only inserts when `activeRunId` exists. Live DB showed zero `queue:%`/`daemon:scheduler:%` rows during the incident. | High | Low | Add a recorder test with a synthetic no-run-id `queue:prd:discovered` and confirm current code drops it, then fix. | If wrong, persistence changes alone might not restore live queue updates. |
| Nullable `events.run_id` plus explicit ownership is the cleanest durable model. | Code inspection: current schema forces `run_id TEXT NOT NULL`; `writeDaemonEvent` already uses fake unmatched ids and `foreign_keys=OFF`. This confirms storage is representing daemon-owned events indirectly today. | High | Medium | Implement migration in a temp DB with pre-existing run and fake-daemon rows; assert run queries and daemon replay still work. | If wrong, migration could create unnecessary churn or break event queries. |
| Existing consumers can tolerate daemon event rows with no run id if `EventRecord` mapping is made explicit. | Server daemon SSE parsing uses event data, type, id, and timestamp; run/session APIs join via `runs`, which should naturally exclude null-run daemon rows. This is code-inspection evidence, not a full compile proof. | Medium | Low | Type-check after changing `EventRecord.runId` to nullable/optional and add row-mapping tests. | If wrong, more internal call sites must be updated to handle nullable run ids. |
| Existing historical event ids should be preserved by migration. | SSE cursor logic uses integer event ids (`Last-Event-ID`, `getMaxDaemonEventId`). Losing ids would be risky. SQLite table rebuild can preserve ids by inserting explicit `id` values. | High | Low | Migration test with fixed ids before/after schema rebuild. | If wrong, active/reconnecting clients could miss or duplicate historical events. |
| The daemon stream contract should remain registry/allowlist-driven, not ownership-column-driven. | `db.ts` and `event-registry.ts` already share `DAEMON_EVENT_TYPES`; tests assert `getDaemonEventsAfter` behavior based on this allowlist. | Medium | Medium | Review all `DAEMON_EVENT_TYPES` members and decide whether to preserve current persist-based behavior or tighten to `scope === 'daemon' && persist` in a separate change. | If wrong, this plan could preserve an overly broad daemon stream contract; changing it here might be larger than needed. |

No low-confidence/high-impact assumptions remain unvalidated. The main medium-confidence assumption is consumer tolerance for nullable run ids, and it has a cheap validation path through TypeScript and targeted DB/SSE tests.

### Profile Signal

Recommended profile: **Excursion**.

Rationale: this is cross-cutting across monitor DB schema/migration, recorder behavior, daemon SSE replay, and tests, but it is still a cohesive bugfix with one clear architectural throughline. A single planner should be able to produce a high-quality plan without delegated module planning. It is more than an errand because the DB migration and event-contract implications need explicit sequencing and regression coverage.

## Scope

### In Scope

- Persist daemon-stream events without an active run id.
- Add an explicit helper/predicate based on the shared event registry/allowlist to identify persisted daemon-stream events.
- Use the shared client event registry/allowlist (`DAEMON_EVENT_TYPES`) or a directly equivalent shared helper for `/api/daemon-events` replay eligibility.
- Migrate `events.run_id` from required to nullable.
- Add an explicit storage ownership column such as `origin` or `owner_kind`.
- Store daemon-owned events with `origin='daemon'` and `run_id=NULL`.
- Keep `run_id` for run-correlated events.
- Add or expose a named daemon insertion API such as `insertDaemonEvent(...)`.
- Preserve normal run events during migration.
- Classify existing synthetic/unmatched daemon rows as daemon-origin during migration.
- Preferably set existing synthetic/unmatched daemon row `run_id` values to `NULL` while preserving event JSON payload.
- Preserve event ids, data, timestamps, plan ids, agents, and run-correlated query behavior.
- Preserve `getEvents*` session/run queries for run-correlated events.
- Preserve `getDaemonEventsAfter` and `getMaxDaemonEventId` behavior for daemon stream replay.
- Update `writeDaemonEvent(...)` to use explicit daemon-event storage.
- Update `wrapWatcherEvents(...)` if `withRecording` needs options for persistence behavior.
- Add/adjust tests for DB schema/migration, recorder behavior, stream/reducer parity, and monitor UI reducer behavior.

### Out of Scope

- Adding a new roadmap feature.
- Treating daemon-owned queue/scheduler events as enqueue/build runs.
- Synthesizing `runs` rows for queue/scheduler events.
- Creating synthetic daemon session/run ids to persist daemon-owned events.
- Inventing a monitor-local daemon event replay list that diverges from the shared client event registry/allowlist.
- Using `enqueue:complete` as the live queue source.
- Projecting only `enqueue:complete` into queue state as a UI workaround.
- Changing `daemon:run:upsert` as the only live source for `DaemonState.runs`.
- Follow-up docs unless API/reference docs mention monitor DB internals.

## Acceptance Criteria

### Functional Criteria

- When `withRecording` processes a persisted daemon-stream event with no run id, e.g. `queue:prd:discovered`, the event is inserted into `.eforge/monitor.db` and returned by `db.getDaemonEventsAfter(...)`.
- Newly queued PRDs appear in already-open monitor UI sessions without browser reload, via the normal `/api/daemon-events` SSE path.
- Queue lifecycle remains live beyond enqueue: `queue:prd:discovered`, `queue:prd:start`, `queue:prd:complete`, `queue:complete`, and scheduler diagnostic events are persisted/replayed when emitted without a run id.
- Fresh `stream:hello.queue` snapshots and live queue-event projection converge for the same queue state.
- `daemon:run:upsert` remains the only live source for `DaemonState.runs`.
- Queue/scheduler events must not create synthetic run rows.

### Storage / Model Criteria

- The `events` table no longer requires `run_id` for daemon-owned rows.
- The schema has an explicit daemon-vs-run ownership field (`origin`, `owner_kind`, or equivalent) and uses it for new daemon-owned event rows.
- Synthetic daemon session/run ids are no longer required to persist daemon-owned events.
- Existing DB rows migrate without losing event ids, data, timestamps, plan ids, agents, or run-correlated query behavior.
- Run/session event queries (`getEvents`, `getEventsBySession`, `getEventsByTypeForSession`) continue to return run-correlated events correctly and ignore daemon-owned rows without run association.

### Test Criteria

- Add/adjust unit tests in `packages/monitor/src/__tests__/db.test.ts` or equivalent for nullable daemon-owned event rows.
- Add a recorder regression test proving no-run-id `queue:prd:discovered` is persisted and visible through `getDaemonEventsAfter`.
- Add a stream/reducer parity regression proving live queue projection from daemon events matches the fresh snapshot path for a newly discovered PRD.
- Existing monitor tests, client event-schema tests, and daemon SSE handshake/parity tests pass.

### Validation Commands

```bash
pnpm build
pnpm type-check
pnpm test -- packages/monitor/src/__tests__/db.test.ts packages/monitor/src/__tests__/recorder-run-upsert.test.ts packages/monitor/src/__tests__/stream-hello-parity.test.ts packages/monitor-ui/src/lib/__tests__/daemon-reducer.test.ts
```

Run full tests if targeted tests pass:

```bash
pnpm test
```
