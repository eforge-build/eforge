import { API_ROUTES } from '@eforge-build/client';
import type { MonitorContext } from '../../context.js';
import { defineRoute, type RouteDefinition } from '../../http/router.js';
import { isRequestBodyTooLargeError, parseJsonBody } from '../../http/request.js';
import { sendJson, sendJsonError } from '../../http/response.js';
import { localMutation } from '../../http/security.js';
import { EXTENSION_NAME_RE, isPlainObject } from './validation.js';
import { trustExtension, untrustExtension } from './trust-service.js';

export function createExtensionTrustRoutes(context: MonitorContext): RouteDefinition[] {
  const security = [localMutation('Extension management mutations')];
  return [
    defineRoute({ routeKey: 'extensionTrust', method: 'POST', pattern: API_ROUTES.extensionTrust, security, handler: (ctx) => handle(ctx, context, true) }),
    defineRoute({ routeKey: 'extensionUntrust', method: 'POST', pattern: API_ROUTES.extensionUntrust, security, handler: (ctx) => handle(ctx, context, false) }),
  ];
}
async function handle(ctx: any, context: MonitorContext, trust: boolean) {
  if (!context.cwd) return sendJsonError(ctx.res, 503, 'Working directory not configured');
  let body: Record<string, unknown>; try { const raw = await parseJsonBody(ctx.req); if (!isPlainObject(raw)) return sendJsonError(ctx.res, 400, 'Invalid JSON body'); body = raw; } catch (err) { return sendJsonError(ctx.res, isRequestBodyTooLargeError(err) ? 413 : 400, isRequestBodyTooLargeError(err) ? 'Request body too large' : 'Invalid JSON body'); }
  if (!trust && body.trustedBy !== undefined) return sendJsonError(ctx.res, 400, 'trustedBy is not accepted for untrust requests');
  const hasName = body.name !== undefined; const hasPath = body.path !== undefined;
  if (!hasName && !hasPath) return sendJsonError(ctx.res, 400, 'Missing required field: name or path');
  if (hasName && hasPath) return sendJsonError(ctx.res, 400, 'Specify only one of name or path');
  if (hasName && (typeof body.name !== 'string' || !EXTENSION_NAME_RE.test(body.name))) return sendJsonError(ctx.res, 400, 'Invalid extension name');
  if (hasPath && typeof body.path !== 'string') return sendJsonError(ctx.res, 400, 'Invalid extension path');
  if (trust && body.trustedBy !== undefined && typeof body.trustedBy !== 'string') return sendJsonError(ctx.res, 400, 'Invalid trustedBy: must be a string');
  try { sendJson(ctx.res, trust ? await trustExtension(context.cwd, body as any) : await untrustExtension(context.cwd, body as any)); }
  catch (err) { sendJsonError(ctx.res, (err as { statusCode?: number }).statusCode ?? 500, err instanceof Error ? err.message : (trust ? 'Failed to trust extension' : 'Failed to untrust extension')); }
}
