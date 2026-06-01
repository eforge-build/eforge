import { describe, it, expect } from 'vitest';
import { selectNowMetricsPanel } from '@/lib/selectors/metrics';
import type { NowRecentRunItem, NowStackSummary } from '@/lib/selectors/now';

function stack(byStatus: Record<string, number>): NowStackSummary {
  return {
    totalCount: Object.values(byStatus).reduce((a, b) => a + b, 0),
    byStatus,
    byStackId: {},
    topRows: [],
    hiddenCount: 0,
  };
}

function run(overrides: Partial<NowRecentRunItem> = {}): NowRecentRunItem {
  return {
    id: 'r-1',
    sessionId: 's-1',
    planSet: 'Build A',
    command: 'build',
    status: 'completed',
    startedAt: '2026-05-31T00:00:00.000Z',
    durationMs: 120_000,
    ...overrides,
  };
}

describe('selectNowMetricsPanel — land rate', () => {
  it('buckets statuses into landed / failed / other and computes land rate', () => {
    const model = selectNowMetricsPanel(stack({ landed: 17, failed: 5, building: 2 }), []);
    expect(model.landed).toBe(17);
    expect(model.failed).toBe(5);
    expect(model.total).toBe(24);
    expect(model.landRate).toBeCloseTo(17 / 22, 5);
    expect(model.hasStack).toBe(true);
    // 'other' bucket (building) is a slice but excluded from land rate denominator.
    expect(model.successSlices.map((s) => s.key)).toEqual(['landed', 'failed', 'other']);
  });

  it('returns null land rate and no stack when there is no completed history', () => {
    const model = selectNowMetricsPanel(null, []);
    expect(model.landRate).toBeNull();
    expect(model.hasStack).toBe(false);
    expect(model.successSlices).toEqual([]);
  });

  it('drops zero-value slices', () => {
    const model = selectNowMetricsPanel(stack({ landed: 3, failed: 0 }), []);
    expect(model.successSlices.map((s) => s.key)).toEqual(['landed']);
  });
});

describe('selectNowMetricsPanel — throughput bars', () => {
  it('orders bars oldest -> newest and colors by outcome', () => {
    const runs: NowRecentRunItem[] = [
      run({ id: 'newest', startedAt: '2026-05-31T03:00:00.000Z', status: 'running', durationMs: null }),
      run({ id: 'middle', startedAt: '2026-05-31T02:00:00.000Z', status: 'failed', durationMs: 60_000 }),
      run({ id: 'oldest', startedAt: '2026-05-31T01:00:00.000Z', status: 'completed', durationMs: 180_000 }),
    ];
    // Caller passes newest-first (as selectAllNowRunItems does).
    const model = selectNowMetricsPanel(null, runs);
    expect(model.runBars.map((b) => b.id)).toEqual(['oldest', 'middle', 'newest']);
    expect(model.runBars.map((b) => b.outcome)).toEqual(['completed', 'failed', 'running']);
    expect(model.runBars[0].durationMin).toBeCloseTo(3, 5);
    // Null duration treated as 0.
    expect(model.runBars[2].durationMin).toBe(0);
  });

  it('caps the number of plotted bars', () => {
    const runs = Array.from({ length: 40 }, (_, i) =>
      run({ id: `r-${i}`, startedAt: `2026-05-31T${String(i % 24).padStart(2, '0')}:00:00.000Z` }),
    );
    const model = selectNowMetricsPanel(null, runs);
    expect(model.runBars.length).toBe(24);
  });
});
