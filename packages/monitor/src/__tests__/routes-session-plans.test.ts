import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { API_ROUTES } from '@eforge-build/client';
import { startContentRouteHarness } from './route-test-harness.js';

const session = '2026-01-01-demo';
async function createPlan(h: Awaited<ReturnType<typeof startContentRouteHarness>>) {
  await mkdir(join(h.cwd, '.eforge', 'session-plans'), { recursive: true });
  return h.postJson(API_ROUTES.sessionPlanCreate, { session, topic: 'Demo', planning_type: 'feature', planning_depth: 'quick', profile: 'errand' });
}

describe('session plan routes', () => {
  it('validates create and supports list/show/readiness', async () => {
    const h = await startContentRouteHarness();
    try { expect((await h.postJson(API_ROUTES.sessionPlanCreate, { session: 'Bad_Id', topic: 'x' })).status).toBe(400); expect((await createPlan(h)).status).toBe(200); expect((await h.get(API_ROUTES.sessionPlanList)).status).toBe(200); expect((await h.get(`${API_ROUTES.sessionPlanShow}?session=${session}`)).status).toBe(200); expect((await h.get(`${API_ROUTES.sessionPlanReadiness}?session=${session}`)).status).toBe(200); }
    finally { await h.close(); }
  });
  it('mutates sections, dimensions, status, and legacy migration', async () => {
    const h = await startContentRouteHarness();
    try { await createPlan(h); expect((await h.postJson(API_ROUTES.sessionPlanSetSection, { session, dimension: 'implementation', content: 'Do it' })).status).toBe(200); expect((await h.postJson(API_ROUTES.sessionPlanSkipDimension, { session, dimension: 'risks', reason: 'none' })).status).not.toBe(400); expect((await h.postJson(API_ROUTES.sessionPlanSelectDimensions, { session, planning_depth: 'focused' })).status).toBe(200); expect((await h.postJson(API_ROUTES.sessionPlanSetStatus, { session, status: 'submitted' })).status).toBe(400); expect((await h.postJson(API_ROUTES.sessionPlanMigrateLegacy, { session })).status).toBe(200); }
    finally { await h.close(); }
  });
  it('maps show errors', async () => {
    const h = await startContentRouteHarness();
    try { expect((await h.get(`${API_ROUTES.sessionPlanShow}?session=Bad_Id`)).status).toBe(400); expect((await h.get(`${API_ROUTES.sessionPlanShow}?session=${session}`)).status).toBe(404); }
    finally { await h.close(); }
  });
});
