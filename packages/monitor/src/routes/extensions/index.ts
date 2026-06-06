import type { MonitorContext } from '../../context.js';
import type { RouteDefinition } from '../../http/router.js';
import { createExtensionReadRoutes } from './read.js';
import { createExtensionManagementRoutes } from './management.js';
import { createExtensionReplayRoutes } from './replay.js';
import { createExtensionTrustRoutes } from './trust.js';
import { createExtensionPackageRoutes } from './packages.js';
import { createExtensionContributionRoutes } from './contributions.js';
// --- eforge:region plan-05-monitor-frame-assets ---
import { createExtensionWorkstationRoutes } from './workstations.js';
// --- eforge:endregion plan-05-monitor-frame-assets ---

export function createExtensionRoutes(context: MonitorContext): RouteDefinition[] {
  return [
    ...createExtensionReadRoutes(context),
    ...createExtensionContributionRoutes(context),
    // --- eforge:region plan-05-monitor-frame-assets ---
    ...createExtensionWorkstationRoutes(context),
    // --- eforge:endregion plan-05-monitor-frame-assets ---
    ...createExtensionManagementRoutes(context),
    ...createExtensionReplayRoutes(context),
    ...createExtensionTrustRoutes(context),
    ...createExtensionPackageRoutes(context),
  ];
}
