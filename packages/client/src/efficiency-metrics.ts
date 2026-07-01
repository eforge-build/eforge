export type NullableMetric = number | null;

export interface MetricAvailability {
  available: boolean;
  unavailableReason?: 'missing-numerator' | 'missing-denominator' | 'invalid-denominator' | 'invalid-value';
}

function finiteNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function divideByPositiveDenominator(
  numerator: number | null | undefined,
  denominator: number | null | undefined,
): NullableMetric {
  const n = finiteNumber(numerator);
  const d = finiteNumber(denominator);
  if (n === null || d === null || d <= 0) return null;
  return n / d;
}

export function metricAvailability(value: number | null | undefined): MetricAvailability {
  return finiteNumber(value) === null ? { available: false, unavailableReason: 'invalid-value' } : { available: true };
}

export function computeOutputGenerationRate(
  outputTokens: number | null | undefined,
  durationApiMs: number | null | undefined,
): NullableMetric {
  const seconds = divideByPositiveDenominator(durationApiMs, 1000);
  return divideByPositiveDenominator(outputTokens, seconds);
}

export function computeTotalTokenTrafficRate(
  totalTokens: number | null | undefined,
  durationApiMs: number | null | undefined,
): NullableMetric {
  const seconds = divideByPositiveDenominator(durationApiMs, 1000);
  return divideByPositiveDenominator(totalTokens, seconds);
}

export function computeCostBurnRate(
  costUsd: number | null | undefined,
  durationApiMs: number | null | undefined,
): NullableMetric {
  const minutes = divideByPositiveDenominator(durationApiMs, 60_000);
  return divideByPositiveDenominator(costUsd, minutes);
}

export function computeOutputTokensPerDollar(
  outputTokens: number | null | undefined,
  costUsd: number | null | undefined,
): NullableMetric {
  return divideByPositiveDenominator(outputTokens, costUsd);
}

export function computeCachePercentage(
  cacheReadTokens: number | null | undefined,
  inputTokens: number | null | undefined,
): NullableMetric {
  const ratio = divideByPositiveDenominator(cacheReadTokens, inputTokens);
  return ratio === null ? null : ratio * 100;
}

export function nearestRankPercentile(samples: readonly number[], percentile: number): NullableMetric {
  if (!Number.isFinite(percentile)) return null;
  const finiteSamples = samples.filter((sample) => Number.isFinite(sample)).sort((a, b) => a - b);
  if (finiteSamples.length === 0) return null;
  const clamped = Math.min(100, Math.max(0, percentile));
  const rank = Math.max(1, Math.ceil((clamped / 100) * finiteSamples.length));
  return finiteSamples[rank - 1] ?? null;
}
