// @vitest-environment node
import { describe, it, expect } from 'vitest';
import type { RunInfo } from '@eforge-build/client/browser';
import { countActiveIntakeRuns, countActiveBuildRuns } from '@/lib/selectors/enqueue-cards';

function makeRun(overrides: Partial<RunInfo> = {}): RunInfo {
  return {
    id: 'run-1',
    sessionId: 'sess-1',
    planSet: 'my-plans',
    command: 'build',
    status: 'running',
    startedAt: new Date(Date.now() - 10_000).toISOString(),
    cwd: '/project',
    ...overrides,
  };
}

describe('countActiveIntakeRuns / countActiveBuildRuns', () => {
  it('splits in-progress runs into intake (enqueue) and build, excluding terminal runs', () => {
    const runs = [
      makeRun({ id: 'b1', sessionId: 's1', command: 'build', status: 'running' }),
      makeRun({ id: 'b2', sessionId: 's2', command: 'build', status: 'running' }),
      // An enqueue/formatting run counts as intake, never as an active build.
      makeRun({ id: 'e1', sessionId: 's3', command: 'enqueue', status: 'running' }),
      // A completed run is neither intake nor active.
      makeRun({
        id: 'b3',
        sessionId: 's4',
        command: 'build',
        status: 'completed',
        completedAt: new Date().toISOString(),
      }),
    ];
    expect(countActiveIntakeRuns(runs)).toBe(1);
    expect(countActiveBuildRuns(runs)).toBe(2);
  });

  it('dedupes by session id so a multi-run session counts once', () => {
    const runs = [
      makeRun({ id: 'a', sessionId: 'dup', command: 'build', status: 'running' }),
      makeRun({ id: 'b', sessionId: 'dup', command: 'build', status: 'running' }),
    ];
    expect(countActiveBuildRuns(runs)).toBe(1);
    expect(countActiveIntakeRuns(runs)).toBe(0);
  });
});
