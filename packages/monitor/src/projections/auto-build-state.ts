import type { AutoBuildState, DaemonStreamSnapshot, EforgeEvent, RecoveryAutoResumeProjectionState } from '@eforge-build/client';
import type { AutoBuildController } from '../auto-build-supervisor.js';

interface AutoBuildProjectionInput {
  state?: { autoBuildController: Pick<AutoBuildController, 'getSnapshot'> };
  capacity: { runningCount: number; limit: number };
  recoveryAutoResume?: { enabled: boolean; maxAttempts: number };
  daemonEvents?: Array<{ type: string; data: string }>;
  latestRecoveryAutoResumeEvent?: { type: string; data: string };
}

const DISABLED: AutoBuildState = {
  enabled: false,
  watcher: { running: false, pid: null, sessionId: null },
  desired: 'disabled',
  mode: 'disabled',
  scheduler: { alive: false, paused: false },
};

function parseAutoResumeEvent(row: { type: string; data: string }): EforgeEvent | undefined {
  if (!row.type.startsWith('recovery:auto-resume:')) return undefined;
  try {
    const parsed = JSON.parse(row.data) as EforgeEvent;
    return parsed.type.startsWith('recovery:auto-resume:') ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function projectRecoveryAutoResumeState(input: Pick<AutoBuildProjectionInput, 'recoveryAutoResume' | 'daemonEvents' | 'latestRecoveryAutoResumeEvent'>): RecoveryAutoResumeProjectionState | undefined {
  if (!input.recoveryAutoResume) return undefined;
  const base: RecoveryAutoResumeProjectionState = {
    enabled: input.recoveryAutoResume.enabled,
    maxAttempts: input.recoveryAutoResume.maxAttempts,
    attempts: 0,
  };
  if (!input.recoveryAutoResume.enabled) return { ...base, stopReason: 'disabled', lastDecision: 'stopped' };

  const latest = (input.latestRecoveryAutoResumeEvent ? [input.latestRecoveryAutoResumeEvent] : [...(input.daemonEvents ?? [])].reverse())
    .map(parseAutoResumeEvent)
    .find((event): event is Extract<EforgeEvent, { type: 'recovery:auto-resume:evaluate' | 'recovery:auto-resume:queued' | 'recovery:auto-resume:stopped' }> => event !== undefined);
  if (!latest) return base;
  if (latest.type === 'recovery:auto-resume:queued') {
    return { enabled: true, lastDecision: 'queued', attempts: latest.attempt, maxAttempts: latest.maxAttempts, prdId: latest.prdId, setName: latest.setName };
  }
  if (latest.type === 'recovery:auto-resume:stopped') {
    return { enabled: latest.reason !== 'disabled', lastDecision: 'stopped', attempts: latest.attempt, maxAttempts: latest.maxAttempts, prdId: latest.prdId, setName: latest.setName, stopReason: latest.reason, ...(latest.message !== undefined ? { message: latest.message } : {}) };
  }
  return { enabled: latest.enabled, lastDecision: 'evaluate', attempts: latest.attempt, maxAttempts: latest.maxAttempts, prdId: latest.prdId, setName: latest.setName };
}

export function autoBuildStateToWire(input: AutoBuildProjectionInput): AutoBuildState {
  const snapshot = input.state?.autoBuildController.getSnapshot() ?? DISABLED;
  const recoveryAutoResume = projectRecoveryAutoResumeState(input);
  return {
    ...snapshot,
    scheduler: snapshot.scheduler
      ? { ...snapshot.scheduler, runningCount: input.capacity.runningCount, limit: input.capacity.limit }
      : { alive: false, paused: false, runningCount: input.capacity.runningCount, limit: input.capacity.limit },
    ...(recoveryAutoResume !== undefined ? { recoveryAutoResume } : {}),
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
    ...(snapshot.recoveryAutoResume !== undefined ? { recoveryAutoResume: snapshot.recoveryAutoResume } : {}),
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
