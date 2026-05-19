/**
 * End-to-end recorder test: daemon:run:upsert emission.
 *
 * Drives withRecording() over synthetic event streams and asserts:
 *   1. Exactly one daemon:run:upsert is yielded per DB mutation
 *      (insertRun, updateRunStatus, updateRunPlanSet).
 *   2. Each payload's `run` field deep-equals db.getRunById(runId).
 *
 * Covers two sequences:
 *   - Enqueue-only: enqueue:start → enqueue:complete (and enqueue:failed variant)
 *   - Phase-driven build: phase:start → phase:end
 *
 * Follows AGENTS.md conventions:
 * - No mocks. Real SQLite DB via openDatabase.
 * - Constructs inputs inline (no fixtures).
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../db.js';
import { withRecording } from '../recorder.js';
import type { EforgeEvent } from '@eforge-build/engine/events';
import type { RunInfo } from '@eforge-build/client';

function makeTmpCwd(): string {
  const dir = mkdtempSync(join(tmpdir(), 'eforge-recorder-upsert-'));
  mkdirSync(join(dir, '.eforge'), { recursive: true });
  return dir;
}

/** Convert an array of events into an async generator. */
async function* asGenerator(events: EforgeEvent[]): AsyncGenerator<EforgeEvent> {
  for (const event of events) yield event;
}

/** Collect all yielded events from a withRecording generator. */
async function collectEvents(gen: AsyncGenerator<EforgeEvent>): Promise<EforgeEvent[]> {
  const result: EforgeEvent[] = [];
  for await (const event of gen) result.push(event);
  return result;
}

// ---------------------------------------------------------------------------
// Helper: extract daemon:run:upsert events from a collected sequence
// ---------------------------------------------------------------------------

function upserts(events: EforgeEvent[]): Extract<EforgeEvent, { type: 'daemon:run:upsert' }>[] {
  return events.filter(
    (e): e is Extract<EforgeEvent, { type: 'daemon:run:upsert' }> =>
      e.type === 'daemon:run:upsert',
  );
}

// ---------------------------------------------------------------------------
// Enqueue-only sequence: enqueue:start → enqueue:complete
// ---------------------------------------------------------------------------

