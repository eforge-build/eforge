// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { FailedEnqueueInfo } from '@eforge-build/client/browser';
import { initialConsoleProjectState } from '@/lib/project-state';
import { failedEnqueueAttentionCandidates } from '@/lib/failed-enqueues';
import { selectNowAttentionItems } from '@/lib/selectors/now';

const older = '2026-06-19T10:00:00.000Z';
const newer = '2026-06-19T11:00:00.000Z';

function failed(overrides: Partial<FailedEnqueueInfo> = {}): FailedEnqueueInfo {
  return {
    runId: 'run-1',
    sessionId: 'session-1',
    sourceLabel: 'docs/prd.md',
    provenance: { label: 'enqueue:start source' },
    failureReason: 'Invalid PRD',
    failedAt: older,
    canReenqueue: true,
    nextCommand: { executable: 'eforge', args: ['enqueue', '<redacted-source>'] },
    ...overrides,
  };
}

describe('failed enqueue attention selectors', () => {
  it('builds one warning attention candidate per unresolved failed enqueue run', () => {
    const candidates = failedEnqueueAttentionCandidates([
      failed({ runId: 'run-a', sourceLabel: 'a.md', failureReason: 'A failed', failedAt: older }),
      failed({ runId: 'run-b', sourceLabel: 'b.md', failureReason: 'B failed', failedAt: newer }),
      failed({ runId: 'run-c', resolvedAt: newer, canReenqueue: false }),
    ]);

    expect(candidates.map((candidate) => candidate.item.id)).toEqual(['failed-enqueue-run-b', 'failed-enqueue-run-a']);
    expect(candidates[0]).toMatchObject({
      dedupKey: 'failed-enqueue:run-b',
      item: { severity: 'warning', message: 'Enqueue failed: b.md', detail: `B failed · ${newer}` },
    });
  });

  it('selectNowAttentionItems includes the client-owned FailedEnqueueInfo payload and omits resolved rows', () => {
    const state = {
      ...initialConsoleProjectState,
      failedEnqueues: [
        failed({ runId: 'run-a', sourceLabel: 'Source A', failureReason: 'A failed', failedAt: older }),
        failed({ runId: 'run-b', sourceLabel: 'Source B', resolvedAt: newer, canReenqueue: false }),
      ],
    };

    const { items } = selectNowAttentionItems(state, {}, Date.parse(newer));

    expect(items.map((item) => item.id)).toContain('failed-enqueue-run-a');
    expect(items.map((item) => item.id)).not.toContain('failed-enqueue-run-b');
    expect(items.find((item) => item.id === 'failed-enqueue-run-a')).toMatchObject({
      message: 'Enqueue failed: Source A',
      detail: expect.stringContaining('A failed'),
      failedEnqueue: { runId: 'run-a', sessionId: 'session-1' },
    });
  });

  it('dedupes snapshot/live duplicates by runId before rendering attention', () => {
    const state = {
      ...initialConsoleProjectState,
      failedEnqueues: [
        failed({ runId: 'same-run', failureReason: 'old failure', failedAt: older }),
        failed({ runId: 'same-run', failureReason: 'new failure', failedAt: newer }),
      ],
    };

    const { items } = selectNowAttentionItems(state, {}, Date.parse(newer));
    const failedItems = items.filter((item) => item.id === 'failed-enqueue-same-run');

    expect(failedItems).toHaveLength(1);
    expect(failedItems[0].detail).toContain('new failure');
  });
});
