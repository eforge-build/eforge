import { describe, it, expect } from 'vitest';
import { selectActiveSessionIds } from '@/lib/selectors/active-builds';
import type { RunInfo } from '@eforge-build/client/browser';

function makeRun(overrides: Partial<RunInfo>): RunInfo {
  return {
    id: 'run-1',
    sessionId: 'session-1',
    planSet: 'plan-set',
    command: 'build',
    status: 'running',
    startedAt: new Date().toISOString(),
    cwd: '/tmp',
    ...overrides,
  };
}

describe('selectActiveSessionIds', () => {
  it('returns two IDs for two concurrent active runs with distinct session IDs', () => {
    const runs: RunInfo[] = [
      makeRun({ id: 'run-1', sessionId: 'session-a', status: 'running' }),
      makeRun({ id: 'run-2', sessionId: 'session-b', status: 'running' }),
    ];
    const ids = selectActiveSessionIds(runs);
    expect(ids).toHaveLength(2);
    expect(ids).toContain('session-a');
    expect(ids).toContain('session-b');
  });

  it('returns no ID for runs with terminal status and completedAt set', () => {
    const runs: RunInfo[] = [
      makeRun({ id: 'run-1', sessionId: 'session-a', status: 'completed', completedAt: new Date().toISOString() }),
      makeRun({ id: 'run-2', sessionId: 'session-b', status: 'failed', completedAt: new Date().toISOString() }),
    ];
    const ids = selectActiveSessionIds(runs);
    expect(ids).toHaveLength(0);
  });

  it('returns no ID for runs with terminal status even without completedAt', () => {
    const runs: RunInfo[] = [
      makeRun({ id: 'run-1', sessionId: 'session-a', status: 'cancelled' }),
      makeRun({ id: 'run-2', sessionId: 'session-b', status: 'stopped' }),
      makeRun({ id: 'run-3', sessionId: 'session-c', status: 'success' }),
    ];
    const ids = selectActiveSessionIds(runs);
    expect(ids).toHaveLength(0);
  });

  it('returns one ID for duplicate active rows with the same sessionId', () => {
    const runs: RunInfo[] = [
      makeRun({ id: 'run-1', sessionId: 'session-a', status: 'running' }),
      makeRun({ id: 'run-2', sessionId: 'session-a', status: 'pending' }),
    ];
    const ids = selectActiveSessionIds(runs);
    expect(ids).toHaveLength(1);
    expect(ids[0]).toBe('session-a');
  });

  it('returns an active ID for unknown non-terminal status without completedAt', () => {
    const runs: RunInfo[] = [
      makeRun({ id: 'run-1', sessionId: 'session-a', status: 'starting' }),
    ];
    const ids = selectActiveSessionIds(runs);
    expect(ids).toHaveLength(1);
    expect(ids[0]).toBe('session-a');
  });

  it('ignores runs without sessionId', () => {
    const runs: RunInfo[] = [
      makeRun({ id: 'run-1', sessionId: undefined, status: 'running' }),
    ];
    const ids = selectActiveSessionIds(runs);
    expect(ids).toHaveLength(0);
  });

  it('returns sorted IDs for stable hook dependencies', () => {
    const runs: RunInfo[] = [
      makeRun({ id: 'run-1', sessionId: 'zzz', status: 'running' }),
      makeRun({ id: 'run-2', sessionId: 'aaa', status: 'running' }),
      makeRun({ id: 'run-3', sessionId: 'mmm', status: 'running' }),
    ];
    const ids = selectActiveSessionIds(runs);
    expect(ids).toEqual(['aaa', 'mmm', 'zzz']);
  });

  it('handles mixed terminal and active statuses', () => {
    const runs: RunInfo[] = [
      makeRun({ id: 'run-1', sessionId: 'active-1', status: 'running' }),
      makeRun({ id: 'run-2', sessionId: 'done-1', status: 'completed', completedAt: new Date().toISOString() }),
      makeRun({ id: 'run-3', sessionId: 'active-2', status: 'queued' }),
      makeRun({ id: 'run-4', sessionId: 'done-2', status: 'failed', completedAt: new Date().toISOString() }),
    ];
    const ids = selectActiveSessionIds(runs);
    expect(ids).toHaveLength(2);
    expect(ids).toContain('active-1');
    expect(ids).toContain('active-2');
  });
});
