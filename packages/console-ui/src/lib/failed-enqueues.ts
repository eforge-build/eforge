import type { FailedEnqueueInfo } from '@eforge-build/client/browser';
import type { NowAttentionItem } from '@/lib/selectors/now';

export function dedupeFailedEnqueuesByRunId(items: FailedEnqueueInfo[]): FailedEnqueueInfo[] {
  const byRunId = new Map<string, FailedEnqueueInfo>();
  for (const item of items) {
    const existing = byRunId.get(item.runId);
    if (!existing) {
      byRunId.set(item.runId, item);
      continue;
    }
    if (item.resolvedAt && !existing.resolvedAt) {
      byRunId.set(item.runId, item);
      continue;
    }
    if (item.resolvedAt === existing.resolvedAt && item.failedAt > existing.failedAt) {
      byRunId.set(item.runId, item);
    }
  }
  return [...byRunId.values()].sort((a, b) => b.failedAt.localeCompare(a.failedAt) || a.runId.localeCompare(b.runId));
}

export function sortFailedEnqueuesForAttention(items: FailedEnqueueInfo[]): FailedEnqueueInfo[] {
  return items
    .filter((item) => !item.resolvedAt)
    .sort((a, b) => b.failedAt.localeCompare(a.failedAt) || a.runId.localeCompare(b.runId));
}

export function failedEnqueueAttentionCandidates(items: FailedEnqueueInfo[]): Array<{ item: NowAttentionItem; dedupKey: string }> {
  return sortFailedEnqueuesForAttention(dedupeFailedEnqueuesByRunId(items)).map((failedEnqueue) => ({
    item: {
      id: `failed-enqueue-${failedEnqueue.runId}`,
      severity: 'warning',
      message: `Enqueue failed: ${failedEnqueue.sourceLabel}`,
      detail: `${failedEnqueue.failureReason} · ${failedEnqueue.failedAt}`,
      failedEnqueue,
    },
    dedupKey: `failed-enqueue:${failedEnqueue.runId}`,
  }));
}
