import { describe, it, expect } from 'vitest';
import { selectNowMetricsPanel } from '@/lib/selectors/metrics';
import type { NowRecentRunItem } from '@/lib/selectors/now';

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
  it('buckets build run statuses into landed / failed / other and computes land rate', () => {
    const model = selectNowMetricsPanel([
      run({ id: 'completed-1', command: 'build', status: 'completed' }),
      run({ id: 'completed-2', command: 'continue-repair', status: 'success' }),
      run({ id: 'failed-1', command: 'build', status: 'failed' }),
      run({ id: 'other-1', command: 'build', status: 'running' }),
    ]);
    expect(model.landed).toBe(2);
    expect(model.failed).toBe(1);
    expect(model.total).toBe(4);
    expect(model.landRate).toBeCloseTo(2 / 3, 5);
    expect(model.hasHealthData).toBe(true);
    // 'other' bucket (running) is a slice but excluded from land rate denominator.
    expect(model.successSlices.map((s) => s.key)).toEqual(['landed', 'failed', 'other']);
  });

  it('ignores enqueue and compile bookkeeping runs', () => {
    const model = selectNowMetricsPanel([
      run({ id: 'enqueue', command: 'enqueue', status: 'completed' }),
      run({ id: 'compile', command: 'compile', status: 'completed' }),
      run({ id: 'build', command: 'build', status: 'failed' }),
    ]);
    expect(model.landed).toBe(0);
    expect(model.failed).toBe(1);
    expect(model.total).toBe(1);
    expect(model.runBars.map((b) => b.id)).toEqual(['build']);
  });

  it('returns null land rate and no health data when there is no build history', () => {
    const model = selectNowMetricsPanel([]);
    expect(model.landRate).toBeNull();
    expect(model.hasHealthData).toBe(false);
    expect(model.successSlices).toEqual([]);
  });

  it('counts accepted-success-like resolved build statuses as landed', () => {
    const model = selectNowMetricsPanel([
      run({ id: 'accepted', command: 'build', status: 'accepted-success-complete' }),
    ]);
    expect(model.landed).toBe(1);
    expect(model.failed).toBe(0);
    expect(model.successSlices.map((s) => s.key)).toEqual(['landed']);
  });

  it('drops zero-value slices', () => {
    const model = selectNowMetricsPanel([run({ id: 'build', command: 'build', status: 'completed' })]);
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
    const model = selectNowMetricsPanel(runs);
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
    const model = selectNowMetricsPanel(runs);
    expect(model.runBars.length).toBe(24);
  });
});
