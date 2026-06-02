import type { MonitorContext } from '../context.js';
import { createRouter, getRegisteredRouteKeys, type RouteDefinition } from '../http/router.js';
import { serveStaticUiRequest } from '../http/static-assets.js';
import type { MonitorStreamHub } from '../types.js';
import { createConfigProfileStackRoutes } from './config-profile-stack.js';
import { createControlMonitorRoutes } from './control-monitor.js';
import type { ControlMonitorRuntime } from './control-runtime.js';
import { createExtensionContentRoutes } from './extension-content.js';

export function createMonitorRoutes(
  context: MonitorContext,
  runtime: ControlMonitorRuntime,
): RouteDefinition[] {
  return [
    ...createControlMonitorRoutes(context, runtime),
    ...createConfigProfileStackRoutes(context),
    ...createExtensionContentRoutes(context),
  ];
}

export function createMonitorRouter(
  context: MonitorContext,
  streams: MonitorStreamHub,
  runtime: ControlMonitorRuntime,
): ReturnType<typeof createRouter> {
  const routes = createMonitorRoutes(context, runtime);
  return createRouter({
    monitor: context,
    streams,
    routes,
    serveStatic: (req, res, pathname) => serveStaticUiRequest({
      req,
      res,
      pathname,
      monitorUiDir: context.uiRoots.monitorUiDir,
      consoleUiDir: context.uiRoots.consoleUiDir,
    }),
  });
}

export function getMonitorRegisteredRouteKeys(
  context: MonitorContext,
  runtime: ControlMonitorRuntime,
): ReturnType<typeof getRegisteredRouteKeys> {
  return getRegisteredRouteKeys(createMonitorRoutes(context, runtime));
}

export function getMonitorRouteKeysFromRoutes(routes: readonly RouteDefinition[]): ReturnType<typeof getRegisteredRouteKeys> {
  return getRegisteredRouteKeys(routes);
}
