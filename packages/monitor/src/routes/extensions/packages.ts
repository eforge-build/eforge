import { API_ROUTES, type ExtensionDemoteRequest, type ExtensionInstallRequest, type ExtensionPromoteRequest, type ExtensionRemoveRequest, type ExtensionUpdateRequest } from '@eforge-build/client';
import type { MonitorContext } from '../../context.js';
import { defineRoute, type ApiRouteKey, type RouteDefinition } from '../../http/router.js';
import { isRequestBodyTooLargeError, parseJsonBody } from '../../http/request.js';
import { sendJson, sendJsonError } from '../../http/response.js';
import { localMutation } from '../../http/security.js';
import { isPlainObject, EXTENSION_NAME_RE, validateBooleanField, validateStringField, validateExtensionPackageTargetBody } from './validation.js';
import { ExtensionPackageError, demotePackage, installPackage, promotePackage, removePackage, updatePackage } from './package-service.js';

export function createExtensionPackageRoutes(context: MonitorContext): RouteDefinition[] {
  const security = [localMutation('Extension management mutations')];
  return [
    route('extensionInstall', (b) => validateInstall(b), (b) => installPackage(context.cwd!, b as unknown as ExtensionInstallRequest)),
    route('extensionUpdate', (b) => validateExtensionPackageTargetBody(b, { allowTrust: true, allowVersion: true }), (b) => updatePackage(context.cwd!, b as unknown as ExtensionUpdateRequest)),
    route('extensionRemove', (b) => validateExtensionPackageTargetBody(b, { allowForce: true }), (b) => removePackage(context.cwd!, b as unknown as ExtensionRemoveRequest)),
    route('extensionPromote', (b) => validateExtensionPackageTargetBody(b, { allowForce: true, allowTrust: true }), (b) => promotePackage(context.cwd!, b as unknown as ExtensionPromoteRequest)),
    route('extensionDemote', (b) => validateExtensionPackageTargetBody(b, { allowForce: true }), (b) => demotePackage(context.cwd!, b as unknown as ExtensionDemoteRequest)),
  ];
  function route(routeKey: ApiRouteKey, validate: (b: Record<string, unknown>) => string | undefined, run: (b: Record<string, unknown>) => Promise<unknown>): RouteDefinition {
    return defineRoute({ routeKey, method: 'POST', pattern: API_ROUTES[routeKey], security, handler: async (ctx) => {
      if (!context.cwd) return sendJsonError(ctx.res, 503, 'Working directory not configured');
      let body: Record<string, unknown>;
      try { const raw = await parseJsonBody(ctx.req); if (!isPlainObject(raw)) return sendJsonError(ctx.res, 400, 'Invalid JSON body'); body = raw; } catch (err) { return sendJsonError(ctx.res, isRequestBodyTooLargeError(err) ? 413 : 400, isRequestBodyTooLargeError(err) ? 'Request body too large' : 'Invalid JSON body'); }
      const error = validate(body); if (error) return sendJsonError(ctx.res, 400, error);
      try { sendJson(ctx.res, await run(body)); } catch (err) { sendJsonError(ctx.res, err instanceof ExtensionPackageError ? err.statusCode : 500, err instanceof Error ? err.message : fallback(routeKey)); }
    } });
  }
}
function validateInstall(body: Record<string, unknown>): string | undefined {
  if (typeof body.source !== 'string' || body.source.length === 0) return 'Missing required field: source';
  if (body.scope !== undefined && !['local', 'project', 'user'].includes(body.scope as string)) return 'Invalid scope. Supported: local, project, user';
  if (body.name !== undefined && (typeof body.name !== 'string' || !EXTENSION_NAME_RE.test(body.name))) return 'Invalid extension name';
  return validateBooleanField(body, 'force') ?? validateBooleanField(body, 'trust') ?? validateStringField(body, 'trustedBy');
}
function fallback(routeKey: ApiRouteKey): string { return `Failed to ${String(routeKey).replace('extension', '').toLowerCase()} extension`; }
