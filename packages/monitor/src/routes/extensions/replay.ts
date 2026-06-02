import { API_ROUTES } from '@eforge-build/client';
import type { MonitorContext } from '../../context.js';
import { defineRoute, type RouteDefinition } from '../../http/router.js';
import { isRequestBodyTooLargeError, parseJsonBody } from '../../http/request.js';
import { sendJson, sendJsonError } from '../../http/response.js';
import { localMutation } from '../../http/security.js';
import { replayExtensionTest } from './replay-service.js';
import { validateExtensionTestRequestBody } from './validation.js';

export function createExtensionReplayRoutes(context: MonitorContext): RouteDefinition[] {
  return [defineRoute({ routeKey: 'extensionTest', method: 'POST', pattern: API_ROUTES.extensionTest, security: [localMutation('Extension management mutations')], handler: async (ctx) => {
    if (!context.cwd) return sendJsonError(ctx.res, 503, 'Working directory not configured');
    let body: unknown;
    try { body = await parseJsonBody(ctx.req); }
    catch (err) { return sendJsonError(ctx.res, isRequestBodyTooLargeError(err) ? 413 : 400, isRequestBodyTooLargeError(err) ? 'Request body too large' : 'Invalid JSON body'); }
    const validation = validateExtensionTestRequestBody(body);
    if (typeof validation === 'string') return sendJsonError(ctx.res, 400, validation);
    try { sendJson(ctx.res, await replayExtensionTest(context, validation)); }
    catch (err) { sendJsonError(ctx.res, (err as { statusCode?: number }).statusCode ?? 500, err instanceof Error ? err.message : 'Failed to test extensions'); }
  } })];
}
