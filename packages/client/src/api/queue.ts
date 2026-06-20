/**
 * Typed helpers for queue-related daemon API endpoints.
 */

import { daemonRequest, daemonRequestIfRunning } from '../daemon-client.js';

import { API_ROUTES, buildPath } from '../routes.js';
import type {
  EnqueueResponse,
  CancelResponse,
  QueueItem,
  RunInfo,
  RunSummary,
  RunState,
  PlansResponse,
  DiffResponse,
  SessionMetadata,
} from '../types.js';
import type {
  EnqueueRequest,
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
} from '../routes.js';

export function apiEnqueue(opts: { cwd: string; body: EnqueueRequest }) {
  return daemonRequest<EnqueueResponse>(opts.cwd, 'POST', API_ROUTES.enqueue, opts.body);
}

export function apiEnqueueIfRunning(opts: { cwd: string; body: EnqueueRequest }) {
  return daemonRequestIfRunning<EnqueueResponse>(opts.cwd, 'POST', API_ROUTES.enqueue, opts.body);
}

export function apiCancel(opts: { cwd: string; sessionId: string }) {
  return daemonRequest<CancelResponse>(
    opts.cwd,
    'POST',
    buildPath(API_ROUTES.cancel, { sessionId: opts.sessionId }),
  );
}

export function apiCancelIfRunning(opts: { cwd: string; sessionId: string }) {
  return daemonRequestIfRunning<CancelResponse>(
    opts.cwd,
    'POST',
    buildPath(API_ROUTES.cancel, { sessionId: opts.sessionId }),
  );
}

export function apiGetQueue(opts: { cwd: string }) {
  return daemonRequest<QueueItem[]>(opts.cwd, 'GET', API_ROUTES.queue);
}

export function apiGetQueueIfRunning(opts: { cwd: string }) {
  return daemonRequestIfRunning<QueueItem[]>(opts.cwd, 'GET', API_ROUTES.queue);
}

export function apiUpdateQueuePriority(opts: { cwd: string; prdId: string; priority: number }) {
  return daemonRequest<QueuePriorityResponse>(
    opts.cwd,
    'POST',
    buildPath(API_ROUTES.queuePriority, { prdId: opts.prdId }),
    { priority: opts.priority } satisfies QueuePriorityRequest,
  );
}

export function apiUpdateQueuePriorityIfRunning(opts: { cwd: string; prdId: string; priority: number }) {
  return daemonRequestIfRunning<QueuePriorityResponse>(
    opts.cwd,
    'POST',
    buildPath(API_ROUTES.queuePriority, { prdId: opts.prdId }),
    { priority: opts.priority } satisfies QueuePriorityRequest,
  );
}

export function apiRemoveQueueItem(opts: { cwd: string; prdId: string }) {
  return daemonRequest<QueueRemoveResponse>(
    opts.cwd,
    'DELETE',
    buildPath(API_ROUTES.queueRemove, { prdId: opts.prdId }),
  );
}

export function apiRemoveQueueItemIfRunning(opts: { cwd: string; prdId: string }) {
  return daemonRequestIfRunning<QueueRemoveResponse>(
    opts.cwd,
    'DELETE',
    buildPath(API_ROUTES.queueRemove, { prdId: opts.prdId }),
  );
}

export function apiOverrideQueueDependency(opts: { cwd: string; prdId: string; body: QueueDependencyOverrideRequest }) {
  return daemonRequest<QueueDependencyOverrideResponse>(
    opts.cwd,
    'POST',
    buildPath(API_ROUTES.queueDependencyOverride, { prdId: opts.prdId }),
    opts.body,
  );
}

export function apiOverrideQueueDependencyIfRunning(opts: { cwd: string; prdId: string; body: QueueDependencyOverrideRequest }) {
  return daemonRequestIfRunning<QueueDependencyOverrideResponse>(
    opts.cwd,
    'POST',
    buildPath(API_ROUTES.queueDependencyOverride, { prdId: opts.prdId }),
    opts.body,
  );
}


// --- eforge:region plan-01-client-contracts ---
export function apiHoldQueueItem(opts: { cwd: string; prdId: string; body?: QueueHoldRequest }) {
  return daemonRequest<QueueHoldResponse>(
    opts.cwd,
    'POST',
    buildPath(API_ROUTES.queueHold, { prdId: opts.prdId }),
    opts.body ?? {},
  );
}

export function apiHoldQueueItemIfRunning(opts: { cwd: string; prdId: string; body?: QueueHoldRequest }) {
  return daemonRequestIfRunning<QueueHoldResponse>(
    opts.cwd,
    'POST',
    buildPath(API_ROUTES.queueHold, { prdId: opts.prdId }),
    opts.body ?? {},
  );
}

