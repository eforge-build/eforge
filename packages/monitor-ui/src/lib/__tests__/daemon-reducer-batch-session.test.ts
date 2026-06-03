import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  daemonReducer,
  initialDaemonState,
  selectLatestSessionId,
  selectAutoBuildEnabled,
  selectQueueItems,
  selectRuns,
  selectDaemonActivity,
  selectHeartbeatStaleness,
  selectStackLayers,
  ACTIVITY_BUFFER_CAP,
  type DaemonState,
  type HeartbeatPayload,
} from '../daemon-reducer';
import type { EforgeEvent } from '../types';
import type { AutoBuildState } from '../api';
import type { QueueItem, StackLayerWire } from '../types';
import {
  makeAutoBuildState,
  makeEvent,
  makeHeartbeatPayload,
  makeQueueItem,
  makeRun,
} from './daemon-reducer-test-helpers';

// --- eforge:region daemon-reducer-batch-session ---
describe('daemonReducer', () => {
    describe('BATCH_SEED', () => {
      it('seeds all slices from the snapshot', () => {
        const runs = [makeRun()];
        const queue = [makeQueueItem()];
        const sessionMetadata = { 'session-1': { planCount: 3, baseProfile: 'errand' } };
        const autoBuild = makeAutoBuildState();

        const state = daemonReducer(initialDaemonState, {
          type: 'BATCH_SEED',
          runs,
          queue,
          sessionMetadata,
          autoBuild,
        });

        expect(state.runs).toEqual(runs);
        expect(state.queue).toEqual(queue);
        expect(state.sessionMetadata).toEqual(sessionMetadata);
        expect(state.autoBuild).toEqual(autoBuild);
        expect(state.autoBuild?.mode).toBe('running');
        expect(state.autoBuild?.scheduler?.lastMutationReason).toBe('enqueue');
        expect(state.autoBuild?.lastTransition?.reason).toBe('startup complete');
      });

      it('preserves connectionStatus across BATCH_SEED', () => {
        const seeded = daemonReducer(
          { ...initialDaemonState, connectionStatus: 'connected' },
          {
            type: 'BATCH_SEED',
            runs: [],
            queue: [],
            sessionMetadata: {},
            autoBuild: null,
          },
        );
        expect(seeded.connectionStatus).toBe('connected');
      });

      it('appends recentActivity entries to daemonActivity', () => {
        const activity = [
          {
            id: '1',
            event: makeEvent('session:start', { sessionId: 'sess-a' }) as unknown as EforgeEvent,
          },
        ];

        const state = daemonReducer(initialDaemonState, {
          type: 'BATCH_SEED',
          runs: [],
          queue: [],
          sessionMetadata: {},
          autoBuild: null,
          recentActivity: activity,
        });

        expect(state.daemonActivity).toHaveLength(1);
        expect(state.daemonActivity[0].id).toBe('1');
      });

      it('dedupes recentActivity by id — dispatching BATCH_SEED twice with overlapping ids leaves each id exactly once', () => {
        const event1 = makeEvent('session:start', { sessionId: 'sess-a' }) as unknown as EforgeEvent;
        const event2 = makeEvent('session:end', { sessionId: 'sess-a', result: { status: 'completed', summary: '' } }) as unknown as EforgeEvent;

        const activity1 = [{ id: '1', event: event1 }];
        const activity2 = [{ id: '1', event: event1 }, { id: '2', event: event2 }];

        const s1 = daemonReducer(initialDaemonState, {
          type: 'BATCH_SEED',
          runs: [],
          queue: [],
          sessionMetadata: {},
          autoBuild: null,
          recentActivity: activity1,
        });
        expect(s1.daemonActivity).toHaveLength(1);

        const s2 = daemonReducer(s1, {
          type: 'BATCH_SEED',
          runs: [],
          queue: [],
          sessionMetadata: {},
          autoBuild: null,
          recentActivity: activity2,
        });
        // id '1' is already present — only '2' is new
        expect(s2.daemonActivity).toHaveLength(2);
        const ids = s2.daemonActivity.map((a) => a.id);
        expect(ids).toEqual(['1', '2']); // newest at end
      });

      it('dedupes recentActivity, caps at ACTIVITY_BUFFER_CAP', () => {
        // Fill the buffer to near-cap with existing entries
        let state = initialDaemonState;
        for (let i = 0; i < ACTIVITY_BUFFER_CAP - 1; i++) {
          const ev = makeEvent('daemon:lifecycle:starting', { pid: i, port: 8080, version: '1.0.0', mode: 'dev' }) as unknown as EforgeEvent;
          state = daemonReducer(state, { type: 'ADD_EVENT', event: ev, eventId: String(i) });
        }
        expect(state.daemonActivity).toHaveLength(ACTIVITY_BUFFER_CAP - 1);

        // BATCH_SEED with 3 new entries: total = 502, should be capped at 500
        const newActivity = [
          { id: 'new-a', event: makeEvent('session:start', {}) as unknown as EforgeEvent },
          { id: 'new-b', event: makeEvent('session:start', {}) as unknown as EforgeEvent },
          { id: 'new-c', event: makeEvent('session:start', {}) as unknown as EforgeEvent },
        ];
        const capped = daemonReducer(state, {
          type: 'BATCH_SEED',
          runs: [],
          queue: [],
          sessionMetadata: {},
          autoBuild: null,
          recentActivity: newActivity,
        });
        expect(capped.daemonActivity).toHaveLength(ACTIVITY_BUFFER_CAP);
        // Newest entries are at the end
        const lastThree = capped.daemonActivity.slice(-3).map((a) => a.id);
        expect(lastThree).toEqual(['new-a', 'new-b', 'new-c']);
      });

      it('sets latestHeartbeat from snapshot liveness field', () => {
        const latestHeartbeat = {
          at: 1_000_000,
          payload: makeHeartbeatPayload({ uptime: 42_000, queueDepth: 3, runningBuilds: 1 }),
        };

        const state = daemonReducer(initialDaemonState, {
          type: 'BATCH_SEED',
          runs: [],
          queue: [],
          sessionMetadata: {},
          autoBuild: null,
          latestHeartbeat,
        });

        expect(state.latestHeartbeat).toEqual(latestHeartbeat);
      });

      it('does not overwrite latestHeartbeat when latestHeartbeat is undefined in action', () => {
        const existing = {
          at: 999_999,
          payload: makeHeartbeatPayload(),
        };
        const startState = { ...initialDaemonState, latestHeartbeat: existing };

        // BATCH_SEED without latestHeartbeat field → should not clear existing
        const state = daemonReducer(startState, {
          type: 'BATCH_SEED',
          runs: [],
          queue: [],
          sessionMetadata: {},
          autoBuild: null,
          // latestHeartbeat omitted intentionally
        });

        expect(state.latestHeartbeat).toEqual(existing);
      });
    });

    describe('ADD_EVENT: session:start', () => {
      it('does NOT create a new run entry (daemon:run:upsert is authoritative)', () => {
        const existing = makeRun({ id: 'old-run', sessionId: 'old-session' });
        const state: DaemonState = { ...initialDaemonState, runs: [existing] };
        const event = makeEvent('session:start', { sessionId: 'new-session' });

        const next = daemonReducer(state, { type: 'ADD_EVENT', event, eventId: 'e1' });

        // Runs must be unchanged — no synthetic run created
        expect(next.runs).toHaveLength(1);
        expect(next.runs[0]).toEqual(existing);
        // Activity entry must still be appended
        expect(next.daemonActivity).toHaveLength(1);
        expect(next.daemonActivity[0].id).toBe('e1');
      });

      it('does NOT update an existing run status (daemon:run:upsert is authoritative)', () => {
        const existing = makeRun({ status: 'completed' });
        const state: DaemonState = { ...initialDaemonState, runs: [existing] };
        const event = makeEvent('session:start', { sessionId: 'session-1' });

        const next = daemonReducer(state, { type: 'ADD_EVENT', event, eventId: 'e1' });

        // Status must remain unchanged
        expect(next.runs).toHaveLength(1);
        expect(next.runs[0].status).toBe('completed');
      });
    });

    describe('ADD_EVENT: session:end', () => {
      it('does NOT update run status to completed (daemon:run:upsert is authoritative)', () => {
        const state: DaemonState = { ...initialDaemonState, runs: [makeRun()] };
        const event = makeEvent('session:end', {
          sessionId: 'session-1',
          result: { status: 'completed', summary: 'done' },
        });

        const next = daemonReducer(state, { type: 'ADD_EVENT', event, eventId: 'e1' });

        // Status must remain 'running' (unchanged) — daemon:run:upsert handles completion
        expect(next.runs[0].status).toBe('running');
        expect(next.runs[0].completedAt).toBeUndefined();
      });

      it('does NOT update run status to failed (daemon:run:upsert is authoritative)', () => {
        const state: DaemonState = { ...initialDaemonState, runs: [makeRun()] };
        const event = makeEvent('session:end', {
          sessionId: 'session-1',
          result: { status: 'failed', summary: 'error' },
        });

        const next = daemonReducer(state, { type: 'ADD_EVENT', event, eventId: 'e1' });

        // Status must remain 'running' (unchanged)
        expect(next.runs[0].status).toBe('running');
      });

      it('leaves runs unchanged when sessionId is not found but still appends to activity', () => {
        const state: DaemonState = { ...initialDaemonState, runs: [makeRun()] };
        const event = makeEvent('session:end', {
          sessionId: 'unknown-session',
          result: { status: 'completed', summary: '' },
        });

        const next = daemonReducer(state, { type: 'ADD_EVENT', event, eventId: 'e1' });

        expect(next.runs).toEqual(state.runs);
        expect(next.daemonActivity).toHaveLength(1);
        expect(next.daemonActivity[0].id).toBe('e1');
      });
    });

    describe('ADD_EVENT: enqueue:complete', () => {
      it('inserts a minimal pending queue item using event.id', () => {
        const event = makeEvent('enqueue:complete', {
          id: 'prd-enq-001',
          filePath: 'eforge/queue/prd-enq-001.md',
          title: 'My Feature',
          planSet: 'my-feature-set',
        });

        const next = daemonReducer(initialDaemonState, { type: 'ADD_EVENT', event, eventId: 'e1' });

        expect(next.queue).toHaveLength(1);
        expect(next.queue[0]).toEqual({ id: 'prd-enq-001', title: 'My Feature', status: 'pending' });
      });

      it('appends to the activity feed', () => {
        const event = makeEvent('enqueue:complete', {
          id: 'prd-enq-002',
          filePath: 'eforge/queue/prd-enq-002.md',
          title: 'Another Feature',
          planSet: 'another-set',
        });

        const next = daemonReducer(initialDaemonState, { type: 'ADD_EVENT', event, eventId: 'e1' });

        expect(next.daemonActivity).toHaveLength(1);
        expect(next.daemonActivity[0].id).toBe('e1');
      });

      it('dedupes: a second enqueue:complete for the same id leaves one queue item', () => {
        const eventA = makeEvent('enqueue:complete', {
          id: 'prd-enq-003',
          filePath: 'eforge/queue/prd-enq-003.md',
          title: 'Dup Feature',
          planSet: 'dup-set',
        });
        const eventB = makeEvent('enqueue:complete', {
          id: 'prd-enq-003',
          filePath: 'eforge/queue/prd-enq-003.md',
          title: 'Dup Feature',
          planSet: 'dup-set',
        });

        const s1 = daemonReducer(initialDaemonState, { type: 'ADD_EVENT', event: eventA, eventId: 'e1' });
        const s2 = daemonReducer(s1, { type: 'ADD_EVENT', event: eventB, eventId: 'e2' });

        expect(s2.queue).toHaveLength(1);
        expect(s2.queue[0]!.id).toBe('prd-enq-003');
        // Activity feed still gets both entries
        expect(s2.daemonActivity).toHaveLength(2);
      });

      it('does not alter existing runs', () => {
        const existingRun = makeRun({ id: 'run-existing', sessionId: 'existing-session' });
        const state: DaemonState = { ...initialDaemonState, runs: [existingRun] };
        const event = makeEvent('enqueue:complete', {
          id: 'prd-enq-004',
          filePath: 'eforge/queue/prd-enq-004.md',
          title: 'Run-safe Feature',
          planSet: 'run-safe-set',
        });

        const next = daemonReducer(state, { type: 'ADD_EVENT', event, eventId: 'e1' });

        expect(next.runs).toEqual(state.runs);
      });
    });

    describe('ADD_EVENT: queue:prd:discovered', () => {
      it('adds a new pending queue item', () => {
        const event = makeEvent('queue:prd:discovered', {
          prdId: 'prd-42',
          title: 'New Feature',
        });

        const next = daemonReducer(initialDaemonState, { type: 'ADD_EVENT', event, eventId: 'e1' });

        expect(next.queue).toHaveLength(1);
        expect(next.queue[0]).toMatchObject({ id: 'prd-42', title: 'New Feature', status: 'pending' });
      });

      it('ignores duplicate prdIds but still appends to activity', () => {
        const state: DaemonState = { ...initialDaemonState, queue: [makeQueueItem()] };
        const event = makeEvent('queue:prd:discovered', { prdId: 'prd-1', title: 'Dup' });

        const next = daemonReducer(state, { type: 'ADD_EVENT', event, eventId: 'e1' });

        expect(next.queue).toEqual(state.queue);
        expect(next.daemonActivity).toHaveLength(1);
        expect(next.daemonActivity[0].id).toBe('e1');
      });

      it('live queue:prd:discovered projection deep-equals a snapshot-shaped QueueItem', () => {
        // This regression asserts that applying a queue:prd:discovered event to an
        // empty queue produces a QueueItem identical in shape to what stream:hello.queue
        // would return for a PRD file with matching title and no optional frontmatter.
        const event = makeEvent('queue:prd:discovered', {
          prdId: 'prd-parity-99',
          title: 'Parity PRD Title',
        });

        const next = daemonReducer(initialDaemonState, { type: 'ADD_EVENT', event, eventId: 'e1' });

        expect(next.queue).toHaveLength(1);
        // Deep equality with the exact QueueItem shape loadQueueItemsSync would return
        // for a pending PRD (no depends_on, no recoveryVerdict, no lockfile).
        const expectedItem: QueueItem = {
          id: 'prd-parity-99',
          title: 'Parity PRD Title',
          status: 'pending',
        };
        expect(next.queue[0]).toEqual(expectedItem);
      });
    });

    describe('ADD_EVENT: queue:prd:complete', () => {
      it('updates item to failed status', () => {
        const state: DaemonState = { ...initialDaemonState, queue: [makeQueueItem()] };
        const event = makeEvent('queue:prd:complete', { prdId: 'prd-1', status: 'failed' });

        const next = daemonReducer(state, { type: 'ADD_EVENT', event, eventId: 'e1' });

        expect(next.queue[0].status).toBe('failed');
      });

      it('removes completed items from the queue', () => {
        const state: DaemonState = { ...initialDaemonState, queue: [makeQueueItem()] };
        const event = makeEvent('queue:prd:complete', { prdId: 'prd-1', status: 'completed' });

        const next = daemonReducer(state, { type: 'ADD_EVENT', event, eventId: 'e1' });

        expect(next.queue).toHaveLength(0);
      });
    });

    describe('ADD_EVENT: daemon:run:upsert', () => {
      it('prepends new runs and replaces existing runs in place', () => {
        const olderRun = makeRun({ id: 'run-old', sessionId: 'session-old' });
        const newRun = makeRun({ id: 'run-new', sessionId: 'session-new', status: 'queued' });
        const withPrepended = daemonReducer(
          { ...initialDaemonState, runs: [olderRun] },
          { type: 'ADD_EVENT', event: makeEvent('daemon:run:upsert', { run: newRun }), eventId: 'e1' },
        );

        expect(withPrepended.runs.map((run) => run.id)).toEqual(['run-new', 'run-old']);

        const replacement = makeRun({ id: 'run-old', sessionId: 'session-old', status: 'completed' });
        const replaced = daemonReducer(
          withPrepended,
          { type: 'ADD_EVENT', event: makeEvent('daemon:run:upsert', { run: replacement }), eventId: 'e2' },
        );

        expect(replaced.runs.map((run) => run.id)).toEqual(['run-new', 'run-old']);
        expect(replaced.runs[1]).toEqual(replacement);
      });
    });

    describe('ADD_EVENT: queue projections', () => {
      it('marks started PRDs as running', () => {
        const state: DaemonState = { ...initialDaemonState, queue: [makeQueueItem()] };
        const event = makeEvent('queue:prd:start', { prdId: 'prd-1', title: 'My Feature' });

        const next = daemonReducer(state, { type: 'ADD_EVENT', event, eventId: 'e1' });

        expect(next.queue[0].status).toBe('running');
      });

      it('leaves stale PRDs queued for proceed verdicts and removes revise verdicts', () => {
        const state: DaemonState = { ...initialDaemonState, queue: [makeQueueItem()] };
        const proceedEvent = makeEvent('queue:prd:stale', {
          prdId: 'prd-1',
          title: 'My Feature',
          verdict: 'proceed',
          justification: 'still valid',
        });

        const proceeded = daemonReducer(state, { type: 'ADD_EVENT', event: proceedEvent, eventId: 'e1' });
        expect(proceeded.queue).toEqual(state.queue);

        const reviseEvent = makeEvent('queue:prd:stale', {
          prdId: 'prd-1',
          title: 'My Feature',
          verdict: 'revise',
          justification: 'needs updates',
        });
        const revised = daemonReducer(state, { type: 'ADD_EVENT', event: reviseEvent, eventId: 'e2' });
        expect(revised.queue).toHaveLength(0);
      });

      it('removes skipped PRDs and marks commit failures as failed', () => {
        const state: DaemonState = { ...initialDaemonState, queue: [makeQueueItem(), makeQueueItem({ id: 'prd-2' })] };
        const skipEvent = makeEvent('queue:prd:skip', { prdId: 'prd-1', reason: 'dependency failed' });

        const skipped = daemonReducer(state, { type: 'ADD_EVENT', event: skipEvent, eventId: 'e1' });
        expect(skipped.queue.map((item) => item.id)).toEqual(['prd-2']);

        const commitFailedEvent = makeEvent('queue:prd:commit-failed', {
          prdId: 'prd-2',
          title: 'My Feature',
          error: 'git commit failed',
        });
        const failed = daemonReducer(skipped, { type: 'ADD_EVENT', event: commitFailedEvent, eventId: 'e2' });
        expect(failed.queue[0]).toMatchObject({ id: 'prd-2', status: 'failed' });
      });
    });

    describe('ADD_EVENT: queue:complete', () => {
      it('removes all non-failed items', () => {
        const items: QueueItem[] = [
          makeQueueItem({ id: 'prd-1', status: 'running' }),
          makeQueueItem({ id: 'prd-2', status: 'failed' }),
          makeQueueItem({ id: 'prd-3', status: 'pending' }),
        ];
        const state: DaemonState = { ...initialDaemonState, queue: items };
        const event = makeEvent('queue:complete', { processed: 2, skipped: 0 });

        const next = daemonReducer(state, { type: 'ADD_EVENT', event, eventId: 'e1' });

        expect(next.queue).toHaveLength(1);
        expect(next.queue[0].id).toBe('prd-2');
      });
    });
});
// --- eforge:endregion daemon-reducer-batch-session ---
