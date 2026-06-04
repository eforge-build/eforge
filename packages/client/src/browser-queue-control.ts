/** Browser-safe fetch helpers for queue-control routes. */

import { API_ROUTES, buildPath } from './routes.js';
import type {
  QueuePriorityRequest,
  QueuePriorityResponse,
  QueueRemoveResponse,
} from './routes/queue-control.js';

export async function updateQueuePriority(
  prdId: string,
  body: QueuePriorityRequest,
  init?: RequestInit,
): Promise<QueuePriorityResponse> {
  const headers = new Headers(init?.headers);
  headers.set('Content-Type', 'application/json');
  const res = await fetch(buildPath(API_ROUTES.queuePriority, { prdId }), {
    ...init,
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Queue priority request failed (${res.status}): ${text}`);
  }
  return await res.json() as QueuePriorityResponse;
}

export async function removeQueueItem(
  prdId: string,
  init?: RequestInit,
): Promise<QueueRemoveResponse> {
  // Strip any caller-supplied body: queue removal is always a no-body DELETE.
  const { body: _body, ...rest } = init ?? {};
  const res = await fetch(buildPath(API_ROUTES.queueRemove, { prdId }), {
    ...rest,
    method: 'DELETE',
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Queue removal request failed (${res.status}): ${text}`);
  }
  return await res.json() as QueueRemoveResponse;
}
