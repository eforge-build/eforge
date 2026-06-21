import type { AutoBuildState, FailedEnqueueInfo, FailedEnqueueRecoveryCommand, QueueItemWithCapabilities, RunInfo } from '../types.js';

export type FailedEnqueuesResponse = FailedEnqueueInfo[];

export interface FailedEnqueueReenqueueRequest {
  confirm: true;
}

export interface FailedEnqueueDismissRequest {
  confirm: true;
}

interface FailedEnqueueReenqueueResponseBase {
  failedEnqueue: FailedEnqueueInfo;
  queue: QueueItemWithCapabilities[];
  runs: RunInfo[];
  autoBuild?: AutoBuildState;
}

export type FailedEnqueueReenqueueResponse = FailedEnqueueReenqueueResponseBase & (
  | {
    enqueued: true;
    spawnedSessionId: string;
  }
  | {
    enqueued: false;
    disabledReason: string;
    nextCommand?: FailedEnqueueRecoveryCommand;
  }
);

export interface FailedEnqueueDismissResponse {
  dismissed: true;
  failedEnqueue: FailedEnqueueInfo;
  queue: QueueItemWithCapabilities[];
  runs: RunInfo[];
  autoBuild?: AutoBuildState;
}
