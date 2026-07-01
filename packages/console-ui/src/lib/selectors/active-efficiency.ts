import type { NowActiveBuildCard } from './now';
import type { EfficiencyAvailability, RunEfficiencyMetrics, EfficiencyMetric } from '@/lib/run-state/selectors/efficiency';

export interface ActiveEfficiencyMetric {
  label: string;
  value: number | null;
  formula: string;
  availability: EfficiencyAvailability;
  detail: string;
  contributingBuilds: number;
  missingBuilds: number;
}

export interface ActiveEfficiencySummaryViewModel {
  activeBuildCount: number;
  metrics: {
    outputGenerationRate: ActiveEfficiencyMetric;
    tokenTraffic: ActiveEfficiencyMetric;
    costBurn: ActiveEfficiencyMetric;
    outputTokensPerDollar: ActiveEfficiencyMetric;
    cacheContext: ActiveEfficiencyMetric;
  };
}

type ActiveEfficiencySource = Pick<NowActiveBuildCard, 'efficiency'>;

function unavailableMetric(label: string, formula: string, activeBuildCount: number): ActiveEfficiencyMetric {
  return {
    label,
    value: null,
    formula,
    availability: activeBuildCount > 0 ? 'partial' : 'unavailable',
    detail: activeBuildCount > 0 ? 'Waiting for live build detail.' : 'No active builds.',
    contributingBuilds: 0,
    missingBuilds: activeBuildCount,
  };
}

function aggregateMetric(
  metrics: RunEfficiencyMetrics[],
  activeBuildCount: number,
  pick: (metrics: RunEfficiencyMetrics) => EfficiencyMetric,
  canContribute: (metrics: RunEfficiencyMetrics) => boolean,
  aggregateValue: (metrics: RunEfficiencyMetrics[]) => number | null,
): ActiveEfficiencyMetric {
  const template = pick(metrics[0]!);
  const contributingMetrics = metrics.filter(canContribute);
  const value = contributingMetrics.length > 0 ? aggregateValue(contributingMetrics) : null;
  const missingBuilds = activeBuildCount - contributingMetrics.length;
  const hasPartialMetric = contributingMetrics.some((m) => pick(m).availability === 'partial');
  const availability: EfficiencyAvailability = value == null
    ? (missingBuilds > 0 || hasPartialMetric ? 'partial' : 'unavailable')
    : (missingBuilds > 0 || hasPartialMetric ? 'partial' : 'available');
  return {
    label: template.label,
    value,
    formula: template.formula,
    availability,
    detail: missingBuilds > 0
      ? `${missingBuilds} active build${missingBuilds === 1 ? '' : 's'} waiting for live detail.`
      : template.detail,
    contributingBuilds: contributingMetrics.length,
    missingBuilds,
  };
}

export function selectActiveEfficiencySummary(cards: ActiveEfficiencySource[]): ActiveEfficiencySummaryViewModel {
  const metrics = cards.map((card) => card.efficiency).filter((m): m is RunEfficiencyMetrics => Boolean(m));
  const activeBuildCount = cards.length;
  const noMetric = (label: string, formula: string) => unavailableMetric(label, formula, activeBuildCount);

  const outputGenerationRate = metrics.length === 0 ? noMetric('output generation rate', 'sum(output tokens) / sum(API duration seconds)') : aggregateMetric(
    metrics,
    activeBuildCount,
    (m) => m.outputGenerationRate,
    (m) => m.raw.durationApiMsForRate > 0,
    (items) => {
      const output = items.reduce((sum, m) => sum + m.raw.outputTokensForRate, 0);
      const durationMs = items.reduce((sum, m) => sum + m.raw.durationApiMsForRate, 0);
      return durationMs > 0 ? output / (durationMs / 1000) : null;
    },
  );

  const tokenTraffic = metrics.length === 0 ? noMetric('token traffic', '(input + output tokens) / elapsed wall-clock minute') : aggregateMetric(
    metrics,
    activeBuildCount,
    (m) => m.tokenTraffic,
    (m) => m.raw.elapsedWallClockMs != null && m.raw.elapsedWallClockMs > 0,
    (items) => {
      const tokens = items.reduce((sum, m) => sum + m.raw.totalTokensWallClock, 0);
      const elapsedMs = items.reduce((sum, m) => sum + (m.raw.elapsedWallClockMs ?? 0), 0);
      return elapsedMs > 0 ? tokens / (elapsedMs / 60_000) : null;
    },
  );

  const costBurn = metrics.length === 0 ? noMetric('cost burn', 'total cost / elapsed wall-clock minute') : aggregateMetric(
    metrics,
    activeBuildCount,
    (m) => m.costBurn,
    (m) => m.raw.elapsedWallClockMs != null && m.raw.elapsedWallClockMs > 0,
    (items) => {
      const cost = items.reduce((sum, m) => sum + m.raw.totalCostUsdWallClock, 0);
      const elapsedMs = items.reduce((sum, m) => sum + (m.raw.elapsedWallClockMs ?? 0), 0);
      return elapsedMs > 0 ? cost / (elapsedMs / 60_000) : null;
    },
  );

  const outputTokensPerDollar = metrics.length === 0 ? noMetric('output tokens / $', 'output tokens / total cost') : aggregateMetric(
    metrics,
    activeBuildCount,
    (m) => m.outputTokensPerDollar,
    (m) => m.raw.totalCostUsd > 0,
    (items) => {
      const output = items.reduce((sum, m) => sum + m.raw.outputTokens, 0);
      const cost = items.reduce((sum, m) => sum + m.raw.totalCostUsd, 0);
      return cost > 0 ? output / cost : null;
    },
  );

  const cacheContext = metrics.length === 0 ? noMetric('cache context', 'cache read tokens / input tokens') : aggregateMetric(
    metrics,
    activeBuildCount,
    (m) => m.cacheContext,
    (m) => m.raw.inputTokens > 0,
    (items) => {
      const cacheRead = items.reduce((sum, m) => sum + m.raw.cacheReadTokens, 0);
      const input = items.reduce((sum, m) => sum + m.raw.inputTokens, 0);
      return input > 0 ? (cacheRead / input) * 100 : null;
    },
  );

  return {
    activeBuildCount,
    metrics: { outputGenerationRate, tokenTraffic, costBurn, outputTokensPerDollar, cacheContext },
  };
}
