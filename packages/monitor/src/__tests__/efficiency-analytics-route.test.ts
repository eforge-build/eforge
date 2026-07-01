import { afterEach, describe, expect, it } from 'vitest';
import { API_ROUTES } from '@eforge-build/client';
import { startControlRouteHarness, type ControlRouteHarness } from './routes-control-harness.js';

let harness: ControlRouteHarness | undefined;
afterEach(async () => { await harness?.close(); harness = undefined; });

describe('efficiency analytics route', () => {
  it('returns an empty-data response with the selected default window', async () => {
    harness = await startControlRouteHarness();
    const body = await (await harness.get(API_ROUTES.efficiencyAnalytics)).json();
    expect(body).toMatchObject({
      windowDays: 7,
      agentResultCount: 0,
      runCount: 0,
      sessionCount: 0,
      missingModelAttributionCount: 0,
      missingProfileAttributionCount: 0,
      models: [],
      profiles: [],
    });
  });

  it('clamps days below the minimum to a one-day window', async () => {
    harness = await startControlRouteHarness();
    const body = await (await harness.get(`${API_ROUTES.efficiencyAnalytics}?days=0`)).json();
    expect(body.windowDays).toBe(1);
  });

  it('clamps days above the maximum to a ninety-day window', async () => {
    harness = await startControlRouteHarness();
    const body = await (await harness.get(`${API_ROUTES.efficiencyAnalytics}?days=999`)).json();
    expect(body.windowDays).toBe(90);
  });
});
