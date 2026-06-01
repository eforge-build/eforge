import { API_ROUTES } from '@eforge-build/client';
import type { MonitorContext } from '../context.js';
import { defineRoute, type RouteDefinition } from '../http/router.js';
import { sendJson, sendJsonError } from '../http/response.js';
import { localMutation } from '../http/security.js';
import { autoBuildStateToWire } from '../projections/auto-build-state.js';
import { readJsonBody, sendInvalidJson, isSafeRouteId } from './control-validation.js';
import { prepareEnqueueRequest, markSessionPlanSubmittedAfterEnqueue } from './enqueue-service.js';
import { createControlMonitorRuntime, type ControlMonitorRuntime } from './control-runtime.js';

function autoBuildWire(context: MonitorContext) {
  return autoBuildStateToWire({ state: context.options.daemonState, capacity: { runningCount: context.getRunningBuildCount(), limit: context.getSchedulerLimit() } });
}

export function createControlPlaneRoutes(context: MonitorContext, runtime: ControlMonitorRuntime = createControlMonitorRuntime()): RouteDefinition[] {
  const mutationSecurity = [localMutation('Control-plane mutations')];
  return [
    defineRoute({ routeKey: 'keepAlive', method: 'POST', pattern: API_ROUTES.keepAlive, handler: (ctx) => { runtime.notifyKeepAlive(); sendJson(ctx.res, { status: 'ok' }); } }),
    defineRoute({ routeKey: 'enqueue', method: 'POST', pattern: API_ROUTES.enqueue, security: mutationSecurity, async handler(ctx) {
      const workerTracker = context.options.workerTracker;
      if (!workerTracker) return sendJsonError(ctx.res, 503, 'Daemon mode not active');
      if (context.options.config && (!context.options.config.agents?.tiers || Object.keys(context.options.config.agents.tiers).length === 0)) {
        return sendJsonError(ctx.res, 422, 'No agent tiers configured. Add agents.tiers entries (each with harness + model + effort) to eforge/config.yaml');
      }
      const parsed = await readJsonBody(ctx.req);
      if (!parsed.ok || typeof parsed.value !== 'object' || parsed.value === null || Array.isArray(parsed.value)) return sendInvalidJson(ctx.res);
      const prepared = await prepareEnqueueRequest(context, parsed.value as Record<string, unknown>);
      const result = workerTracker.spawnWorker('enqueue', prepared.args);
      await markSessionPlanSubmittedAfterEnqueue(context, prepared.source, result.sessionId);
      sendJson(ctx.res, { sessionId: result.sessionId, pid: result.pid, autoBuild: autoBuildWire(context).enabled });
    } }),
    defineRoute({ routeKey: 'cancel', method: 'POST', pattern: API_ROUTES.cancel, security: mutationSecurity, handler(ctx) {
      const workerTracker = context.options.workerTracker;
      if (!workerTracker) return sendJsonError(ctx.res, 503, 'Daemon mode not active');
      const sessionId = ctx.params.sessionId;
      if (!isSafeRouteId(sessionId)) return sendJsonError(ctx.res, 400, 'Invalid sessionId');
      if (!workerTracker.cancelWorker(sessionId)) return sendJsonError(ctx.res, 404, `No active worker found for sessionId: ${sessionId}`);
      sendJson(ctx.res, { status: 'cancelled', sessionId });
    } }),
    defineRoute({ routeKey: 'daemonStop', method: 'POST', pattern: API_ROUTES.daemonStop, security: mutationSecurity, async handler(ctx) {
      const daemonState = context.options.daemonState;
      if (!daemonState) return sendJsonError(ctx.res, 503, 'Daemon mode not active');
      const parsed = await readJsonBody(ctx.req);
      if (!parsed.ok) return sendInvalidJson(ctx.res);
      const body = (parsed.value && typeof parsed.value === 'object') ? parsed.value as { force?: unknown } : {};
      const force = body.force === true;
      if (!daemonState.onShutdown) return sendJsonError(ctx.res, 500, 'Shutdown handler not configured');
      sendJson(ctx.res, { status: 'stopping', force });
      setImmediate(() => daemonState.onShutdown?.());
    } }),
    defineRoute({ routeKey: 'autoBuildGet', method: 'GET', pattern: API_ROUTES.autoBuildGet, handler(ctx) {
      if (!context.options.daemonState) return sendJsonError(ctx.res, 503, 'Daemon mode not active');
      sendJson(ctx.res, autoBuildWire(context));
    } }),
    defineRoute({ routeKey: 'autoBuildSet', method: 'POST', pattern: API_ROUTES.autoBuildSet, security: mutationSecurity, async handler(ctx) {
      const daemonState = context.options.daemonState;
      if (!daemonState) return sendJsonError(ctx.res, 503, 'Daemon mode not active');
      const parsed = await readJsonBody(ctx.req);
      if (!parsed.ok) return sendInvalidJson(ctx.res);
      if (typeof parsed.value !== 'object' || parsed.value === null || Array.isArray(parsed.value)) return sendJsonError(ctx.res, 400, 'Missing required field: enabled (boolean)');
      const body = parsed.value as { enabled?: unknown };
      if (typeof body.enabled !== 'boolean') return sendJsonError(ctx.res, 400, 'Missing required field: enabled (boolean)');
      if (body.enabled) daemonState.autoBuildController.enable('http enable'); else daemonState.autoBuildController.disable('http disable');
      sendJson(ctx.res, autoBuildWire(context));
    } }),
    defineRoute({ routeKey: 'schedulerKick', method: 'POST', pattern: API_ROUTES.schedulerKick, security: mutationSecurity, handler(ctx) {
      if (!context.options.daemonState) return sendJsonError(ctx.res, 503, 'Daemon mode not active');
      context.notifyQueueMutation('external');
      sendJson(ctx.res, { ok: true });
    } }),
  ];
}
