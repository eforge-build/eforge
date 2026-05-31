// --- eforge:region plan-01-queue-recovery-api-engine ---
/** Typed helpers for queue recovery daemon API endpoints. */

import { daemonRequest, daemonRequestIfRunning } from '../daemon-client.js';
import { API_ROUTES } from '../routes.js';
import type {
  QueueRecoveryAnalyzeRequest,
  QueueRecoveryAnalyzeResponse,
  QueueRecoveryApplyRequest,
  QueueRecoveryApplyResponse,
} from '../queue-recovery.js';

export function apiAnalyzeQueueRecovery(opts: { cwd: string; body: QueueRecoveryAnalyzeRequest }) {
  return daemonRequest<QueueRecoveryAnalyzeResponse>(
    opts.cwd,
    'POST',
    API_ROUTES.queueRecoveryAnalyze,
    opts.body,
  );
}

export function apiAnalyzeQueueRecoveryIfRunning(opts: { cwd: string; body: QueueRecoveryAnalyzeRequest }) {
  return daemonRequestIfRunning<QueueRecoveryAnalyzeResponse>(
    opts.cwd,
    'POST',
    API_ROUTES.queueRecoveryAnalyze,
    opts.body,
  );
}

export function apiApplyQueueRecovery(opts: { cwd: string; body: QueueRecoveryApplyRequest }) {
  return daemonRequest<QueueRecoveryApplyResponse>(
    opts.cwd,
    'POST',
    API_ROUTES.queueRecoveryApply,
    opts.body,
  );
}

export function apiApplyQueueRecoveryIfRunning(opts: { cwd: string; body: QueueRecoveryApplyRequest }) {
  return daemonRequestIfRunning<QueueRecoveryApplyResponse>(
    opts.cwd,
    'POST',
    API_ROUTES.queueRecoveryApply,
    opts.body,
  );
}
// --- eforge:endregion plan-01-queue-recovery-api-engine ---
