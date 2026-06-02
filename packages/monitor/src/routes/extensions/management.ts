import { API_ROUTES, type ExtensionNewRequest } from '@eforge-build/client';
import type { MonitorContext } from '../../context.js';
import { defineRoute, type RouteDefinition } from '../../http/router.js';
import { isRequestBodyTooLargeError, parseJsonBody } from '../../http/request.js';
import { sendJson, sendJsonError } from '../../http/response.js';
import { localMutation } from '../../http/security.js';
import { loadExtensionResponse } from './discovery-service.js';
import { reloadAutoBuildExtensions } from './reload-service.js';

export function createExtensionManagementRoutes(context: MonitorContext): RouteDefinition[] {
  const security = [localMutation('Extension management mutations')];
  return [
    defineRoute({ routeKey: 'extensionNew', method: 'POST', pattern: API_ROUTES.extensionNew, security, handler: (ctx) => handleNew(ctx, context) }),
    defineRoute({ routeKey: 'extensionReload', method: 'POST', pattern: API_ROUTES.extensionReload, security, handler: (ctx) => handleReload(ctx, context) }),
  ];
}
async function handleNew(ctx: any, context: MonitorContext) {
  if (!context.cwd) return sendJsonError(ctx.res, 503, 'Working directory not configured');
  let body: ExtensionNewRequest;
  try { const raw = await parseJsonBody(ctx.req); if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return sendJsonError(ctx.res, 400, 'Invalid JSON body'); body = raw as ExtensionNewRequest; } catch (err) { return sendJsonError(ctx.res, isRequestBodyTooLargeError(err) ? 413 : 400, isRequestBodyTooLargeError(err) ? 'Request body too large' : 'Invalid JSON body'); }
  if (!body.name || typeof body.name !== 'string') return sendJsonError(ctx.res, 400, 'Missing required field: name');
  if (body.scope !== undefined && !['local', 'project', 'user'].includes(body.scope)) return sendJsonError(ctx.res, 400, 'Invalid extension scope. Supported scopes: local, project, user');
  if (body.template !== undefined && !['event-logger', 'blank'].includes(body.template)) return sendJsonError(ctx.res, 400, 'Unknown extension template. Supported templates: event-logger, blank');
  if (body.force !== undefined && typeof body.force !== 'boolean') return sendJsonError(ctx.res, 400, 'Invalid field: force must be boolean');
  try { const { scaffoldNativeExtension } = await import('@eforge-build/engine/extensions/index'); sendJson(ctx.res, await scaffoldNativeExtension({ cwd: context.cwd, name: body.name, ...(body.scope !== undefined && { scope: body.scope }), ...(body.template !== undefined && { template: body.template }), force: body.force === true })); }
  catch (err) { sendJsonError(ctx.res, err instanceof Error && err.name === 'ScaffoldNativeExtensionError' ? ((err as { status?: number }).status ?? 400) : 500, err instanceof Error ? err.message : 'Failed to scaffold extension'); }
}
async function handleReload(ctx: any, context: MonitorContext) { try { const data = await loadExtensionResponse(context.cwd); const watcher = await reloadAutoBuildExtensions(context.options.daemonState); sendJson(ctx.res, { ...data, ...watcher, watcher }); } catch (err) { sendJsonError(ctx.res, context.cwd ? 500 : 503, err instanceof Error ? err.message : 'Failed to reload extensions'); } }
