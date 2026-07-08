import { describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../db.js';
import { parseEventRow, hydrateRecentDaemonActivity } from '../projections/event-hydration.js';
import { buildRunState } from '../projections/run-state.js';

const ts = '2025-01-01T00:00:00.000Z';

describe('event hydration and run state projections', () => {
  it('patches missing timestamp/type and skips malformed rows', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(parseEventRow(JSON.stringify({ runId: 'r1', planSet: 's', command: 'build' }), ts, 'phase:start')?.type).toBe('phase:start');
    expect(parseEventRow('{', ts, 'phase:start')).toBeNull();
    expect(parseEventRow(JSON.stringify({ type: 'not-real' }), ts, 'not-real')).toBeNull();
    expect(parseEventRow('null', ts, 'phase:start')).toBeNull();
    expect(parseEventRow('"secret raw payload"', ts, 'phase:start')).toBeNull();
    expect(stderr.mock.calls.flat().join('\n')).not.toContain('secret raw payload');
    stderr.mockRestore();
  });
  it('builds run state status and serializes hydrated events', () => {
    const db = openDatabase(':memory:');
    db.insertRun({ id: 'r1', sessionId: 's1', planSet: 'set', command: 'build', status: 'completed', startedAt: ts, cwd: process.cwd() });
    db.insertEvent({ runId: 'r1', type: 'phase:start', data: JSON.stringify({ type: 'phase:start', timestamp: ts, runId: 'r1', planSet: 'set', command: 'build' }), timestamp: ts });
    db.insertEvent({ runId: 'r1', type: 'phase:start', data: '{', timestamp: ts });
    const state = buildRunState(db, 's1');
    expect(state.status).toBe('completed');
    expect(state.events).toHaveLength(1);
    expect(JSON.parse(state.events[0].data).type).toBe('phase:start');
    db.close();
  });
  it('hydrates persisted same-plan recovery events through client-owned schemas', () => {
    const db = openDatabase(':memory:');
    db.insertRun({ id: 'r1', sessionId: 's-recovery', planSet: 'set', command: 'build', status: 'running', startedAt: ts, cwd: process.cwd() });
    const event = { type: 'plan:build:recovery:skip', timestamp: ts, planId: 'plan-01', blockerKind: 'review', reason: 'cross-plan-blocker', details: 'Belongs to another plan.', attemptsRemaining: 1 };
    db.insertEvent({ runId: 'r1', type: event.type, data: JSON.stringify(event), timestamp: ts });
    const state = buildRunState(db, 's-recovery');
    expect(state.events).toHaveLength(1);
    expect(JSON.parse(state.events[0].data)).toEqual(event);
    db.close();
  });
  it('derives unknown, running, and failed run-state status with current precedence', () => {
    const db = openDatabase(':memory:');
    expect(buildRunState(db, 'missing').status).toBe('unknown');
    db.insertRun({ id: 'failed', sessionId: 's1', planSet: 'set', command: 'build', status: 'failed', startedAt: ts, cwd: process.cwd() });
    expect(buildRunState(db, 's1').status).toBe('failed');
    db.insertRun({ id: 'running', sessionId: 's1', planSet: 'set', command: 'build', status: 'running', startedAt: ts, cwd: process.cwd() });
    expect(buildRunState(db, 's1').status).toBe('running');
    db.close();
  });
  it('treats forced-termination run statuses as failed', () => {
    const db = openDatabase(':memory:');
    db.insertRun({ id: 'killed', sessionId: 's-killed', planSet: 'set', command: 'build', status: 'killed', startedAt: ts, cwd: process.cwd() });
    expect(buildRunState(db, 's-killed').status).toBe('failed');
    db.close();
  });
  it('trims recent daemon activity to the hello cursor', () => {
    const rows = [
      { id: 1, runId: null, origin: 'daemon' as const, type: 'phase:start', data: JSON.stringify({ type: 'phase:start', timestamp: ts, runId: 'r', planSet: 's', command: 'build' }), timestamp: ts },
      { id: 2, runId: null, origin: 'daemon' as const, type: 'phase:start', data: JSON.stringify({ type: 'phase:start', timestamp: ts, runId: 'r', planSet: 's', command: 'build' }), timestamp: ts },
    ];
    expect(hydrateRecentDaemonActivity(rows, 1).map((r) => r.id)).toEqual([1]);
  });
});
