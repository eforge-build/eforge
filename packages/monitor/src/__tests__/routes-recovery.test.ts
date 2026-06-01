import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { API_ROUTES } from '@eforge-build/client';
import { startControlRouteHarness, type ControlRouteHarness } from './routes-control-harness.js';

let harness: ControlRouteHarness | undefined;
afterEach(async () => { await harness?.close(); harness = undefined; });

describe('recovery and resume route modules', () => {
  it('rejects cross-site sensitive requests', async () => {
    harness = await startControlRouteHarness();
    const res = await harness.rawPost(API_ROUTES.recover, JSON.stringify({}), { host: 'evil.example', 'content-type': 'application/json' });
    expect(res.status).toBe(403);
  });

  it('validates recover requests and spawns the recover worker', async () => {
    const calls: unknown[] = [];
    harness = await startControlRouteHarness({ serverOptions: { workerTracker: { spawnWorker: (command, args) => { calls.push([command, args]); return { sessionId: 's1', pid: 7 }; }, cancelWorker: () => false } } });
    expect((await harness.postJson(API_ROUTES.recover, {})).status).toBe(400);
    const res = await harness.postJson(API_ROUTES.recover, { setName: 'set-1', prdId: 'prd-1' });
    expect(res.status).toBe(200); expect(await res.json()).toEqual({ sessionId: 's1', pid: 7 });
    expect(calls).toEqual([['recover', ['set-1', 'prd-1']]]);
  });

  it('reads recovery sidecars from the failed queue directory', async () => {
    harness = await startControlRouteHarness();
    const failed = join(harness.cwd, '.eforge', 'queue', 'failed');
    await mkdir(failed, { recursive: true });
    await writeFile(join(failed, 'prd-1.recovery.md'), '# recovery');
    await writeFile(join(failed, 'prd-1.recovery.json'), JSON.stringify({ schemaVersion: 1, generatedAt: new Date(0).toISOString(), summary: {}, verdict: { verdict: 'manual', confidence: 1 } }));
    const res = await harness.get(`${API_ROUTES.readRecoverySidecar}?prdId=prd-1`);
    expect(res.status).toBe(200); expect(await res.json()).toMatchObject({ markdown: '# recovery' });
  });

  it('validates and spawns resume builds', async () => {
    const calls: unknown[] = [];
    harness = await startControlRouteHarness({ serverOptions: { workerTracker: { spawnWorker: (command, args) => { calls.push([command, args]); return { sessionId: 'resume-1', pid: 9 }; }, cancelWorker: () => false } } });
    expect((await harness.postJson(API_ROUTES.resumeBuild, null)).status).toBe(400);
    const res = await harness.postJson(API_ROUTES.resumeBuild, { prdId: 'prd-1', setName: 'set-1' });
    expect(res.status).toBe(200); expect(calls).toEqual([['resume', ['prd-1', '--set-name', 'set-1']]]);
  });
});
