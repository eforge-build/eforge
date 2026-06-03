import type { EforgeEvent } from '../types';
import type { AutoBuildState } from '../api';
import type { QueueItem, RunInfo, StackLayerWire } from '../types';
import type { HeartbeatPayload } from '../daemon-reducer';

// Hand-crafted event helper following the "cast through unknown" test pattern.
export function makeEvent<T extends EforgeEvent['type']>(
  type: T,
  extra: object,
): Extract<EforgeEvent, { type: T }> {
  return {
    type,
    timestamp: '2024-01-15T10:00:00.000Z',
    sessionId: 'session-1',
    ...extra,
  } as unknown as Extract<EforgeEvent, { type: T }>;
}

export function makeRun(overrides: Partial<RunInfo> = {}): RunInfo {
  return {
    id: 'run-1',
    sessionId: 'session-1',
    planSet: 'my-set',
    command: 'build',
    status: 'running',
    startedAt: '2024-01-15T09:00:00.000Z',
    cwd: '/home/user/project',
    ...overrides,
  };
}

export function makeQueueItem(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    id: 'prd-1',
    title: 'My Feature',
    status: 'pending',
    ...overrides,
  };
}

export function makeAutoBuildState(enabled = true): AutoBuildState {
  return {
    enabled,
    watcher: { running: true, pid: 1234, sessionId: 'watcher-session-1' },
    desired: enabled ? 'enabled' : 'disabled',
    mode: enabled ? 'running' : 'disabled',
    scheduler: { alive: enabled, paused: false, lastMutationReason: 'enqueue' },
    lastTransition: {
      at: '2024-01-15T09:59:00.000Z',
      previousMode: enabled ? 'starting' : 'running',
      nextMode: enabled ? 'running' : 'disabled',
      desired: enabled ? 'enabled' : 'disabled',
      reason: enabled ? 'startup complete' : 'manual disable',
      source: 'test',
    },
    reason: enabled ? 'startup complete' : 'manual disable',
  };
}

export function makeHeartbeatPayload(overrides: Partial<HeartbeatPayload> = {}): HeartbeatPayload {
  return {
    uptime: 60_000,
    queueDepth: 0,
    runningBuilds: 0,
    autoBuild: { enabled: true, paused: false },
    subscribers: 1,
    ...overrides,
  };
}

export function makeStackLayer(overrides: Partial<StackLayerWire> = {}): StackLayerWire {
  return {
    prdId: 'prd-1',
    stackId: 'stack-1',
    provider: 'git-spice',
    branch: 'eforge/prd-1',
    baseBranch: 'main',
    status: 'pending',
    recordedAt: '2024-01-15T09:00:00.000Z',
    updatedAt: '2024-01-15T09:00:00.000Z',
    ...overrides,
  } as StackLayerWire;
}
