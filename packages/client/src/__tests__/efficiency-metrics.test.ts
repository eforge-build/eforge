import { describe, expect, it } from 'vitest';
import {
  computeCachePercentage,
  computeCostBurnRate,
  computeOutputGenerationRate,
  computeOutputTokensPerDollar,
  computeTotalTokenTrafficRate,
  nearestRankPercentile,
} from '../efficiency-metrics.js';

describe('efficiency metric formulas', () => {
  it('computes output generation rate in output tokens per second', () => {
    expect(computeOutputGenerationRate(600, 4000)).toBe(150);
  });

  it('returns null instead of coercing missing or invalid denominators to zero', () => {
    for (const denominator of [0, -1, null, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(computeOutputGenerationRate(600, denominator)).toBeNull();
      expect(computeTotalTokenTrafficRate(1000, denominator)).toBeNull();
      expect(computeCostBurnRate(1, denominator)).toBeNull();
      expect(computeOutputTokensPerDollar(600, denominator)).toBeNull();
      expect(computeCachePercentage(100, denominator)).toBeNull();
    }
  });

  it('computes all shared rate and ratio helpers with explicit units', () => {
    expect(computeOutputGenerationRate(600, 4000)).toBe(150);
    expect(computeTotalTokenTrafficRate(1200, 4000)).toBe(300);
    expect(computeCostBurnRate(3, 120_000)).toBe(1.5);
    expect(computeOutputTokensPerDollar(600, 3)).toBe(200);
    expect(computeCachePercentage(250, 1000)).toBe(25);
  });

  it('returns null instead of coercing missing or invalid numerators to zero', () => {
    for (const numerator of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(computeOutputGenerationRate(numerator, 1000)).toBeNull();
      expect(computeTotalTokenTrafficRate(numerator, 1000)).toBeNull();
      expect(computeCostBurnRate(numerator, 60_000)).toBeNull();
      expect(computeOutputTokensPerDollar(numerator, 1)).toBeNull();
      expect(computeCachePercentage(numerator, 100)).toBeNull();
    }
  });

  it('preserves numeric zero when the numerator is available', () => {
    expect(computeOutputGenerationRate(0, 1000)).toBe(0);
    expect(computeTotalTokenTrafficRate(0, 1000)).toBe(0);
    expect(computeCostBurnRate(0, 60_000)).toBe(0);
    expect(computeOutputTokensPerDollar(0, 1)).toBe(0);
    expect(computeCachePercentage(0, 100)).toBe(0);
  });
});

describe('nearestRankPercentile', () => {
  it('returns nearest-rank p50/p95 for odd samples', () => {
    expect(nearestRankPercentile([1, 3, 5], 50)).toBe(3);
    expect(nearestRankPercentile([1, 3, 5], 95)).toBe(5);
  });

  it('returns nearest-rank p50/p95 for even samples', () => {
    expect(nearestRankPercentile([1, 2, 3, 4], 50)).toBe(2);
    expect(nearestRankPercentile([1, 2, 3, 4], 95)).toBe(4);
  });

  it('handles one-item and empty sample arrays', () => {
    expect(nearestRankPercentile([42], 95)).toBe(42);
    expect(nearestRankPercentile([], 50)).toBeNull();
  });
});
