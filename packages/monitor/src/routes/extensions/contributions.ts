import { randomUUID } from 'node:crypto';
import { API_ROUTES, safeParseExtensionActionInvokeRequest } from '@eforge-build/client';
import type { MonitorContext } from '../../context.js';
import { defineRoute, type RequestContext, type RouteDefinition } from '../../http/router.js';
import { isRequestBodyTooLargeError, parseJsonBody } from '../../http/request.js';
import { sendJson, sendJsonError } from '../../http/response.js';
import { localMutation, localOnly, rejectCrossSiteBrowser } from '../../http/security.js';
import { failureBody, getContributionManifest, invokeExtensionAction } from './contribution-service.js';

// --- eforge:region plan-03-daemon-action-routes ---
export function createExtensionContributionRoutes(context: MonitorContext): RouteDefinition[] {
  return [
    defineRoute({
      routeKey: 'extensionContributionManifest',
      method: 'GET',
      pattern: API_ROUTES.extensionContributionManifest,
      security: [localOnly('Extension contribution manifest reads'), rejectCrossSiteBrowser('Extension contribution manifest reads')],
      handler: (ctx) => handleManifest(ctx, context),
    }),
    defineRoute({
      routeKey: 'extensionActionInvoke',
      method: 'POST',
      pattern: API_ROUTES.extensionActionInvoke,
      security: [localMutation('Extension action invocation')],
      handler: (ctx) => handleInvoke(ctx, context),
    }),
  ];
}

async function handleManifest(ctx: RequestContext, context: MonitorContext): Promise<void> {
  if (!context.cwd) return sendJsonError(ctx.res, 503, 'Working directory not configured');
  try {
    sendJson(ctx.res, await getContributionManifest(context));
  } catch (err) {
    sendJsonError(ctx.res, 500, err instanceof Error ? err.message : 'Failed to load extension contribution manifest');
  }
}

async function handleInvoke(ctx: RequestContext, context: MonitorContext): Promise<void> {
  const invocationId = randomUUID();
  if (!context.cwd) {
    return sendJson(ctx.res, failureBody(invocationId, 'daemon-unavailable', 'Working directory not configured'), 503);
  }

  if (!isJsonContentType(ctx.req.headers['content-type'])) {
    return sendJson(ctx.res, failureBody(invocationId, 'invalid-request', 'Content-Type must be application/json'), 400);
  }

  let raw: unknown;
  try {
    raw = await parseJsonBody(ctx.req);
  } catch (err) {
    const tooLarge = isRequestBodyTooLargeError(err);
    return sendJson(ctx.res, failureBody(invocationId, 'invalid-request', tooLarge ? 'Request body too large' : 'Invalid JSON body'), tooLarge ? 413 : 400);
  }

  const parsed = safeParseExtensionActionInvokeRequest(raw);
  if (!parsed.success) {
    return sendJson(ctx.res, failureBody(invocationId, 'invalid-request', 'Action invocation request failed schema validation', parsed.error.errors), 400);
  }

  try {
    const result = await invokeExtensionAction(context, parsed.data, invocationId);
    sendJson(ctx.res, result.body, result.status);
  } catch (err) {
    sendJson(ctx.res, failureBody(invocationId, 'daemon-unavailable', err instanceof Error ? err.message : 'Extension action runtime unavailable'), 503);
  }
}

function isJsonContentType(value: string | string[] | undefined): boolean {
  const contentTypes = Array.isArray(value) ? value : value ? [value] : [];
  return contentTypes.some((contentType) => contentType.split(';', 1)[0]?.trim().toLowerCase() === 'application/json');
}
// --- eforge:endregion plan-03-daemon-action-routes ---
