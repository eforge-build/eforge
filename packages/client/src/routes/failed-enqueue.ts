import type { AutoBuildState, FailedEnqueueInfo, FailedEnqueueRecoveryCommand, QueueItem, RunInfo } from '../types.js';

export type FailedEnqueuesResponse = FailedEnqueueInfo[];

export interface FailedEnqueueReenqueueRequest {
  confirm: true;
}

export interface FailedEnqueueReenqueueResponse {
  enqueued: boolean;
  failedEnqueue: FailedEnqueueInfo;
  queue: QueueItem[];
  runs: RunInfo[];
  newRunId?: string;
  disabledReason?: string;
  nextCommand?: FailedEnqueueRecoveryCommand;
  autoBuild?: AutoBuildState;
}
