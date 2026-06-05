import { describe, it, expect } from 'vitest';
import { selectNowSpendPanel } from '@/lib/selectors/spend';
import type { DailySpend, ModelSpend, SpendSummary } from '@eforge-build/client/browser';

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

function model(overrides: Partial<ModelSpend> & { model: string }): ModelSpend {
  return {
    harness: 'claude-sdk',
    provider: null,
    inputTokens: 0,
    outputTokens: 0,
    tokensTotal: 0,
    cacheReadTokens: 0,
    costUsd: 0,
    ...overrides,
  };
}

function summary(
  days: DailySpend[],
  windowDays = 7,
  models: ModelSpend[] = [],
  modelsToday: ModelSpend[] = [],
): SpendSummary {
  return { windowDays, days, models, modelsToday };
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

  it('surfaces today and window totals, tokens, and cache rates', () => {
    const model = selectNowSpendPanel(
      summary([
        day({ date: '2026-06-01', costUsd: 10, tokensIn: 1000, tokensTotal: 1100, cacheRead: 500 }),
        day({ date: '2026-06-03', costUsd: 32.18, tokensIn: 1000, tokensTotal: 1200, cacheRead: 950 }),
      ]),
      '2026-06-03',
    );
    expect(model.hasData).toBe(true);
    expect(model.todayCostUsd).toBeCloseTo(32.18, 5);
    expect(model.todayTokens).toBe(1200);
    expect(model.todayCachePct).toBeCloseTo(95, 5);
    expect(model.windowCostUsd).toBeCloseTo(42.18, 5);
    expect(model.windowTokens).toBe(2300);
    // Window cache rate is total cacheRead / total tokensIn = 1450 / 2000.
    expect(model.windowCachePct).toBeCloseTo(72.5, 5);
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
    const panel = selectNowSpendPanel(
      summary([day({ date: '2026-05-20', costUsd: 1 }), day({ date: '2026-06-03', costUsd: 2 })], 7),
      '2026-06-03',
    );
    expect(panel.bars[0].date).toBe('2026-05-20');
    expect(panel.bars[panel.bars.length - 1].date).toBe('2026-06-03');
  });

  it('derives per-model rows with cost share and cache rate', () => {
    const panel = selectNowSpendPanel(
      summary(
        [day({ date: '2026-06-03', costUsd: 100 })],
        7,
        [
          model({ model: 'claude-opus-4-7', costUsd: 75, tokensTotal: 1200, inputTokens: 1000, cacheReadTokens: 900 }),
          model({ model: 'claude-sonnet-4-6', costUsd: 25, tokensTotal: 400, inputTokens: 300, cacheReadTokens: 150 }),
        ],
      ),
      '2026-06-03',
    );
    expect(panel.models).toHaveLength(2);
    expect(panel.models[0]).toMatchObject({ model: 'claude-opus-4-7', costUsd: 75, sharePct: 75 });
    expect(panel.models[0].cachePct).toBeCloseTo(90, 5);
    expect(panel.models[1]).toMatchObject({ model: 'claude-sonnet-4-6', sharePct: 25 });
    expect(panel.models[1].cachePct).toBeCloseTo(50, 5);
  });

  it('joins each model\'s today spend onto its window row, matched by harness/provider', () => {
    const panel = selectNowSpendPanel(
      summary(
        [day({ date: '2026-06-02', costUsd: 60 }), day({ date: '2026-06-03', costUsd: 40 })],
        7,
        // Window total is 100; today total is 40.
        [model({ model: 'claude-opus-4-7', costUsd: 90 }), model({ model: 'claude-sonnet-4-6', costUsd: 10 })],
        [
          model({ model: 'claude-opus-4-7', costUsd: 30 }),
          model({ model: 'claude-sonnet-4-6', costUsd: 10 }),
        ],
      ),
      '2026-06-03',
    );
    // Window shares are against the window total (100); today spend rides along.
    expect(panel.models[0]).toMatchObject({ model: 'claude-opus-4-7', sharePct: 90, todayCostUsd: 30 });
    expect(panel.models[1]).toMatchObject({ model: 'claude-sonnet-4-6', sharePct: 10, todayCostUsd: 10 });
  });

  it('matches today spend per harness so the same model id stays distinct', () => {
    const panel = selectNowSpendPanel(
      summary(
        [day({ date: '2026-06-03', costUsd: 30 })],
        7,
        [
          model({ model: 'claude-opus-4-8', costUsd: 20, harness: 'claude-sdk', provider: null }),
          model({ model: 'claude-opus-4-8', costUsd: 10, harness: 'pi', provider: 'openrouter' }),
        ],
        // Only the Pi route ran today; the claude-sdk row stays idle.
        [model({ model: 'claude-opus-4-8', costUsd: 4, harness: 'pi', provider: 'openrouter' })],
      ),
      '2026-06-03',
    );
    expect(panel.models[0]).toMatchObject({ harness: 'claude-sdk', todayCostUsd: 0 });
    expect(panel.models[1]).toMatchObject({ harness: 'pi', todayCostUsd: 4 });
  });

  it('reports zero today spend on every row when nothing ran today', () => {
    const panel = selectNowSpendPanel(
      summary([day({ date: '2026-06-02', costUsd: 60 })], 7, [
        model({ model: 'claude-opus-4-7', costUsd: 60 }),
      ]),
      '2026-06-03',
    );
    expect(panel.models).toHaveLength(1);
    expect(panel.models[0].todayCostUsd).toBe(0);
  });

  it('carries harness and provider through to the model rows', () => {
    const panel = selectNowSpendPanel(
      summary([day({ date: '2026-06-03', costUsd: 30 })], 7, [
        model({ model: 'claude-opus-4-8', costUsd: 20, harness: 'claude-sdk', provider: null }),
        model({ model: 'claude-opus-4-8', costUsd: 10, harness: 'pi', provider: 'openrouter' }),
      ]),
      '2026-06-03',
    );
    expect(panel.models[0]).toMatchObject({ harness: 'claude-sdk', provider: null });
    expect(panel.models[1]).toMatchObject({ harness: 'pi', provider: 'openrouter' });
  });

  it('defaults missing harness/provider to null (historical spend)', () => {
    const panel = selectNowSpendPanel(
      summary([day({ date: '2026-06-03', costUsd: 5 })], 7, [
        { model: 'legacy-model', harness: null, provider: null, inputTokens: 0, outputTokens: 0, tokensTotal: 0, cacheReadTokens: 0, costUsd: 5 },
      ]),
      '2026-06-03',
    );
    expect(panel.models[0]).toMatchObject({ harness: null, provider: null });
  });

  it('reports a null cache rate for a model with no input tokens', () => {
    const panel = selectNowSpendPanel(
      summary([day({ date: '2026-06-03', costUsd: 10 })], 7, [
        model({ model: 'claude-opus-4-7', costUsd: 10, inputTokens: 0 }),
      ]),
      '2026-06-03',
    );
    expect(panel.models[0].cachePct).toBeNull();
  });
});
