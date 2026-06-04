import { describe, it, expect } from 'vitest';
import {
  eforgeReducer,
  initialRunState,
  getSummaryStats,
  type RunState,
  type RunAction,
} from '@eforge-build/console-ui/lib/run-state';
import type { EforgeEvent, ProjectableState } from '@eforge-build/client';
import { isAlwaysYieldedAgentEvent } from '@eforge-build/client';
import { dispatch } from './monitor-reducer-helpers';

describe('event-registry run projection via daemon:run:upsert', () => {
  it('daemon:run:upsert is the only run-state projector; enqueue:complete projects queue only', async () => {
    const { eventRegistry } = await import('@eforge-build/client');

    // enqueue:start and enqueue:failed still have no project functions.
    // daemon:run:upsert is the single source of truth for DaemonState.runs.
    expect(eventRegistry['enqueue:start'].project).toBeUndefined();
    expect(eventRegistry['enqueue:failed'].project).toBeUndefined();

    // enqueue:complete now has a project function for queue projection only.
    // It must insert a pending QueueItem but must NOT touch runs.
    expect(eventRegistry['enqueue:complete'].project).toBeDefined();
    const enqueueCompleteProject = eventRegistry['enqueue:complete'].project!;
    const stateWithRuns = {
      runs: [
        {
          id: 'run-001',
          planSet: 'test',
          command: 'build' as const,
          status: 'running' as const,
          startedAt: '2025-01-01T00:00:00.000Z',
          cwd: '/tmp/project',
        },
      ],
      queue: [],
      autoBuild: null,
      latestHeartbeat: null,
      stackLayers: [],
    } satisfies ProjectableState;
    const enqEvent = {
      type: 'enqueue:complete' as const,
      timestamp: '2025-01-01T00:01:00.000Z',
      id: 'prd-x',
      filePath: 'eforge/queue/prd-x.md',
      title: 'X Feature',
      planSet: 'x-feature',
    };
    const enqDelta = enqueueCompleteProject(enqEvent, stateWithRuns);
    // Queue gets a new pending item
    expect(enqDelta?.queue).toBeDefined();
    expect(enqDelta?.queue![0]!.id).toBe('prd-x');
    // Runs must not be touched
    expect(enqDelta).not.toHaveProperty('runs');

    // daemon:run:upsert has the project function and updates state.runs
    expect(eventRegistry['daemon:run:upsert'].project).toBeDefined();

    const runId = 'run-enqueue-001';
    const state = {
      runs: [
        {
          id: runId,
          planSet: '',
          command: 'enqueue' as const,
          status: 'running' as const,
          startedAt: '2025-01-01T00:00:00.000Z',
          cwd: '/tmp/project',
        },
      ],
      queue: [],
      autoBuild: null,
      latestHeartbeat: null,
      stackLayers: [],
    } satisfies ProjectableState;

    const upsertEvent = {
      type: 'daemon:run:upsert' as const,
      timestamp: '2025-01-01T00:01:00.000Z',
      run: {
        id: runId,
        planSet: 'Canonical Plan Set Name',
        command: 'enqueue' as const,
        status: 'completed' as const,
        startedAt: '2025-01-01T00:00:00.000Z',
        cwd: '/tmp/project',
      },
    };

    const upsertEntry = eventRegistry['daemon:run:upsert'];
    const delta = upsertEntry.project!(upsertEvent as Parameters<typeof upsertEntry.project>[0], state);
    expect(delta).toBeDefined();
    expect(delta!.runs![0].planSet).toBe('Canonical Plan Set Name');
    expect(delta!.runs![0].status).toBe('completed');
  });
});
