import type { QueueItem } from '@eforge-build/client/browser';
import { selectPrdDisplayLabel } from '@/lib/selectors/labels';
import { compareQueueItems, sortQueueItemsTopologically } from './queue-stacks';

export interface NowQueueItem {
  id: string;
  title: string;
  status: string;
  priority: number | undefined;
  created: string | undefined;
  dependsOn: string[] | undefined;
  recoveryVerdict: { verdict: string; confidence: string } | undefined;
}

export interface NowQueueSummary {
  total: number;
  byStatus: Record<string, number>;
  runningCount: number;
  pendingCount: number;
  failedCount: number;
  waitingCount: number;
  skippedCount: number;
  withDependenciesCount: number;
  withRecoveryVerdictCount: number;
  topItems: NowQueueItem[];
  allItems?: NowQueueItem[];
  hiddenCount: number;
}

const MAX_QUEUE_ITEMS = 4;

function toNowQueueItem(item: QueueItem): NowQueueItem {
  return {
    id: item.id,
    title: selectPrdDisplayLabel(item.title, item.id),
    status: item.status,
    priority: item.priority,
    created: item.created,
    dependsOn: item.dependsOn,
    recoveryVerdict: item.recoveryVerdict,
  };
}

export function selectNowQueueSummary(queue: QueueItem[]): NowQueueSummary {
  const byStatus: Record<string, number> = {};
  let runningCount = 0;
  let pendingCount = 0;
  let failedCount = 0;
  let waitingCount = 0;
  let skippedCount = 0;
  let withDependenciesCount = 0;
  let withRecoveryVerdictCount = 0;

  for (const item of queue) {
    const s = item.status.toLowerCase();
    byStatus[s] = (byStatus[s] ?? 0) + 1;
    if (s === 'running') runningCount++;
    if (s === 'pending') pendingCount++;
    if (s === 'failed') failedCount++;
    if (s === 'waiting') waitingCount++;
    if (s === 'skipped') skippedCount++;
    if (item.dependsOn && item.dependsOn.length > 0) withDependenciesCount++;
    if (item.recoveryVerdict) withRecoveryVerdictCount++;
  }

  const displayable = queue.filter((item) => item.status.toLowerCase() !== 'running');
  const failed = displayable.filter((item) => item.status.toLowerCase() === 'failed').sort(compareQueueItems);
  const skipped = displayable.filter((item) => item.status.toLowerCase() === 'skipped').sort(compareQueueItems);
  const activeQueue = displayable.filter((item) => {
    const status = item.status.toLowerCase();
    return status !== 'failed' && status !== 'skipped';
  });
  const sorted = [...failed, ...skipped, ...sortQueueItemsTopologically(activeQueue)];

  const allItems = sorted.map(toNowQueueItem);

  return {
    total: displayable.length,
    byStatus,
    runningCount,
    pendingCount,
    failedCount,
    waitingCount,
    skippedCount,
    withDependenciesCount,
    withRecoveryVerdictCount,
    topItems: allItems.slice(0, MAX_QUEUE_ITEMS),
    allItems,
    hiddenCount: Math.max(0, displayable.length - MAX_QUEUE_ITEMS),
  };
}
