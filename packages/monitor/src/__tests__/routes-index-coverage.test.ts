import { describe, expect, it } from 'vitest';
import { API_ROUTES } from '@eforge-build/client';
import { openDatabase } from '../db.js';
import { createMonitorContext } from '../context.js';
import { createControlMonitorRuntime } from '../routes/control-runtime.js';
import {
  createMonitorRouter,
  createMonitorRoutes,
  getMonitorRouteKeysFromRoutes,
} from '../routes/index.js';

const ALLOWED_METHODS = new Set(['GET', 'POST', 'DELETE', 'OPTIONS']);

describe('monitor route aggregation', () => {
  it('registers one route key for every client daemon route', async () => {
    const db = openDatabase(':memory:');
    try {
      const context = await createMonitorContext(db);
      const runtime = createControlMonitorRuntime();
      const routes = createMonitorRoutes(context, runtime);
      const routeKeys = getMonitorRouteKeysFromRoutes(routes);

      expect(new Set(routeKeys).size).toBe(routeKeys.length);
      expect([...routeKeys].sort()).toEqual(Object.keys(API_ROUTES).sort());

      for (const route of routes) {
        expect(route.pattern).toBe(API_ROUTES[route.routeKey]);
        expect(ALLOWED_METHODS.has(route.method)).toBe(true);
      }

      const byPattern = new Map<string, Set<string>>();
      for (const route of routes) {
        const methods = byPattern.get(route.pattern) ?? new Set<string>();
        methods.add(route.method);
        byPattern.set(route.pattern, methods);
      }
      for (const methods of byPattern.values()) {
        expect(methods.size).toBeGreaterThan(0);
      }

      const streams = { attachSession() {}, attachDaemon() {}, broadcast() {}, subscriberCount: () => 0, stop() {} };
      const router = createMonitorRouter(context, streams, runtime);
      expect(router.getRegisteredRouteKeys().sort()).toEqual(routeKeys.sort());
    } finally {
      db.close();
    }
  });
});
