export interface EfficiencyMetricRollup {
  runCount: number;
  successCount: number;
  failureCount: number;
  sampleCount: number;
  costSampleCount: number;
  tokenSampleCount: number;
  durationSampleCount: number;
  durationUnavailableCount: number;
  speedExcludedSampleCount: number;
  outputRateSampleCount: number;
  outputRateUnavailableCount: number;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cacheReadTokens: number | null;
  totalCostUsd: number | null;
  costPerRunUsd: number | null;
  costPerMinuteUsd: number | null;
  outputTokensPerDollar: number | null;
  cachePercentage: number | null;
  outputTokensPerSecondP50: number | null;
  outputTokensPerSecondP95: number | null;
  totalTokensPerSecondP50: number | null;
  totalTokensPerSecondP95: number | null;
}

export interface EfficiencyModelRollup extends EfficiencyMetricRollup {
  model: string;
  harness: 'claude-sdk' | 'pi' | null;
  provider: string | null;
}

export interface EfficiencyProfileRollup extends EfficiencyMetricRollup {
  profileName: string;
}

export interface EfficiencyAnalyticsSummary {
  windowDays: number;
  startedAt: string;
  endedAt: string;
  agentResultCount: number;
  runCount: number;
  sessionCount: number;
  missingModelAttributionCount: number;
  missingProfileAttributionCount: number;
  models: EfficiencyModelRollup[];
  profiles: EfficiencyProfileRollup[];
}
