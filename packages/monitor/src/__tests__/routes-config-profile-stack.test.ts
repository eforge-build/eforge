import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { API_ROUTES, buildPath } from '@eforge-build/client';
import { createMonitorContext } from '../context.js';
import { openDatabase } from '../db.js';
import type { MonitorStreamHub } from '../types.js';
import { createRouter } from '../http/router.js';
import { createConfigProfileStackRoutes } from '../routes/config-profile-stack.js';

const streams: MonitorStreamHub = { attachSession() {}, attachDaemon() {}, broadcast() {}, subscriberCount: () => 0, stop() {} };
let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => { await cleanup?.(); cleanup = undefined; });

describe('config/profile/stack route factory', () => {
  it('registers owned routes with client route patterns', async () => {
    const db = openDatabase(':memory:');
    const context = await createMonitorContext(db);
    const routes = createConfigProfileStackRoutes(context);
    expect(routes.map((route) => route.routeKey)).toEqual([
      'projectContext', 'health', 'version', 'configShow', 'configValidate',
      'profileList', 'profileShow', 'profileUse', 'profileCreate', 'profileDelete',
      'modelProviders', 'modelList', 'stackLayers', 'stackSync', 'stackSyncStatus',
    ]);
    for (const route of routes) expect(route.pattern).toBe(API_ROUTES[route.routeKey]);
    expect(routes.find((route) => route.routeKey === 'profileDelete')?.method).toBe('DELETE');
    db.close();
  });

  it('dispatches DELETE profile paths through the shared router', async () => {
    const db = openDatabase(':memory:');
    const context = await createMonitorContext(db);
    const router = createRouter({ monitor: context, streams, routes: createConfigProfileStackRoutes(context) });
    const server = createServer((req, res) => void router.handle(req, res));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    cleanup = () => new Promise((resolve) => server.close(() => { db.close(); resolve(); }));
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('no address');
    const res = await fetch(`http://127.0.0.1:${addr.port}/api/profile/bad/name`, { method: 'DELETE' });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: `Unknown route: DELETE /api/profile/bad/name` });
    const matched = await fetch(`http://127.0.0.1:${addr.port}${buildPath(API_ROUTES.profileDelete, { name: 'bad name' })}`, { method: 'DELETE' });
    expect(matched.status).toBe(400);
    expect(await matched.json()).toEqual({ error: 'Invalid agent runtime profile name' });
  });
});
