import { resolve } from 'node:path';
import { API_ROUTES, type QueueRecoveryOperation } from '@eforge-build/client';
import { analyzeQueueRecovery, applyQueueRecovery } from '@eforge-build/engine/queue/recovery-cascade';
import type { MonitorContext } from '../context.js';
import { defineRoute, type RouteDefinition } from '../http/router.js';
import { sendJson, sendJsonError } from '../http/response.js';
import { localMutation, localOnly, rejectCrossSiteBrowser } from '../http/security.js';
import { isPlainObject, isValidPathSegment, readJsonBody } from './control-validation.js';

export function createQueueRecoveryRoutes(context: MonitorContext): RouteDefinition[] {
  return [
    defineRoute({ routeKey: 'queueRecoveryAnalyze', method: 'POST', pattern: API_ROUTES.queueRecoveryAnalyze, security: [localOnly('Queue recovery analysis'), rejectCrossSiteBrowser('Queue recovery analysis')], async handler(ctx) {
      const body = await parseQueueRecoveryBody(ctx.req, ctx.res); if (!body) return;
      if (!validateSelected(body.selectedPrdId, ctx.res)) return;
      if (!validateStrategy(body.strategy, ctx.res)) return;
      if (!context.cwd) return sendJsonError(ctx.res, 503, 'Working directory not configured');
      try { sendJson(ctx.res, await analyzeQueueRecovery({ cwd: context.cwd, selectedPrdId: body.selectedPrdId, strategy: body.strategy as string | undefined, queueDir: queueDir(context) })); }
      catch (err) { sendJsonError(ctx.res, 500, err instanceof Error ? err.message : 'Failed to analyze queue recovery'); }
    } }),
    defineRoute({ routeKey: 'queueRecoveryApply', method: 'POST', pattern: API_ROUTES.queueRecoveryApply, security: [localMutation('Queue recovery mutations')], async handler(ctx) {
      if (!context.options.daemonState) return sendJsonError(ctx.res, 503, 'Daemon mode not active');
      const body = await parseQueueRecoveryBody(ctx.req, ctx.res); if (!body) return;
      if (!validateSelected(body.selectedPrdId, ctx.res)) return;
      if (!validateStrategy(body.strategy, ctx.res)) return;
      const expectedOperations = validateExpectedOperations(body.expectedOperations, ctx.res); if (!expectedOperations) return;
      if (!context.cwd) return sendJsonError(ctx.res, 503, 'Working directory not configured');
      try {
        const result = await applyQueueRecovery({ cwd: context.cwd, selectedPrdId: body.selectedPrdId, strategy: body.strategy as string | undefined, expectedOperations, queueDir: queueDir(context) });
        if (result.operationResults.some((op) => op.status === 'applied')) context.notifyQueueMutation('apply-recovery');
        sendJson(ctx.res, result);
      } catch (err) { sendJsonError(ctx.res, 500, err instanceof Error ? err.message : 'Failed to apply queue recovery'); }
    } }),
  ];
}

async function parseQueueRecoveryBody(req: Parameters<RouteDefinition['handler']>[0]['req'], res: Parameters<RouteDefinition['handler']>[0]['res']): Promise<Record<string, unknown> | null> {
  const parsed = await readJsonBody(req);
  if (!parsed.ok) { sendJsonError(res, parsed.tooLarge ? 413 : 400, parsed.tooLarge ? 'Request body too large' : 'Invalid JSON body'); return null; }
  if (!isPlainObject(parsed.value)) { sendJsonError(res, 400, 'Invalid request body: must be a JSON object'); return null; }
  return parsed.value;
}

function queueDir(context: MonitorContext): string {
  return context.queuePaths?.queueDir ?? resolve(context.cwd!, context.options.queueDir ?? context.options.config?.prdQueue?.dir ?? '.eforge/queue');
}

function validateSelected(selectedPrdId: unknown, res: Parameters<RouteDefinition['handler']>[0]['res']): selectedPrdId is string {
  if (!selectedPrdId || typeof selectedPrdId !== 'string') { sendJsonError(res, 400, 'Missing required field: selectedPrdId'); return false; }
  if (!isValidPathSegment(selectedPrdId)) { sendJsonError(res, 400, 'Invalid selectedPrdId: must not contain path separators or traversal sequences'); return false; }
  return true;
}

function validateStrategy(strategy: unknown, res: Parameters<RouteDefinition['handler']>[0]['res']): boolean {
  if (strategy !== undefined && typeof strategy !== 'string') { sendJsonError(res, 400, 'Invalid strategy: must be a string when present'); return false; }
  return true;
}

function validateExpectedOperations(value: unknown, res: Parameters<RouteDefinition['handler']>[0]['res']): QueueRecoveryOperation[] | null {
  if (!Array.isArray(value)) { sendJsonError(res, 400, 'Missing required field: expectedOperations'); return null; }
  const operations: QueueRecoveryOperation[] = [];
  for (const [index, raw] of value.entries()) {
    const prefix = `Invalid expectedOperations[${index}]`;
    if (!isPlainObject(raw)) { sendJsonError(res, 400, `${prefix}: must be an object`); return null; }
    if (typeof raw.id !== 'string') { sendJsonError(res, 400, `${prefix}: id must be a string`); return null; }
    if (raw.kind !== 'move-prd' && raw.kind !== 'remove-recovery-sidecars') { sendJsonError(res, 400, `${prefix}: kind is invalid`); return null; }
    if (typeof raw.prdId !== 'string' || !isValidPathSegment(raw.prdId)) { sendJsonError(res, 400, `${prefix}: prdId must be a safe string`); return null; }
    if (!isValidQueueRecoveryLocation(raw.expectedSourceLocation)) { sendJsonError(res, 400, `${prefix}: expectedSourceLocation is invalid`); return null; }
    if (typeof raw.reason !== 'string') { sendJsonError(res, 400, `${prefix}: reason must be a string`); return null; }
    if (raw.kind === 'move-prd') {
      if (!isValidQueueRecoveryLocation(raw.targetLocation)) { sendJsonError(res, 400, `${prefix}: targetLocation is required and invalid`); return null; }
      operations.push({ id: raw.id, kind: raw.kind, prdId: raw.prdId, expectedSourceLocation: raw.expectedSourceLocation, targetLocation: raw.targetLocation, reason: raw.reason });
    } else {
      operations.push({ id: raw.id, kind: raw.kind, prdId: raw.prdId, expectedSourceLocation: raw.expectedSourceLocation, reason: raw.reason });
    }
  }
  return operations;
}

function isValidQueueRecoveryLocation(value: unknown): value is QueueRecoveryOperation['expectedSourceLocation'] {
  return value === 'queue' || value === 'waiting' || value === 'failed' || value === 'skipped';
}
