import type { AutoBuildState, QueueItemCapabilities, QueueItemWithCapabilities, RunInfo, SessionMetadata } from '@eforge-build/client';
import { deriveQueueCapabilitiesForSnapshot } from '@eforge-build/engine/queue/capabilities';
import { resolveRunningPrdOwnership } from '@eforge-build/engine/queue/cancellation';
import { loadQueueControlSnapshot } from '@eforge-build/engine/queue/snapshot';
import type { MonitorContext } from '../context.js';
import { autoBuildStateToWire } from './auto-build-state.js';
import { projectFailedEnqueues } from './failed-enqueues.js';
import { overlayQueueDispatchFailures } from './queue-dispatch-failures.js';
import { loadQueueItems } from './queue-items.js';
import { projectRunsForAcceptedSuccess } from './runs.js';

export async function projectQueueForContext(context: MonitorContext): Promise<QueueItemWithCapabilities[]> {
  if (!context.cwd || !context.queuePaths) return [];
  const queue = await loadQueueItems(context.queuePaths.queueDir, context.queuePaths.lockDir);
  const overlaid = overlayQueueDispatchFailures(queue, context.db.getQueueDispatchFailureEvents(queue.map((item) => item.id)));
  let capabilities = new Map<string, QueueItemCapabilities>();
  try {
    const snapshot = await loadQueueControlSnapshot({ cwd: context.cwd, queueDir: context.queuePaths.queueDir, classifyRootLocks: 'read-only' });
    const workerSessions = new Set(context.options.workerTracker?.listWorkerSessions?.() ?? []);
    const ownershipEntries = await Promise.all(snapshot.records.map(async (record) => [record.id, await resolveRunningPrdOwnership({ cwd: context.cwd!, prdId: record.id, runs: context.db.getRunningRuns(), workerSessions })] as const));
    capabilities = deriveQueueCapabilitiesForSnapshot(snapshot, new Map(ownershipEntries));
  } catch {
    capabilities = new Map();
  }
  return overlaid.map((item) => ({ ...item, capabilities: capabilities.get(item.id) ?? defaultCapabilities('Queue control data is unavailable.') }));
}

export function projectRunsForContext(context: MonitorContext): RunInfo[] {
  return projectRunsForAcceptedSuccess(context.db.getRuns(), context.queuePaths?.queueDir);
}

export function projectAutoBuildForContext(context: MonitorContext): AutoBuildState {
  return autoBuildStateToWire({ state: context.options.daemonState, capacity: { runningCount: context.getRunningBuildCount(), limit: context.getSchedulerLimit() } });
}

export function projectSessionMetadataForContext(context: MonitorContext): Record<string, SessionMetadata> {
  return context.db.getSessionMetadataBatch();
}

export function projectFailedEnqueuesForContext(context: MonitorContext, options?: { includeResolved?: boolean }) {
  return projectFailedEnqueues(context.db, options);
}

function defaultCapabilities(reason: string): QueueItemCapabilities {
  const capability = { allowed: false, reason };
  return {
    priority: capability,
    remove: capability,
    dependencyOverride: capability,
    hold: capability,
    unhold: capability,
    cascadeRemove: capability,
    cancel: capability,
    cascadeCancel: capability,
  };
}
