import type {
  EfficiencyAnalyticsSummary,
  EfficiencyMetricRollup,
  EfficiencyModelRollup,
  EfficiencyProfileRollup,
} from '@eforge-build/client/browser';

export type EfficiencyAnalyticsAvailability = 'available' | 'partial' | 'unavailable';
export type EfficiencyAnalyticsRowKind = 'model' | 'profile';

export interface EfficiencyAnalyticsMetricValue {
  value: number | null;
  availability: EfficiencyAnalyticsAvailability;
  sampleCount: number;
}

export interface EfficiencyAnalyticsRow {
  kind: EfficiencyAnalyticsRowKind;
  id: string;
  label: string;
  sublabel: string | null;
  p50OutputTokensPerSecond: EfficiencyAnalyticsMetricValue;
  p95OutputTokensPerSecond: EfficiencyAnalyticsMetricValue;
  costPerRunUsd: EfficiencyAnalyticsMetricValue;
  costPerMinuteUsd: EfficiencyAnalyticsMetricValue;
  outputTokensPerDollar: EfficiencyAnalyticsMetricValue;
  successCount: number;
  failureCount: number;
  runCount: number;
  sampleCount: number;
  speedSampleCount: number;
  runSampleCount: number;
  partialLabel: string | null;
  /** Cache-read share of input tokens over the window, when attributable. */
  cachePercentage: number | null;
  /** Total reported cost over the window, when attributable. */
  totalCostUsd: number | null;
  /** Total output tokens over the window, when attributable. */
  outputTokens: number | null;
}

export interface EfficiencyAnalyticsViewModel {
  hasData: boolean;
  windowDays: number;
  agentResultCount: number;
  runCount: number;
  sessionCount: number;
  missingModelAttributionCount: number;
  missingProfileAttributionCount: number;
  models: EfficiencyAnalyticsRow[];
  profiles: EfficiencyAnalyticsRow[];
  noDataLabel: string;
}

const EMPTY: EfficiencyAnalyticsViewModel = {
  hasData: false,
  windowDays: 0,
  agentResultCount: 0,
  runCount: 0,
  sessionCount: 0,
  missingModelAttributionCount: 0,
  missingProfileAttributionCount: 0,
  models: [],
  profiles: [],
  noDataLabel: 'No efficiency analytics for this window yet.',
};

function metricValue(value: number | null, sampleCount: number): EfficiencyAnalyticsMetricValue {
  return {
    value,
    sampleCount,
    availability: value == null ? (sampleCount > 0 ? 'partial' : 'unavailable') : 'available',
  };
}

function partialLabel(rollup: EfficiencyMetricRollup): string | null {
  const labels: string[] = [];
  if (rollup.durationUnavailableCount > 0) labels.push(`${rollup.durationUnavailableCount} missing duration`);
  if (rollup.outputRateUnavailableCount > 0) labels.push(`${rollup.outputRateUnavailableCount} missing output-rate tokens`);
  if (rollup.speedExcludedSampleCount > 0) labels.push(`${rollup.speedExcludedSampleCount} speed samples excluded`);
  if (rollup.costSampleCount < rollup.sampleCount) labels.push('partial cost');
  if (rollup.tokenSampleCount < rollup.sampleCount) labels.push('partial tokens');
  return labels.length > 0 ? labels.join(' · ') : null;
}

function modelId(row: EfficiencyModelRollup): string {
  return `${row.model}::${row.harness ?? ''}::${row.provider ?? ''}`;
}

function harnessLabel(row: Pick<EfficiencyModelRollup, 'harness' | 'provider'>): string | null {
  if (!row.harness && !row.provider) return null;
  if (!row.harness) return row.provider;
  return row.provider ? `${row.harness} · ${row.provider}` : row.harness;
}

function toRow(
  kind: EfficiencyAnalyticsRowKind,
  rollup: EfficiencyMetricRollup,
  label: string,
  sublabel: string | null,
  id: string,
): EfficiencyAnalyticsRow {
  return {
    kind,
    id,
    label,
    sublabel,
    p50OutputTokensPerSecond: metricValue(rollup.outputTokensPerSecondP50, rollup.outputRateSampleCount),
    p95OutputTokensPerSecond: metricValue(rollup.outputTokensPerSecondP95, rollup.outputRateSampleCount),
    costPerRunUsd: metricValue(rollup.costPerRunUsd, rollup.costSampleCount),
    costPerMinuteUsd: metricValue(rollup.costPerMinuteUsd, rollup.durationSampleCount),
    outputTokensPerDollar: metricValue(rollup.outputTokensPerDollar, rollup.costSampleCount),
    successCount: rollup.successCount,
    failureCount: rollup.failureCount,
    runCount: rollup.runCount,
    sampleCount: rollup.sampleCount,
    speedSampleCount: rollup.outputRateSampleCount,
    runSampleCount: rollup.runCount,
    partialLabel: partialLabel(rollup),
    cachePercentage: rollup.cachePercentage,
    totalCostUsd: rollup.totalCostUsd,
    outputTokens: rollup.outputTokens,
  };
}

function modelRow(row: EfficiencyModelRollup): EfficiencyAnalyticsRow {
  return toRow('model', row, row.model, harnessLabel(row), modelId(row));
}

function profileRow(row: EfficiencyProfileRollup): EfficiencyAnalyticsRow {
  const profileName = row.profileName.trim();
  return toRow('profile', row, profileName || 'Unattributed profile', null, profileName || 'unattributed');
}

export function selectEfficiencyAnalyticsViewModel(
  summary: EfficiencyAnalyticsSummary | null,
): EfficiencyAnalyticsViewModel {
  if (!summary) return EMPTY;

  const models = summary.models.map(modelRow);
  const profiles = summary.profiles.map(profileRow);

  return {
    hasData: models.length > 0 || profiles.length > 0,
    windowDays: summary.windowDays,
    agentResultCount: summary.agentResultCount,
    runCount: summary.runCount,
    sessionCount: summary.sessionCount,
    missingModelAttributionCount: summary.missingModelAttributionCount,
    missingProfileAttributionCount: summary.missingProfileAttributionCount,
    models,
    profiles,
    noDataLabel: `No efficiency analytics in the last ${summary.windowDays}d yet.`,
  };
}
