import type { EforgeEvent } from '../events.js';
import type { ProjectableState } from '../event-registry.js';
import type { QueueItem } from '../types.js';

type QueueProjectState = Readonly<Pick<ProjectableState, 'queue'>>;
type EnqueueCompleteEvent = Extract<EforgeEvent, { type: 'enqueue:complete' }>;
type QueuePrdDiscoveredEvent = Extract<EforgeEvent, { type: 'queue:prd:discovered' }>;
type SchedulerDependencyBlockedEvent = Extract<EforgeEvent, { type: 'daemon:scheduler:dependency-blocked' }>;
type QueueDependencyOverriddenEvent = Extract<EforgeEvent, { type: 'queue:prd:dependency-overridden' }>;
type QueuePrdDispatchFailedEvent = Extract<EforgeEvent, { type: 'queue:prd:dispatch-failed' }>;

function dedupeDependsOn(dependsOn: string[]): string[] {
  const deduped: string[] = [];
  for (const id of dependsOn) {
    if (!deduped.includes(id)) deduped.push(id);
  }
  return deduped;
}

function mergeDependsOn(existing: string[] | undefined, incoming: string[] | undefined): string[] | undefined {
  if (incoming === undefined && existing === undefined) return undefined;
  return dedupeDependsOn([...(existing ?? []), ...(incoming ?? [])]);
}

function withMergedDependsOn(item: QueueItem, incoming: string[] | undefined): QueueItem {
  const dependsOn = mergeDependsOn(item.dependsOn, incoming);
  return dependsOn === undefined ? item : { ...item, dependsOn };
}

function withDiscoveredDependsOn(item: QueueItem, incoming: string[] | undefined): QueueItem {
  if (incoming === undefined) return item;
  const dependsOn = dedupeDependsOn(incoming);
  if (dependsOn.length === 0) {
    const { dependsOn: _dependsOn, ...rest } = item;
    return rest;
  }
  return { ...item, dependsOn };
}

function normalizeLiveQueueItem(item: QueueItem): QueueItem {
  const { recoveryVerdict: _recoveryVerdict, recoveryApplied: _recoveryApplied, dispatchFailure: _dispatchFailure, ...liveItem } = item;
  return liveItem;
}

function isTerminalQueueStatus(status: string): boolean {
  return status === 'failed' || status === 'skipped';
}

export function normalizeTerminalQueueItem(item: QueueItem, status: string): QueueItem {
  if (item.dependsOn === undefined && item.status === status) return item;
  const { dependsOn: _dependsOn, ...terminalItem } = item;
  return { ...terminalItem, status };
}

export function projectEnqueueComplete(event: EnqueueCompleteEvent, state: QueueProjectState): Partial<ProjectableState> | undefined {
  if (state.queue.some((item) => item.id === event.id)) return undefined;
  return { queue: [...state.queue, { id: event.id, title: event.title, status: 'pending' }] };
}

export function projectQueuePrdDiscovered(event: QueuePrdDiscoveredEvent, state: QueueProjectState): Partial<ProjectableState> | undefined {
  const idx = state.queue.findIndex((item) => item.id === event.prdId);
  if (idx === -1) {
    const newItem = withDiscoveredDependsOn({ id: event.prdId, title: event.title, status: 'pending' }, event.dependsOn);
    return { queue: [...state.queue, newItem] };
  }

  const existing = normalizeLiveQueueItem(state.queue[idx]);
  const status = existing.status === 'running' ? existing.status : 'pending';
  const updatedItem = withDiscoveredDependsOn({ ...existing, title: event.title, status }, event.dependsOn);
  const updated = [...state.queue];
  updated[idx] = updatedItem;
  return { queue: updated };
}

export function projectSchedulerDependencyBlocked(event: SchedulerDependencyBlockedEvent, state: QueueProjectState): Partial<ProjectableState> | undefined {
  const idx = state.queue.findIndex((item) => item.id === event.prdId);
  if (idx === -1) return undefined;
  const existing = state.queue[idx];
  if (isTerminalQueueStatus(existing.status)) return undefined;
  const updatedItem = withMergedDependsOn(existing, event.blockedBy);
  if (updatedItem === existing) return undefined;
  const updated = [...state.queue];
  updated[idx] = updatedItem;
  return { queue: updated };
}

export function projectQueuePrdDispatchFailed(event: QueuePrdDispatchFailedEvent, state: QueueProjectState): Partial<ProjectableState> | undefined {
  const dispatchFailure = { reason: event.reason, stage: event.stage, timestamp: event.timestamp };
  const idx = state.queue.findIndex((item) => item.id === event.prdId);
  if (idx === -1) {
    return { queue: [...state.queue, { id: event.prdId, title: event.title, status: 'failed', dispatchFailure }] };
  }
  const updated = [...state.queue];
  updated[idx] = { ...normalizeTerminalQueueItem(updated[idx], 'failed'), title: event.title, dispatchFailure };
  return { queue: updated };
}

export function projectQueueDependencyOverridden(event: QueueDependencyOverriddenEvent, state: QueueProjectState): Partial<ProjectableState> | undefined {
  const idx = state.queue.findIndex((item) => item.id === event.prdId);
  if (idx === -1) return undefined;
  const existing = state.queue[idx];
  if (isTerminalQueueStatus(existing.status)) return undefined;
  const updated = [...state.queue];
  if (event.currentDependsOn.length === 0) {
    const { dependsOn: _dependsOn, ...rest } = existing;
    updated[idx] = existing.status === 'waiting' ? { ...rest, status: 'pending' } : rest;
  } else {
    updated[idx] = { ...existing, dependsOn: dedupeDependsOn(event.currentDependsOn) };
  }
  return { queue: updated };
}
