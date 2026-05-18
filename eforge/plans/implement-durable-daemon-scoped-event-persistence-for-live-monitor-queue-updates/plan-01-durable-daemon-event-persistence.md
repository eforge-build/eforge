---
id: plan-01-durable-daemon-event-persistence
name: Durable Daemon Event Persistence for Live Queue Updates
branch: implement-durable-daemon-scoped-event-persistence-for-live-monitor-queue-updates/plan-01-durable-daemon-event-persistence
migrations:
  - timestamp: "20260518160000"
    description: Rebuild monitor events table with nullable run_id and explicit
      daemon/run origin
agents:
  builder:
    effort: high
    rationale: Cross-cutting storage migration plus recorder and SSE persistence
      behavior requires careful compatibility with existing event queries.
  tester:
    effort: high
    rationale: Migration, recorder, and live/snapshot parity regressions need
      targeted coverage across monitor and UI tests.
---

# Durable Daemon Event Persistence for Live Queue Updates

## Architecture Context

The monitor daemon stores run-correlated events in SQLite and `/api/daemon-events` replays the subset listed by the shared client daemon-event allowlist. Queue and scheduler lifecycle events are already registered as persisted daemon-stream events and the UI reducer already projects them, but `withRecording()` only writes events with an active run id. The storage schema also forces `events.run_id` to be non-null, which pushed daemon-owned events into synthetic/unmatched run ids.

This plan makes daemon-owned event rows first-class: nullable `run_id`, explicit ownership, a named daemon insertion API, and recorder/server usage that persists allowlisted daemon-stream events without creating synthetic runs.

## Implementation

### Overview

Rebuild the monitor `events` table to represent run-owned and daemon-owned events explicitly. Add a shared predicate for persisted daemon-event types, use it in the recorder and daemon write path, and add regression tests proving runless queue events are persisted and replayed into live queue state.

### Key Decisions

1. Store daemon ownership as data, not as a fake run id.
   - Use `origin TEXT NOT NULL DEFAULT 'run' CHECK (origin IN ('run','daemon'))` and nullable `run_id`.
   - New daemon-owned rows use `origin='daemon'` and `run_id=NULL`.
2. Keep replay eligibility allowlist-driven.
   - Add or export a predicate backed by `DAEMON_EVENT_TYPES` from `@eforge-build/client` and use that in monitor code.
   - Do not introduce a monitor-local queue/scheduler event list.
3. Keep run-row projection unchanged.
   - `daemon:run:upsert` remains the sole live source for `DaemonState.runs`.
   - Queue/scheduler events do not call `insertRun()`.
4. Preserve historical event ids and payloads.
   - The migration inserts explicit `id`, `data`, `timestamp`, `plan_id`, and `agent` values into the rebuilt table.

## Scope

### In Scope

- Add a shared persisted-daemon-event predicate based on `DAEMON_EVENT_TYPES` or the event registry.
- Change monitor DB schema to nullable `events.run_id` plus explicit `origin` ownership.
- Add `MonitorDB.insertDaemonEvent(...)` for daemon-owned rows.
- Keep `MonitorDB.insertEvent(...)` as the run-correlated insertion path.
- Add row mapping for event records so `runId: string | null` and `origin` are represented deliberately.
- Migrate legacy `events` tables in place while preserving ids, payload JSON, timestamps, plan ids, and agent fields.
- Classify legacy unmatched rows whose type is in the daemon allowlist as daemon-origin and set `run_id` to `NULL`.
- Persist allowlisted daemon-stream events without active run ids in `withRecording()`.
- Update direct daemon event writers and synthetic daemon/session insertions in `server-main.ts` to use `insertDaemonEvent(...)` where no real run id exists.
- Add DB, recorder, SSE/reducer parity, and UI reducer regression coverage required by the source.

### Out of Scope

- New roadmap features.
- Creating `runs` rows for queue or scheduler events.
- Using `enqueue:complete` as the source of live queue state.
- Changing `daemon:run:upsert` as the source of live run state.
- A new monitor-local daemon-event replay allowlist.
- User-facing documentation changes unless an existing document explicitly describes monitor DB internals.

## Files

### Modify

