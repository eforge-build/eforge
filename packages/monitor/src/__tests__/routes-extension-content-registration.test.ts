import { describe, expect, it } from 'vitest';
import { API_ROUTES } from '@eforge-build/client';
import { createExtensionContentRoutes, EXTENSION_CONTENT_ROUTE_KEYS } from '../routes/extension-content.js';
import { routeMethodsByKey, startContentRouteHarness } from './route-test-harness.js';

const EXPECTED_ROUTE_KEYS = [
  'extensionList', 'extensionShow', 'extensionValidate',
  'extensionContributionManifest', 'extensionActionInvoke',
  'extensionAgentTaskStart', 'extensionAgentTaskGet', 'extensionAgentTaskCancel',
  'extensionWorkstationFrame', 'extensionWorkstationAsset',
  'extensionNew', 'extensionReload', 'extensionTest', 'extensionTrust', 'extensionUntrust', 'extensionInstall', 'extensionUpdate',
  'extensionRemove', 'extensionPromote', 'extensionDemote',
  'sessionPlanList', 'sessionPlanShow', 'sessionPlanCreate', 'sessionPlanSetSection',
  'sessionPlanSkipDimension', 'sessionPlanSetStatus', 'sessionPlanSelectDimensions',
  'sessionPlanReadiness', 'sessionPlanMigrateLegacy',
  'sessionPlanSetList', 'sessionPlanSetShow', 'sessionPlanSetValidate',
] as const;

const GET_ROUTE_KEYS = new Set([
  'extensionList', 'extensionShow', 'extensionValidate',
  'extensionContributionManifest',
  'extensionAgentTaskGet',
  'extensionWorkstationFrame', 'extensionWorkstationAsset',
  'sessionPlanList', 'sessionPlanShow', 'sessionPlanReadiness',
  'sessionPlanSetList', 'sessionPlanSetShow', 'sessionPlanSetValidate',
]);

const SECURED_ROUTE_KEYS = new Set([
  'extensionList', 'extensionShow', 'extensionValidate',
  'extensionContributionManifest', 'extensionActionInvoke',
  'extensionAgentTaskStart', 'extensionAgentTaskGet', 'extensionAgentTaskCancel',
  'extensionWorkstationFrame', 'extensionWorkstationAsset',
  'extensionNew', 'extensionReload', 'extensionTest', 'extensionTrust', 'extensionUntrust', 'extensionInstall', 'extensionUpdate',
  'extensionRemove', 'extensionPromote', 'extensionDemote',
  'sessionPlanList', 'sessionPlanShow', 'sessionPlanCreate', 'sessionPlanSetSection',
  'sessionPlanSkipDimension', 'sessionPlanSetStatus', 'sessionPlanSelectDimensions',
  'sessionPlanReadiness', 'sessionPlanMigrateLegacy',
  'sessionPlanSetList', 'sessionPlanSetShow', 'sessionPlanSetValidate',
]);

describe('extension content route registration', () => {
  it('registers exactly the 32 non-playbook module-owned route keys with client patterns', async () => {
    const harness = await startContentRouteHarness();
    try {
      expect(EXTENSION_CONTENT_ROUTE_KEYS).toEqual(EXPECTED_ROUTE_KEYS);
      expect(EXTENSION_CONTENT_ROUTE_KEYS).toHaveLength(32);
      expect(harness.routes.map((route) => route.routeKey)).toEqual(EXPECTED_ROUTE_KEYS);
      expect(new Set(harness.routes.map((route) => route.routeKey)).size).toBe(harness.routes.length);
      for (const route of harness.routes) expect(route.pattern).toBe(API_ROUTES[route.routeKey]);
      expect(harness.routes.map((route) => route.routeKey).filter((key) => key.startsWith('playbook'))).toEqual([]);
    } finally { await harness.close(); }
  });

  it('declares the ownership-matrix HTTP methods for every content route', async () => {
    const harness = await startContentRouteHarness({ routes: createExtensionContentRoutes });
    try {
      const methods = routeMethodsByKey(harness.routes);
      for (const routeKey of EXPECTED_ROUTE_KEYS) {
        expect(methods.get(routeKey)).toBe(GET_ROUTE_KEYS.has(routeKey) ? 'GET' : 'POST');
      }
    } finally { await harness.close(); }
  });

  it('declares security on local content routes', async () => {
    const harness = await startContentRouteHarness({ routes: createExtensionContentRoutes });
    try {
      const secured = new Set(harness.routes.filter((route) => (route.security?.length ?? 0) > 0).map((route) => route.routeKey));
      expect(secured).toEqual(SECURED_ROUTE_KEYS);
    } finally { await harness.close(); }
  });
});
