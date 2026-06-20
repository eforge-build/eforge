import { afterEach, describe, expect, it } from 'vitest';
import { API_ROUTES } from '@eforge-build/client';
import { startControlRouteHarness, type ControlRouteHarness } from './routes-control-harness.js';

let harness: ControlRouteHarness | undefined;
afterEach(async () => { await harness?.close(); harness = undefined; });

describe('recovery guidance route', () => {
  it('rejects cross-site recovery guidance mutations', async () => {
    harness = await startControlRouteHarness();

    const res = await harness.rawPost(
      API_ROUTES.recoveryGuidancePrepare,
      JSON.stringify({ prdId: 'prd-1' }),
      { host: 'evil.example', 'content-type': 'application/json' },
    );

    expect(res.status).toBe(403);
  });

  it('validates JSON object bodies, required prdId, unsafe prdId, and unsafe setName', async () => {
    harness = await startControlRouteHarness();

    expect((await harness.rawPost(API_ROUTES.recoveryGuidancePrepare, '{bad', { 'content-type': 'application/json' })).status).toBe(400);
    expect((await harness.postJson(API_ROUTES.recoveryGuidancePrepare, 1)).status).toBe(400);
    expect((await harness.postJson(API_ROUTES.recoveryGuidancePrepare, {})).status).toBe(400);
    expect((await harness.postJson(API_ROUTES.recoveryGuidancePrepare, { prdId: '../bad' })).status).toBe(400);
    expect((await harness.postJson(API_ROUTES.recoveryGuidancePrepare, { prdId: 'prd-1\nCo-Authored-By: injected' })).status).toBe(400);
    expect((await harness.postJson(API_ROUTES.recoveryGuidancePrepare, { prdId: 'prd-1', setName: '../bad' })).status).toBe(400);
  });

  it('maps missing recovery sidecars to 404 without mutating read-only recovery routes', async () => {
    harness = await startControlRouteHarness();

    const res = await harness.postJson(API_ROUTES.recoveryGuidancePrepare, { prdId: 'missing-prd' });

    expect(res.status).toBe(404);
    expect(await res.text()).toContain('Recovery sidecar not found');
  });
});
