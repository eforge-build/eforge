import { describe, expect, it } from 'vitest';
import { selectActiveEfficiencySummary } from '@/lib/selectors/active-efficiency';
import type { NowActiveBuildCard } from '@/lib/selectors/now';
import type { RunEfficiencyMetrics } from '@/lib/run-state';

function metric(label: string, value: number | null, formula = 'formula') {
  return { label, value, formula, availability: value == null ? 'unavailable' as const : 'available' as const, detail: 'detail' };
}

function efficiency(
  overrides: Partial<RunEfficiencyMetrics['raw']>,
  metricValues: Partial<Record<keyof RunEfficiencyMetrics, number | null>> = {},
): RunEfficiencyMetrics {
  return {
    outputGenerationRate: metric('output generation rate', metricValues.outputGenerationRate ?? 10),
    tokenTraffic: metric('token traffic', metricValues.tokenTraffic ?? 100),
    costBurn: metric('cost burn', metricValues.costBurn ?? 1),
    outputTokensPerDollar: metric('output tokens / $', metricValues.outputTokensPerDollar ?? 200),
    cacheContext: metric('cache context', metricValues.cacheContext ?? 50),
    raw: {
      outputTokensForRate: 100,
      durationApiMsForRate: 10_000,
      totalTokensWallClock: 100,
      totalCostUsd: 1,
      totalCostUsdWallClock: 1,
      elapsedWallClockMs: 60_000,
      inputTokens: 100,
      outputTokens: 100,
      cacheReadTokens: 50,
      cacheCreationTokens: 0,
      ...overrides,
    },
  };
}

function card(e: RunEfficiencyMetrics | null): Pick<NowActiveBuildCard, 'efficiency'> {
  return { efficiency: e };
}

describe('selectActiveEfficiencySummary', () => {
  it('aggregates active build efficiency metrics from raw run totals and marks missing detail as partial', () => {
    const summary = selectActiveEfficiencySummary([
      card(efficiency({
        outputTokensForRate: 120,
        durationApiMsForRate: 10_000,
        totalTokensWallClock: 300,
        totalCostUsdWallClock: 2,
        elapsedWallClockMs: 60_000,
        outputTokens: 120,
        totalCostUsd: 2,
        inputTokens: 400,
        cacheReadTokens: 40,
      }, { tokenTraffic: 999, costBurn: 999 })),
      card(efficiency({
        outputTokensForRate: 30,
        durationApiMsForRate: 5_000,
        totalTokensWallClock: 450,
        totalCostUsdWallClock: 3,
        elapsedWallClockMs: 60_000,
        outputTokens: 30,
        totalCostUsd: 1,
        inputTokens: 100,
        cacheReadTokens: 60,
      }, { tokenTraffic: 1, costBurn: 1 })),
      card(null),
    ]);
    expect(summary.activeBuildCount).toBe(3);

    expect(summary.metrics.outputGenerationRate.value).toBe(10);
    expect(summary.metrics.tokenTraffic.value).toBe(375);
    expect(summary.metrics.costBurn.value).toBe(2.5);
    expect(summary.metrics.outputTokensPerDollar.value).toBe(50);
    expect(summary.metrics.cacheContext.value).toBe(20);

    for (const metric of Object.values(summary.metrics)) {
      expect(metric.availability).toBe('partial');
      expect(metric.contributingBuilds).toBe(2);
      expect(metric.missingBuilds).toBe(1);
    }
  });

  it('keeps unavailable per-build raw traffic and burn metrics partial instead of counting them as zero', () => {
    const summary = selectActiveEfficiencySummary([
      card(efficiency({
        totalTokensWallClock: 600,
        totalCostUsdWallClock: 6,
        elapsedWallClockMs: 60_000,
      }, { tokenTraffic: 123, costBurn: 123 })),
      card(efficiency({
        totalTokensWallClock: 900,
        totalCostUsdWallClock: 9,
        elapsedWallClockMs: null,
      }, { tokenTraffic: null, costBurn: null })),
    ]);

    expect(summary.metrics.tokenTraffic.value).toBe(600);
    expect(summary.metrics.tokenTraffic.availability).toBe('partial');
    expect(summary.metrics.tokenTraffic.contributingBuilds).toBe(1);
    expect(summary.metrics.tokenTraffic.missingBuilds).toBe(1);
    expect(summary.metrics.costBurn.value).toBe(6);
    expect(summary.metrics.costBurn.availability).toBe('partial');
    expect(summary.metrics.costBurn.contributingBuilds).toBe(1);
    expect(summary.metrics.costBurn.missingBuilds).toBe(1);
  });
});
