import { describe, it, expect } from 'vitest';
import { selectNowSpendPanel } from '@/lib/selectors/spend';
import type { DailySpend, SpendSummary } from '@eforge-build/client/browser';

function day(overrides: Partial<DailySpend> & { date: string }): DailySpend {
  return {
    tokensIn: 0,
    tokensOut: 0,
    tokensTotal: 0,
    cacheRead: 0,
    cacheCreation: 0,
    costUsd: 0,
    ...overrides,
  };
}

function summary(days: DailySpend[], windowDays = 7): SpendSummary {
  return { windowDays, days };
}

describe('selectNowSpendPanel', () => {
  it('returns an empty, hidden panel when summary is null', () => {
    const model = selectNowSpendPanel(null, '2026-06-03');
    expect(model.hasData).toBe(false);
    expect(model.bars).toEqual([]);
  });

  it('returns an empty panel when there are no days', () => {
    expect(selectNowSpendPanel(summary([]), '2026-06-03').hasData).toBe(false);
  });

  it('surfaces today totals, cache rate, and window total', () => {
    const model = selectNowSpendPanel(
      summary([
        day({ date: '2026-06-01', costUsd: 10 }),
        day({ date: '2026-06-03', costUsd: 32.18, tokensIn: 1000, tokensTotal: 1200, cacheRead: 950 }),
      ]),
      '2026-06-03',
    );
    expect(model.hasData).toBe(true);
    expect(model.todayCostUsd).toBeCloseTo(32.18, 5);
    expect(model.todayTokens).toBe(1200);
    expect(model.todayCachePct).toBeCloseTo(95, 5);
    expect(model.windowCostUsd).toBeCloseTo(42.18, 5);
  });

  it('reports zero spend for today when today has no row', () => {
    const model = selectNowSpendPanel(
      summary([day({ date: '2026-06-01', costUsd: 10 })]),
      '2026-06-03',
    );
    expect(model.todayCostUsd).toBe(0);
    expect(model.todayCachePct).toBeNull();
    // Today is still represented in the sparkline, as a zero bar flagged today.
    const todayBar = model.bars.find((b) => b.date === '2026-06-03');
    expect(todayBar).toEqual({ date: '2026-06-03', costUsd: 0, isToday: true });
  });

  it('fills idle days so the sparkline is contiguous and ends at today', () => {
    const model = selectNowSpendPanel(
      summary([day({ date: '2026-06-03', costUsd: 5 })], 7),
      '2026-06-03',
    );
    expect(model.bars).toHaveLength(7);
    expect(model.bars[model.bars.length - 1]).toMatchObject({ date: '2026-06-03', isToday: true });
    expect(model.bars[0].date).toBe('2026-05-28');
    // Idle days are present with zero cost.
    expect(model.bars.filter((b) => b.costUsd === 0)).toHaveLength(6);
  });

  it('extends the axis when history reaches further back than the window', () => {
    const model = selectNowSpendPanel(
      summary([day({ date: '2026-05-20', costUsd: 1 }), day({ date: '2026-06-03', costUsd: 2 })], 7),
      '2026-06-03',
    );
    expect(model.bars[0].date).toBe('2026-05-20');
    expect(model.bars[model.bars.length - 1].date).toBe('2026-06-03');
  });
});
