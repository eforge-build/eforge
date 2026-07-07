import { describe, expect, it } from 'vitest';
import { autoBuildHeartbeatToWire, autoBuildStateToWire, buildDaemonHeartbeatObject, projectRecoveryAutoResumeState } from '../projections/auto-build-state.js';
import type { AutoBuildState, EforgeEvent } from '@eforge-build/client';

describe('auto-build state projections', () => {
  it('projects disabled defaults with capacity', () => {
    expect(autoBuildStateToWire({ capacity: { runningCount: 2, limit: 4 } })).toMatchObject({ enabled: false, scheduler: { runningCount: 2, limit: 4 } });
  });
  it('enriches controller snapshots and heartbeat pause state', () => {
    const snapshot: AutoBuildState = { enabled: true, watcher: { running: true, pid: 1, sessionId: 's' }, desired: 'enabled', mode: 'paused', scheduler: { alive: true, paused: false } };
    const input = { state: { autoBuildController: { getSnapshot: () => snapshot } }, capacity: { runningCount: 1, limit: 3 } };
    expect(autoBuildStateToWire(input).scheduler).toEqual({ alive: true, paused: false, runningCount: 1, limit: 3 });
    expect(autoBuildHeartbeatToWire(input).paused).toBe(true);
  });
  it('builds daemon heartbeat liveness with injected timestamps', () => {
    expect(buildDaemonHeartbeatObject({ now: 2000, startedAtMs: 500, queueDepth: 7, runningBuilds: 2, subscriberCount: 3, capacity: { runningCount: 2, limit: 5 } })).toMatchObject({ timestamp: '1970-01-01T00:00:02.000Z', uptime: 1500, queueDepth: 7, runningBuilds: 2, subscribers: 3 });
  });

  it('projects disabled recovery auto-resume policy as a stopped state with a visible reason', () => {
    expect(projectRecoveryAutoResumeState({ recoveryAutoResume: { enabled: false, maxAttempts: 1 } })).toEqual({
      enabled: false,
      maxAttempts: 1,
      attempts: 0,
      lastDecision: 'stopped',
      stopReason: 'disabled',
    });
  });

  it('keeps the current disabled recovery auto-resume policy authoritative over stale daemon audit events', () => {
    const events: EforgeEvent[] = [
      { type: 'recovery:auto-resume:queued', timestamp: '2025-01-01T00:00:01.000Z', prdId: 'prd-1', setName: 'set-1', action: 'continue-repair', attempt: 1, maxAttempts: 2 },
      { type: 'recovery:auto-resume:stopped', timestamp: '2025-01-01T00:00:02.000Z', prdId: 'prd-1', setName: 'set-1', reason: 'attempt-budget-exhausted', attempt: 1, maxAttempts: 2, message: 'old stop' },
    ];
    const daemonEvents = events.map((event) => ({ type: event.type, data: JSON.stringify(event) }));
    const expected = {
      enabled: false,
      maxAttempts: 1,
      attempts: 0,
      lastDecision: 'stopped' as const,
      stopReason: 'disabled' as const,
    };
    expect(projectRecoveryAutoResumeState({ recoveryAutoResume: { enabled: false, maxAttempts: 1 }, daemonEvents })).toEqual(expected);
    expect(autoBuildStateToWire({ capacity: { runningCount: 0, limit: 1 }, recoveryAutoResume: { enabled: false, maxAttempts: 1 }, daemonEvents }).recoveryAutoResume).toEqual(expected);
  });

  it('projects recovery auto-resume attempts, queued decision, and stopped reason from daemon audit events', () => {
    const events: EforgeEvent[] = [
      { type: 'recovery:auto-resume:evaluate', timestamp: '2025-01-01T00:00:00.000Z', prdId: 'prd-1', setName: 'set-1', enabled: true, attempt: 1, maxAttempts: 2 },
      { type: 'recovery:auto-resume:queued', timestamp: '2025-01-01T00:00:01.000Z', prdId: 'prd-1', setName: 'set-1', action: 'continue-repair', attempt: 2, maxAttempts: 2 },
      { type: 'recovery:auto-resume:stopped', timestamp: '2025-01-01T00:00:02.000Z', prdId: 'prd-1', setName: 'set-1', reason: 'attempt-budget-exhausted', attempt: 2, maxAttempts: 2, message: 'Budget exhausted.' },
    ];
    const daemonEvents = events.map((event) => ({ type: event.type, data: JSON.stringify(event) }));
    expect(projectRecoveryAutoResumeState({ recoveryAutoResume: { enabled: true, maxAttempts: 2 }, daemonEvents })).toMatchObject({
      enabled: true,
      maxAttempts: 2,
      attempts: 2,
      lastDecision: 'stopped',
      stopReason: 'attempt-budget-exhausted',
      message: 'Budget exhausted.',
      prdId: 'prd-1',
    });
  });

  it('includes exact recovery auto-resume state in auto-build REST and heartbeat wire projections', () => {
    const latest: EforgeEvent = { type: 'recovery:auto-resume:queued', timestamp: '2025-01-01T00:00:01.000Z', prdId: 'prd-1', setName: 'set-1', action: 'continue-repair', attempt: 1, maxAttempts: 2 };
    const input = {
      capacity: { runningCount: 0, limit: 2 },
      recoveryAutoResume: { enabled: true, maxAttempts: 2 },
      latestRecoveryAutoResumeEvent: { type: latest.type, data: JSON.stringify(latest) },
    };
    const expected = { enabled: true, maxAttempts: 2, attempts: 1, lastDecision: 'queued', prdId: 'prd-1', setName: 'set-1' };
    expect(autoBuildStateToWire(input).recoveryAutoResume).toEqual(expected);
    expect(autoBuildHeartbeatToWire(input).recoveryAutoResume).toEqual(expected);
    expect(buildDaemonHeartbeatObject({ ...input, now: 2000, startedAtMs: 500, queueDepth: 0, runningBuilds: 0, subscriberCount: 1 }).autoBuild.recoveryAutoResume).toEqual(expected);
  });
});
