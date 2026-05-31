import type { QueueItem } from '@eforge-build/client/browser';
import { selectPrdDisplayLabel } from '@/lib/selectors/labels';

export interface NowQueueStackItem {
  id: string;
  title: string;
  status: string;
  priority: number | undefined;
  created: string | undefined;
  dependsOn: string[];
  blockedBy: string[];
  unlocksCount: number;
  layer: number;
  totalLayers: number;
}

export interface NowQueueStack {
  id: string;
  totalItems: number;
  activeCount: number;
  waitingCount: number;
  pendingCount: number;
  layers: number;
  items: NowQueueStackItem[];
}

const QUEUE_STATUS_ATTENTION_ORDER = ['failed', 'skipped', 'running', 'waiting', 'pending'];

function queueStatusOrder(status: string): number {
  const idx = QUEUE_STATUS_ATTENTION_ORDER.indexOf(status.toLowerCase());
  return idx === -1 ? QUEUE_STATUS_ATTENTION_ORDER.length : idx;
}

export function queueItemLabelById(byId: Map<string, QueueItem>, id: string): string {
  const item = byId.get(id);
  return item ? selectPrdDisplayLabel(item.title, item.id) : selectPrdDisplayLabel(undefined, id);
}

export function compareQueueItems(a: QueueItem, b: QueueItem): number {
  const orderDiff = queueStatusOrder(a.status) - queueStatusOrder(b.status);
  if (orderDiff !== 0) return orderDiff;

  const aPriority = a.priority ?? 0;
  const bPriority = b.priority ?? 0;
  if (bPriority !== aPriority) return bPriority - aPriority;

  const aCreated = a.created ?? '';
  const bCreated = b.created ?? '';
  if (aCreated !== bCreated) return aCreated < bCreated ? -1 : 1;

  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function sortQueueItemsTopologically(items: QueueItem[]): QueueItem[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const idSet = new Set(byId.keys());
  const depthMemo = new Map<string, number>();
  const visiting = new Set<string>();

  function depth(id: string): number {
    const memoized = depthMemo.get(id);
    if (memoized != null) return memoized;
    if (visiting.has(id)) return 1;

    visiting.add(id);
    const deps = (byId.get(id)?.dependsOn ?? []).filter((depId) => idSet.has(depId));
    const value = deps.length === 0 ? 1 : Math.max(...deps.map(depth)) + 1;
    visiting.delete(id);
    depthMemo.set(id, value);
    return value;
  }

  return [...items].sort((a, b) => {
    const depthDiff = depth(a.id) - depth(b.id);
    if (depthDiff !== 0) return depthDiff;
    return compareQueueItems(a, b);
  });
}

function getQueueStackComponents(queue: QueueItem[]): string[][] {
  const eligible = queue.filter((item) => {
    const status = item.status.toLowerCase();
    return status === 'running' || status === 'waiting' || status === 'pending';
  });
  const byId = new Map(eligible.map((item) => [item.id, item]));
  const adjacency = new Map<string, Set<string>>();

  for (const item of eligible) {
    if (!adjacency.has(item.id)) adjacency.set(item.id, new Set());
    for (const depId of item.dependsOn ?? []) {
      if (!byId.has(depId)) continue;
      adjacency.get(item.id)!.add(depId);
      if (!adjacency.has(depId)) adjacency.set(depId, new Set());
      adjacency.get(depId)!.add(item.id);
    }
  }

  const visited = new Set<string>();
  const components: string[][] = [];
  for (const id of adjacency.keys()) {
    if (visited.has(id)) continue;
    const stack = [id];
    const component: string[] = [];
    visited.add(id);
    while (stack.length > 0) {
      const current = stack.pop()!;
      component.push(current);
      for (const next of adjacency.get(current) ?? []) {
        if (visited.has(next)) continue;
        visited.add(next);
        stack.push(next);
      }
    }
    if (component.length > 1) components.push(component);
  }

  return components;
}

export function selectNowQueueStacks(queue: QueueItem[]): NowQueueStack[] {
  const activeQueue = queue.filter((item) => {
    const status = item.status.toLowerCase();
    return status === 'running' || status === 'waiting' || status === 'pending';
  });
  const byId = new Map(activeQueue.map((item) => [item.id, item]));
  const dependentIdsById = new Map<string, string[]>();
  for (const item of activeQueue) {
    for (const depId of item.dependsOn ?? []) {
      dependentIdsById.set(depId, [...(dependentIdsById.get(depId) ?? []), item.id]);
    }
  }

  const stacks = getQueueStackComponents(activeQueue).map((componentIds) => {
    const componentItems = componentIds.flatMap((id) => {
      const item = byId.get(id);
      return item ? [item] : [];
    });
    const sorted = sortQueueItemsTopologically(componentItems);
    const componentIdSet = new Set(componentIds);
    const layerById = new Map(sorted.map((item, index) => [item.id, index + 1]));
    const totalLayers = sorted.length;
    const activeCount = sorted.filter((item) => item.status.toLowerCase() === 'running').length;
    const waitingCount = sorted.filter((item) => item.status.toLowerCase() === 'waiting').length;
    const pendingCount = sorted.filter((item) => item.status.toLowerCase() === 'pending').length;

    return {
      id: sorted.map((item) => item.id).join('>'),
      totalItems: sorted.length,
      activeCount,
      waitingCount,
      pendingCount,
      layers: totalLayers,
      items: sorted.map((item) => {
        const internalDeps = (item.dependsOn ?? []).filter((depId) => componentIdSet.has(depId));
        const blockedBy = internalDeps.map((depId) => queueItemLabelById(byId, depId));
        const unlocksCount = (dependentIdsById.get(item.id) ?? [])
          .filter((depId) => componentIdSet.has(depId)).length;
        return {
          id: item.id,
          title: selectPrdDisplayLabel(item.title, item.id),
          status: item.status,
          priority: item.priority,
          created: item.created,
          dependsOn: item.dependsOn ?? [],
          blockedBy,
          unlocksCount,
          layer: layerById.get(item.id) ?? 1,
          totalLayers,
        };
      }),
    } satisfies NowQueueStack;
  });

  return stacks.sort((a, b) => {
    if (b.activeCount !== a.activeCount) return b.activeCount - a.activeCount;
    return b.totalItems - a.totalItems;
  });
}