describe('withRecording() enqueue-only sequence', () => {
  it('emits exactly 2 daemon:run:upsert events (one on insertRun, one on updateRunStatus)', async () => {
    const cwd = makeTmpCwd();
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    const ts = new Date().toISOString();

    const inputEvents: EforgeEvent[] = [
      { type: 'session:start', sessionId: 'sess-enq-1', timestamp: ts },
      { type: 'enqueue:start', source: 'api', timestamp: ts },
      {
        type: 'enqueue:complete',
        id: 'prd-abc',
        filePath: '/queue/prd-abc.md',
        title: 'My Feature',
        planSet: 'my-feature',
        timestamp: ts,
      },
      { type: 'session:end', sessionId: 'sess-enq-1', result: { status: 'completed', summary: 'done' }, timestamp: ts },
    ];

    const yielded = await collectEvents(withRecording(asGenerator(inputEvents), db, cwd));
    const emitted = upserts(yielded);

    // Expect exactly 2: one after insertRun (enqueue:start) and one after updateRunStatus (enqueue:complete)
    expect(emitted).toHaveLength(2);

    // Both should be for the same run (the enqueue run)
    const runId = emitted[0].run.id;
    expect(emitted[1].run.id).toBe(runId);

    // session:start is buffered until enqueue:start establishes the real run;
    // it must not also be persisted as a daemon-owned duplicate.
    const sessionStartRows = db.getDaemonEventsAfter(0).filter((e) => e.type === 'session:start');
    expect(sessionStartRows).toHaveLength(1);
    expect(sessionStartRows[0].runId).toBe(runId);
    expect(sessionStartRows[0].origin).toBe('run');

    // First upsert: run is 'running' with command='enqueue'
    // Verify the full payload shape at insertion time (no completedAt yet,
    // cwd matches, planSet matches the source provided to enqueue:start).
    expect(emitted[0].run.command).toBe('enqueue');
    expect(emitted[0].run.status).toBe('running');
    expect(emitted[0].run.cwd).toBe(cwd);
    expect(emitted[0].run.completedAt).toBeUndefined();
    expect(typeof emitted[0].run.startedAt).toBe('string');

    // Second upsert: run is 'completed' with planSet updated
    expect(emitted[1].run.status).toBe('completed');
    expect(emitted[1].run.planSet).toBe('my-feature');
    expect(emitted[1].run.completedAt).toBeDefined();

    // Each payload must deep-equal db.getRunById at the time of emission —
    // verify final state matches db.getRuns()
    const dbRuns = db.getRuns();
    const dbRun = dbRuns.find((r) => r.id === runId);
    expect(dbRun).toBeDefined();
    expect(emitted[1].run).toEqual(dbRun as RunInfo);

    db.close();
  });

  it('emits 2 daemon:run:upsert events for enqueue:failed (insertRun + updateRunStatus)', async () => {
    const cwd = makeTmpCwd();
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    const ts = new Date().toISOString();

    const inputEvents: EforgeEvent[] = [
      { type: 'session:start', sessionId: 'sess-enq-fail', timestamp: ts },
      { type: 'enqueue:start', source: 'api', timestamp: ts },
      { type: 'enqueue:failed', error: 'git commit failed', timestamp: ts },
      { type: 'session:end', sessionId: 'sess-enq-fail', result: { status: 'failed', summary: 'err' }, timestamp: ts },
    ];

    const yielded = await collectEvents(withRecording(asGenerator(inputEvents), db, cwd));
    const emitted = upserts(yielded);

    // 2 upserts: insertRun + updateRunStatus(failed)
    expect(emitted).toHaveLength(2);
    expect(emitted[0].run.status).toBe('running');
    expect(emitted[1].run.status).toBe('failed');

    // Verify final run matches DB
    const dbRun = db.getRunById(emitted[1].run.id);
    expect(dbRun).toBeDefined();
    expect(emitted[1].run).toEqual(dbRun as RunInfo);

    db.close();
  });

  it('emits daemon:run:upsert on session:end with failed result for enqueue sessions', async () => {
    const cwd = makeTmpCwd();
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    const ts = new Date().toISOString();

    // Simulate: enqueue:start is received but no enqueue:complete/failed before session:end fails
    const inputEvents: EforgeEvent[] = [
      { type: 'session:start', sessionId: 'sess-enq-crash', timestamp: ts },
      { type: 'enqueue:start', source: 'api', timestamp: ts },
      // session:end(failed) without explicit enqueue:failed — the recorder updates
      // enqueueRunId to 'failed' in the session:end handler
      { type: 'session:end', sessionId: 'sess-enq-crash', result: { status: 'failed', summary: 'crash' }, timestamp: ts },
    ];

    const yielded = await collectEvents(withRecording(asGenerator(inputEvents), db, cwd));
    const emitted = upserts(yielded);

    // Expect: insertRun upsert + session:end failure upsert = 2
    expect(emitted).toHaveLength(2);
    expect(emitted[0].run.status).toBe('running');
    expect(emitted[1].run.status).toBe('failed');

    db.close();
  });
});

// ---------------------------------------------------------------------------
// Phase-driven build sequence: phase:start → phase:end
// ---------------------------------------------------------------------------

