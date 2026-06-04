import { API_ROUTES } from '@eforge-build/client';
import { DEFAULT_CONFIG } from '@eforge-build/engine/config';
import { EforgeEngine } from '@eforge-build/engine/eforge';
import { applyRecoveryAbandon, applyRecoveryManual, applyRecoveryRetry } from '@eforge-build/engine/recovery/apply';
import type { MonitorContext } from '../context.js';
import { defineRoute, type RouteDefinition } from '../http/router.js';
import { sendJson, sendJsonError } from '../http/response.js';
import { localMutation } from '../http/security.js';
import { readJsonBody, isValidPathSegment, isPlainObject, sendInvalidJson } from './control-validation.js';
import { readRecoverySidecar, readRecoveryVerdictForApply } from './recovery-sidecar-service.js';
import { previewAcceptSuccessForRequest, applyAcceptSuccessForRequest } from './recovery-accept-success-service.js';
import type { AcceptSuccessRequest } from '@eforge-build/client';

export function createRecoveryRoutes(context: MonitorContext): RouteDefinition[] {
  return [
    defineRoute({ routeKey: 'recover', method: 'POST', pattern: API_ROUTES.recover, security: [localMutation('Recovery analysis')], async handler(ctx) {
      const workerTracker = context.options.workerTracker;
      if (!workerTracker) return sendJsonError(ctx.res, 503, 'Daemon mode not active');
      const parsed = await readJsonBody(ctx.req);
      if (!parsed.ok || typeof parsed.value !== 'object' || parsed.value === null) return sendInvalidJson(ctx.res, !parsed.ok && parsed.tooLarge);
      const body = parsed.value as { setName?: unknown; prdId?: unknown };
      if (!body.setName || typeof body.setName !== 'string') return sendJsonError(ctx.res, 400, 'Missing required field: setName');
      if (!body.prdId || typeof body.prdId !== 'string') return sendJsonError(ctx.res, 400, 'Missing required field: prdId');
      if (!isValidPathSegment(body.setName) || !isValidPathSegment(body.prdId)) return sendJsonError(ctx.res, 400, 'Invalid setName or prdId: must not contain path separators or traversal sequences');
      try { const result = workerTracker.spawnWorker('recover', [body.setName, body.prdId]); sendJson(ctx.res, { sessionId: result.sessionId, pid: result.pid }); }
      catch (err) { sendJsonError(ctx.res, 500, err instanceof Error ? err.message : 'Failed to spawn recovery worker'); }
    } }),
    defineRoute({ routeKey: 'readRecoverySidecar', method: 'GET', pattern: API_ROUTES.readRecoverySidecar, security: [localMutation('Recovery sidecar reads')], async handler(ctx) {
      const prdId = ctx.query.get('prdId');
      if (!context.cwd) return sendJsonError(ctx.res, 503, 'Working directory not configured');
      if (!prdId) return sendJsonError(ctx.res, 400, 'Missing required query param: prdId');
      if (!isValidPathSegment(prdId)) return sendJsonError(ctx.res, 400, 'Invalid prdId: must not contain path separators or traversal sequences');
      sendJson(ctx.res, await readRecoverySidecar(context, prdId));
    } }),
    defineRoute({ routeKey: 'applyRecovery', method: 'POST', pattern: API_ROUTES.applyRecovery, security: [localMutation('Recovery apply')], async handler(ctx) {
      if (!context.options.daemonState) return sendJsonError(ctx.res, 503, 'Daemon mode not active');
      if (!context.cwd) return sendJsonError(ctx.res, 503, 'No working directory configured');
      const parsed = await readJsonBody(ctx.req);
      if (!parsed.ok || typeof parsed.value !== 'object' || parsed.value === null) return sendInvalidJson(ctx.res, !parsed.ok && parsed.tooLarge);
      const body = parsed.value as { prdId?: unknown };
      if (!body.prdId || typeof body.prdId !== 'string') return sendJsonError(ctx.res, 400, 'Missing required field: prdId');
      if (!isValidPathSegment(body.prdId)) return sendJsonError(ctx.res, 400, 'Invalid prdId: must not contain path separators or traversal sequences');
      const recoveryData = await readRecoveryVerdictForApply(context, body.prdId);
      const helperOptions = { cwd: context.cwd, prdId: body.prdId, queueDir: context.queuePaths?.queueDir ?? `${context.cwd}/.eforge/queue` };
      try {
        switch (recoveryData.verdict.verdict) {
          case 'retry': {
            const result = await applyRecoveryRetry(helperOptions);
            context.notifyQueueMutation('apply-recovery');
            return sendJson(ctx.res, { verdict: 'retry', commitSha: result.commitSha, noAction: false });
          }
          case 'split': {
            const splitQueueDir = context.queuePaths?.relativeQueueDir ?? context.options.config?.prdQueue?.dir ?? context.options.queueDir ?? '.eforge/queue';
            const splitConfig = { ...context.options.config, prdQueue: { ...(context.options.config?.prdQueue ?? DEFAULT_CONFIG.prdQueue), dir: splitQueueDir } };
            const engine = await EforgeEngine.create({ cwd: context.cwd, config: splitConfig, agentRuntimes: context.options.agentRuntimes });
            const gen = engine.applyRecovery(body.prdId);
            let next = await gen.next();
            while (!next.done) next = await gen.next();
            const result = next.value;
            context.notifyQueueMutation('apply-recovery');
            return sendJson(ctx.res, { verdict: 'split', commitSha: result.commitSha, successorPrdId: result.successorPrdId, noAction: false, status: result.status, detail: result.detail });
          }
          case 'abandon': {
            const result = await applyRecoveryAbandon(helperOptions);
            context.notifyQueueMutation('apply-recovery');
            return sendJson(ctx.res, { verdict: 'abandon', commitSha: result.commitSha, noAction: false });
          }
          case 'manual': {
            const result = await applyRecoveryManual(helperOptions);
            context.notifyQueueMutation('apply-recovery');
            return sendJson(ctx.res, { verdict: 'manual', noAction: result.noAction });
          }
          default: throw new Error(`Unknown verdict: ${(recoveryData.verdict as { verdict: string }).verdict}`);
        }
      } catch (err) { sendJsonError(ctx.res, 500, err instanceof Error ? err.message : 'Failed to apply recovery verdict'); }
    } }),
    // --- eforge:region plan-02-accept-success-recovery-backend ---
    defineRoute({ routeKey: 'acceptRecoverySuccessPreview', method: 'GET', pattern: API_ROUTES.acceptRecoverySuccessPreview, security: [localMutation('Accept-success recovery preview')], async handler(ctx) {
      if (!context.cwd) return sendJsonError(ctx.res, 503, 'No working directory configured');
      const prdId = ctx.query.get('prdId');
      if (!prdId) return sendJsonError(ctx.res, 400, 'Missing required query param: prdId');
      if (!isValidPathSegment(prdId)) return sendJsonError(ctx.res, 400, 'Invalid prdId: must not contain path separators or traversal sequences');
      sendJson(ctx.res, await previewAcceptSuccessForRequest(context, prdId));
    } }),
    defineRoute({ routeKey: 'acceptRecoverySuccess', method: 'POST', pattern: API_ROUTES.acceptRecoverySuccess, security: [localMutation('Accept-success recovery apply')], async handler(ctx) {
      if (!context.options.daemonState) return sendJsonError(ctx.res, 503, 'Daemon mode not active');
      if (!context.cwd) return sendJsonError(ctx.res, 503, 'No working directory configured');
      const parsed = await readJsonBody(ctx.req);
      if (!parsed.ok || !isPlainObject(parsed.value)) return sendInvalidJson(ctx.res, !parsed.ok && parsed.tooLarge);
      const body = parsed.value as Partial<AcceptSuccessRequest>;
      if (!body.prdId || typeof body.prdId !== 'string') return sendJsonError(ctx.res, 400, 'Missing required field: prdId');
      if (!isValidPathSegment(body.prdId)) return sendJsonError(ctx.res, 400, 'Invalid prdId: must not contain path separators or traversal sequences');
      // Reject a malformed unblockDependentIds rather than silently coercing it to
      // [] (which would ignore the caller's requested dependent selection).
      if (body.unblockDependentIds !== undefined && (!Array.isArray(body.unblockDependentIds) || body.unblockDependentIds.some((id) => typeof id !== 'string'))) {
        return sendJsonError(ctx.res, 400, 'unblockDependentIds must be an array of strings');
      }
      const result = await applyAcceptSuccessForRequest(context, {
        prdId: body.prdId,
        reasonCategory: body.reasonCategory as AcceptSuccessRequest['reasonCategory'],
        reason: typeof body.reason === 'string' ? body.reason : '',
        unblockDependentIds: body.unblockDependentIds ?? [],
      });
      context.notifyQueueMutation('apply-recovery');
      sendJson(ctx.res, result);
    } }),
    // --- eforge:endregion plan-02-accept-success-recovery-backend ---
  ];
}
