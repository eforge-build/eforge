// --- eforge:region plan-01-queue-recovery-api-engine ---
/** Browser-safe fetch helpers for queue recovery routes. */

import { API_ROUTES } from './routes.js';
import type {
  QueueRecoveryAnalyzeRequest,
  QueueRecoveryAnalyzeResponse,
  QueueRecoveryApplyRequest,
  QueueRecoveryApplyResponse,
} from './queue-recovery.js';

async function postJson<TResponse>(path: string, body: unknown, init?: RequestInit): Promise<TResponse> {
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
    throw new Error(`Queue recovery request failed (${res.status}): ${text}`);
  }
  return await res.json() as TResponse;
}

export function fetchQueueRecoveryAnalysis(
  body: QueueRecoveryAnalyzeRequest,
  init?: RequestInit,
): Promise<QueueRecoveryAnalyzeResponse> {
  return postJson<QueueRecoveryAnalyzeResponse>(API_ROUTES.queueRecoveryAnalyze, body, init);
}

export function applyQueueRecovery(
  body: QueueRecoveryApplyRequest,
  init?: RequestInit,
): Promise<QueueRecoveryApplyResponse> {
  return postJson<QueueRecoveryApplyResponse>(API_ROUTES.queueRecoveryApply, body, init);
}
// --- eforge:endregion plan-01-queue-recovery-api-engine ---