export function apiUnholdQueueItem(opts: { cwd: string; prdId: string; body?: QueueUnholdRequest }) {
  return daemonRequest<QueueUnholdResponse>(
    opts.cwd,
    'POST',
    buildPath(API_ROUTES.queueUnhold, { prdId: opts.prdId }),
    opts.body ?? {},
  );
}

export function apiUnholdQueueItemIfRunning(opts: { cwd: string; prdId: string; body?: QueueUnholdRequest }) {
  return daemonRequestIfRunning<QueueUnholdResponse>(
    opts.cwd,
    'POST',
    buildPath(API_ROUTES.queueUnhold, { prdId: opts.prdId }),
    opts.body ?? {},
  );
}

export function apiPreviewQueueCascade(opts: { cwd: string; prdId: string; body: QueueCascadePreviewRequest }) {
  return daemonRequest<QueueCascadePreviewResponse>(
    opts.cwd,
    'POST',
    buildPath(API_ROUTES.queueCascadePreview, { prdId: opts.prdId }),
    opts.body,
  );
}

export function apiPreviewQueueCascadeIfRunning(opts: { cwd: string; prdId: string; body: QueueCascadePreviewRequest }) {
  return daemonRequestIfRunning<QueueCascadePreviewResponse>(
    opts.cwd,
    'POST',
    buildPath(API_ROUTES.queueCascadePreview, { prdId: opts.prdId }),
    opts.body,
  );
}

export function apiApplyQueueCascade(opts: { cwd: string; prdId: string; body: QueueCascadeApplyRequest }) {
  return daemonRequest<QueueCascadeApplyResponse>(
    opts.cwd,
    'POST',
    buildPath(API_ROUTES.queueCascadeApply, { prdId: opts.prdId }),
    opts.body,
  );
}

export function apiApplyQueueCascadeIfRunning(opts: { cwd: string; prdId: string; body: QueueCascadeApplyRequest }) {
  return daemonRequestIfRunning<QueueCascadeApplyResponse>(
    opts.cwd,
    'POST',
    buildPath(API_ROUTES.queueCascadeApply, { prdId: opts.prdId }),
    opts.body,
  );
}
// --- eforge:endregion plan-01-client-contracts ---

export function apiGetRuns(opts: { cwd: string }) {
  return daemonRequest<RunInfo[]>(opts.cwd, 'GET', API_ROUTES.runs);
}

export function apiGetRunsIfRunning(opts: { cwd: string }) {
  return daemonRequestIfRunning<RunInfo[]>(opts.cwd, 'GET', API_ROUTES.runs);
}

export function apiGetRunSummary(opts: { cwd: string; id: string }) {
  return daemonRequest<RunSummary>(
    opts.cwd,
    'GET',
    buildPath(API_ROUTES.runSummary, { id: opts.id }),
  );
}

export function apiGetRunSummaryIfRunning(opts: { cwd: string; id: string }) {
  return daemonRequestIfRunning<RunSummary>(
    opts.cwd,
    'GET',
    buildPath(API_ROUTES.runSummary, { id: opts.id }),
  );
}

export function apiGetRunState(opts: { cwd: string; id: string }) {
  return daemonRequest<RunState>(
    opts.cwd,
    'GET',
    buildPath(API_ROUTES.runState, { id: opts.id }),
  );
}

export function apiGetRunStateIfRunning(opts: { cwd: string; id: string }) {
  return daemonRequestIfRunning<RunState>(
    opts.cwd,
    'GET',
    buildPath(API_ROUTES.runState, { id: opts.id }),
  );
}

export function apiGetPlans(opts: { cwd: string; runId: string }) {
  return daemonRequest<PlansResponse>(
    opts.cwd,
    'GET',
    buildPath(API_ROUTES.plans, { runId: opts.runId }),
  );
}

export function apiGetPlansIfRunning(opts: { cwd: string; runId: string }) {
  return daemonRequestIfRunning<PlansResponse>(
    opts.cwd,
    'GET',
    buildPath(API_ROUTES.plans, { runId: opts.runId }),
  );
}

export function apiGetDiff(opts: { cwd: string; sessionId: string; planId: string; file?: string }) {
  const base = buildPath(API_ROUTES.diff, { sessionId: opts.sessionId, planId: opts.planId });
  const path = opts.file !== undefined ? `${base}?file=${encodeURIComponent(opts.file)}` : base;
  return daemonRequest<DiffResponse>(opts.cwd, 'GET', path);
}

export function apiGetDiffIfRunning(opts: { cwd: string; sessionId: string; planId: string; file?: string }) {
  const base = buildPath(API_ROUTES.diff, { sessionId: opts.sessionId, planId: opts.planId });
  const path = opts.file !== undefined ? `${base}?file=${encodeURIComponent(opts.file)}` : base;
  return daemonRequestIfRunning<DiffResponse>(opts.cwd, 'GET', path);
}

