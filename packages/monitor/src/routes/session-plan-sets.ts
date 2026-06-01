import { API_ROUTES } from '@eforge-build/client';
import type { MonitorContext } from '../context.js';
import { defineRoute, type RequestContext, type RouteDefinition } from '../http/router.js';
import { sendJson, sendJsonError } from '../http/response.js';
import { localOnly, rejectCrossSiteBrowser } from '../http/security.js';
import { includeSubmittedFromQuery } from './content-validation.js';
import { isUnsafePlanSetId, listSessionPlanSetsWire, sessionPlanSetErrorStatus, showSessionPlanSetWire, validateSessionPlanSetWire } from './session-plan-set-service.js';

export function createSessionPlanSetRoutes(context: MonitorContext): RouteDefinition[] {
  const security = [localOnly('Session plan-set reads'), rejectCrossSiteBrowser('Session plan-set reads')];
  return [
    defineRoute({ routeKey: 'sessionPlanSetList', method: 'GET', pattern: API_ROUTES.sessionPlanSetList, security, handler: (ctx) => withCwd(ctx, context, () => listSessionPlanSetsWire(context.cwd!, includeSubmittedFromQuery(ctx.query))) }),
    defineRoute({ routeKey: 'sessionPlanSetShow', method: 'GET', pattern: API_ROUTES.sessionPlanSetShow, security, handler: (ctx) => withPlanSetId(ctx, context, (id) => showSessionPlanSetWire(context.cwd!, id)) }),
    defineRoute({ routeKey: 'sessionPlanSetValidate', method: 'GET', pattern: API_ROUTES.sessionPlanSetValidate, security, handler: (ctx) => withPlanSetId(ctx, context, (id) => validateSessionPlanSetWire(context.cwd!, id)) }),
  ];
}
function withCwd(ctx: RequestContext, context: MonitorContext, run: () => Promise<unknown>) { if (!context.cwd) return sendJsonError(ctx.res, 500, 'Daemon has no working directory configured'); return run().then((r) => sendJson(ctx.res, r)).catch((e) => sendJsonError(ctx.res, sessionPlanSetErrorStatus(e), e instanceof Error ? e.message : String(e))); }
function withPlanSetId(ctx: RequestContext, context: MonitorContext, run: (id: string) => Promise<unknown>) { const id = ctx.query.get('planSetId'); if (id === null || id.length === 0) return sendJsonError(ctx.res, 400, 'Missing required query parameter: planSetId'); if (isUnsafePlanSetId(id)) return sendJsonError(ctx.res, 400, `Unsafe plan-set id: ${id}`); return withCwd(ctx, context, () => run(id)); }