describe('withRecording() phase-driven build sequence', () => {
  it('emits exactly 2 daemon:run:upsert events (insertRun + updateRunStatus)', async () => {
    const cwd = makeTmpCwd();
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    const ts = new Date().toISOString();
    const runId = `run-phase-${Date.now()}`;
    const sessionId = `sess-phase-${Date.now()}`;

    const inputEvents: EforgeEvent[] = [
      { type: 'session:start', sessionId, timestamp: ts },
      { type: 'phase:start', runId, sessionId, planSet: 'my-plan-set', command: 'build', timestamp: ts },
      { type: 'phase:end', runId, result: { status: 'completed', summary: 'done' }, timestamp: ts },
      { type: 'session:end', sessionId, result: { status: 'completed', summary: 'done' }, timestamp: ts },
    ];

    const yielded = await collectEvents(withRecording(asGenerator(inputEvents), db, cwd));
    const emitted = upserts(yielded);

    // 2 upserts: insertRun (phase:start) + updateRunStatus (phase:end)
    expect(emitted).toHaveLength(2);

    // Both should reference the phase runId
    expect(emitted[0].run.id).toBe(runId);
    expect(emitted[1].run.id).toBe(runId);

    // First: running
    expect(emitted[0].run.status).toBe('running');
    expect(emitted[0].run.command).toBe('build');
    expect(emitted[0].run.planSet).toBe('my-plan-set');

    // Second: completed
    expect(emitted[1].run.status).toBe('completed');

    // Final payload must equal db.getRunById
    const dbRun = db.getRunById(runId);
    expect(dbRun).toBeDefined();
    expect(emitted[1].run).toEqual(dbRun as RunInfo);

    // Also verify the emitted[0] payload matched db state at that time by checking
    // it has all required fields
    expect(emitted[0].run.cwd).toBe(cwd);
    expect(typeof emitted[0].run.startedAt).toBe('string');

    db.close();
  });

  it('daemon:run:upsert events are persisted to the DB and visible via getDaemonEventsAfter', async () => {
    const cwd = makeTmpCwd();
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    const ts = new Date().toISOString();
    const runId = `run-persist-${Date.now()}`;
    const sessionId = `sess-persist-${Date.now()}`;

    const inputEvents: EforgeEvent[] = [
      { type: 'session:start', sessionId, timestamp: ts },
      { type: 'phase:start', runId, sessionId, planSet: 'test-set', command: 'compile', timestamp: ts },
      { type: 'phase:end', runId, result: { status: 'failed', summary: 'err' }, timestamp: ts },
      { type: 'session:end', sessionId, result: { status: 'failed', summary: 'err' }, timestamp: ts },
    ];

    await collectEvents(withRecording(asGenerator(inputEvents), db, cwd));

    // Retrieve all daemon-wide events; daemon:run:upsert should be in there
    const daemonEvents = db.getDaemonEventsAfter(0);
    const upsertEvents = daemonEvents.filter((e) => e.type === 'daemon:run:upsert');

    expect(upsertEvents.length).toBe(2);

    // Parse and verify
    const first = JSON.parse(upsertEvents[0].data) as Extract<EforgeEvent, { type: 'daemon:run:upsert' }>;
    const second = JSON.parse(upsertEvents[1].data) as Extract<EforgeEvent, { type: 'daemon:run:upsert' }>;

    expect(first.type).toBe('daemon:run:upsert');
    expect(first.run.id).toBe(runId);
    expect(first.run.status).toBe('running');

    expect(second.run.id).toBe(runId);
    expect(second.run.status).toBe('failed');

    db.close();
  });

  it('daemon:run:upsert events are ordered after their triggering event in the yield sequence', async () => {
    const cwd = makeTmpCwd();
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    const ts = new Date().toISOString();
    const runId = `run-order-${Date.now()}`;
    const sessionId = `sess-order-${Date.now()}`;

    const inputEvents: EforgeEvent[] = [
      { type: 'session:start', sessionId, timestamp: ts },
      { type: 'phase:start', runId, sessionId, planSet: 'test', command: 'build', timestamp: ts },
      { type: 'phase:end', runId, result: { status: 'completed', summary: 'ok' }, timestamp: ts },
      { type: 'session:end', sessionId, result: { status: 'completed', summary: 'ok' }, timestamp: ts },
    ];

    const yielded = await collectEvents(withRecording(asGenerator(inputEvents), db, cwd));
    const types = yielded.map((e) => e.type);

    // phase:start should be immediately followed by its daemon:run:upsert
    const phaseStartIdx = types.indexOf('phase:start');
    expect(types[phaseStartIdx + 1]).toBe('daemon:run:upsert');

    // phase:end should be immediately followed by its daemon:run:upsert
    const phaseEndIdx = types.indexOf('phase:end');
    expect(types[phaseEndIdx + 1]).toBe('daemon:run:upsert');

    db.close();
  });
});

