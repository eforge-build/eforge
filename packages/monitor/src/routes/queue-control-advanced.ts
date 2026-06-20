import { API_ROUTES, type QueueCascadeExpectedAffected, type QueueCascadeOperation, type QueueCascadeStrategy } from '@eforge-build/client';
import { applyQueueCascade, previewQueueCascade } from '@eforge-build/engine/queue/cascade-control';
import { resolveRunningPrdOwnership } from '@eforge-build/engine/queue/cancellation';
import type { QueueControlRecord } from '@eforge-build/engine/queue/snapshot';
import { holdQueuedPrd, unholdQueuedPrd } from '@eforge-build/engine/queue/hold';
import type { MonitorContext } from '../context.js';
import { defineRoute, type RouteDefinition } from '../http/router.js';
import { sendJson, sendJsonError } from '../http/response.js';
import { localMutation, localOnly, rejectCrossSiteBrowser } from '../http/security.js';
import { projectAutoBuildForContext, projectQueueForContext } from '../projections/monitor-state.js';
import { isPlainObject, isValidPathSegment, readJsonBody, sendInvalidJson } from './control-validation.js';
import { queueDir, sendQueueControlError } from './queue-control.js';

export function createQueueControlAdvancedRoutes(context: MonitorContext): RouteDefinition[] {
  return [
    defineRoute({ routeKey: 'queueHold', method: 'POST', pattern: API_ROUTES.queueHold, security: [localMutation('Queue hold mutations')], async handler(ctx) {
      if (!context.cwd) return sendJsonError(ctx.res, 503, 'Working directory not configured');
      const prdId = ctx.params.prdId;
      if (!isValidPathSegment(prdId)) return sendJsonError(ctx.res, 400, 'Invalid prdId');
      const parsed = await readJsonBody(ctx.req);
      if (!parsed.ok) return sendInvalidJson(ctx.res, parsed.tooLarge);
      if (!isPlainObject(parsed.value)) return sendJsonError(ctx.res, 400, 'Invalid request body: must be a JSON object');
      const reason = parsed.value.reason;
      if (reason !== undefined && (typeof reason !== 'string' || reason.length > 500 || /[\x00-\x1f\x7f]/.test(reason))) return sendJsonError(ctx.res, 400, 'Invalid reason');
      try {
        const result = await holdQueuedPrd({ cwd: context.cwd, queueDir: queueDir(context), prdId, ...(reason !== undefined ? { reason } : {}) });
        if (result.status === 'held') context.notifyQueueMutation('external');
        const queue = await projectQueueForContext(context);
        const item = findItem(queue, prdId);
        if (!item) return sendJsonError(ctx.res, 409, `Queue projection does not include mutated item: ${prdId}`);
        sendJson(ctx.res, { status: result.status, item, queue, autoBuild: projectAutoBuildForContext(context) });
      } catch (err) { sendQueueControlError(ctx.res, err); }
    } }),
    defineRoute({ routeKey: 'queueUnhold', method: 'POST', pattern: API_ROUTES.queueUnhold, security: [localMutation('Queue hold mutations')], async handler(ctx) {
      if (!context.cwd) return sendJsonError(ctx.res, 503, 'Working directory not configured');
      const prdId = ctx.params.prdId;
      if (!isValidPathSegment(prdId)) return sendJsonError(ctx.res, 400, 'Invalid prdId');
      const parsed = await readJsonBody(ctx.req);
      if (!parsed.ok) return sendInvalidJson(ctx.res, parsed.tooLarge);
      if (!isPlainObject(parsed.value)) return sendJsonError(ctx.res, 400, 'Invalid request body: must be a JSON object');
      if (Object.keys(parsed.value).length > 0) return sendJsonError(ctx.res, 400, 'Invalid request body: unhold does not accept fields');
      try {
        const result = await unholdQueuedPrd({ cwd: context.cwd, queueDir: queueDir(context), prdId });
        if (result.status === 'unheld') context.notifyQueueMutation('external');
        const queue = await projectQueueForContext(context);
        const item = findItem(queue, prdId);
        if (!item) return sendJsonError(ctx.res, 409, `Queue projection does not include mutated item: ${prdId}`);
        sendJson(ctx.res, { status: result.status, item, queue, autoBuild: projectAutoBuildForContext(context) });
      } catch (err) { sendQueueControlError(ctx.res, err); }
    } }),
    defineRoute({ routeKey: 'queueCascadePreview', method: 'POST', pattern: API_ROUTES.queueCascadePreview, security: [localOnly('Queue cascade preview'), rejectCrossSiteBrowser('Queue cascade preview')], async handler(ctx) {
      if (!context.cwd) return sendJsonError(ctx.res, 503, 'Working directory not configured');
      const prdId = ctx.params.prdId;
      if (!isValidPathSegment(prdId)) return sendJsonError(ctx.res, 400, 'Invalid prdId');
      const parsed = await readJsonBody(ctx.req);
      if (!parsed.ok) return sendInvalidJson(ctx.res, parsed.tooLarge);
      if (!isPlainObject(parsed.value)) return sendJsonError(ctx.res, 400, 'Invalid request body: must be a JSON object');
      const operation = parseOperation(parsed.value.operation);
      if (!operation) return sendJsonError(ctx.res, 400, 'Invalid operation');
      try { sendJson(ctx.res, await previewQueueCascade({ cwd: context.cwd, queueDir: queueDir(context), prdId, operation, resolveRunningOwnership: (record) => resolveOwnership(context, record) })); }
      catch (err) { sendQueueControlError(ctx.res, err); }
    } }),
    defineRoute({ routeKey: 'queueCascadeApply', method: 'POST', pattern: API_ROUTES.queueCascadeApply, security: [localMutation('Queue cascade mutations')], async handler(ctx) {
      if (!context.cwd) return sendJsonError(ctx.res, 503, 'Working directory not configured');
      const prdId = ctx.params.prdId;
      if (!isValidPathSegment(prdId)) return sendJsonError(ctx.res, 400, 'Invalid prdId');
      const parsed = await readJsonBody(ctx.req);
      if (!parsed.ok) return sendInvalidJson(ctx.res, parsed.tooLarge);
      if (!isPlainObject(parsed.value)) return sendJsonError(ctx.res, 400, 'Invalid request body: must be a JSON object');
      const operation = parseOperation(parsed.value.operation);
      const strategy = parseStrategy(parsed.value.strategy);
      if (!operation || !strategy || !isExpectedAffected(parsed.value.expectedAffected) || typeof parsed.value.confirmDependents !== 'boolean') return sendJsonError(ctx.res, 400, 'Invalid cascade apply request');
      const reason = parsed.value.reason;
      if (reason !== undefined && (typeof reason !== 'string' || reason.length > 500 || /[\x00-\x1f\x7f]/.test(reason))) return sendJsonError(ctx.res, 400, 'Invalid reason');
      try {
        const response = await applyQueueCascade({ cwd: context.cwd, queueDir: queueDir(context), prdId, operation, strategy, expectedAffected: parsed.value.expectedAffected, confirmDependents: parsed.value.confirmDependents, ...(reason !== undefined ? { reason } : {}), resolveRunningOwnership: (record) => resolveOwnership(context, record), cancelRunning: (ownership) => cancelRunning(context, ownership) });
        if (response.applied) context.notifyQueueMutation('external');
        sendJson(ctx.res, { ...response, queue: await projectQueueForContext(context), autoBuild: projectAutoBuildForContext(context) });
      } catch (err) { sendQueueControlError(ctx.res, err); }
    } }),
  ];
}

