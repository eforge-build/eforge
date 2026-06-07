import { daemonRequest, daemonRequestIfRunning } from '../daemon-client.js';
import { API_ROUTES, buildPath } from '../routes.js';
import {
  assertExtensionAgentTaskId,
  parseExtensionAgentTaskCancelResponse,
  parseExtensionAgentTaskGetResponse,
  parseExtensionAgentTaskStartResponse,
  type ExtensionAgentTaskCancelRequest,
  type ExtensionAgentTaskCancelResponse,
  type ExtensionAgentTaskGetResponse,
  type ExtensionAgentTaskStartRequest,
  type ExtensionAgentTaskStartResponse,
} from '../extension-agent-tasks.js';

export type {
  ExtensionAgentTaskCancelRequest,
  ExtensionAgentTaskCancelResponse,
  ExtensionAgentTaskGetResponse,
  ExtensionAgentTaskStartRequest,
  ExtensionAgentTaskStartResponse,
} from '../extension-agent-tasks.js';

export async function apiStartExtensionAgentTask(opts: {
  cwd: string;
  body: ExtensionAgentTaskStartRequest;
}): Promise<{ data: ExtensionAgentTaskStartResponse; port: number }> {
  const { data, port } = await daemonRequest<unknown>(
    opts.cwd,
    'POST',
    API_ROUTES.extensionAgentTaskStart,
    opts.body,
  );
  return { data: parseExtensionAgentTaskStartResponse(data), port };
}

export async function apiStartExtensionAgentTaskIfRunning(opts: {
  cwd: string;
  body: ExtensionAgentTaskStartRequest;
}): Promise<{ data: ExtensionAgentTaskStartResponse; port: number } | null> {
  const result = await daemonRequestIfRunning<unknown>(
    opts.cwd,
    'POST',
    API_ROUTES.extensionAgentTaskStart,
    opts.body,
  );
  return result ? { data: parseExtensionAgentTaskStartResponse(result.data), port: result.port } : null;
}

export async function apiGetExtensionAgentTask(opts: {
  cwd: string;
  taskId: string;
}): Promise<{ data: ExtensionAgentTaskGetResponse; port: number }> {
  assertExtensionAgentTaskId(opts.taskId);
  const { data, port } = await daemonRequest<unknown>(
    opts.cwd,
    'GET',
    buildPath(API_ROUTES.extensionAgentTaskGet, { taskId: opts.taskId }),
  );
  return { data: parseExtensionAgentTaskGetResponse(data), port };
}

export async function apiGetExtensionAgentTaskIfRunning(opts: {
  cwd: string;
  taskId: string;
}): Promise<{ data: ExtensionAgentTaskGetResponse; port: number } | null> {
  assertExtensionAgentTaskId(opts.taskId);
  const result = await daemonRequestIfRunning<unknown>(
    opts.cwd,
    'GET',
    buildPath(API_ROUTES.extensionAgentTaskGet, { taskId: opts.taskId }),
  );
  return result ? { data: parseExtensionAgentTaskGetResponse(result.data), port: result.port } : null;
}

export async function apiCancelExtensionAgentTask(opts: {
  cwd: string;
  taskId: string;
  reason?: string;
}): Promise<{ data: ExtensionAgentTaskCancelResponse; port: number }> {
  assertExtensionAgentTaskId(opts.taskId);
  const body: ExtensionAgentTaskCancelRequest = opts.reason !== undefined ? { reason: opts.reason } : {};
  const { data, port } = await daemonRequest<unknown>(
    opts.cwd,
    'POST',
    buildPath(API_ROUTES.extensionAgentTaskCancel, { taskId: opts.taskId }),
    body,
  );
  return { data: parseExtensionAgentTaskCancelResponse(data), port };
}

export async function apiCancelExtensionAgentTaskIfRunning(opts: {
  cwd: string;
  taskId: string;
  reason?: string;
}): Promise<{ data: ExtensionAgentTaskCancelResponse; port: number } | null> {
  assertExtensionAgentTaskId(opts.taskId);
  const body: ExtensionAgentTaskCancelRequest = opts.reason !== undefined ? { reason: opts.reason } : {};
  const result = await daemonRequestIfRunning<unknown>(
    opts.cwd,
    'POST',
    buildPath(API_ROUTES.extensionAgentTaskCancel, { taskId: opts.taskId }),
    body,
  );
  return result ? { data: parseExtensionAgentTaskCancelResponse(result.data), port: result.port } : null;
}
