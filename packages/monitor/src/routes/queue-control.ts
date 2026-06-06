import { resolve } from 'node:path';
import type { ServerResponse } from 'node:http';
import { API_ROUTES } from '@eforge-build/client';
import { isQueueControlError, removeQueuedPrd, updateQueuedPrdPriority,
  // --- eforge:region plan-02-daemon-dependency-override ---
  overrideQueuedPrdDependency,
  // --- eforge:endregion plan-02-daemon-dependency-override ---
} from '@eforge-build/engine/queue/control';
import type { MonitorContext } from '../context.js';
import { defineRoute, type RouteDefinition } from '../http/router.js';
import { sendJson, sendJsonError } from '../http/response.js';
import { localMutation } from '../http/security.js';
// --- eforge:region plan-02-daemon-dependency-override ---
import { writeDaemonEvent } from '../daemon-events.js';
// --- eforge:endregion plan-02-daemon-dependency-override ---
import { isPlainObject, isValidPathSegment, readJsonBody, sendInvalidJson } from './control-validation.js';

export function createQueueControlRoutes(context: MonitorContext): RouteDefinition[] {
  return [
    defineRoute({ routeKey: 'queuePriority', method: 'POST', pattern: API_ROUTES.queuePriority, security: [localMutation('Queue control mutations')], async handler(ctx) {
      if (!context.cwd) return sendJsonError(ctx.res, 503, 'Working directory not configured');
      const prdId = ctx.params.prdId;
      if (!isValidPathSegment(prdId)) return sendJsonError(ctx.res, 400, 'Invalid prdId: must not contain path separators or traversal sequences');
      const parsed = await readJsonBody(ctx.req);
      if (!parsed.ok) return sendInvalidJson(ctx.res, parsed.tooLarge);
      if (!isPlainObject(parsed.value)) return sendJsonError(ctx.res, 400, 'Invalid request body: must be a JSON object');
      const priority = parsed.value.priority;
      if (priority === undefined) return sendJsonError(ctx.res, 400, 'Missing required field: priority');
      if (typeof priority !== 'number' || !Number.isFinite(priority) || !Number.isInteger(priority)) {
        return sendJsonError(ctx.res, 400, 'Invalid priority: must be a finite integer');
      }
      try {
        const result = await updateQueuedPrdPriority({ cwd: context.cwd, queueDir: queueDir(context), prdId, priority });
        context.notifyQueueMutation('external');
        sendJson(ctx.res, result);
      } catch (err) {
        sendQueueControlError(ctx.res, err);
      }
    } }),
    defineRoute({ routeKey: 'queueDependencyOverride', method: 'POST', pattern: API_ROUTES.queueDependencyOverride, security: [localMutation('Queue control mutations')], async handler(ctx) {
      if (!context.cwd) return sendJsonError(ctx.res, 503, 'Working directory not configured');
      const prdId = ctx.params.prdId;
      if (!isValidPathSegment(prdId)) return sendJsonError(ctx.res, 400, 'Invalid prdId: must not contain path separators or traversal sequences');
      const parsed = await readJsonBody(ctx.req);
      if (!parsed.ok) return sendInvalidJson(ctx.res, parsed.tooLarge);
      if (!isPlainObject(parsed.value)) return sendJsonError(ctx.res, 400, 'Invalid request body: must be a JSON object');
      const dependencyId = parsed.value.dependencyId;
      if (typeof dependencyId !== 'string' || !isValidPathSegment(dependencyId)) return sendJsonError(ctx.res, 400, 'Invalid dependencyId: must be a non-empty path segment');
      const reason = parsed.value.reason;
      if (reason !== undefined && typeof reason !== 'string') return sendJsonError(ctx.res, 400, 'Invalid reason: must be a string when provided');
      try {
        const result = await overrideQueuedPrdDependency({ cwd: context.cwd, queueDir: queueDir(context), prdId, dependencyId });
        writeDaemonEvent(context.db, {
          type: 'queue:prd:dependency-overridden',
          prdId: result.id,
          title: result.title,
          removedDependency: result.removedDependency,
          previousDependsOn: result.previousDependsOn,
          currentDependsOn: result.currentDependsOn,
          ...(reason !== undefined && { reason }),
        }, context.daemonSessionId);
        context.notifyQueueMutation('external');
        const { title: _title, ...response } = result;
        sendJson(ctx.res, response);
      } catch (err) {
        sendQueueControlError(ctx.res, err);
      }
    } }),
    defineRoute({ routeKey: 'queueRemove', method: 'DELETE', pattern: API_ROUTES.queueRemove, security: [localMutation('Queue control mutations')], async handler(ctx) {
      if (!context.cwd) return sendJsonError(ctx.res, 503, 'Working directory not configured');
      const prdId = ctx.params.prdId;
      if (!isValidPathSegment(prdId)) return sendJsonError(ctx.res, 400, 'Invalid prdId: must not contain path separators or traversal sequences');
      try {
        const result = await removeQueuedPrd({ cwd: context.cwd, queueDir: queueDir(context), prdId });
        context.notifyQueueMutation('external');
        sendJson(ctx.res, result);
      } catch (err) {
        sendQueueControlError(ctx.res, err);
      }
    } }),
  ];
}

function queueDir(context: MonitorContext): string {
  return context.queuePaths?.queueDir ?? resolve(context.cwd!, context.options.queueDir ?? context.options.config?.prdQueue?.dir ?? '.eforge/queue');
}

function sendQueueControlError(res: ServerResponse, err: unknown): void {
  if (isQueueControlError(err)) {
    const status = err.kind === 'not-found' ? 404 : err.kind === 'validation' ? 400 : 409;
    return sendJsonError(res, status, err.message);
  }
  sendJsonError(res, 500, err instanceof Error ? err.message : 'Queue control mutation failed');
}
