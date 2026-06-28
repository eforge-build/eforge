import * as React from 'react';
import {
  applyQueueCascade,
  holdQueueItem,
  overrideQueueDependency,
  previewQueueCascade,
  unholdQueueItem,
  updateQueuePriority,
  type QueueCascadeApplyRequest,
  type QueueCascadeOperation,
} from '@eforge-build/client/browser';

interface UseQueueControlActionsInput {
  refreshQueue?: () => Promise<void> | void;
  refreshRuns?: () => Promise<void> | void;
}

export function useQueueControlActions({ refreshQueue, refreshRuns }: UseQueueControlActionsInput) {
  const setPriority = React.useCallback(async (id: string, priority: number) => {
    await updateQueuePriority(id, { priority });
    await refreshQueue?.();
  }, [refreshQueue]);

  const overrideDependency = React.useCallback(async (id: string, dependencyId: string, reason?: string) => {
    await overrideQueueDependency(id, { dependencyId, reason });
    await refreshQueue?.();
  }, [refreshQueue]);

  const hold = React.useCallback(async (id: string, reason?: string) => {
    await holdQueueItem(id, { ...(reason ? { reason } : {}) });
    await refreshQueue?.();
  }, [refreshQueue]);

  const unhold = React.useCallback(async (id: string) => {
    await unholdQueueItem(id, {});
    await refreshQueue?.();
  }, [refreshQueue]);

  const previewCascade = React.useCallback((id: string, operation: QueueCascadeOperation) => {
    return previewQueueCascade(id, { operation });
  }, []);

  const applyCascade = React.useCallback(async (id: string, request: QueueCascadeApplyRequest) => {
    const response = await applyQueueCascade(id, request);
    if (response.applied === true) {
      await refreshQueue?.();
      if (request.operation === 'remove' || request.operation === 'cancel') await refreshRuns?.();
    }
    return response;
  }, [refreshQueue, refreshRuns]);

  return { setPriority, overrideDependency, hold, unhold, previewCascade, applyCascade };
}