function parseOperation(value: unknown): QueueCascadeOperation | undefined { return value === 'remove' || value === 'cancel' ? value : undefined; }
function parseStrategy(value: unknown): QueueCascadeStrategy | undefined { return value === 'target-only' || value === 'cascade-dependents' ? value : undefined; }

function isExpectedAffected(value: unknown): value is QueueCascadeExpectedAffected {
  return isPlainObject(value) && typeof value.token === 'string' && Array.isArray(value.prdIds) && value.prdIds.every((id) => typeof id === 'string' && isValidPathSegment(id));
}

async function resolveOwnership(context: MonitorContext, record: QueueControlRecord) {
  return resolveRunningPrdOwnership({ cwd: context.cwd!, prdId: record.id, runs: context.db.getRunningRuns(), workerSessions: new Set(context.options.workerTracker?.listWorkerSessions?.() ?? []) });
}

function cancelRunning(context: MonitorContext, ownership: { owned: boolean; sessionId?: string }) {
  if (ownership.owned !== true || !ownership.sessionId) return { cancelled: false, reason: 'Running queue item is not daemon-owned.' };
  const cancel = context.options.workerTracker?.cancelWorkerProcess;
  if (!cancel) return { cancelled: false, reason: 'Signal-only worker cancellation is unavailable.' };
  return cancel(ownership.sessionId) ? { cancelled: true } : { cancelled: false, reason: 'Daemon worker process was not found.' };
}

function findItem<T extends { id: string }>(queue: T[], prdId: string): T | undefined {
  return queue.find((item) => item.id === prdId);
}
