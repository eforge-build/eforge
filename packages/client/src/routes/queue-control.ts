/** Shared queue-control wire contract for daemon, Console, and client helpers. */

/**
 * Closed union of queue-control statuses shared by route handlers and clients.
 *
 * - `pending`  — root-queue PRD with no live lock.
 * - `running`  — root-queue PRD with a live lock (an owner process is building it).
 * - `waiting`  — PRD parked in `waiting/` pending an upstream dependency.
 * - `failed`   — PRD in `failed/`.
 * - `skipped`  — PRD in `skipped/`.
 * - `removed`  — terminal status returned after a successful removal.
 */
export type QueueControlStatus = 'pending' | 'running' | 'waiting' | 'failed' | 'skipped' | 'removed';

/** Request body for `POST /api/queue/:prdId/priority`. */
export interface QueuePriorityRequest {
  priority: number;
}

/** Response for a successful queue priority mutation. */
export interface QueuePriorityResponse {
  id: string;
  previousStatus: 'pending' | 'waiting';
  currentStatus: 'pending' | 'waiting';
  priority: number;
}

/**
 * Response for a successful queue removal.
 *
 * `removedSidecars` lists queue-relative paths that existed and were deleted,
 * such as `failed/<id>.recovery.json`.
 */
export interface QueueRemoveResponse {
  id: string;
  previousStatus: 'pending' | 'waiting' | 'failed' | 'skipped';
  currentStatus: 'removed';
  removedSidecars: string[];
}
