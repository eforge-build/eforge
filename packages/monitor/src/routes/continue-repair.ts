import { API_ROUTES } from '@eforge-build/client';
import type { MonitorContext } from '../context.js';
import { defineRoute, type RouteDefinition } from '../http/router.js';
import { sendJson, sendJsonError } from '../http/response.js';
import { localMutation } from '../http/security.js';
import { isPlainObject, isValidPathSegment, readJsonBody, sendInvalidJson } from './control-validation.js';
import { buildContinueRepairEligibility, queueContinueRepair } from './continue-repair-service.js';

export function createContinueRepairRoutes(context: MonitorContext): RouteDefinition[] {
  return [
    defineRoute({ routeKey: 'continueRepair', method: 'POST', pattern: API_ROUTES.continueRepair, security: [localMutation('Continue and repair build')], async handler(ctx) {
      const parsed = await readJsonBody(ctx.req);
      if (!parsed.ok) return sendInvalidJson(ctx.res, parsed.tooLarge);
      if (!isPlainObject(parsed.value)) return sendJsonError(ctx.res, 400, 'Invalid request body: must be a JSON object');
      try { sendJson(ctx.res, await queueContinueRepair(context, parsed.value)); }
      catch (err) { if (err instanceof Error && 'status' in err) throw err; sendJsonError(ctx.res, 500, err instanceof Error ? err.message : 'Failed to queue continue-and-repair build'); }
    } }),
    defineRoute({ routeKey: 'continueRepairEligibility', method: 'GET', pattern: API_ROUTES.continueRepairEligibility, security: [localMutation('Continue-and-repair eligibility checks')], async handler(ctx) {
      const prdId = ctx.query.get('prdId');
      if (!prdId) return sendJsonError(ctx.res, 400, 'Missing required query param: prdId');
      if (!isValidPathSegment(prdId)) return sendJsonError(ctx.res, 400, 'Invalid prdId: must not contain path separators or traversal sequences');
      const setNameParam = ctx.query.get('setName');
      if (setNameParam !== null && !isValidPathSegment(setNameParam)) return sendJsonError(ctx.res, 400, 'Invalid setName: must not contain path separators or traversal sequences');
      try { sendJson(ctx.res, await buildContinueRepairEligibility(context, prdId, setNameParam)); }
      catch (err) { if (err instanceof Error && 'status' in err) throw err; sendJsonError(ctx.res, 500, err instanceof Error ? err.message : 'Failed to check continue-and-repair eligibility'); }
    } }),
  ];
}
