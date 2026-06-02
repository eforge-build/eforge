import { API_ROUTES } from '@eforge-build/client';
import type { MonitorContext } from '../context.js';
import { defineRoute, type RouteDefinition } from '../http/router.js';
import { sendJson, sendJsonError } from '../http/response.js';
import { localOnly, rejectCrossSiteBrowser } from '../http/security.js';
import { buildDiffResponse } from '../projections/diff.js';
import { buildPlansResponse } from '../projections/plans.js';
import { buildRunState } from '../projections/run-state.js';
import { buildRunSummary } from '../projections/run-summary.js';
import { isSafeRouteId, sendLegacyTextParameterFailure } from './control-validation.js';

export function createRunDetailRoutes(context: MonitorContext): RouteDefinition[] {
  const readSecurity = [localOnly('Run detail reads'), rejectCrossSiteBrowser('Run detail reads')];
  return [
    defineRoute({ routeKey: 'runSummary', method: 'GET', pattern: API_ROUTES.runSummary, security: readSecurity, handler(ctx) {
      const id = ctx.params.id;
      if (!isSafeRouteId(id)) return sendLegacyTextParameterFailure(ctx.res, 'Invalid id');
      sendJson(ctx.res, buildRunSummary(context.db, context.resolveSessionId(id)));
    } }),
    defineRoute({ routeKey: 'runState', method: 'GET', pattern: API_ROUTES.runState, security: readSecurity, handler(ctx) {
      const id = ctx.params.id;
      if (!isSafeRouteId(id)) return sendLegacyTextParameterFailure(ctx.res, 'Invalid id');
      sendJson(ctx.res, buildRunState(context.db, context.resolveSessionId(id)));
    } }),
    defineRoute({ routeKey: 'plans', method: 'GET', pattern: API_ROUTES.plans, security: readSecurity, async handler(ctx) {
      const runId = ctx.params.runId;
      if (!isSafeRouteId(runId)) return sendLegacyTextParameterFailure(ctx.res, 'Invalid runId');
      sendJson(ctx.res, await buildPlansResponse({ db: context.db, sessionId: context.resolveSessionId(runId), planOutputDir: context.planOutputDir }));
    } }),
    defineRoute({ routeKey: 'diff', method: 'GET', pattern: API_ROUTES.diff, security: readSecurity, handler(ctx) {
      const sessionIdParam = ctx.params.sessionId;
      const planId = ctx.params.planId;
      if (!isSafeRouteId(sessionIdParam) || !isSafeRouteId(planId)) return sendJsonError(ctx.res, 400, 'Invalid sessionId or planId');
      sendJson(ctx.res, buildDiffResponse(context.db, context.resolveSessionId(sessionIdParam), planId, ctx.query.get('file') ?? undefined));
    } }),
  ];
}
