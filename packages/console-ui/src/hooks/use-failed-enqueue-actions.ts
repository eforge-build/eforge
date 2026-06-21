import * as React from 'react';
import { dismissFailedEnqueue, reenqueueFailedEnqueue, type FailedEnqueueInfo } from '@eforge-build/client/browser';

interface UseFailedEnqueueActionsInput {
  refreshQueue?: () => Promise<void> | void;
  refreshRuns?: () => Promise<void> | void;
  refreshFailedEnqueues?: () => Promise<void> | void;
}

type FailedEnqueueAction = 'reenqueue' | 'dismiss';

export function useFailedEnqueueActions({ refreshQueue, refreshRuns, refreshFailedEnqueues }: UseFailedEnqueueActionsInput) {
  const [pending, setPending] = React.useState<{ runId: string; action: FailedEnqueueAction } | null>(null);
  const [errorsByRunId, setErrorsByRunId] = React.useState<Record<string, string>>({});

  const reenqueue = React.useCallback(async (failedEnqueue: FailedEnqueueInfo) => {
    setPending({ runId: failedEnqueue.runId, action: 'reenqueue' });
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
      setPending(null);
    }
  }, [refreshFailedEnqueues, refreshQueue, refreshRuns]);

  const dismiss = React.useCallback(async (failedEnqueue: FailedEnqueueInfo) => {
    setPending({ runId: failedEnqueue.runId, action: 'dismiss' });
    setErrorsByRunId((errors) => ({ ...errors, [failedEnqueue.runId]: '' }));
    try {
      await dismissFailedEnqueue(failedEnqueue.runId, { confirm: true });
      setErrorsByRunId((errors) => {
        const next = { ...errors };
        delete next[failedEnqueue.runId];
        return next;
      });
      await Promise.all([refreshQueue?.(), refreshRuns?.(), refreshFailedEnqueues?.()]);
    } catch (err) {
      setErrorsByRunId((errors) => ({
        ...errors,
        [failedEnqueue.runId]: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      setPending(null);
    }
  }, [refreshFailedEnqueues, refreshQueue, refreshRuns]);

  return { pendingRunId: pending?.runId ?? null, pendingAction: pending?.action ?? null, errorsByRunId, reenqueue, dismiss };
}
