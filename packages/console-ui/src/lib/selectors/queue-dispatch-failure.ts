import type { QueueItem } from '@eforge-build/client/browser';

export function formatQueueDispatchFailure(failure: QueueItem['dispatchFailure']): string | null {
  if (!failure) return null;
  return `Dispatch blocked before session:start (${failure.stage}): ${failure.reason}`;
}

export function formatQueueDispatchFailureTimestamp(failure: QueueItem['dispatchFailure']): string | null {
  if (!failure?.timestamp) return null;
  const millis = Date.parse(failure.timestamp);
  if (!Number.isFinite(millis)) return failure.timestamp;
  return new Date(millis).toLocaleString();
}
