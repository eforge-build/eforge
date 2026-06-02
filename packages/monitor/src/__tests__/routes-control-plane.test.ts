import { afterEach, describe, expect, it } from 'vitest';
import { API_ROUTES, buildPath, type AutoBuildState } from '@eforge-build/client';
import { startControlRouteHarness, type ControlRouteHarness } from './routes-control-harness.js';

let harness: ControlRouteHarness | undefined;
afterEach(async () => { await harness?.close(); harness = undefined; });

function controller(calls: string[]) {
  const state: AutoBuildState = { enabled: false, watcher: { running: false, pid: null, sessionId: null }, desired: 'disabled', mode: 'disabled', scheduler: { alive: false, paused: false } };
  return { getSnapshot: () => state, enable: (r: string) => calls.push(`enable:${r}`), disable: (r: string) => calls.push(`disable:${r}`), notifyQueueMutation: (r: string) => { calls.push(`mutation:${r}`); return state; } } as never;
}

describe('control plane route modules', () => {
  it('keep-alive notifies the runtime callback', async () => {
    harness = await startControlRouteHarness();
    let count = 0; harness.runtime.setOnKeepAlive(() => { count += 1; });
    const res = await harness.postJson(API_ROUTES.keepAlive, {});
    expect(res.status).toBe(200); expect(await res.json()).toEqual({ status: 'ok' }); expect(count).toBe(1);
  });

  it('enqueue reports daemon and tier precondition failures', async () => {
    harness = await startControlRouteHarness();
    expect((await harness.postJson(API_ROUTES.enqueue, { source: 'x' })).status).toBe(503);
    await harness.close();
    harness = await startControlRouteHarness({ serverOptions: { workerTracker: { spawnWorker: () => ({ sessionId: 's', pid: 1 }), cancelWorker: () => false }, config: { agents: { tiers: {} } } as never } });
    const res = await harness.postJson(API_ROUTES.enqueue, { source: 'x' });
    expect(res.status).toBe(422);
  });

  it('cancel validates ids and delegates to worker tracker', async () => {
    const cancelled = new Set(['known']);
    harness = await startControlRouteHarness({ serverOptions: { workerTracker: { spawnWorker: () => ({ sessionId: 's', pid: 1 }), cancelWorker: (id) => cancelled.has(id) } } });
    expect((await harness.postJson(buildPath(API_ROUTES.cancel, { sessionId: 'bad/id' }), {})).status).toBe(400);
    expect((await harness.postJson(buildPath(API_ROUTES.cancel, { sessionId: 'missing' }), {})).status).toBe(404);
    const ok = await harness.postJson(buildPath(API_ROUTES.cancel, { sessionId: 'known' }), {});
    expect(ok.status).toBe(200); expect(await ok.json()).toEqual({ status: 'cancelled', sessionId: 'known' });
  });

  it('daemon stop rejects malformed bodies before shutdown', async () => {
    const calls: string[] = [];
    harness = await startControlRouteHarness({ serverOptions: { daemonState: { autoBuildController: controller(calls), onShutdown: () => calls.push('shutdown') } } });
    expect((await harness.postJson(API_ROUTES.daemonStop, [])).status).toBe(400);
    expect((await harness.postJson(API_ROUTES.daemonStop, { force: 'true' })).status).toBe(400);
    expect(calls).not.toContain('shutdown');
  });

  it('auto-build and scheduler routes use daemon controller state', async () => {
    const calls: string[] = [];
    harness = await startControlRouteHarness({ serverOptions: { daemonState: { autoBuildController: controller(calls), onShutdown: () => calls.push('shutdown') } } });
    expect((await harness.get(API_ROUTES.autoBuildGet)).status).toBe(200);
    expect((await harness.postJson(API_ROUTES.autoBuildSet, { enabled: true })).status).toBe(200);
    expect((await harness.postJson(API_ROUTES.schedulerKick, {})).status).toBe(200);
    expect(calls).toContain('enable:http enable'); expect(calls).toContain('mutation:external');
  });
});
