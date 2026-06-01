import { describe, expect, it } from 'vitest';
import { API_ROUTES } from '@eforge-build/client';
import { startContentRouteHarness } from './route-test-harness.js';

describe('session plan set routes', () => {
  it('requires safe planSetId values', async () => {
    const h = await startContentRouteHarness();
    try { expect((await h.get(API_ROUTES.sessionPlanSetShow)).status).toBe(400); expect((await h.get(`${API_ROUTES.sessionPlanSetShow}?planSetId=../bad`)).status).toBe(400); }
    finally { await h.close(); }
  });
  it('applies local and cross-site security', async () => {
    const h = await startContentRouteHarness();
    try { expect((await h.rawGet(API_ROUTES.sessionPlanSetList, { Host: 'evil.example' })).status).toBe(403); expect((await h.rawGet(API_ROUTES.sessionPlanSetList, { 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403); }
    finally { await h.close(); }
  });
  it('lists empty sets and maps missing set ids to not found', async () => {
    const h = await startContentRouteHarness();
    try { expect((await h.get(API_ROUTES.sessionPlanSetList)).status).toBe(200); expect((await h.get(`${API_ROUTES.sessionPlanSetValidate}?planSetId=missing`)).status).toBe(404); }
    finally { await h.close(); }
  });
});
