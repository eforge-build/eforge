import { API_ROUTES, type FailedEnqueueDismissResponse, type FailedEnqueueReenqueueResponse } from '@eforge-build/client';
import type { MonitorContext } from '../context.js';
import { defineRoute, type RouteDefinition } from '../http/router.js';
import { sendJson, sendJsonError } from '../http/response.js';
import { localMutation, localOnly, rejectCrossSiteBrowser } from '../http/security.js';
import { HttpRouteError } from '../http/route-errors.js';
import { getFailedEnqueueSource, projectFailedEnqueueByRunId, recordFailedEnqueueResolved } from '../projections/failed-enqueues.js';
import { projectAutoBuildForContext, projectFailedEnqueuesForContext, projectQueueForContext, projectRunsForContext } from '../projections/monitor-state.js';
import { isPlainObject, isSafeRouteId, readJsonBody, sendInvalidJson } from './control-validation.js';
import { markSessionPlanSubmittedAfterEnqueue, prepareEnqueueRequest } from './enqueue-service.js';

export function createFailedEnqueueRoutes(context: MonitorContext): RouteDefinition[] {
  return [
    defineRoute({ routeKey: 'failedEnqueues', method: 'GET', pattern: API_ROUTES.failedEnqueues, security: [localOnly('Failed enqueue reads'), rejectCrossSiteBrowser('Failed enqueue reads')], handler(ctx) {
      sendJson(ctx.res, projectFailedEnqueuesForContext(context));
    } }),
    defineRoute({ routeKey: 'failedEnqueueReenqueue', method: 'POST', pattern: API_ROUTES.failedEnqueueReenqueue, security: [localMutation('Failed enqueue re-enqueue')], async handler(ctx) {
      const runId = ctx.params.runId;
      if (!isSafeRouteId(runId)) return sendJsonError(ctx.res, 400, 'Invalid runId');
      const parsed = await readJsonBody(ctx.req);
      if (!parsed.ok) return sendInvalidJson(ctx.res, parsed.tooLarge);
      if (!isPlainObject(parsed.value)) return sendJsonError(ctx.res, 400, 'Invalid request body: must be a JSON object');
      if (parsed.value.confirm !== true) return sendJsonError(ctx.res, 400, 'Missing required field: confirm must be true');
      const failedEnqueue = projectFailedEnqueueByRunId(context.db, runId, { includeResolved: true });
      if (!failedEnqueue) return sendJsonError(ctx.res, 404, `Failed enqueue run not found: ${runId}`);
      const source = getFailedEnqueueSource(context.db, runId);
      if (!source || !failedEnqueue.canReenqueue) return sendJson(ctx.res, await disabledResponse(context, failedEnqueue));
      const workerTracker = context.options.workerTracker;
      if (!workerTracker) return sendJsonError(ctx.res, 503, 'Daemon worker spawning is unavailable');
      let prepared: Awaited<ReturnType<typeof prepareEnqueueRequest>>;
      try {
        prepared = await prepareEnqueueRequest(context, { source });
      } catch (err) {
        if (err instanceof HttpRouteError) return sendJson(ctx.res, await disabledResponse(context, failedEnqueue, err.message));
        throw err;
      }
      const spawned = workerTracker.spawnWorker('enqueue', prepared.args);
      await markSessionPlanSubmittedAfterEnqueue(context, prepared.source, spawned.sessionId);
      const resolvedAt = new Date().toISOString();
      recordFailedEnqueueResolved(context.db, runId, resolvedAt, spawned.sessionId);
      const resolved = projectFailedEnqueueByRunId(context.db, runId, { includeResolved: true }) ?? { ...failedEnqueue, resolvedAt, canReenqueue: false, disabledReason: 'This failed enqueue has already been re-enqueued.' };
      const response: FailedEnqueueReenqueueResponse = { enqueued: true, failedEnqueue: resolved, queue: await projectQueueForContext(context), runs: projectRunsForContext(context), spawnedSessionId: spawned.sessionId, autoBuild: projectAutoBuildForContext(context) };
      sendJson(ctx.res, response);
    } }),
    defineRoute({ routeKey: 'failedEnqueueDismiss', method: 'POST', pattern: API_ROUTES.failedEnqueueDismiss, security: [localMutation('Failed enqueue dismiss')], async handler(ctx) {
      const runId = ctx.params.runId;
      if (!isSafeRouteId(runId)) return sendJsonError(ctx.res, 400, 'Invalid runId');
      const parsed = await readJsonBody(ctx.req);
      if (!parsed.ok) return sendInvalidJson(ctx.res, parsed.tooLarge);
      if (!isPlainObject(parsed.value)) return sendJsonError(ctx.res, 400, 'Invalid request body: must be a JSON object');
      if (parsed.value.confirm !== true) return sendJsonError(ctx.res, 400, 'Missing required field: confirm must be true');
      const failedEnqueue = projectFailedEnqueueByRunId(context.db, runId, { includeResolved: true });
      if (!failedEnqueue) return sendJsonError(ctx.res, 404, `Failed enqueue run not found: ${runId}`);
      const resolvedAt = failedEnqueue.resolvedAt ?? new Date().toISOString();
      if (!failedEnqueue.resolvedAt) recordFailedEnqueueResolved(context.db, runId, resolvedAt);
      const resolved = projectFailedEnqueueByRunId(context.db, runId, { includeResolved: true }) ?? { ...failedEnqueue, resolvedAt, canReenqueue: false, disabledReason: 'This failed enqueue has been dismissed.' };
      const response: FailedEnqueueDismissResponse = { dismissed: true, failedEnqueue: resolved, queue: await projectQueueForContext(context), runs: projectRunsForContext(context), autoBuild: projectAutoBuildForContext(context) };
      sendJson(ctx.res, response);
    } }),
  ];
}

async function disabledResponse(context: MonitorContext, failedEnqueue: NonNullable<ReturnType<typeof projectFailedEnqueueByRunId>>, reason = failedEnqueue.disabledReason): Promise<FailedEnqueueReenqueueResponse> {
  const disabledReason = reason ?? failedEnqueue.disabledReason ?? 'This failed enqueue cannot be re-enqueued.';
  return {
    enqueued: false,
    failedEnqueue: { ...failedEnqueue, canReenqueue: false, disabledReason },
    queue: await projectQueueForContext(context),
    runs: projectRunsForContext(context),
    disabledReason,
    ...(failedEnqueue.nextCommand ? { nextCommand: failedEnqueue.nextCommand } : {}),
    autoBuild: projectAutoBuildForContext(context),
  };
}
