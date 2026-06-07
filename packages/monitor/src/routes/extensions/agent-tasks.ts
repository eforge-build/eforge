import {
  API_ROUTES,
  buildPath,
  formatExtensionAgentTaskSchemaError,
  safeParseExtensionAgentTaskCancelRequest,
  safeParseExtensionAgentTaskStartRequest,
} from '@eforge-build/client';
import { defineRoute, type RequestContext, type RouteDefinition } from '../../http/router.js';
import { isRequestBodyTooLargeError, parseJsonBody } from '../../http/request.js';
import { sendJson, sendJsonError } from '../../http/response.js';
import { localMutation, localOnly, rejectCrossSiteBrowser } from '../../http/security.js';
import { AgentTaskServiceError, ExtensionAgentTaskService } from './agent-task-service.js';

export function createExtensionAgentTaskRoutes(service: ExtensionAgentTaskService): RouteDefinition[] {
  return [
    defineRoute({
      routeKey: 'extensionAgentTaskStart',
      method: 'POST',
      pattern: API_ROUTES.extensionAgentTaskStart,
      security: [localMutation('Extension agent task starts')],
      handler: (ctx) => handleStart(ctx, service),
    }),
    defineRoute({
      routeKey: 'extensionAgentTaskGet',
      method: 'GET',
      pattern: API_ROUTES.extensionAgentTaskGet,
      security: [localOnly('Extension agent task reads'), rejectCrossSiteBrowser('Extension agent task reads')],
      handler: (ctx) => handleGet(ctx, service),
    }),
    defineRoute({
      routeKey: 'extensionAgentTaskCancel',
      method: 'POST',
      pattern: API_ROUTES.extensionAgentTaskCancel,
      security: [localMutation('Extension agent task cancellation')],
      handler: (ctx) => handleCancel(ctx, service),
    }),
  ];
}

async function handleStart(ctx: RequestContext, service: ExtensionAgentTaskService): Promise<void> {
  if (!isJsonContentType(ctx.req.headers['content-type'])) {
    sendJsonError(ctx.res, 400, 'Content-Type must be application/json');
    return;
  }
  let raw: unknown;
  try {
    raw = await parseJsonBody(ctx.req);
  } catch (err) {
    sendJsonError(ctx.res, isRequestBodyTooLargeError(err) ? 413 : 400, isRequestBodyTooLargeError(err) ? 'Request body too large' : 'Invalid JSON body');
    return;
  }
  const parsed = safeParseExtensionAgentTaskStartRequest(raw);
  if (!parsed.success) {
    sendJsonError(ctx.res, 400, formatExtensionAgentTaskSchemaError(parsed) ?? 'Invalid task start request');
    return;
  }
  await sendServiceResult(ctx, () => service.start(parsed.data));
}

async function handleGet(ctx: RequestContext, service: ExtensionAgentTaskService): Promise<void> {
  await sendServiceResult(ctx, () => service.get(ctx.params.taskId ?? ''));
}

async function handleCancel(ctx: RequestContext, service: ExtensionAgentTaskService): Promise<void> {
  if (!isJsonContentType(ctx.req.headers['content-type'])) {
    sendJsonError(ctx.res, 400, 'Content-Type must be application/json');
    return;
  }
  let raw: unknown;
  try {
    raw = await parseJsonBody(ctx.req);
  } catch (err) {
    sendJsonError(ctx.res, isRequestBodyTooLargeError(err) ? 413 : 400, isRequestBodyTooLargeError(err) ? 'Request body too large' : 'Invalid JSON body');
    return;
  }
  const parsed = safeParseExtensionAgentTaskCancelRequest(raw);
  if (!parsed.success) {
    sendJsonError(ctx.res, 400, formatExtensionAgentTaskSchemaError(parsed) ?? 'Invalid task cancel request');
    return;
  }
  await sendServiceResult(ctx, () => service.cancel(ctx.params.taskId ?? '', parsed.data.reason));
}

async function sendServiceResult(ctx: RequestContext, fn: () => Promise<unknown>): Promise<void> {
  try {
    sendJson(ctx.res, await fn());
  } catch (err) {
    if (err instanceof AgentTaskServiceError) {
      sendJsonError(ctx.res, err.status, err.message);
      return;
    }
    sendJsonError(ctx.res, 500, err instanceof Error ? err.message : 'Extension agent task request failed');
  }
}

function isJsonContentType(value: string | string[] | undefined): boolean {
  const contentTypes = Array.isArray(value) ? value : value ? [value] : [];
  return contentTypes.some((contentType) => contentType.split(';', 1)[0]?.trim().toLowerCase() === 'application/json');
}

export function extensionAgentTaskPath(taskId: string): string {
  return buildPath(API_ROUTES.extensionAgentTaskGet, { taskId });
}
