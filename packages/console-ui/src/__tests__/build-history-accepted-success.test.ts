// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { classifyBuildStatus, selectAllNowBuildItems } from '@/lib/selectors/build-history';
import { makeRun } from '@/test-support/factories';

describe('Build history accepted-success statuses', () => {
  it('classifies accepted-success-like resolved runs as completed', () => {
    expect(classifyBuildStatus('accepted-success-complete')).toBe('completed');
    expect(classifyBuildStatus('accepted-success-resolved')).toBe('completed');
  });

  it('classifies forced-termination statuses as failed', () => {
    expect(classifyBuildStatus('killed')).toBe('failed');
    expect(classifyBuildStatus('cancelled')).toBe('failed');
    expect(classifyBuildStatus('aborted')).toBe('failed');
  });

  it('rolls up an accepted-success-like resolved build as completed', () => {
    const builds = selectAllNowBuildItems([
      makeRun({
        id: 'run-accepted-success',
        sessionId: 'session-accepted-success',
        planSet: 'accepted-success-prd',
        command: 'build',
        status: 'accepted-success-complete',
        startedAt: '2026-06-01T00:00:00.000Z',
        completedAt: '2026-06-01T00:05:00.000Z',
      }),
    ]);

    expect(builds).toHaveLength(1);
    expect(builds[0].status).toBe('completed');
    expect(builds[0].phase).toBeNull();
  });

  it('rolls up a killed build as failed at its last phase', () => {
    const builds = selectAllNowBuildItems([
      makeRun({
        id: 'run-killed',
        sessionId: 'session-killed',
        planSet: 'killed-prd',
        command: 'build',
        status: 'killed',
        startedAt: '2026-06-01T00:00:00.000Z',
        completedAt: '2026-06-01T00:05:00.000Z',
      }),
    ]);

    expect(builds).toHaveLength(1);
    expect(builds[0].status).toBe('failed');
    expect(builds[0].phase).toBe('build');
  });

  it('rolls up historical killed rows without completedAt as failed instead of running', () => {
    const builds = selectAllNowBuildItems([
      makeRun({
        id: 'run-old-killed',
        sessionId: 'session-old-killed',
        planSet: 'old-killed-prd',
        command: 'build',
        status: 'killed',
        startedAt: '2026-06-01T00:00:00.000Z',
        completedAt: undefined,
      }),
    ]);

    expect(builds).toHaveLength(1);
    expect(builds[0].status).toBe('failed');
    expect(builds[0].phase).toBe('build');
  });
});