// --- eforge:region plan-01-profile-replay-and-plan-tab ---

// ---------------------------------------------------------------------------
// session:profile buffering and flush
// ---------------------------------------------------------------------------

describe('withRecording() session:profile buffering — phase-driven sequence', () => {
  it('flushes buffered session:profile into the run when phase:start establishes correlation', async () => {
    const cwd = makeTmpCwd();
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    const ts = new Date().toISOString();
    const runId = `run-profile-phase-${Date.now()}`;
    const sessionId = `sess-profile-phase-${Date.now()}`;
    const profileName = 'my-build-profile';

    const inputEvents: EforgeEvent[] = [
      { type: 'session:start', sessionId, timestamp: ts },
      // session:profile arrives before phase:start (no runId, no enqueueRunId)
      {
        type: 'session:profile',
        profileName,
        source: 'project',
        scope: 'project',
        config: null,
        timestamp: ts,
      } as unknown as EforgeEvent,
      { type: 'phase:start', runId, sessionId, planSet: 'test-set', command: 'build', timestamp: ts },
      { type: 'phase:end', runId, result: { status: 'completed', summary: 'done' }, timestamp: ts },
      { type: 'session:end', sessionId, result: { status: 'completed', summary: 'done' }, timestamp: ts },
    ];

    await collectEvents(withRecording(asGenerator(inputEvents), db, cwd));

    // session:profile must be stored as a run-correlated row
    const profileRows = db.getEventsByTypeForSession(sessionId, 'session:profile');
    expect(profileRows).toHaveLength(1);
    expect(profileRows[0].origin).toBe('run');
    expect(profileRows[0].runId).toBe(runId);

    // Must NOT produce a daemon-owned session:profile row
    const daemonEvents = db.getDaemonEventsAfter(0);
    const daemonProfileRows = daemonEvents.filter((e) => e.type === 'session:profile');
    expect(daemonProfileRows).toHaveLength(0);

    // Session metadata must reflect the profile name
    const metadata = db.getSessionMetadataBatch();
    expect(metadata[sessionId]).toBeDefined();
    expect(metadata[sessionId].baseProfile).toBe(profileName);

    db.close();
  });

  it('does not produce duplicate rows for an already-correlated session:profile', async () => {
    const cwd = makeTmpCwd();
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    const ts = new Date().toISOString();
    const runId = `run-profile-correlated-${Date.now()}`;
    const sessionId = `sess-profile-correlated-${Date.now()}`;

    // session:profile arrives after phase:start, so it has activeRunId available
    // and goes through the normal insertion path — should produce exactly one row.
    const inputEvents: EforgeEvent[] = [
      { type: 'session:start', sessionId, timestamp: ts },
      { type: 'phase:start', runId, sessionId, planSet: 'test-set', command: 'build', timestamp: ts },
      {
        type: 'session:profile',
        profileName: 'post-phase-profile',
        source: 'project',
        scope: 'project',
        config: null,
        timestamp: ts,
      } as unknown as EforgeEvent,
      { type: 'phase:end', runId, result: { status: 'completed', summary: 'done' }, timestamp: ts },
      { type: 'session:end', sessionId, result: { status: 'completed', summary: 'done' }, timestamp: ts },
    ];

    await collectEvents(withRecording(asGenerator(inputEvents), db, cwd));

    const profileRows = db.getEventsByTypeForSession(sessionId, 'session:profile');
    expect(profileRows).toHaveLength(1);
    expect(profileRows[0].runId).toBe(runId);

    db.close();
  });
});

