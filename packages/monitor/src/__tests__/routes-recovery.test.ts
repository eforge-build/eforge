import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { API_ROUTES } from '@eforge-build/client';
import { startControlRouteHarness, type ControlRouteHarness } from './routes-control-harness.js';

let harness: ControlRouteHarness | undefined;
afterEach(async () => { await harness?.close(); harness = undefined; });

describe('recovery and continue-repair route modules', () => {
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
    await writeFile(join(failed, 'prd-1.recovery.json'), JSON.stringify({ schemaVersion: 3, generatedAt: new Date(0).toISOString(), prdId: 'prd-1', setName: 'set-1', verdict: { verdict: 'manual', confidence: 'low', rationale: 'Manual recovery required.', completedWork: [], remainingWork: [], risks: [] }, report: { operatorSummary: 'Manual recovery required.', recommendedAction: 'Review manually.', keyEvidence: [], completedWork: [], remainingWork: [], risks: [] }, boundedEvidence: { identity: { prdId: 'prd-1', setName: 'set-1', featureBranch: 'eforge/set-1', baseBranch: 'main', failedAt: new Date(0).toISOString() }, plans: [{ planId: 'plan-01', status: 'failed' }], failingPlan: { planId: 'plan-01' }, landedCommits: [], diffStat: '', modelsUsed: [] } }));
    const res = await harness.get(`${API_ROUTES.readRecoverySidecar}?prdId=prd-1`);
    expect(res.status).toBe(200); expect(await res.json()).toMatchObject({ markdown: '# recovery' });
  });

  it('returns the durable applied marker from the recovery sidecar when present', async () => {
    harness = await startControlRouteHarness();
    const failed = join(harness.cwd, '.eforge', 'queue', 'failed');
    await mkdir(failed, { recursive: true });
    await writeFile(join(failed, 'prd-applied.recovery.md'), '# recovery');
    await writeFile(join(failed, 'prd-applied.recovery.json'), JSON.stringify({ schemaVersion: 3, generatedAt: new Date(0).toISOString(), prdId: 'prd-applied', setName: 'set-1', verdict: { verdict: 'continue-repair', confidence: 'high', rationale: 'Preserved artifacts are available.', completedWork: [], remainingWork: [], risks: [] }, report: { operatorSummary: 'Preserved artifacts are available.', recommendedAction: 'Continue and repair build.', keyEvidence: [], completedWork: [], remainingWork: [], risks: [] }, boundedEvidence: { identity: { prdId: 'prd-applied', setName: 'set-1', featureBranch: 'eforge/set-1', baseBranch: 'main', failedAt: new Date(0).toISOString() }, plans: [{ planId: 'plan-01', status: 'failed' }], failingPlan: { planId: 'plan-01' }, landedCommits: [], diffStat: '', modelsUsed: [] }, applied: { action: 'continue-repair', appliedAt: '2025-01-01T00:00:00.000Z' } }));
    const res = await harness.get(`${API_ROUTES.readRecoverySidecar}?prdId=prd-applied`);
    expect(res.status).toBe(200);
    const body = await res.json() as { json: { applied?: { action?: string } } };
    expect(body.json.applied).toEqual({ action: 'continue-repair', appliedAt: '2025-01-01T00:00:00.000Z' });
  });

  it('rejects cross-site accept-success preview and apply requests', async () => {
    harness = await startControlRouteHarness();
    const preview = await harness.rawGet(`${API_ROUTES.acceptRecoverySuccessPreview}?prdId=prd-1`, { host: 'evil.example' });
    expect(preview.status).toBe(403);
    const apply = await harness.rawPost(API_ROUTES.acceptRecoverySuccess, JSON.stringify({ prdId: 'prd-1' }), { host: 'evil.example', 'content-type': 'application/json' });
    expect(apply.status).toBe(403);
  });

  it('validates accept-success preview requests', async () => {
    harness = await startControlRouteHarness();
    expect((await harness.get(API_ROUTES.acceptRecoverySuccessPreview)).status).toBe(400);
    expect((await harness.get(`${API_ROUTES.acceptRecoverySuccessPreview}?prdId=ghost`)).status).toBe(404);
  });

  it('validates continue-repair requeue requests without spawning a worker', async () => {
    const calls: unknown[] = [];
    harness = await startControlRouteHarness({ serverOptions: { workerTracker: { spawnWorker: (command, args) => { calls.push([command, args]); return { sessionId: 'continue-1', pid: 9 }; }, cancelWorker: () => false } } });
    expect((await harness.postJson(API_ROUTES.continueRepair, null)).status).toBe(400);
    const res = await harness.postJson(API_ROUTES.continueRepair, { prdId: 'prd-1', setName: 'set-1' });
    expect(res.status).not.toBe(200); expect(calls).toEqual([]);
  });
});
