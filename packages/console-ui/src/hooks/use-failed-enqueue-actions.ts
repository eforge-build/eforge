import * as React from 'react';
import { reenqueueFailedEnqueue, type FailedEnqueueInfo } from '@eforge-build/client/browser';

interface UseFailedEnqueueActionsInput {
  refreshQueue?: () => Promise<void> | void;
  refreshRuns?: () => Promise<void> | void;
  refreshFailedEnqueues?: () => Promise<void> | void;
}

export function useFailedEnqueueActions({ refreshQueue, refreshRuns, refreshFailedEnqueues }: UseFailedEnqueueActionsInput) {
  const [pendingRunId, setPendingRunId] = React.useState<string | null>(null);
  const [errorsByRunId, setErrorsByRunId] = React.useState<Record<string, string>>({});

  const reenqueue = React.useCallback(async (failedEnqueue: FailedEnqueueInfo) => {
    setPendingRunId(failedEnqueue.runId);
    setErrorsByRunId((errors) => ({ ...errors, [failedEnqueue.runId]: '' }));
    try {
      const response = await reenqueueFailedEnqueue(failedEnqueue.runId, { confirm: true });
      if (response.enqueued === true) {
        setErrorsByRunId((errors) => {
          const next = { ...errors };
          delete next[failedEnqueue.runId];
          return next;
        });
        await Promise.all([refreshQueue?.(), refreshRuns?.(), refreshFailedEnqueues?.()]);
      } else {
        setErrorsByRunId((errors) => ({
          ...errors,
          [failedEnqueue.runId]: response.disabledReason ?? 'Re-enqueue was not accepted by the daemon.',
        }));
        await refreshFailedEnqueues?.();
      }
    } catch (err) {
      setErrorsByRunId((errors) => ({
        ...errors,
        [failedEnqueue.runId]: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      setPendingRunId(null);
    }
  }, [refreshFailedEnqueues, refreshQueue, refreshRuns]);

  return { pendingRunId, errorsByRunId, reenqueue };
}
