import { API_ROUTES } from '@eforge-build/client';
import { defineRoute, type RouteDefinition } from '../../http/router.js';
import { sendJsonError } from '../../http/response.js';
import { localOnly, rejectCrossSiteBrowser } from '../../http/security.js';

const security = [localOnly('Extension workstation content reads'), rejectCrossSiteBrowser('Extension workstation content reads')];

export function createExtensionWorkstationRoutes(): RouteDefinition[] {
  return [
    defineRoute({
      routeKey: 'extensionWorkstationFrame',
      method: 'GET',
      pattern: API_ROUTES.extensionWorkstationFrame,
      security,
      handler: (ctx) => sendJsonError(ctx.res, 501, 'Extension workstation frame serving is not implemented'),
    }),
    defineRoute({
      routeKey: 'extensionWorkstationAsset',
      method: 'GET',
      pattern: API_ROUTES.extensionWorkstationAsset,
      security,
      handler: (ctx) => sendJsonError(ctx.res, 501, 'Extension workstation asset serving is not implemented'),
    }),
  ];
}
