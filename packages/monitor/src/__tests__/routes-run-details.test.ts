import { afterEach, describe, expect, it } from 'vitest';
import { API_ROUTES, buildPath } from '@eforge-build/client';
import { buildDiffResponse } from '../projections/diff.js';
import { buildRunState } from '../projections/run-state.js';
import { buildRunSummary } from '../projections/run-summary.js';
import { startControlRouteHarness, type ControlRouteHarness } from './routes-control-harness.js';

let harness: ControlRouteHarness | undefined;
afterEach(async () => { await harness?.close(); harness = undefined; });

const ts = new Date(0).toISOString();

describe('run detail route modules', () => {
  it('returns text errors for invalid run detail ids', async () => {
    harness = await startControlRouteHarness();
    expect((await harness.rawGet(buildPath(API_ROUTES.runSummary, { id: 'bad/id' }))).body).toBe('Invalid id');
    expect((await harness.rawGet(buildPath(API_ROUTES.runState, { id: 'bad/id' }))).body).toBe('Invalid id');
    expect((await harness.rawGet(buildPath(API_ROUTES.plans, { runId: 'bad/id' }))).body).toBe('Invalid runId');
  });

  it('uses run summary and state projections', async () => {
    harness = await startControlRouteHarness();
    harness.db.insertRun({ id: 'run-1', sessionId: 'session-1', planSet: 'set', command: 'build', status: 'running', startedAt: ts, cwd: harness.cwd });
    harness.db.insertEvent({ runId: 'run-1', type: 'phase:start', data: JSON.stringify({ type: 'phase:start', timestamp: ts, phase: 'build' }), timestamp: ts });
    expect(await (await harness.get(buildPath(API_ROUTES.runSummary, { id: 'run-1' }))).json()).toEqual(buildRunSummary(harness.db, 'session-1'));
    expect(await (await harness.get(buildPath(API_ROUTES.runState, { id: 'run-1' }))).json()).toEqual(buildRunState(harness.db, 'session-1'));
  });

  it('returns JSON 400 for invalid diff ids and delegates valid diff projection', async () => {
    harness = await startControlRouteHarness();
    const bad = await harness.get(buildPath(API_ROUTES.diff, { sessionId: 'bad/id', planId: 'plan-1' }));
    expect(bad.status).toBe(400); expect(await bad.json()).toEqual({ error: 'Invalid sessionId or planId' });
    const good = await harness.get(buildPath(API_ROUTES.diff, { sessionId: 'session-1', planId: 'plan-1' }));
    expect(await good.json()).toEqual(buildDiffResponse(harness.db, 'session-1', 'plan-1'));
  });
});
