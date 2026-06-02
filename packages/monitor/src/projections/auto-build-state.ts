import type { AutoBuildState, DaemonStreamSnapshot } from '@eforge-build/client';
import type { AutoBuildController } from '../auto-build-supervisor.js';

interface AutoBuildProjectionInput {
  state?: { autoBuildController: Pick<AutoBuildController, 'getSnapshot'> };
  capacity: { runningCount: number; limit: number };
}

const DISABLED: AutoBuildState = {
  enabled: false,
  watcher: { running: false, pid: null, sessionId: null },
  desired: 'disabled',
  mode: 'disabled',
  scheduler: { alive: false, paused: false },
};

export function autoBuildStateToWire(input: AutoBuildProjectionInput): AutoBuildState {
  const snapshot = input.state?.autoBuildController.getSnapshot() ?? DISABLED;
  return {
    ...snapshot,
    scheduler: snapshot.scheduler
      ? { ...snapshot.scheduler, runningCount: input.capacity.runningCount, limit: input.capacity.limit }
      : { alive: false, paused: false, runningCount: input.capacity.runningCount, limit: input.capacity.limit },
  };
}

export function autoBuildHeartbeatToWire(input: AutoBuildProjectionInput): DaemonStreamSnapshot['liveness']['autoBuild'] {
  const snapshot = autoBuildStateToWire(input);
  return {
    enabled: snapshot.enabled,
    paused: snapshot.mode === 'paused' || snapshot.scheduler?.paused === true,
    desired: snapshot.desired,
    mode: snapshot.mode,
    scheduler: snapshot.scheduler,
    lastTransition: snapshot.lastTransition,
    reason: snapshot.reason,
  };
}

export function buildDaemonHeartbeatObject(input: AutoBuildProjectionInput & { now: number; startedAtMs: number; queueDepth: number; runningBuilds: number; subscriberCount: number }): DaemonStreamSnapshot['liveness'] {
  return {
    type: 'daemon:heartbeat',
    timestamp: new Date(input.now).toISOString(),
    uptime: input.now - input.startedAtMs,
    queueDepth: input.queueDepth,
    runningBuilds: input.runningBuilds,
    autoBuild: autoBuildHeartbeatToWire(input),
    subscribers: input.subscriberCount,
  };
}
