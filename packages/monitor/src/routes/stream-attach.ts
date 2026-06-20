import { API_ROUTES } from '@eforge-build/client';
import type { MonitorContext } from '../context.js';
import { defineRoute, type RouteDefinition } from '../http/router.js';
import { localOnly, rejectCrossSiteBrowser } from '../http/security.js';
import { isSafeRouteId, sendLegacyTextParameterFailure } from './control-validation.js';

export function createStreamAttachRoutes(_context: MonitorContext): RouteDefinition[] {
  const readSecurity = [localOnly('Monitor data reads'), rejectCrossSiteBrowser('Monitor data reads')];
  return [
    defineRoute({ routeKey: 'events', method: 'GET', pattern: API_ROUTES.events, security: readSecurity, handler(ctx) {
      const runId = ctx.params.runId;
      if (!isSafeRouteId(runId)) return sendLegacyTextParameterFailure(ctx.res, 'Invalid runId');
      ctx.streams.attachSession(ctx.req, ctx.res, runId);
    } }),
    defineRoute({ routeKey: 'daemonEvents', method: 'GET', pattern: API_ROUTES.daemonEvents, security: readSecurity, async handler(ctx) {
      await ctx.streams.attachDaemon(ctx.req, ctx.res);
    } }),
  ];
}