export function apiGetSessionMetadata(opts: { cwd: string }) {
  return daemonRequest<Record<string, SessionMetadata>>(opts.cwd, 'GET', API_ROUTES.sessionMetadata);
}

export function apiGetSessionMetadataIfRunning(opts: { cwd: string }) {
  return daemonRequestIfRunning<Record<string, SessionMetadata>>(opts.cwd, 'GET', API_ROUTES.sessionMetadata);
}

/**
 * Fetch the latest run by querying GET /api/runs and returning the first entry.
 * Runs are sorted by started_at DESC so index 0 is the most recent.
 * Returns null when no runs exist.
 */
export async function apiGetLatestRunFromRuns(opts: { cwd: string }): Promise<RunInfo | null> {
  const { data } = await daemonRequest<RunInfo[]>(opts.cwd, 'GET', API_ROUTES.runs);
  return data[0] ?? null;
}

/**
 * Like apiGetLatestRunFromRuns but returns null when no daemon is running.
 * Also returns null when the daemon is running but no runs exist.
 */
export async function apiGetLatestRunFromRunsIfRunning(opts: { cwd: string }): Promise<RunInfo | null> {
  const result = await daemonRequestIfRunning<RunInfo[]>(opts.cwd, 'GET', API_ROUTES.runs);
  if (result === null) return null;
  return result.data[0] ?? null;
}

/**
 * Fetch all currently running sessions.
 * Filters /api/runs to status === 'running' with a valid sessionId.
 * Dedupes by sessionId keeping the first occurrence (newest, since runs are
 * sorted started_at DESC — one session may have multiple rows after recovery/retry).
 */
export async function apiGetRunningRuns(opts: { cwd: string }): Promise<{ data: RunInfo[]; port: number }> {
  const { data, port } = await daemonRequest<RunInfo[]>(opts.cwd, 'GET', API_ROUTES.runs);
  const filtered = data
    .filter((r) => r.status === 'running' && r.sessionId !== undefined)
    .filter((r, i, arr) => arr.findIndex((x) => x.sessionId === r.sessionId) === i);
  return { data: filtered, port };
}

/**
 * Like apiGetRunningRuns but returns null when no daemon is running.
 */
export async function apiGetRunningRunsIfRunning(
  opts: { cwd: string },
): Promise<{ data: RunInfo[]; port: number } | null> {
  const result = await daemonRequestIfRunning<RunInfo[]>(opts.cwd, 'GET', API_ROUTES.runs);
  if (result === null) return null;
  const filtered = result.data
    .filter((r) => r.status === 'running' && r.sessionId !== undefined)
    .filter((r, i, arr) => arr.findIndex((x) => x.sessionId === r.sessionId) === i);
  return { data: filtered, port: result.port };
}

/**
 * Fetch all currently running session summaries.
 * Calls apiGetRunningRuns, then fetches RunSummary for each in parallel via
 * Promise.allSettled. Drops rejected entries silently (transient errors should
 * not blank the full status). Preserves input run order.
 */
export async function apiGetRunningSessionSummaries(opts: { cwd: string }): Promise<Array<{ run: RunInfo; summary: RunSummary }>> {
  const { data: runs } = await apiGetRunningRuns(opts);
  const results = await Promise.allSettled(
    runs.map(async (run) => {
      const { data: summary } = await apiGetRunSummary({ cwd: opts.cwd, id: run.sessionId! });
      return { run, summary };
    }),
  );
  return results
    .filter((r): r is PromiseFulfilledResult<{ run: RunInfo; summary: RunSummary }> => r.status === 'fulfilled')
    .map((r) => r.value);
}

/**
 * Like apiGetRunningSessionSummaries but returns null when no daemon is running.
 * Fetches summaries via apiGetRunSummaryIfRunning; silently drops any that fail
 * (transient errors should not blank the full status). Returns null only when
 * the daemon is not running at all.
 */
export async function apiGetRunningSessionSummariesIfRunning(
  opts: { cwd: string },
): Promise<Array<{ run: RunInfo; summary: RunSummary }> | null> {
  const runsResult = await apiGetRunningRunsIfRunning(opts);
  if (runsResult === null) return null;
  const results = await Promise.allSettled(
    runsResult.data.map(async (run) => {
      const summaryResult = await apiGetRunSummaryIfRunning({ cwd: opts.cwd, id: run.sessionId! });
      if (summaryResult === null) throw new Error('Daemon stopped mid-request');
      return { run, summary: summaryResult.data };
    }),
  );
  return results
    .filter((r): r is PromiseFulfilledResult<{ run: RunInfo; summary: RunSummary }> => r.status === 'fulfilled')
    .map((r) => r.value);
}
