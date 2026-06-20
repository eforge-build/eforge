import type { AutoBuildState, FailedEnqueueInfo, FailedEnqueueRecoveryCommand, QueueItemWithCapabilities, RunInfo } from '../types.js';

export type FailedEnqueuesResponse = FailedEnqueueInfo[];

export interface FailedEnqueueReenqueueRequest {
  confirm: true;
}

export interface FailedEnqueueReenqueueResponse {
  enqueued: boolean;
  failedEnqueue: FailedEnqueueInfo;
  queue: QueueItemWithCapabilities[];
  runs: RunInfo[];
  newRunId?: string;
  disabledReason?: string;
  nextCommand?: FailedEnqueueRecoveryCommand;
  autoBuild?: AutoBuildState;
}
