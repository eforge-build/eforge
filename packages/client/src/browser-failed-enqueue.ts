import { API_ROUTES, buildPath } from './routes.js';
import type {
  FailedEnqueueDismissRequest,
  FailedEnqueueDismissResponse,
  FailedEnqueueReenqueueRequest,
  FailedEnqueueReenqueueResponse,
  FailedEnqueuesResponse,
} from './routes.js';

async function getJson<TResponse>(path: string, init?: RequestInit): Promise<TResponse> {
  const res = await fetch(path, { ...init, method: 'GET' });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed enqueue request failed (${res.status}): ${text}`);
  }
  return await res.json() as TResponse;
}

async function postJson<TResponse>(path: string, body: unknown, init?: RequestInit): Promise<TResponse> {
  const headers = new Headers(init?.headers);
  headers.set('Content-Type', 'application/json');
  const res = await fetch(path, { ...init, method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed enqueue request failed (${res.status}): ${text}`);
  }
  return await res.json() as TResponse;
}

export function fetchFailedEnqueues(init?: RequestInit): Promise<FailedEnqueuesResponse> {
  return getJson<FailedEnqueuesResponse>(API_ROUTES.failedEnqueues, init);
}

export function reenqueueFailedEnqueue(
  runId: string,
  body: FailedEnqueueReenqueueRequest,
  init?: RequestInit,
): Promise<FailedEnqueueReenqueueResponse> {
  return postJson<FailedEnqueueReenqueueResponse>(buildPath(API_ROUTES.failedEnqueueReenqueue, { runId }), body, init);
}

export function dismissFailedEnqueue(
  runId: string,
  body: FailedEnqueueDismissRequest,
  init?: RequestInit,
): Promise<FailedEnqueueDismissResponse> {
  return postJson<FailedEnqueueDismissResponse>(buildPath(API_ROUTES.failedEnqueueDismiss, { runId }), body, init);
}
