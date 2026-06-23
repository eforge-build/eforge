import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { API_ROUTES, type AutoBuildState } from '@eforge-build/client';
import { startControlRouteHarness, type ControlRouteHarness } from './routes-control-harness.js';

let harness: ControlRouteHarness | undefined;
afterEach(async () => { await harness?.close(); harness = undefined; });

function disabledController(calls: string[]) {
  const state: AutoBuildState = {
    enabled: false,
    watcher: { running: false, pid: null, sessionId: null },
    desired: 'disabled',
    mode: 'disabled',
    scheduler: { alive: false, paused: false },
  };
  return {
    getSnapshot: () => state,
    enable: (reason: string) => calls.push(`enable:${reason}`),
    disable: (reason: string) => calls.push(`disable:${reason}`),
    notifyQueueMutation: (reason: string) => { calls.push(`mutation:${reason}`); return state; },
  } as never;
}

describe('control plane acceptance coverage', () => {
  it('maps enqueue JSON and validation failures to the legacy response statuses', async () => {
    harness = await startControlRouteHarness({
      serverOptions: {
        workerTracker: { spawnWorker: () => ({ sessionId: 'unused', pid: 1 }), cancelWorker: () => false },
      },
    });

    expect((await harness.rawPost(API_ROUTES.enqueue, '{', { 'content-type': 'application/json' })).status).toBe(400);
    expect((await harness.postJson(API_ROUTES.enqueue, {})).status).toBe(400);
    expect((await harness.postJson(API_ROUTES.enqueue, { source: 'prd.md', onSuccess: 'merge' })).status).toBe(400);
    expect((await harness.postJson(API_ROUTES.enqueue, { source: 'prd.md', landingAction: 'bad' })).status).toBe(400);
    expect((await harness.postJson(API_ROUTES.enqueue, { source: 'prd.md', landingAutoMerge: 'yes' })).status).toBe(400);
    expect((await harness.postJson(API_ROUTES.enqueue, { source: 'prd.md', postMerge: 'pnpm test' })).status).toBe(400);
    expect((await harness.postJson(API_ROUTES.enqueue, { source: 'prd.md', postMerge: ['pnpm test', 42] })).status).toBe(400);
    expect((await harness.postJson(API_ROUTES.enqueue, { source: 'prd.md', postMerge: ['pnpm test', ''] })).status).toBe(400);
    expect((await harness.postJson(API_ROUTES.enqueue, { source: 'prd.md', postMerge: ['pnpm test\nrm -rf .'] })).status).toBe(400);
    expect((await harness.postJson(API_ROUTES.enqueue, { source: 'prd.md', afterQueueId: 1 })).status).toBe(400);
    expect((await harness.postJson(API_ROUTES.enqueue, { source: 'prd.md', profile: 'missing-profile' })).status).toBe(400);
  });

  it('spawns enqueue with source, flags, landing, auto-merge false, and after args in order', async () => {
    const spawned: Array<{ command: string; args: string[] }> = [];
    harness = await startControlRouteHarness({
      serverOptions: {
        workerTracker: {
          spawnWorker: (command, args) => { spawned.push({ command, args }); return { sessionId: 'session-1', pid: 42 }; },
          cancelWorker: () => false,
        },
      },
    });
    await mkdir(join(harness.cwd, '.eforge', 'queue'), { recursive: true });
    await writeFile(join(harness.cwd, '.eforge', 'queue', 'already.md'), '---\ntitle: Already queued\n---\n');

    const res = await harness.postJson(API_ROUTES.enqueue, {
      source: 'prd.md',
      flags: ['--dry-run', 12, '--verbose'],
      postMerge: ['pnpm build', 'pnpm test'],
      landingAction: 'leave',
      landingAutoMerge: false,
      afterQueueId: 'already',
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sessionId: 'session-1', pid: 42, autoBuild: false });
    expect(spawned).toEqual([{ command: 'enqueue', args: ['prd.md', '--dry-run', '--verbose', '--post-merge', 'pnpm build', '--post-merge', 'pnpm test', '--landing-action', 'leave', '--no-landing-auto-merge', '--after', 'already'] }]);
  });

  it('preserves daemon-stop preconditions and invokes shutdown after responding', async () => {
    harness = await startControlRouteHarness();
    expect((await harness.postJson(API_ROUTES.daemonStop, {})).status).toBe(503);
    await harness.close();

    harness = await startControlRouteHarness({ serverOptions: { daemonState: { autoBuildController: disabledController([]) } } });
    expect((await harness.postJson(API_ROUTES.daemonStop, {})).status).toBe(500);
    await harness.close();

    const calls: string[] = [];
    harness = await startControlRouteHarness({ serverOptions: { daemonState: { autoBuildController: disabledController(calls), onShutdown: () => calls.push('shutdown') } } });
    const res = await harness.postJson(API_ROUTES.daemonStop, { force: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'stopping', force: true });
    await new Promise((resolve) => setImmediate(resolve));
    expect(calls).toContain('shutdown');
  });
});
