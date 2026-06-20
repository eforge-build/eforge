/** Shared queue-control wire contract for daemon, Console, and client helpers. */

import type { AutoBuildState, QueueItemWithCapabilities } from '../types.js';

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

/** Request body for `POST /api/queue/:prdId/dependencies/override`. */
export interface QueueDependencyOverrideRequest {
  dependencyId: string;
  reason?: string;
}

/** Response for a successful queue priority mutation. */
export interface QueuePriorityResponse {
  id: string;
  previousStatus: 'pending' | 'waiting';
  currentStatus: 'pending' | 'waiting';
  priority: number;
  item?: QueueItemWithCapabilities;
  queue?: QueueItemWithCapabilities[];
  autoBuild?: AutoBuildState;
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
  item?: QueueItemWithCapabilities;
  queue?: QueueItemWithCapabilities[];
  autoBuild?: AutoBuildState;
}

/** Response for a successful queue dependency override. */
export interface QueueDependencyOverrideResponse {
  id: string;
  previousStatus: 'pending' | 'waiting';
  currentStatus: 'pending' | 'waiting';
  removedDependency: string;
  previousDependsOn: string[];
  currentDependsOn: string[];
  movedToQueueRoot: boolean;
  item?: QueueItemWithCapabilities;
  queue?: QueueItemWithCapabilities[];
  autoBuild?: AutoBuildState;
}

// --- eforge:region plan-01-client-contracts ---
export interface QueueHoldRequest {
  reason?: string;
}

export interface QueueHoldResponse {
  status: 'held' | 'already-held';
  item: QueueItemWithCapabilities;
  queue?: QueueItemWithCapabilities[];
  autoBuild?: AutoBuildState;
}

export type QueueUnholdRequest = Record<string, never>;

export interface QueueUnholdResponse {
  status: 'unheld' | 'already-unheld';
  item: QueueItemWithCapabilities;
  queue?: QueueItemWithCapabilities[];
  autoBuild?: AutoBuildState;
}

export type QueueControlLocation = 'queue' | 'waiting' | 'failed' | 'skipped';
export type QueueCascadeOperation = 'remove' | 'cancel';
export type QueueCascadeApplyResultStatus = QueueControlStatus | 'cancelled';
export type QueueCascadeStrategy = 'target-only' | 'cascade-dependents';
export type QueueCascadeEffect =
  | 'none'
  | 'target-remove'
  | 'target-cancel'
  | 'dependent-remove'
  | 'dependent-cancel'
  | 'dependent-skip'
  | 'refused';

export interface QueueCascadeRunningOwnership {
  owned: boolean;
  sessionId?: string;
  runId?: string;
  pid?: number;
  reason?: string;
}

export interface QueueCascadeAffectedItem {
  prdId: string;
  title: string;
  status: QueueControlStatus;
  location: QueueControlLocation;
  dependsOn: string[];
  depth: number;
  effect: QueueCascadeEffect;
  blockers: string[];
  runningOwnership?: QueueCascadeRunningOwnership;
}

export interface QueueCascadeExpectedAffected {
  token: string;
  prdIds: string[];
}

export interface QueueCascadePreviewRequest {
  operation: QueueCascadeOperation;
}

export interface QueueCascadePreviewResponse {
  target: QueueCascadeAffectedItem;
  dependents: QueueCascadeAffectedItem[];
  defaultRefusalReason?: string;
  safeStrategies: QueueCascadeStrategy[];
  warnings: string[];
  blockers: string[];
  expectedAffected: QueueCascadeExpectedAffected;
}

export interface QueueCascadeApplyRequest {
  operation: QueueCascadeOperation;
  strategy: QueueCascadeStrategy;
  expectedAffected: QueueCascadeExpectedAffected;
  confirmDependents: boolean;
}

export interface QueueCascadeApplyItemResult {
  prdId: string;
  previousStatus: QueueControlStatus;
  status: QueueCascadeApplyResultStatus;
  currentStatus?: QueueCascadeApplyResultStatus;
  reason?: string;
  sessionId?: string;
  removedSidecars?: string[];
}

export interface QueueCascadeApplyResponse {
  applied: boolean;
  operation: QueueCascadeOperation;
  strategy: QueueCascadeStrategy;
  target: QueueCascadeApplyItemResult;
  dependents: QueueCascadeApplyItemResult[];
  warnings: string[];
  blockers: string[];
  queue?: QueueItemWithCapabilities[];
  autoBuild?: AutoBuildState;
}
// --- eforge:endregion plan-01-client-contracts ---
