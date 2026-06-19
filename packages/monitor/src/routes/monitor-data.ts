import { API_ROUTES } from '@eforge-build/client';
import type { MonitorContext } from '../context.js';
import { defineRoute, type RouteDefinition } from '../http/router.js';
import { sendJson } from '../http/response.js';
import { localOnly, rejectCrossSiteBrowser } from '../http/security.js';
import { overlayQueueDispatchFailures } from '../projections/queue-dispatch-failures.js';
import { loadQueueItems } from '../projections/queue-items.js';
import { projectRunsForAcceptedSuccess } from '../projections/runs.js';

export function createMonitorDataRoutes(context: MonitorContext): RouteDefinition[] {
  const readSecurity = [localOnly('Monitor data reads'), rejectCrossSiteBrowser('Monitor data reads')];
  return [
    defineRoute({ routeKey: 'queue', method: 'GET', pattern: API_ROUTES.queue, security: readSecurity, async handler(ctx) {
      if (!context.cwd || !context.queuePaths) return sendJson(ctx.res, []);
      const queue = await loadQueueItems(context.queuePaths.queueDir, context.queuePaths.lockDir);
      sendJson(ctx.res, overlayQueueDispatchFailures(queue, context.db.getQueueDispatchFailureEvents(queue.map((item) => item.id))));
    } }),
    defineRoute({ routeKey: 'sessionMetadata', method: 'GET', pattern: API_ROUTES.sessionMetadata, security: readSecurity, handler: (ctx) => sendJson(ctx.res, context.db.getSessionMetadataBatch()) }),
    defineRoute({ routeKey: 'runs', method: 'GET', pattern: API_ROUTES.runs, security: readSecurity, handler: (ctx) => sendJson(ctx.res, projectRunsForAcceptedSuccess(context.db.getRuns(), context.queuePaths?.queueDir)) }),
    defineRoute({ routeKey: 'spend', method: 'GET', pattern: API_ROUTES.spend, security: readSecurity, handler: (ctx) => {
      const raw = Number(ctx.query.get('days'));
      const windowDays = Number.isFinite(raw) && raw >= 1 ? Math.min(90, Math.floor(raw)) : 7;
      sendJson(ctx.res, {
        windowDays,
        days: context.db.getDailySpend(windowDays),
        models: context.db.getModelSpend(windowDays),
        modelsToday: context.db.getModelSpend(1),
      });
    } }),
  ];
}
