import { afterEach, describe, expect, it } from 'vitest';
import { API_ROUTES } from '@eforge-build/client';
import { startControlRouteHarness, type ControlRouteHarness } from './routes-control-harness.js';

let harness: ControlRouteHarness | undefined;
afterEach(async () => { await harness?.close(); harness = undefined; });

function daemonState() {
  return { autoBuildController: { getSnapshot: () => ({ enabled: false, watcher: { running: false, pid: null, sessionId: null }, desired: 'disabled', mode: 'disabled', scheduler: { alive: false, paused: false } }), notifyQueueMutation: () => undefined } as never };
}

describe('queue recovery route modules', () => {
  it('validates analyze request bodies before queue access', async () => {
    harness = await startControlRouteHarness();
    expect((await harness.postJson(API_ROUTES.queueRecoveryAnalyze, null)).status).toBe(400);
    expect((await harness.postJson(API_ROUTES.queueRecoveryAnalyze, {})).status).toBe(400);
    expect((await harness.postJson(API_ROUTES.queueRecoveryAnalyze, { selectedPrdId: '../x' })).status).toBe(400);
    expect((await harness.postJson(API_ROUTES.queueRecoveryAnalyze, { selectedPrdId: 'prd-1', strategy: 1 })).status).toBe(400);
  });

  it('guards apply as a local mutation and validates expected operations', async () => {
    harness = await startControlRouteHarness({ serverOptions: { daemonState: daemonState() } });
    expect((await harness.rawPost(API_ROUTES.queueRecoveryApply, '{}', { host: 'evil.example', 'content-type': 'application/json' })).status).toBe(403);
    expect((await harness.postJson(API_ROUTES.queueRecoveryApply, { selectedPrdId: 'prd-1' })).status).toBe(400);
  });

  it('rejects malformed repair actions before engine recovery', async () => {
    harness = await startControlRouteHarness({ serverOptions: { daemonState: daemonState() } });
    const base = { selectedPrdId: 'prd-1', expectedOperations: [] };
    expect((await harness.postJson(API_ROUTES.queueRecoveryApply, { ...base, repairActions: {} })).status).toBe(400);
    expect((await harness.postJson(API_ROUTES.queueRecoveryApply, { ...base, repairActions: [{ kind: 'remove-depends-on', targetPrdId: '../prd', dependencyIds: ['ok'] }] })).status).toBe(400);
    expect((await harness.postJson(API_ROUTES.queueRecoveryApply, { ...base, repairActions: [{ kind: 'set-stack-parent', targetPrdId: 'prd-1', selectedParentId: '../parent' }] })).status).toBe(400);
    expect((await harness.postJson(API_ROUTES.queueRecoveryApply, { ...base, confirmDependencyRemoval: 'yes' })).status).toBe(400);
  });

  it('accepts client-owned repair-action bodies and dependency-removal confirmation', async () => {
    harness = await startControlRouteHarness({ serverOptions: { daemonState: daemonState() } });
    const res = await harness.postJson(API_ROUTES.queueRecoveryApply, {
      selectedPrdId: 'prd-1',
      expectedOperations: [],
      repairActions: [
        { kind: 'remove-depends-on', targetPrdId: 'prd-1', dependencyIds: ['done-1'] },
        { kind: 'set-stack-parent', targetPrdId: 'prd-1', selectedParentId: 'done-2' },
      ],
      confirmDependencyRemoval: true,
    });
    expect(res.status).not.toBe(400);
  });

  it('maps oversized queue recovery JSON bodies to 413', async () => {
    harness = await startControlRouteHarness();
    const large = JSON.stringify({ selectedPrdId: 'prd-1', filler: 'x'.repeat(1024 * 1024) });
    const res = await harness.rawPost(API_ROUTES.queueRecoveryAnalyze, large, { 'content-type': 'application/json' });
    expect(res.status).toBe(413);
  });
});
