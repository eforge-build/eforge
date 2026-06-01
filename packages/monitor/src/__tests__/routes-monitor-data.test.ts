import { afterEach, describe, expect, it } from 'vitest';
import { API_ROUTES, buildPath } from '@eforge-build/client';
import type { ServerResponse } from 'node:http';
import { createMonitorContext } from '../context.js';
import { openDatabase } from '../db.js';
import { createControlMonitorRoutes } from '../routes/control-monitor.js';
import { startControlRouteHarness, type ControlRouteHarness } from './routes-control-harness.js';

let harness: ControlRouteHarness | undefined;
afterEach(async () => { await harness?.close(); harness = undefined; });

describe('monitor data and stream attach routes', () => {
  it('returns an empty queue without a cwd', async () => {
    const db = openDatabase(':memory:');
    const context = await createMonitorContext(db);
    const route = createControlMonitorRoutes(context).find((r) => r.routeKey === 'queue');
    let responseBody = '';
    const res = { headersSent: false, writeHead() {}, end(body: string) { responseBody = body; } } as unknown as ServerResponse;
    await route?.handler({ req: {} as never, res, url: new URL('http://x'), pathname: API_ROUTES.queue, params: {}, query: new URLSearchParams(), monitor: context, streams: {} as never });
    expect(JSON.parse(responseBody)).toEqual([]);
    db.close();
  });

  it('returns seeded runs and session metadata', async () => {
    harness = await startControlRouteHarness();
    harness.db.insertRun({ id: 'run-1', sessionId: 'session-1', planSet: 'set', command: 'build', status: 'running', startedAt: new Date(0).toISOString(), cwd: harness.cwd });
    expect(await (await harness.get(API_ROUTES.runs)).json()).toHaveLength(1);
    expect(await (await harness.get(API_ROUTES.sessionMetadata)).json()).toEqual(harness.db.getSessionMetadataBatch());
  });

  it('rejects invalid session stream route ids with text', async () => {
    harness = await startControlRouteHarness();
    const res = await harness.rawGet(buildPath(API_ROUTES.events, { runId: 'bad/id' }));
    expect(res.status).toBe(400); expect(res.body).toBe('Invalid runId');
  });
});
