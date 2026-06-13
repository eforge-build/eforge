import { describe, expect, it } from 'vitest';
import { API_ROUTES } from '@eforge-build/client';
import { createMonitorContext } from '../context.js';
import { openDatabase } from '../db.js';
import { CONTROL_MONITOR_ROUTE_KEYS, createControlMonitorRoutes } from '../routes/control-monitor.js';

const sensitive = ['keepAlive', 'enqueue', 'cancel', 'daemonStop', 'autoBuildGet', 'autoBuildSet', 'schedulerKick', 'queueDependencyOverride', 'recover', 'readRecoverySidecar', 'applyRecovery', 'acceptRecoverySuccessPreview', 'acceptRecoverySuccess', 'continueRepair', 'continueRepairEligibility', 'queueRecoveryAnalyze', 'queueRecoveryApply'];
const intentionallyUngated: string[] = [];

describe('control monitor route registration', () => {
  it('registers exactly the owned route keys with client-owned patterns', async () => {
    const db = openDatabase(':memory:');
    const context = await createMonitorContext(db);
    const routes = createControlMonitorRoutes(context);
    expect(routes.map((route) => route.routeKey)).toEqual([...CONTROL_MONITOR_ROUTE_KEYS]);
    expect(new Set(routes.map((route) => route.routeKey)).size).toBe(routes.length);
    for (const route of routes) expect(route.pattern).toBe(API_ROUTES[route.routeKey]);
    expect(routes.find((route) => route.routeKey === 'autoBuildGet')?.pattern).toBe(routes.find((route) => route.routeKey === 'autoBuildSet')?.pattern);
    expect(routes.find((route) => route.routeKey === 'autoBuildGet')?.method).toBe('GET');
    expect(routes.find((route) => route.routeKey === 'autoBuildSet')?.method).toBe('POST');
    for (const key of sensitive) expect(routes.find((route) => route.routeKey === key)?.security?.length).toBeGreaterThan(0);
    for (const key of intentionallyUngated) expect(routes.find((route) => route.routeKey === key)?.security).toBeUndefined();
    db.close();
  });
});
