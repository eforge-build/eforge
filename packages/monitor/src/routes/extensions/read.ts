import { API_ROUTES } from '@eforge-build/client';
import type { MonitorContext } from '../../context.js';
import { defineRoute, type RouteDefinition, type RequestContext } from '../../http/router.js';
import { sendJson, sendJsonError } from '../../http/response.js';
import { localOnly, rejectCrossSiteBrowser } from '../../http/security.js';
import { loadExtensionResponse, selectExtensionByName } from './discovery-service.js';
import { validateExtensionQueryPath } from './path-security.js';
import { EXTENSION_NAME_RE } from './validation.js';

export function createExtensionReadRoutes(context: MonitorContext): RouteDefinition[] {
  const security = [localOnly('Extension reads'), rejectCrossSiteBrowser('Extension reads')];
  return [
    defineRoute({ routeKey: 'extensionList', method: 'GET', pattern: API_ROUTES.extensionList, security, handler: (ctx) => handleList(ctx, context) }),
    defineRoute({ routeKey: 'extensionShow', method: 'GET', pattern: API_ROUTES.extensionShow, security, handler: (ctx) => handleShow(ctx, context) }),
    defineRoute({ routeKey: 'extensionValidate', method: 'GET', pattern: API_ROUTES.extensionValidate, security, handler: (ctx) => handleValidate(ctx, context) }),
  ];
}
async function handleList(ctx: RequestContext, context: MonitorContext) { try { sendJson(ctx.res, await loadExtensionResponse(context.cwd)); } catch (err) { sendJsonError(ctx.res, context.cwd ? 500 : 503, err instanceof Error ? err.message : 'Failed to list extensions'); } }
async function handleShow(ctx: RequestContext, context: MonitorContext) {
  const name = ctx.query.get('name');
  if (!name) return sendJsonError(ctx.res, 400, 'Missing required query param: name');
  if (!EXTENSION_NAME_RE.test(name)) return sendJsonError(ctx.res, 400, 'Invalid extension name');
  try { const data = await loadExtensionResponse(context.cwd); const extension = selectExtensionByName(data.extensions, name); if (!extension) return sendJsonError(ctx.res, 404, `Extension not found: ${name}`); sendJson(ctx.res, { extension }); }
  catch (err) { sendJsonError(ctx.res, context.cwd ? 500 : 503, err instanceof Error ? err.message : 'Failed to show extension'); }
}
async function handleValidate(ctx: RequestContext, context: MonitorContext) {
  const hasName = ctx.query.has('name'); const hasPath = ctx.query.has('path');
  const name = hasName ? ctx.query.get('name') ?? '' : undefined; const rawPath = hasPath ? ctx.query.get('path') ?? '' : undefined;
  if (hasName && hasPath) return sendJsonError(ctx.res, 400, 'Specify only one of name or path');
  if (hasName && (!name || !EXTENSION_NAME_RE.test(name))) return sendJsonError(ctx.res, 400, 'Invalid extension name');
  const validatedPath = hasPath ? await validateExtensionQueryPath(context.cwd, rawPath ?? '') : undefined;
  if (hasPath && !validatedPath) return sendJsonError(ctx.res, 400, 'Invalid extension path');
  try {
    const data = await loadExtensionResponse(context.cwd, validatedPath ? { path: validatedPath } : undefined);
    const extensions = name ? data.extensions.filter((entry) => entry.name === name) : data.extensions;
    if (name && extensions.length === 0) return sendJsonError(ctx.res, 404, `Extension not found: ${name}`);
    const selectedKeys = name ? new Set(extensions.flatMap((entry) => [entry.name, entry.path])) : undefined;
    const diagnosticEntries = [...data.diagnostics.filter((d) => !selectedKeys || selectedKeys.has(d.name ?? '') || selectedKeys.has(d.path ?? '')), ...extensions.flatMap((e) => e.diagnostics)].filter((d) => d.severity === 'error');
    const diagnostics = [...new Map(diagnosticEntries.map((d) => [`${d.code}\0${d.path ?? ''}\0${d.message}`, d])).values()];
    sendJson(ctx.res, { valid: extensions.every((entry) => entry.status !== 'error') && diagnostics.length === 0, extensions, diagnostics });
  } catch (err) { sendJsonError(ctx.res, context.cwd ? 500 : 503, err instanceof Error ? err.message : 'Failed to validate extensions'); }
}