- `packages/client/src/event-registry.ts` — export a predicate such as `isPersistedDaemonEventType(type: string): type is EforgeEvent['type']` backed by `DAEMON_EVENT_TYPES`/registry metadata.
- `packages/client/src/index.ts` and `packages/client/src/browser.ts` — re-export the new predicate if public exports are required by monitor imports or browser parity tests.
- `packages/client/src/__tests__/events-schemas.test.ts` or `packages/client/src/__tests__/events.test.ts` — assert the predicate returns true for queue/scheduler persisted event types and false for `daemon:heartbeat` and non-persisted session-scoped events.
- `packages/monitor/src/db.ts` — rebuild `events` schema; add `origin`; make `run_id` nullable; add `EventOrigin`, nullable `EventRecord.runId`, `rowToEventRecord`, `insertDaemonEvent`, and updated queries/indexes.
- `packages/monitor/src/recorder.ts` — persist allowlisted daemon-stream events without `activeRunId` via `insertDaemonEvent(...)`; retain the existing active-run insertion path and file-diff stripping behavior.
- `packages/monitor/src/server-main.ts` — make `writeDaemonEvent(...)` call `insertDaemonEvent(...)`; update no-real-run direct insertions such as daemon lifecycle, recovery, auto-build/scheduler emission, and cancellation `session:end` rows to avoid synthetic run ids.
- `packages/monitor/src/server.ts` — update any event-row type assumptions if `EventRecord.runId` becomes nullable; keep `/api/daemon-events` polling and replay queries allowlist-driven.
- `packages/monitor/src/__tests__/db.test.ts` — add schema, daemon insert, run insert, query isolation, and legacy migration tests.
- `packages/monitor/src/__tests__/recorder-run-upsert.test.ts` — add a regression for no-run-id `queue:prd:discovered` and representative scheduler/queue lifecycle events.
- `packages/monitor/src/__tests__/stream-hello-parity.test.ts` — add live queue-event projection versus fresh `stream:hello.queue` parity for a newly discovered queued PRD.
- `packages/monitor-ui/src/lib/__tests__/daemon-reducer.test.ts` — add or adjust reducer coverage for the same discovered-PRD live projection path if current coverage does not assert equality with a snapshot-shaped queue item.
- Existing tests under `test/` and `packages/monitor/src/__tests__/` that construct `EventRecord` or assert synthetic daemon run ids — update expectations to `origin='daemon'` and `runId === null` for daemon-owned rows.

## Database Migration

SQLite cannot drop `NOT NULL` from `events.run_id` in place, so `openDatabase()` needs an idempotent migration after `db.exec(SCHEMA)` detects missing `origin` or `run_id.notnull === 1`.

```sql
BEGIN;
CREATE TABLE events_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT REFERENCES runs(id),
  origin TEXT NOT NULL DEFAULT 'run' CHECK (origin IN ('run','daemon')),
  type TEXT NOT NULL,
  plan_id TEXT,
  agent TEXT,
  data TEXT NOT NULL,
  timestamp TEXT NOT NULL
);
-- Implement this INSERT from TypeScript so the daemon allowlist placeholders
-- come from DAEMON_EVENT_TYPES instead of a hardcoded SQL list, and so
-- <existing_origin_or_run> is `COALESCE(e.origin, 'run')` only when the legacy
-- table actually has an origin column; otherwise it is the literal `'run'`.
INSERT INTO events_new (id, run_id, origin, type, plan_id, agent, data, timestamp)
SELECT
  e.id,
  CASE
    WHEN e.run_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.id = e.run_id)
      AND e.type IN (<DAEMON_EVENT_TYPES placeholders>)
    THEN NULL
    ELSE e.run_id
  END,
  CASE
    WHEN e.run_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.id = e.run_id)
      AND e.type IN (<DAEMON_EVENT_TYPES placeholders>)
    THEN 'daemon'
    ELSE <existing_origin_or_run>
  END,
  e.type,
  e.plan_id,
  e.agent,
  e.data,
  e.timestamp
FROM events e;
DROP TABLE events;
ALTER TABLE events_new RENAME TO events;
CREATE INDEX IF NOT EXISTS idx_events_run_id ON events(run_id);
CREATE INDEX IF NOT EXISTS idx_events_origin ON events(origin);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
COMMIT;
```

Implementation notes:

- For existing DBs that already have `origin`, still validate `run_id` nullability and rebuild if the column remains `NOT NULL`.
- For existing DBs without `origin`, use the same table rebuild, but do not reference `e.origin` in the migration SQL; set non-daemon copied rows to `origin='run'`.
- Preserve non-allowlisted unmatched rows as `origin='run'` with their existing `run_id` to avoid deleting diagnostics outside this source's scope.
- Keep `getEvents*` session/run queries using run joins or `run_id = ?`, which naturally excludes daemon-owned rows with `run_id IS NULL`.
- Keep `getDaemonEventsAfter` and `getMaxDaemonEventId` filtering by the shared allowlist, not by `origin` alone.

## Verification

- [ ] `PRAGMA table_info(events)` reports `run_id.notnull = 0` and includes `origin`.
- [ ] `db.insertDaemonEvent({ type: 'queue:prd:discovered', ... })` stores a row with `origin='daemon'` and `runId === null`.
- [ ] `db.getDaemonEventsAfter(0)` returns the daemon-owned queue event, and `db.getEvents(<runId>)` does not return it for any run.
- [ ] A legacy DB containing a run-correlated event and an unmatched daemon-allowlisted event migrates with both original `id` values and JSON payload strings unchanged.
- [ ] `withRecording()` persists no-run-id `queue:prd:discovered`, `queue:prd:start`, `queue:prd:complete`, `queue:complete`, and representative `daemon:scheduler:*` events through `insertDaemonEvent(...)`.
- [ ] The same recorder test confirms no queue/scheduler event creates a `runs` row.
- [ ] `writeDaemonEvent()` produces daemon-owned rows with `runId === null` and no synthetic daemon run id in storage.
- [ ] Applying the persisted `queue:prd:discovered` event to an empty live queue yields the same array as `stream:hello.queue` for a PRD file with matching title and no optional frontmatter.
- [ ] Existing `daemon:run:upsert` tests still observe run rows changing only through recorder run mutations.
- [ ] Targeted and full validation commands pass.
