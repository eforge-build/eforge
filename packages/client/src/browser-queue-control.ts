/** Browser-safe fetch helpers for queue-control routes. */

import { API_ROUTES, buildPath } from './routes.js';
import type {
  QueuePriorityRequest,
  QueuePriorityResponse,
  QueueRemoveResponse,
  QueueDependencyOverrideRequest,
  QueueDependencyOverrideResponse,
  QueueHoldRequest,
  QueueHoldResponse,
  QueueUnholdRequest,
  QueueUnholdResponse,
  QueueCascadePreviewRequest,
  QueueCascadePreviewResponse,
  QueueCascadeApplyRequest,
  QueueCascadeApplyResponse,
} from './routes/queue-control.js';

async function postJson<TResponse>(path: string, body: unknown, errorLabel: string, init?: RequestInit): Promise<TResponse> {
  const headers = new Headers(init?.headers);
  headers.set('Content-Type', 'application/json');
  const res = await fetch(path, {
    ...init,
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${errorLabel} request failed (${res.status}): ${text}`);
  }
  return await res.json() as TResponse;
}

export async function updateQueuePriority(
  prdId: string,
  body: QueuePriorityRequest,
  init?: RequestInit,
): Promise<QueuePriorityResponse> {
  return postJson<QueuePriorityResponse>(buildPath(API_ROUTES.queuePriority, { prdId }), body, 'Queue priority', init);
}

export async function overrideQueueDependency(
  prdId: string,
  body: QueueDependencyOverrideRequest,
  init?: RequestInit,
): Promise<QueueDependencyOverrideResponse> {
  return postJson<QueueDependencyOverrideResponse>(buildPath(API_ROUTES.queueDependencyOverride, { prdId }), body, 'Queue dependency override', init);
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

export function holdQueueItem(
  prdId: string,
  body: QueueHoldRequest = {},
  init?: RequestInit,
): Promise<QueueHoldResponse> {
  return postJson<QueueHoldResponse>(buildPath(API_ROUTES.queueHold, { prdId }), body, 'Queue hold', init);
}

export function unholdQueueItem(
  prdId: string,
  body: QueueUnholdRequest = {},
  init?: RequestInit,
): Promise<QueueUnholdResponse> {
  return postJson<QueueUnholdResponse>(buildPath(API_ROUTES.queueUnhold, { prdId }), body, 'Queue unhold', init);
}

export function previewQueueCascade(
  prdId: string,
  body: QueueCascadePreviewRequest,
  init?: RequestInit,
): Promise<QueueCascadePreviewResponse> {
  return postJson<QueueCascadePreviewResponse>(buildPath(API_ROUTES.queueCascadePreview, { prdId }), body, 'Queue cascade preview', init);
}

export function applyQueueCascade(
  prdId: string,
  body: QueueCascadeApplyRequest,
  init?: RequestInit,
): Promise<QueueCascadeApplyResponse> {
  return postJson<QueueCascadeApplyResponse>(buildPath(API_ROUTES.queueCascadeApply, { prdId }), body, 'Queue cascade apply', init);
}
