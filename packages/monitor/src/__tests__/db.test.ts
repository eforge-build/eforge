/**
 * Tests for getDaemonEventsAfter with the new daemon event type allowlist.
 *
 * Verifies that:
 *  - All new persisted daemon event types are included in the allowlist query.
 *  - daemon:heartbeat is explicitly excluded (LIVE-ONLY, never persisted).
 *
 * Follows AGENTS.md conventions:
 * - No mocks. Real SQLite DB via openDatabase.
 * - Constructs input rows inline.
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../db.js';
import { DatabaseSync } from 'node:sqlite';

function makeTmpCwd(): string {
  const dir = mkdtempSync(join(tmpdir(), 'eforge-db-events-'));
  mkdirSync(join(dir, '.eforge'), { recursive: true });
  return dir;
}

// All new persisted daemon event types from plan-01 (heartbeat intentionally absent)
const NEW_PERSISTED_TYPES = [
  'daemon:lifecycle:starting',
  'daemon:lifecycle:ready',
  'daemon:lifecycle:shutdown:start',
  'daemon:lifecycle:shutdown:complete',
  'daemon:scheduler:dequeued',
  'daemon:scheduler:capacity-blocked',
  'daemon:scheduler:dependency-blocked',
  'daemon:auto-build:enabled',
  'daemon:auto-build:disabled',
  'daemon:auto-build:resumed',
  'daemon:auto-build:triggered',
  'daemon:recovery:start',
  'daemon:recovery:run-marked-failed',
  'daemon:recovery:lock-removed',
  'daemon:recovery:complete',
  'daemon:orphan:reaped',
  'daemon:warning',
  'daemon:error',
] as const;

describe('getDaemonEventsAfter — new persisted event types', () => {
  it('returns events for all new persisted daemon event types', () => {
    const cwd = makeTmpCwd();
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));

    const daemonSessionId = `daemon-test-${Date.now()}`;
    const now = new Date().toISOString();

    // Insert one event of each new persisted type (FK is OFF — no matching run row needed)
    for (const eventType of NEW_PERSISTED_TYPES) {
      db.insertEvent({
        runId: daemonSessionId,
        type: eventType,
        data: JSON.stringify({ type: eventType, sessionId: daemonSessionId, timestamp: now }),
        timestamp: now,
      });
    }

    const events = db.getDaemonEventsAfter(0);
    const returnedTypes = new Set(events.map((e) => e.type));

    for (const eventType of NEW_PERSISTED_TYPES) {
      expect(returnedTypes.has(eventType), `Expected ${eventType} to be returned by getDaemonEventsAfter`).toBe(true);
    }

    db.close();
  });

  it('excludes daemon:heartbeat — it is LIVE-ONLY and must not be replayed', () => {
    const cwd = makeTmpCwd();
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));

    const daemonSessionId = `daemon-test-hb-${Date.now()}`;
    const now = new Date().toISOString();

    // Insert a heartbeat event directly into the events table
    // (bypassing the allowlist that prevents it from ever being stored in practice)
    db.insertEvent({
      runId: daemonSessionId,
      type: 'daemon:heartbeat',
      data: JSON.stringify({
        type: 'daemon:heartbeat',
        uptime: 1000,
        queueDepth: 0,
        runningBuilds: 0,
        autoBuild: { enabled: true, paused: false },
        subscribers: 1,
        timestamp: now,
      }),
      timestamp: now,
    });

    // Also insert a persisted type so we can confirm the query does return results
    db.insertEvent({
      runId: daemonSessionId,
      type: 'daemon:lifecycle:starting',
      data: JSON.stringify({ type: 'daemon:lifecycle:starting', pid: 1, port: 4567, version: '1.0', mode: 'persistent', timestamp: now }),
      timestamp: now,
    });

    const events = db.getDaemonEventsAfter(0);
    const returnedTypes = events.map((e) => e.type);

    // daemon:heartbeat must NOT appear
    expect(returnedTypes).not.toContain('daemon:heartbeat');
    // daemon:lifecycle:starting MUST appear
    expect(returnedTypes).toContain('daemon:lifecycle:starting');

    db.close();
  });

  it('getDaemonEventsAfter(id) only returns events with id > afterId', () => {
    const cwd = makeTmpCwd();
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));

    const daemonSessionId = `daemon-test-after-${Date.now()}`;
    const now = new Date().toISOString();

    // Insert two events
    db.insertEvent({
      runId: daemonSessionId,
      type: 'daemon:recovery:start',
      data: JSON.stringify({ type: 'daemon:recovery:start', timestamp: now }),
      timestamp: now,
    });
    const maxIdAfterFirst = db.getMaxEventId();

    db.insertEvent({
      runId: daemonSessionId,
      type: 'daemon:recovery:complete',
      data: JSON.stringify({ type: 'daemon:recovery:complete', runsFailed: 0, locksRemoved: 0, durationMs: 5, timestamp: now }),
      timestamp: now,
    });

    // getDaemonEventsAfter(maxIdAfterFirst) should only return the second event
    const events = db.getDaemonEventsAfter(maxIdAfterFirst);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('daemon:recovery:complete');

    db.close();
  });
});


// ---------------------------------------------------------------------------
// Schema: nullable run_id and origin column
// ---------------------------------------------------------------------------

describe('events table schema — nullable run_id and origin column', () => {
  it('PRAGMA table_info reports run_id.notnull = 0 and includes origin column', () => {
    const cwd = makeTmpCwd();
    const dbPath = join(cwd, '.eforge', 'monitor.db');
    const db = openDatabase(dbPath);
    db.close();

    // Inspect the schema directly via a raw SQLite connection
    const raw = new DatabaseSync(dbPath);
    const cols = raw.prepare('PRAGMA table_info(events)').all() as unknown as { name: string; notnull: number }[];
    raw.close();

    const runIdCol = cols.find((c) => c.name === 'run_id');
    expect(runIdCol, 'run_id column must exist').toBeDefined();
    expect(runIdCol!.notnull, 'run_id must be nullable (notnull = 0)').toBe(0);

    const originCol = cols.find((c) => c.name === 'origin');
    expect(originCol, 'origin column must exist').toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// insertDaemonEvent: daemon-owned rows
// ---------------------------------------------------------------------------

describe('insertDaemonEvent — daemon-owned event rows', () => {
  it('stores a row with origin="daemon" and runId=null', () => {
    const cwd = makeTmpCwd();
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    const now = new Date().toISOString();

    db.insertDaemonEvent({
      type: 'queue:prd:discovered',
      data: JSON.stringify({ type: 'queue:prd:discovered', prdId: 'prd-abc', title: 'My Feature', timestamp: now }),
      timestamp: now,
    });

    const events = db.getDaemonEventsAfter(0);
    const discovered = events.find((e) => e.type === 'queue:prd:discovered');
    expect(discovered).toBeDefined();
    expect(discovered!.runId).toBeNull();
    expect(discovered!.origin).toBe('daemon');

    db.close();
  });

  it('getDaemonEventsAfter(0) returns daemon-owned queue event', () => {
    const cwd = makeTmpCwd();
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    const now = new Date().toISOString();

    db.insertDaemonEvent({
      type: 'queue:prd:discovered',
      data: JSON.stringify({ type: 'queue:prd:discovered', prdId: 'prd-daemon-test', title: 'Test', timestamp: now }),
      timestamp: now,
    });

    const daemonEvents = db.getDaemonEventsAfter(0);
    const types = daemonEvents.map((e) => e.type);
    expect(types).toContain('queue:prd:discovered');

    db.close();
  });

  it('getEvents(runId) does not return daemon-owned rows for any run', () => {
    const cwd = makeTmpCwd();
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    const now = new Date().toISOString();

    // Insert a real run
    db.insertRun({ id: 'run-123', planSet: 'my-set', command: 'build', status: 'running', startedAt: now, cwd });

    // Insert a run-correlated event
    db.insertEvent({
      runId: 'run-123',
      type: 'session:start',
      data: JSON.stringify({ type: 'session:start', timestamp: now }),
      timestamp: now,
    });

    // Insert a daemon-owned queue event
    db.insertDaemonEvent({
      type: 'queue:prd:discovered',
      data: JSON.stringify({ type: 'queue:prd:discovered', prdId: 'prd-x', title: 'X', timestamp: now }),
      timestamp: now,
    });

    // getEvents for the real run should NOT include the daemon-owned row
    const runEvents = db.getEvents('run-123');
    expect(runEvents.map((e) => e.type)).not.toContain('queue:prd:discovered');
    expect(runEvents).toHaveLength(1);
    expect(runEvents[0].type).toBe('session:start');
    expect(runEvents[0].origin).toBe('run');

    db.close();
  });

  it('insertEvent still stores rows with origin="run" and the provided runId', () => {
    const cwd = makeTmpCwd();
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    const now = new Date().toISOString();

    const fakeRunId = `fake-run-${Date.now()}`;
    db.insertEvent({
      runId: fakeRunId,
      type: 'daemon:lifecycle:starting',
      data: JSON.stringify({ type: 'daemon:lifecycle:starting', timestamp: now }),
      timestamp: now,
    });

    const events = db.getDaemonEventsAfter(0);
    const ev = events.find((e) => e.type === 'daemon:lifecycle:starting');
    expect(ev).toBeDefined();
    expect(ev!.runId).toBe(fakeRunId);
    expect(ev!.origin).toBe('run');

    db.close();
  });

  it('query isolation: run events and daemon events are separate', () => {
    const cwd = makeTmpCwd();
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    const now = new Date().toISOString();

    const runId = `run-isolate-${Date.now()}`;
    const sessionId = `sess-isolate-${Date.now()}`;
    db.insertRun({ id: runId, sessionId, planSet: 'test', command: 'build', status: 'running', startedAt: now, cwd });
    db.insertEvent({
      runId,
      type: 'plan:status:change',
      data: JSON.stringify({ type: 'plan:status:change', planId: 'p1', status: 'running', timestamp: now }),
      timestamp: now,
    });

    db.insertDaemonEvent({
      type: 'queue:complete',
      data: JSON.stringify({ type: 'queue:complete', processed: 1, skipped: 0, timestamp: now }),
      timestamp: now,
    });
    db.insertDaemonEvent({
      type: 'daemon:scheduler:dequeued',
      data: JSON.stringify({ type: 'daemon:scheduler:dequeued', prdId: 'p1', queueDepth: 0, timestamp: now }),
      timestamp: now,
    });

    // getEvents for the run only returns run-correlated rows
    const runEvents = db.getEvents(runId);
    expect(runEvents).toHaveLength(1);
    expect(runEvents[0].type).toBe('plan:status:change');

    // getDaemonEventsAfter returns daemon-owned rows (and any run-correlated daemon-type rows)
    const daemonEvents = db.getDaemonEventsAfter(0);
    const daemonTypes = daemonEvents.map((e) => e.type);
    expect(daemonTypes).toContain('queue:complete');
    expect(daemonTypes).toContain('daemon:scheduler:dequeued');
    // plan:status:change is persist:true so it may appear; but the run-correlated row is returned too
    // The key point: the daemon event query is type-driven, not origin-driven

    db.close();
  });
});

// ---------------------------------------------------------------------------
// Legacy migration: existing DB with NOT NULL run_id migrates correctly
// ---------------------------------------------------------------------------

describe('legacy DB migration — NOT NULL run_id rebuilt to nullable with origin', () => {
  it('migrates a legacy DB: preserves ids and payload JSON, classifies daemon-allowlisted unmatched rows', () => {
    const cwd = makeTmpCwd();
    const legacyDbPath = join(cwd, '.eforge', 'monitor-legacy.db');

    // Create a legacy-style DB with the old events schema (run_id NOT NULL, no origin)
    const legacyDb = new DatabaseSync(legacyDbPath);
    legacyDb.exec('PRAGMA journal_mode = WAL');
    legacyDb.exec('PRAGMA foreign_keys = OFF');
    legacyDb.exec(`
      CREATE TABLE runs (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        plan_set TEXT NOT NULL,
        command TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'running',
        started_at TEXT NOT NULL,
        completed_at TEXT,
        cwd TEXT NOT NULL,
        pid INTEGER
      );
      CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        type TEXT NOT NULL,
        plan_id TEXT,
        agent TEXT,
        data TEXT NOT NULL,
        timestamp TEXT NOT NULL
      );
    `);

    const now = new Date().toISOString();
    const realRunId = 'real-run-abc';
    legacyDb.prepare(`INSERT INTO runs (id, plan_set, command, status, started_at, cwd) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(realRunId, 'my-set', 'build', 'completed', now, cwd);

    // Row 1: run-correlated event (real run ID)
    const row1Payload = JSON.stringify({ type: 'session:start', timestamp: now });
    legacyDb.prepare(`INSERT INTO events (run_id, type, plan_id, agent, data, timestamp) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(realRunId, 'session:start', 'plan-run', 'builder', row1Payload, now);
    const row1Id = Number(legacyDb.prepare('SELECT last_insert_rowid() as id').get()!['id' as keyof object]);

    // Row 2: unmatched daemon-allowlisted event (synthetic daemon session ID, no matching run row)
    const daemonSyntheticId = 'daemon-99999-legacy';
    const daemonPayload = JSON.stringify({ type: 'daemon:lifecycle:starting', pid: 1, port: 4567, version: '1.0', mode: 'persistent', timestamp: now });
    legacyDb.prepare(`INSERT INTO events (run_id, type, plan_id, agent, data, timestamp) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(daemonSyntheticId, 'daemon:lifecycle:starting', 'plan-daemon', 'scheduler', daemonPayload, now);
    const row2Id = Number(legacyDb.prepare('SELECT last_insert_rowid() as id').get()!['id' as keyof object]);

    // Row 3: unmatched row with non-daemon-allowlisted type (should stay as 'run' origin with original run_id)
    const unknownRunId = 'unknown-run-xyz';
    const row3Payload = JSON.stringify({ type: 'session:profile', timestamp: now });
    legacyDb.prepare(`INSERT INTO events (run_id, type, data, timestamp) VALUES (?, ?, ?, ?)`)
      .run(unknownRunId, 'session:profile', row3Payload, now);
    const row3Id = Number(legacyDb.prepare('SELECT last_insert_rowid() as id').get()!['id' as keyof object]);

    legacyDb.close();

    // Open via openDatabase — migration should run
    const db = openDatabase(legacyDbPath);

    // Verify schema after migration
    const rawDb = new DatabaseSync(legacyDbPath);
    const cols = rawDb.prepare('PRAGMA table_info(events)').all() as unknown as { name: string; notnull: number }[];
    rawDb.close();

    const runIdCol = cols.find((c) => c.name === 'run_id');
    expect(runIdCol!.notnull, 'run_id must be nullable after migration').toBe(0);
    const originCol = cols.find((c) => c.name === 'origin');
    expect(originCol, 'origin column must exist after migration').toBeDefined();

    // Row 1 (run-correlated): retains runId and gets origin='run'
    const runEvents = db.getEvents(realRunId);
    expect(runEvents).toHaveLength(1);
    expect(runEvents[0].id).toBe(row1Id);
    expect(runEvents[0].runId).toBe(realRunId);
    expect(runEvents[0].origin).toBe('run');
    expect(runEvents[0].planId).toBe('plan-run');
    expect(runEvents[0].agent).toBe('builder');
    expect(runEvents[0].data).toBe(row1Payload);
    expect(runEvents[0].timestamp).toBe(now);

    // Row 2 (unmatched daemon-allowlisted): classified as daemon-owned
    const daemonEvents = db.getDaemonEventsAfter(0);
    const lifecycleRow = daemonEvents.find((e) => e.id === row2Id);
    expect(lifecycleRow).toBeDefined();
    expect(lifecycleRow!.id).toBe(row2Id);
    expect(lifecycleRow!.runId).toBeNull();
    expect(lifecycleRow!.origin).toBe('daemon');
    expect(lifecycleRow!.planId).toBe('plan-daemon');
    expect(lifecycleRow!.agent).toBe('scheduler');
    expect(lifecycleRow!.data).toBe(daemonPayload);
    expect(lifecycleRow!.timestamp).toBe(now);

    // Row 3 (unmatched non-allowlisted type): preserved as origin='run' with original run_id
    const rawForRow3 = new DatabaseSync(legacyDbPath);
    const row3Data = rawForRow3.prepare('SELECT id, run_id, origin, data, timestamp FROM events WHERE id = ?').get(row3Id) as unknown as { id: number; run_id: string | null; origin: string; data: string; timestamp: string } | undefined;
    rawForRow3.close();

    expect(row3Data).toEqual({
      id: row3Id,
      run_id: unknownRunId,
      origin: 'run',
      data: row3Payload,
      timestamp: now,
    });

    db.close();
  });

  it('migrates legacy DBs that already have origin but still have NOT NULL run_id', () => {
    const cwd = makeTmpCwd();
    const legacyDbPath = join(cwd, '.eforge', 'monitor-origin-legacy.db');
    const legacyDb = new DatabaseSync(legacyDbPath);
    legacyDb.exec('PRAGMA foreign_keys = OFF');
    legacyDb.exec(`
      CREATE TABLE runs (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        plan_set TEXT NOT NULL,
        command TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'running',
        started_at TEXT NOT NULL,
        completed_at TEXT,
        cwd TEXT NOT NULL,
        pid INTEGER
      );
      CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        origin TEXT NOT NULL DEFAULT 'run' CHECK (origin IN ('run','daemon')),
        type TEXT NOT NULL,
        plan_id TEXT,
        agent TEXT,
        data TEXT NOT NULL,
        timestamp TEXT NOT NULL
      );
    `);

    const now = new Date().toISOString();
    legacyDb.prepare(`INSERT INTO runs (id, plan_set, command, status, started_at, cwd) VALUES (?, ?, ?, ?, ?, ?)`).run('run-with-origin', 'set', 'build', 'running', now, cwd);
    legacyDb.prepare(`INSERT INTO events (run_id, origin, type, data, timestamp) VALUES (?, ?, ?, ?, ?)`).run('run-with-origin', 'run', 'session:start', JSON.stringify({ type: 'session:start', timestamp: now }), now);
    const runRowId = Number(legacyDb.prepare('SELECT last_insert_rowid() as id').get()!['id' as keyof object]);
    legacyDb.prepare(`INSERT INTO events (run_id, origin, type, data, timestamp) VALUES (?, ?, ?, ?, ?)`).run('daemon-synthetic-origin', 'run', 'daemon:lifecycle:ready', JSON.stringify({ type: 'daemon:lifecycle:ready', pid: 1, port: 4567, version: '1.0', mode: 'persistent', recoveryDurationMs: 0, timestamp: now }), now);
    const daemonRowId = Number(legacyDb.prepare('SELECT last_insert_rowid() as id').get()!['id' as keyof object]);
    legacyDb.close();

    const db = openDatabase(legacyDbPath);

    const raw = new DatabaseSync(legacyDbPath);
    const cols = raw.prepare('PRAGMA table_info(events)').all() as unknown as { name: string; notnull: number }[];
    expect(cols.find((c) => c.name === 'run_id')!.notnull).toBe(0);
    const rows = raw.prepare('SELECT id, run_id, origin FROM events ORDER BY id').all() as unknown as Array<{ id: number; run_id: string | null; origin: string }>;
    raw.close();

    expect(rows).toEqual([
      { id: runRowId, run_id: 'run-with-origin', origin: 'run' },
      { id: daemonRowId, run_id: null, origin: 'daemon' },
    ]);
    expect(db.getDaemonEventsAfter(0).find((event) => event.id === daemonRowId)?.runId).toBeNull();
    db.close();
  });

  it('migration is idempotent: opening a migrated DB a second time does not re-migrate', () => {
    const cwd = makeTmpCwd();
    const dbPath = join(cwd, '.eforge', 'monitor.db');

    // First open: creates fresh DB with correct schema
    const db1 = openDatabase(dbPath);
    const now = new Date().toISOString();
    db1.insertDaemonEvent({
      type: 'queue:prd:discovered',
      data: JSON.stringify({ type: 'queue:prd:discovered', prdId: 'prd-1', title: 'T', timestamp: now }),
      timestamp: now,
    });
    const eventsAfterFirst = db1.getDaemonEventsAfter(0);
    expect(eventsAfterFirst).toHaveLength(1);
    db1.close();

    // Second open: migration should be skipped, data should be intact
    const db2 = openDatabase(dbPath);
    const eventsAfterSecond = db2.getDaemonEventsAfter(0);
    expect(eventsAfterSecond).toHaveLength(1);
    expect(eventsAfterSecond[0].type).toBe('queue:prd:discovered');
    expect(eventsAfterSecond[0].runId).toBeNull();
    expect(eventsAfterSecond[0].origin).toBe('daemon');
    db2.close();
  });
});

