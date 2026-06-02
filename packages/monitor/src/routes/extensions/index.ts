import type { MonitorContext } from '../../context.js';
import type { RouteDefinition } from '../../http/router.js';
import { createExtensionReadRoutes } from './read.js';
import { createExtensionManagementRoutes } from './management.js';
import { createExtensionReplayRoutes } from './replay.js';
import { createExtensionTrustRoutes } from './trust.js';
import { createExtensionPackageRoutes } from './packages.js';

export function createExtensionRoutes(context: MonitorContext): RouteDefinition[] {
  return [
    ...createExtensionReadRoutes(context),
    ...createExtensionManagementRoutes(context),
    ...createExtensionReplayRoutes(context),
    ...createExtensionTrustRoutes(context),
    ...createExtensionPackageRoutes(context),
  ];
}
