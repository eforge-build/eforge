import { resolve } from 'node:path';
import { API_ROUTES } from '@eforge-build/client';
import { prepareRecoveryGuidance, RecoveryGuidanceError } from '@eforge-build/engine/recovery/guidance';
import type { MonitorContext } from '../context.js';
import { defineRoute, type RouteDefinition } from '../http/router.js';
import { sendJson, sendJsonError } from '../http/response.js';
import { localMutation } from '../http/security.js';
import { isPlainObject, isValidPathSegment, readJsonBody, sendInvalidJson } from './control-validation.js';

export function createRecoveryGuidanceRoutes(context: MonitorContext): RouteDefinition[] {
  return [defineRoute({ routeKey: 'recoveryGuidancePrepare', method: 'POST', pattern: API_ROUTES.recoveryGuidancePrepare, security: [localMutation('Recovery guidance preparation')], async handler(ctx) {
    if (!context.cwd) return sendJsonError(ctx.res, 503, 'Working directory not configured');
    const parsed = await readJsonBody(ctx.req);
    if (!parsed.ok) return sendInvalidJson(ctx.res, parsed.tooLarge);
    if (!isPlainObject(parsed.value)) return sendJsonError(ctx.res, 400, 'Invalid request body: must be a JSON object');
    const prdId = parsed.value.prdId;
    if (typeof prdId !== 'string') return sendJsonError(ctx.res, 400, 'Missing required field: prdId');
    if (!isValidPathSegment(prdId) || hasAsciiControl(prdId)) return sendJsonError(ctx.res, 400, 'Invalid prdId: must be a safe path segment');
    const setName = parsed.value.setName;
    if (setName !== undefined && (typeof setName !== 'string' || !isValidPathSegment(setName))) return sendJsonError(ctx.res, 400, 'Invalid setName: must be a safe path segment');
    try {
      const result = await prepareRecoveryGuidance({
        cwd: context.cwd,
        prdId,
        ...(setName !== undefined ? { setName } : {}),
        queueDir: context.queuePaths?.queueDir ?? resolve(context.cwd, context.options.queueDir ?? context.options.config?.prdQueue?.dir ?? '.eforge/queue'),
        outputDir: context.options.config?.plan?.outputDir ?? context.options.planOutputDir ?? context.relativePlanOutputDir,
        dbPath: resolve(context.cwd, '.eforge', 'monitor.db'),
        ...(context.options.config?.build?.trunkBranch !== undefined ? { trunkBranch: context.options.config.build.trunkBranch } : {}),
      });
      sendJson(ctx.res, result);
    } catch (err) {
      sendRecoveryGuidanceError(ctx.res, err);
    }
  } })];
}

function sendRecoveryGuidanceError(res: Parameters<typeof sendJsonError>[0], err: unknown): void {
  const message = err instanceof Error ? err.message : 'Recovery guidance preparation failed';
  if (err instanceof RecoveryGuidanceError) {
    if (err.kind === 'missing-sidecar') return sendJsonError(res, 404, message);
    if (err.kind === 'preflight') return sendJsonError(res, 409, message);
    return sendJsonError(res, 400, message);
  }
  sendJsonError(res, 500, message);
}

function hasAsciiControl(value: string): boolean {
  return /[\x00-\x1f\x7f]/.test(value);
}
