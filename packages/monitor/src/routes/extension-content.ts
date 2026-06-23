import type { ApiRouteKey, RouteDefinition } from '../http/router.js';
import type { MonitorContext } from '../context.js';
import { createExtensionRoutes } from './extensions/index.js';
import { createSessionPlanRoutes } from './session-plans.js';
import { createSessionPlanSetRoutes } from './session-plan-sets.js';

export const EXTENSION_CONTENT_ROUTE_KEYS = [
  'extensionList','extensionShow','extensionValidate',
  'extensionContributionManifest','extensionActionInvoke',
  // --- eforge:region extension-agent-task-context ---
  'extensionAgentTaskStart','extensionAgentTaskGet','extensionAgentTaskCancel',
  // --- eforge:endregion extension-agent-task-context ---
  'extensionWorkstationFrame','extensionWorkstationAsset',
  'extensionNew','extensionReload','extensionTest','extensionTrust','extensionUntrust','extensionInstall','extensionUpdate','extensionRemove','extensionPromote','extensionDemote',
  'sessionPlanList','sessionPlanShow','sessionPlanCreate','sessionPlanSetSection','sessionPlanSkipDimension','sessionPlanSetStatus','sessionPlanSelectDimensions','sessionPlanReadiness','sessionPlanMigrateLegacy',
  'sessionPlanSetList','sessionPlanSetShow','sessionPlanSetValidate',
] as const satisfies readonly ApiRouteKey[];

export function createExtensionContentRoutes(context: MonitorContext): RouteDefinition[] {
  return [
    ...createExtensionRoutes(context),
    ...createSessionPlanRoutes(context),
    ...createSessionPlanSetRoutes(context),
  ];
}
