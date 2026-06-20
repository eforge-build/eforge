import { describe, expect, it } from 'vitest';
import { safeParseEforgeEvent } from '@eforge-build/client';
import { openDatabase } from '../db.js';
import {
  buildFailedEnqueueUpsertEvent,
  projectFailedEnqueues,
  recordFailedEnqueueResolved,
  recordFailedEnqueueUpsert,
} from '../projections/failed-enqueues.js';

const t1 = '2026-06-19T10:00:00.000Z';
const t2 = '2026-06-19T11:00:00.000Z';

function insertRunWithEvent(db: ReturnType<typeof openDatabase>, opts: { id: string; command?: string; status?: string; source?: string; error?: string; failedAt?: string; summary?: string; planSet?: string }) {
  db.insertRun({ id: opts.id, sessionId: `${opts.id}-session`, planSet: opts.planSet ?? opts.id, command: opts.command ?? 'enqueue', status: opts.status ?? 'failed', startedAt: t1, cwd: process.cwd() });
  if (opts.source !== undefined) {
    db.insertEvent({ runId: opts.id, type: 'enqueue:start', timestamp: t1, data: JSON.stringify({ type: 'enqueue:start', timestamp: t1, source: opts.source }) });
  }
  if (opts.error !== undefined) {
    db.insertEvent({ runId: opts.id, type: 'enqueue:failed', timestamp: opts.failedAt ?? t2, data: JSON.stringify({ type: 'enqueue:failed', timestamp: opts.failedAt ?? t2, error: opts.error }) });
  }
  if (opts.summary !== undefined) {
    db.insertEvent({ runId: opts.id, type: 'session:end', timestamp: t2, data: JSON.stringify({ type: 'session:end', timestamp: t2, sessionId: `${opts.id}-session`, result: { status: 'failed', summary: opts.summary } }) });
  }
}

describe('failed enqueue projection', () => {
  it('projects failed enqueue runs from durable run events and sorts newest first', () => {
    const db = openDatabase(':memory:');
    try {
      insertRunWithEvent(db, { id: 'older', source: 'docs/old-prd.md', error: 'old failure', failedAt: t1 });
      insertRunWithEvent(db, { id: 'newer', source: '# Inline PRD\nbody', error: 'new failure', failedAt: t2 });
      insertRunWithEvent(db, { id: 'successful', status: 'completed', source: 'docs/success.md', command: 'enqueue' });
      insertRunWithEvent(db, { id: 'build-failure', command: 'build', source: 'docs/build.md', error: 'build failure' });

      const rows = projectFailedEnqueues(db);

      expect(rows.map((row) => row.runId)).toEqual(['newer', 'older']);
      expect(rows[0]).toMatchObject({
        sessionId: 'newer-session',
        sourceLabel: 'Inline enqueue source (redacted)',
        failureReason: 'new failure',
        failedAt: t2,
        canReenqueue: true,
        nextCommand: { executable: 'eforge', args: ['enqueue', '<redacted-source>'] },
      });
      expect(rows[1]).toMatchObject({ sourceLabel: 'docs/old-prd.md' });
    } finally {
      db.close();
    }
  });

  it('falls back to session summaries and disables re-enqueue when source is missing', () => {
    const db = openDatabase(':memory:');
    try {
      insertRunWithEvent(db, { id: 'missing-source', summary: 'session summary failure', planSet: 'plan-set-a' });

      const [row] = projectFailedEnqueues(db);

      expect(row).toMatchObject({
        runId: 'missing-source',
        sourceLabel: 'plan-set-a',
        failureReason: 'session summary failure',
        failedAt: t1,
        canReenqueue: false,
        disabledReason: expect.stringContaining('Original enqueue source was not recorded'),
        nextCommand: { executable: 'eforge', args: ['history', 'show', 'missing-source'] },
      });
    } finally {
      db.close();
    }
  });

  it('marks resolved rows from daemon events and omits them unless requested', () => {
    const db = openDatabase(':memory:');
    try {
      insertRunWithEvent(db, { id: 'failed-run', source: 'prd.md', error: 'failed' });
      insertRunWithEvent(db, { id: 'dismissed-run', source: 'dismissed.md', error: 'dismissed' });
      recordFailedEnqueueResolved(db, 'failed-run', t2, 'reenqueue-run');
      recordFailedEnqueueResolved(db, 'dismissed-run', t2);

      expect(projectFailedEnqueues(db)).toEqual([]);
      expect(projectFailedEnqueues(db, { includeResolved: true })).toMatchObject([
        { runId: 'dismissed-run', resolvedAt: t2, canReenqueue: false, disabledReason: expect.stringContaining('has been dismissed') },
        { runId: 'failed-run', resolvedAt: t2, canReenqueue: false, disabledReason: expect.stringContaining('already been re-enqueued') },
      ]);
    } finally {
      db.close();
    }
  });

  it('builds and persists client-owned failed-enqueue upsert events', () => {
    const db = openDatabase(':memory:');
    try {
      insertRunWithEvent(db, { id: 'failed-run', source: 'prd.md', error: 'failed' });

      const event = buildFailedEnqueueUpsertEvent(db, 'failed-run');
      expect(event).toMatchObject({ type: 'daemon:failed-enqueue:upsert', failedEnqueue: { runId: 'failed-run' } });
      expect(safeParseEforgeEvent(event)).toMatchObject({ success: true });

      recordFailedEnqueueUpsert(db, 'failed-run');
      const daemonRows = db.getDaemonEventsAfter(0).filter((row) => row.type === 'daemon:failed-enqueue:upsert');
      expect(daemonRows).toHaveLength(1);
      expect(safeParseEforgeEvent(JSON.parse(daemonRows[0]!.data))).toMatchObject({ success: true });
    } finally {
      db.close();
    }
  });
});