describe('withRecording() session:profile buffering — enqueue sequence', () => {
  it('flushes buffered session:profile into the enqueue run when enqueue:start establishes correlation', async () => {
    const cwd = makeTmpCwd();
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    const ts = new Date().toISOString();
    const sessionId = `sess-enq-profile-${Date.now()}`;
    const profileName = 'enqueue-profile';

    const inputEvents: EforgeEvent[] = [
      { type: 'session:start', sessionId, timestamp: ts },
      {
        type: 'session:profile',
        profileName,
        source: 'project',
        scope: 'project',
        config: null,
        timestamp: ts,
      } as unknown as EforgeEvent,
      { type: 'enqueue:start', source: 'api', timestamp: ts },
      {
        type: 'enqueue:complete',
        id: 'prd-enq-profile',
        filePath: '/queue/prd-enq-profile.md',
        title: 'Profile Enqueue',
        planSet: 'profile-enqueue',
        timestamp: ts,
      },
      { type: 'session:end', sessionId, result: { status: 'completed', summary: 'done' }, timestamp: ts },
    ];

    await collectEvents(withRecording(asGenerator(inputEvents), db, cwd));

    // session:profile must be stored as a run-correlated row
    const profileRows = db.getEventsByTypeForSession(sessionId, 'session:profile');
    expect(profileRows).toHaveLength(1);
    expect(profileRows[0].origin).toBe('run');
    expect(profileRows[0].runId).not.toBeNull();

    // Must NOT produce a daemon-owned session:profile row
    const daemonEvents = db.getDaemonEventsAfter(0);
    const daemonProfileRows = daemonEvents.filter((e) => e.type === 'session:profile');
    expect(daemonProfileRows).toHaveLength(0);

    // Session metadata must reflect the profile name
    const metadata = db.getSessionMetadataBatch();
    expect(metadata[sessionId]).toBeDefined();
    expect(metadata[sessionId].baseProfile).toBe(profileName);

    db.close();
  });
});

// --- eforge:endregion plan-01-profile-replay-and-plan-tab ---

// --- eforge:region plan-01-durable-daemon-event-persistence ---

// ---------------------------------------------------------------------------
// Regression: no-run-id queue/scheduler events are persisted as daemon-owned rows
// ---------------------------------------------------------------------------

