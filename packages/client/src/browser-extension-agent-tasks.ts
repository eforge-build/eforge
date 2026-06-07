import { API_ROUTES, buildPath } from './routes.js';
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
} from './extension-agent-tasks.js';

export async function startExtensionAgentTask(
  body: ExtensionAgentTaskStartRequest,
  init?: RequestInit,
): Promise<ExtensionAgentTaskStartResponse> {
  const json = await fetchJson(API_ROUTES.extensionAgentTaskStart, {
    ...init,
    method: 'POST',
    headers: jsonHeaders(init?.headers),
    body: JSON.stringify(body),
  }, 'start extension agent task');
  return parseExtensionAgentTaskStartResponse(json);
}

export async function getExtensionAgentTask(
  taskId: string,
  init?: RequestInit,
): Promise<ExtensionAgentTaskGetResponse> {
  assertExtensionAgentTaskId(taskId);
  const json = await fetchJson(
    buildPath(API_ROUTES.extensionAgentTaskGet, { taskId }),
    { ...init, method: 'GET' },
    'get extension agent task',
  );
  return parseExtensionAgentTaskGetResponse(json);
}

export async function cancelExtensionAgentTask(
  taskId: string,
  reason?: string,
  init?: RequestInit,
): Promise<ExtensionAgentTaskCancelResponse> {
  assertExtensionAgentTaskId(taskId);
  const body: ExtensionAgentTaskCancelRequest = reason !== undefined ? { reason } : {};
  const json = await fetchJson(
    buildPath(API_ROUTES.extensionAgentTaskCancel, { taskId }),
    {
      ...init,
      method: 'POST',
      headers: jsonHeaders(init?.headers),
      body: JSON.stringify(body),
    },
    'cancel extension agent task',
  );
  return parseExtensionAgentTaskCancelResponse(json);
}

async function fetchJson(path: string, init: RequestInit, label: string): Promise<unknown> {
  const res = await fetch(path, init);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Failed to ${label}: HTTP ${res.status} ${text}`);
  }
  return parseJsonText(text);
}

function jsonHeaders(initHeaders: HeadersInit | undefined): Headers {
  const headers = new Headers(initHeaders);
  headers.set('Content-Type', 'application/json');
  return headers;
}

function parseJsonText(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}
