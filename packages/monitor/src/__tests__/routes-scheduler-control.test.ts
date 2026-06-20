import { afterEach, describe, expect, it } from 'vitest';
import { API_ROUTES } from '@eforge-build/client';
import { startControlRouteHarness, type ControlRouteHarness } from './routes-control-harness.js';

let harness: ControlRouteHarness | undefined;
afterEach(async () => { await harness?.close(); harness = undefined; });

function daemonStateController(initialDesired: 'enabled' | 'disabled' = 'enabled') {
  const calls: string[] = [];
  let snapshot = {
    enabled: initialDesired === 'enabled',
    desired: initialDesired,
    mode: initialDesired === 'enabled' ? 'running' : 'disabled',
    watcher: { running: false, pid: null, sessionId: null },
    scheduler: { alive: initialDesired === 'enabled', paused: false },
  };
  return {
    calls,
    daemonState: {
      autoBuildController: {
        getSnapshot: () => snapshot,
        pauseScheduler: (reason: string) => {
          calls.push(`pause:${reason}`);
          snapshot = { ...snapshot, enabled: false, mode: 'paused', scheduler: { ...snapshot.scheduler, paused: true } };
          return snapshot;
        },
        resumeScheduler: (reason: string) => {
          calls.push(`resume:${reason}`);
          snapshot = { ...snapshot, enabled: true, mode: 'running', scheduler: { ...snapshot.scheduler, paused: false } };
          return snapshot;
        },
        notifyQueueMutation: (reason: string) => { calls.push(`mutation:${reason}`); return snapshot; },
      },
    } as never,
  };
}

describe('scheduler control routes', () => {
  it('rejects cross-site pause and resume mutations', async () => {
    harness = await startControlRouteHarness({ serverOptions: { daemonState: daemonStateController().daemonState } });

    expect((await harness.rawPost(API_ROUTES.schedulerPause, '', { host: 'evil.example' })).status).toBe(403);
    expect((await harness.rawPost(API_ROUTES.schedulerResume, '', { host: 'evil.example' })).status).toBe(403);
  });

  it('returns 503 outside daemon mode', async () => {
    harness = await startControlRouteHarness();

    expect((await harness.postJson(API_ROUTES.schedulerPause, {})).status).toBe(503);
    expect((await harness.postJson(API_ROUTES.schedulerResume, {})).status).toBe(503);
  });

  it('returns 409 when desired auto-build is disabled', async () => {
    const controller = daemonStateController('disabled');
    harness = await startControlRouteHarness({ serverOptions: { daemonState: controller.daemonState } });

    expect((await harness.postJson(API_ROUTES.schedulerPause, {})).status).toBe(409);
    expect((await harness.postJson(API_ROUTES.schedulerResume, {})).status).toBe(409);
    expect(controller.calls).toEqual([]);
  });

  it('pauses and resumes scheduler while keeping desired auto-build enabled', async () => {
    const controller = daemonStateController('enabled');
    harness = await startControlRouteHarness({ serverOptions: { daemonState: controller.daemonState } });

    const pause = await harness.postJson(API_ROUTES.schedulerPause, {});
    expect(pause.status).toBe(200);
    await expect(pause.json()).resolves.toMatchObject({ desired: 'enabled', mode: 'paused', scheduler: { paused: true } });

    const resume = await harness.postJson(API_ROUTES.schedulerResume, {});
    expect(resume.status).toBe(200);
    await expect(resume.json()).resolves.toMatchObject({ desired: 'enabled', mode: 'running', scheduler: { paused: false } });

    expect(controller.calls).toEqual(['pause:operator pause', 'resume:operator resume']);
    expect(controller.calls).not.toContain('mutation:external');
  });
});