describe('withRecording() daemon event persistence — no active run', () => {
  it('persists queue:prd:discovered (no run id) as a daemon-owned row via insertDaemonEvent', async () => {
    const cwd = makeTmpCwd();
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    const ts = new Date().toISOString();

    // Simulate watcher emitting queue lifecycle events without an active run.
    // These are daemon-scope, persist:true events that occur before any build starts.
    const watcherEvents: EforgeEvent[] = [
      { type: 'queue:prd:discovered', prdId: 'prd-no-run', title: 'Discovered PRD', timestamp: ts },
    ];

    const yielded = await collectEvents(withRecording(asGenerator(watcherEvents), db, cwd));

    // The event should be yielded through unchanged
    expect(yielded).toHaveLength(1);
    expect(yielded[0].type).toBe('queue:prd:discovered');

    // The event should be persisted in the DB as a daemon-owned row
    const daemonEvents = db.getDaemonEventsAfter(0);
    const discoveredRows = daemonEvents.filter((e) => e.type === 'queue:prd:discovered');
    expect(discoveredRows).toHaveLength(1);
    expect(discoveredRows[0].runId).toBeNull();
    expect(discoveredRows[0].origin).toBe('daemon');

    // No runs row was created for this queue event
    const runs = db.getRuns();
    expect(runs).toHaveLength(0);

    db.close();
  });

  it('persists representative queue and scheduler lifecycle events without creating runs rows', async () => {
    const cwd = makeTmpCwd();
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    const ts = new Date().toISOString();

    const watcherEvents: EforgeEvent[] = [
      { type: 'queue:prd:discovered', prdId: 'prd-1', title: 'PRD 1', timestamp: ts },
      { type: 'queue:prd:start', prdId: 'prd-1', title: 'PRD 1', timestamp: ts },
      { type: 'queue:prd:complete', prdId: 'prd-1', status: 'completed', timestamp: ts },
      { type: 'queue:complete', processed: 1, skipped: 0, timestamp: ts },
      { type: 'daemon:scheduler:dequeued', prdId: 'prd-1', queueDepth: 0, capacityRemaining: 2, timestamp: ts },
      { type: 'daemon:scheduler:capacity-blocked', queueDepth: 3, runningCount: 2, limit: 2, timestamp: ts },
    ];

    await collectEvents(withRecording(asGenerator(watcherEvents), db, cwd));

    // No runs rows created
    expect(db.getRuns()).toHaveLength(0);

    // All daemon-allowlisted events persisted exactly once as daemon-owned rows
    const daemonEvents = db.getDaemonEventsAfter(0);
    expect(daemonEvents).toHaveLength(watcherEvents.length);
    const persistedTypes = new Set(daemonEvents.map((e) => e.type));
    expect(persistedTypes.has('queue:prd:discovered')).toBe(true);
    expect(persistedTypes.has('queue:prd:start')).toBe(true);
    expect(persistedTypes.has('queue:prd:complete')).toBe(true);
    expect(persistedTypes.has('queue:complete')).toBe(true);
    expect(persistedTypes.has('daemon:scheduler:dequeued')).toBe(true);
    expect(persistedTypes.has('daemon:scheduler:capacity-blocked')).toBe(true);

    // All are daemon-owned
    for (const event of daemonEvents) {
      expect(event.runId, `${event.type} should have null runId`).toBeNull();
      expect(event.origin, `${event.type} should have origin='daemon'`).toBe('daemon');
    }

    db.close();
  });

  it('does not create daemon-owned rows for non-persisted events without active run', async () => {
    const cwd = makeTmpCwd();
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    const ts = new Date().toISOString();

    // agent:start, plan:build:start etc. are persist:false — should not be stored
    const nonPersistedEvents: EforgeEvent[] = [
      { type: 'planning:start', source: 'queue/test.md', timestamp: ts },
      { type: 'plan:build:start', planId: 'plan-01', timestamp: ts },
    ];

    await collectEvents(withRecording(asGenerator(nonPersistedEvents), db, cwd));

    // No events should be in the DB at all. getDaemonEventsAfter filters by
    // allowlist, so also assert the raw max event id to catch accidental
    // insertion of non-allowlisted daemon-owned rows.
    const daemonEvents = db.getDaemonEventsAfter(0);
    expect(daemonEvents).toHaveLength(0);
    expect(db.getMaxEventId()).toBe(0);

    db.close();
  });

  it('existing run-correlated path still works for phase-driven events', async () => {
    const cwd = makeTmpCwd();
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    const ts = new Date().toISOString();
    const runId = `run-check-${Date.now()}`;
    const sessionId = `sess-check-${Date.now()}`;

    const events: EforgeEvent[] = [
      { type: 'session:start', sessionId, timestamp: ts },
      { type: 'phase:start', runId, sessionId, planSet: 'test', command: 'build', timestamp: ts },
      { type: 'queue:prd:discovered', prdId: 'prd-during-run', title: 'Mid-Run Discovery', timestamp: ts },
      { type: 'phase:end', runId, result: { status: 'completed', summary: 'ok' }, timestamp: ts },
      { type: 'session:end', sessionId, result: { status: 'completed', summary: 'ok' }, timestamp: ts },
    ];

    await collectEvents(withRecording(asGenerator(events), db, cwd));

    // Run-correlated events are stored under the run
    const runEvents = db.getEvents(runId);
    expect(runEvents.some((e) => e.type === 'phase:start')).toBe(true);
    expect(runEvents.every((e) => e.origin === 'run')).toBe(true);

    // queue:prd:discovered has no runId and appears during a phase — no enqueueRunId,
    // but event.runId is also undefined, so activeRunId will be from event.runId ?? enqueueRunId.
    // Since this event is emitted between phase:start and phase:end but the event itself
    // has no runId, and enqueueRunId is not set, it goes to the daemon path.
    const daemonEvents = db.getDaemonEventsAfter(0);
    // daemon:run:upsert events are also stored, filter them out
    const queueDiscovered = daemonEvents.filter((e) => e.type === 'queue:prd:discovered');
    expect(queueDiscovered).toHaveLength(1);
    expect(queueDiscovered[0].runId).toBeNull();
    expect(queueDiscovered[0].origin).toBe('daemon');

    db.close();
  });
});

// --- eforge:endregion plan-01-durable-daemon-event-persistence ---
