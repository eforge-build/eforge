import { describe, it, expect } from 'vitest';
import {
  selectQueueSummary,
  selectQueueAttentionItems,
  selectQueueStatusGroups,
  sortQueueItems,
} from '@/lib/selectors/queue';
import type { QueueItem } from '@eforge-build/client/browser';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItem(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    id: 'q-1',
    title: 'Test item',
    status: 'pending',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// selectQueueSummary — empty counts
// ---------------------------------------------------------------------------

describe('selectQueueSummary – empty', () => {
  it('returns all zeros for empty array', () => {
    const summary = selectQueueSummary([]);
    expect(summary).toEqual({
      total: 0,
      running: 0,
      pending: 0,
      failed: 0,
      waiting: 0,
      withDependencies: 0,
      withRecoveryVerdict: 0,
      recoveryPending: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// selectQueueSummary — individual counts
// ---------------------------------------------------------------------------

describe('selectQueueSummary – counts', () => {
  it('counts total correctly', () => {
    const items = [makeItem({ id: 'q-1' }), makeItem({ id: 'q-2' })];
    expect(selectQueueSummary(items).total).toBe(2);
  });

  it('counts running items', () => {
    const items = [
      makeItem({ id: 'q-1', status: 'running' }),
      makeItem({ id: 'q-2', status: 'pending' }),
    ];
    expect(selectQueueSummary(items).running).toBe(1);
  });

  it('counts pending items', () => {
    const items = [
      makeItem({ id: 'q-1', status: 'pending' }),
      makeItem({ id: 'q-2', status: 'pending' }),
      makeItem({ id: 'q-3', status: 'running' }),
    ];
    expect(selectQueueSummary(items).pending).toBe(2);
  });

  it('counts failed items', () => {
    const items = [
      makeItem({ id: 'q-1', status: 'failed' }),
      makeItem({ id: 'q-2', status: 'pending' }),
    ];
    expect(selectQueueSummary(items).failed).toBe(1);
  });

  it('counts waiting items', () => {
    const items = [
      makeItem({ id: 'q-1', status: 'waiting' }),
      makeItem({ id: 'q-2', status: 'waiting' }),
    ];
    expect(selectQueueSummary(items).waiting).toBe(2);
  });

  it('counts items with dependencies', () => {
    const items = [
      makeItem({ id: 'q-1', dependsOn: ['q-0'] }),
      makeItem({ id: 'q-2', dependsOn: [] }),
      makeItem({ id: 'q-3' }),
    ];
    expect(selectQueueSummary(items).withDependencies).toBe(1);
  });

  it('counts failed items with recovery verdict', () => {
    const items = [
      makeItem({
        id: 'q-1',
        status: 'failed',
        recoveryVerdict: { verdict: 'retry', confidence: 'high' },
      }),
      makeItem({ id: 'q-2', status: 'failed' }),
    ];
    expect(selectQueueSummary(items).withRecoveryVerdict).toBe(1);
  });

  it('counts failed items without recovery verdict as recoveryPending', () => {
    const items = [
      makeItem({ id: 'q-1', status: 'failed' }),
      makeItem({ id: 'q-2', status: 'failed' }),
      makeItem({
        id: 'q-3',
        status: 'failed',
        recoveryVerdict: { verdict: 'split', confidence: 'medium' },
      }),
    ];
    expect(selectQueueSummary(items).recoveryPending).toBe(2);
  });

  it('does not count non-failed items as recoveryPending', () => {
    const items = [
      makeItem({ id: 'q-1', status: 'pending' }),
      makeItem({ id: 'q-2', status: 'running' }),
    ];
    expect(selectQueueSummary(items).recoveryPending).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// selectQueueAttentionItems — failed item selection
// ---------------------------------------------------------------------------

describe('selectQueueAttentionItems', () => {
  it('returns empty array when no failed items', () => {
    const items = [
      makeItem({ id: 'q-1', status: 'pending' }),
      makeItem({ id: 'q-2', status: 'running' }),
    ];
    expect(selectQueueAttentionItems(items)).toHaveLength(0);
  });

  it('returns only failed items', () => {
    const items = [
      makeItem({ id: 'q-1', status: 'failed' }),
      makeItem({ id: 'q-2', status: 'pending' }),
      makeItem({ id: 'q-3', status: 'failed' }),
    ];
    const attention = selectQueueAttentionItems(items);
    expect(attention).toHaveLength(2);
    expect(attention.every((i) => i.status === 'failed')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// sortQueueItems — priority sorting
// ---------------------------------------------------------------------------

describe('sortQueueItems – priority sorting', () => {
  it('sorts lower priority number first', () => {
    const items = [
      makeItem({ id: 'q-1', priority: 3 }),
      makeItem({ id: 'q-2', priority: 1 }),
      makeItem({ id: 'q-3', priority: 2 }),
    ];
    const sorted = sortQueueItems(items);
    expect(sorted.map((i) => i.priority)).toEqual([1, 2, 3]);
  });

  it('sorts items without priority after items with priority', () => {
    const items = [
      makeItem({ id: 'q-1' }),
      makeItem({ id: 'q-2', priority: 5 }),
    ];
    const sorted = sortQueueItems(items);
    expect(sorted[0].id).toBe('q-2');
    expect(sorted[1].id).toBe('q-1');
  });
});

// ---------------------------------------------------------------------------
// sortQueueItems — created-time sorting
// ---------------------------------------------------------------------------

describe('sortQueueItems – created-time sorting', () => {
  it('sorts by created ascending when priorities are equal', () => {
    const items = [
      makeItem({ id: 'q-2', priority: 1, created: '2024-01-01T10:02:00Z' }),
      makeItem({ id: 'q-1', priority: 1, created: '2024-01-01T10:00:00Z' }),
    ];
    const sorted = sortQueueItems(items);
    expect(sorted[0].id).toBe('q-1');
    expect(sorted[1].id).toBe('q-2');
  });
});

// ---------------------------------------------------------------------------
// selectQueueStatusGroups — grouping
// ---------------------------------------------------------------------------

describe('selectQueueStatusGroups – grouping', () => {
  it('returns empty array for empty input', () => {
    expect(selectQueueStatusGroups([])).toHaveLength(0);
  });

  it('groups items by status', () => {
    const items = [
      makeItem({ id: 'q-1', status: 'pending' }),
      makeItem({ id: 'q-2', status: 'running' }),
      makeItem({ id: 'q-3', status: 'pending' }),
    ];
    const groups = selectQueueStatusGroups(items);
    const pendingGroup = groups.find((g) => g.status === 'pending');
    expect(pendingGroup?.items).toHaveLength(2);
    const runningGroup = groups.find((g) => g.status === 'running');
    expect(runningGroup?.items).toHaveLength(1);
  });

  it('orders known status groups canonically: running, pending, waiting, failed', () => {
    const items = [
      makeItem({ id: 'q-1', status: 'failed' }),
      makeItem({ id: 'q-2', status: 'pending' }),
      makeItem({ id: 'q-3', status: 'running' }),
      makeItem({ id: 'q-4', status: 'waiting' }),
    ];
    const groups = selectQueueStatusGroups(items);
    const statuses = groups.map((g) => g.status);
    expect(statuses).toEqual(['running', 'pending', 'waiting', 'failed']);
  });

  it('places unknown statuses after known groups', () => {
    const items = [
      makeItem({ id: 'q-1', status: 'pending' }),
      makeItem({ id: 'q-2', status: 'mystery' }),
    ];
    const groups = selectQueueStatusGroups(items);
    expect(groups[0].status).toBe('pending');
    expect(groups[1].status).toBe('mystery');
  });

  it('preserves unknown status string verbatim', () => {
    const items = [makeItem({ id: 'q-1', status: 'exotic-status' })];
    const groups = selectQueueStatusGroups(items);
    expect(groups[0].status).toBe('exotic-status');
    expect(groups[0].known).toBe(false);
  });

  it('preserves mixed-case unknown status string verbatim', () => {
    const items = [makeItem({ id: 'q-1', status: 'Needs-Manual-Review' })];
    const groups = selectQueueStatusGroups(items);
    expect(groups[0].status).toBe('Needs-Manual-Review');
    expect(groups[0].label).toBe('Needs-Manual-Review');
    expect(groups[0].known).toBe(false);
  });

  it('marks known statuses as known=true', () => {
    const items = [makeItem({ id: 'q-1', status: 'running' })];
    const groups = selectQueueStatusGroups(items);
    expect(groups[0].known).toBe(true);
  });

  it('marks unknown statuses as known=false', () => {
    const items = [makeItem({ id: 'q-1', status: 'unknown-xyz' })];
    const groups = selectQueueStatusGroups(items);
    expect(groups[0].known).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// selectQueueStatusGroups — mixed-case known statuses
// ---------------------------------------------------------------------------

describe('selectQueueStatusGroups – mixed-case known statuses', () => {
  it('normalizes "Running" (capitalized) into the canonical running group', () => {
    const items = [
      makeItem({ id: 'q-1', status: 'Running' }),
      makeItem({ id: 'q-2', status: 'running' }),
    ];
    const groups = selectQueueStatusGroups(items);
    expect(groups).toHaveLength(1);
    expect(groups[0].status).toBe('running');
    expect(groups[0].known).toBe(true);
    expect(groups[0].items).toHaveLength(2);
  });

  it('normalizes "FAILED" (uppercase) into the canonical failed group', () => {
    const items = [
      makeItem({ id: 'q-1', status: 'FAILED' }),
      makeItem({ id: 'q-2', status: 'failed' }),
    ];
    const groups = selectQueueStatusGroups(items);
    expect(groups).toHaveLength(1);
    expect(groups[0].status).toBe('failed');
    expect(groups[0].known).toBe(true);
    expect(groups[0].items).toHaveLength(2);
  });

  it('selectQueueSummary counts mixed-case known statuses correctly', () => {
    const items = [
      makeItem({ id: 'q-1', status: 'Running' }),
      makeItem({ id: 'q-2', status: 'FAILED' }),
      makeItem({ id: 'q-3', status: 'Pending' }),
    ];
    const summary = selectQueueSummary(items);
    expect(summary.running).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.pending).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// selectQueueStatusGroups — dependency count
// ---------------------------------------------------------------------------

describe('selectQueueStatusGroups – dependency data preserved', () => {
  it('preserves dependsOn on items in groups', () => {
    const items = [makeItem({ id: 'q-1', status: 'pending', dependsOn: ['q-0'] })];
    const groups = selectQueueStatusGroups(items);
    expect(groups[0].items[0].dependsOn).toEqual(['q-0']);
  });
});

// ---------------------------------------------------------------------------
// selectQueueStatusGroups — recovery verdict in failed group
// ---------------------------------------------------------------------------

describe('selectQueueStatusGroups – recovery verdicts', () => {
  it('preserves recoveryVerdict on failed items', () => {
    const items = [
      makeItem({
        id: 'q-1',
        status: 'failed',
        recoveryVerdict: { verdict: 'retry', confidence: 'high' },
      }),
    ];
    const groups = selectQueueStatusGroups(items);
    const failedGroup = groups.find((g) => g.status === 'failed');
    expect(failedGroup?.items[0].recoveryVerdict?.verdict).toBe('retry');
  });

  it('failed item without recoveryVerdict has undefined recoveryVerdict', () => {
    const items = [makeItem({ id: 'q-1', status: 'failed' })];
    const groups = selectQueueStatusGroups(items);
    expect(groups[0].items[0].recoveryVerdict).toBeUndefined();
  });
});
