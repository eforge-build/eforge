import type { MonitorContext } from '../context.js';
import type { RouteDefinition } from '../http/router.js';
import { createConfigContextRoutes } from './config-context.js';
import { createModelRoutes } from './models.js';
import { createProfileRoutes } from './profiles.js';
import { createStackRoutes } from './stack.js';

export function createConfigProfileStackRoutes(context: MonitorContext): RouteDefinition[] {
  return [
    ...createConfigContextRoutes(context),
    ...createProfileRoutes(context),
    ...createModelRoutes(context),
    ...createStackRoutes(context),
  ];
}
