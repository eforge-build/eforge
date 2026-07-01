import { describe, expect, it } from 'vitest';
import type { EfficiencyAnalyticsSummary } from '@eforge-build/client/browser';
import { selectEfficiencyAnalyticsViewModel } from '@/lib/selectors/efficiency-analytics';

function summary(overrides: Partial<EfficiencyAnalyticsSummary> = {}): EfficiencyAnalyticsSummary {
  return {
    windowDays: 7,
    startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: '2026-01-08T00:00:00.000Z',
    agentResultCount: 3,
    runCount: 2,
    sessionCount: 2,
    missingModelAttributionCount: 0,
    missingProfileAttributionCount: 0,
    models: [],
    profiles: [],
    ...overrides,
  };
}

describe('selectEfficiencyAnalyticsViewModel', () => {
  it('maps model labels with harness/provider and sample counts', () => {
    const model = selectEfficiencyAnalyticsViewModel(summary({
      models: [{
        model: 'claude-opus-4-7',
        harness: 'pi',
        provider: 'openrouter',
        runCount: 2,
        successCount: 1,
        failureCount: 1,
        sampleCount: 2,
        costSampleCount: 2,
        tokenSampleCount: 2,
        durationSampleCount: 2,
        durationUnavailableCount: 0,
        speedExcludedSampleCount: 0,
        outputRateSampleCount: 2,
        outputRateUnavailableCount: 0,
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        cacheReadTokens: 25,
        totalCostUsd: 1.5,
        costPerRunUsd: 0.75,
        costPerMinuteUsd: 0.5,
        outputTokensPerDollar: 33.3,
        cachePercentage: 25,
        outputTokensPerSecondP50: 4,
        outputTokensPerSecondP95: 8,
        totalTokensPerSecondP50: 12,
        totalTokensPerSecondP95: 16,
      }],
    }));

    expect(model.hasData).toBe(true);
    expect(model.models[0]).toMatchObject({
      label: 'claude-opus-4-7',
      sublabel: 'pi · openrouter',
      successCount: 1,
      failureCount: 1,
      speedSampleCount: 2,
    });
    expect(model.models[0].p50OutputTokensPerSecond).toEqual({ value: 4, availability: 'available', sampleCount: 2 });
  });

  it('maps blank profiles to an unattributed label and run sample count', () => {
    const model = selectEfficiencyAnalyticsViewModel(summary({
      profiles: [{
        profileName: '   ',
        runCount: 3,
        successCount: 3,
        failureCount: 0,
        sampleCount: 3,
        costSampleCount: 3,
        tokenSampleCount: 3,
        durationSampleCount: 2,
        durationUnavailableCount: 1,
        speedExcludedSampleCount: 0,
        outputRateSampleCount: 2,
        outputRateUnavailableCount: 0,
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        cacheReadTokens: 25,
        totalCostUsd: 3,
        costPerRunUsd: 1,
        costPerMinuteUsd: 0.25,
        outputTokensPerDollar: 16.6,
        cachePercentage: 25,
        outputTokensPerSecondP50: 2,
        outputTokensPerSecondP95: 4,
        totalTokensPerSecondP50: 6,
        totalTokensPerSecondP95: 8,
      }],
    }));

    expect(model.profiles[0].label).toBe('Unattributed profile');
    expect(model.profiles[0].runSampleCount).toBe(3);
    expect(model.profiles[0].partialLabel).toContain('1 missing duration');
  });

  it('uses metric sample count rather than run count for model partial labels', () => {
    const model = selectEfficiencyAnalyticsViewModel(summary({
      models: [{
        model: 'claude-sonnet-4-5',
        harness: null,
        provider: null,
        runCount: 1,
        successCount: 1,
        failureCount: 0,
        sampleCount: 2,
        costSampleCount: 1,
        tokenSampleCount: 2,
        durationSampleCount: 2,
        durationUnavailableCount: 0,
        speedExcludedSampleCount: 0,
        outputRateSampleCount: 2,
        outputRateUnavailableCount: 0,
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        cacheReadTokens: 25,
        totalCostUsd: 1,
        costPerRunUsd: 1,
        costPerMinuteUsd: 0.5,
        outputTokensPerDollar: 50,
        cachePercentage: 25,
        outputTokensPerSecondP50: 2,
        outputTokensPerSecondP95: 3,
        totalTokensPerSecondP50: 4,
        totalTokensPerSecondP95: 5,
      }],
    }));

    expect(model.models[0].partialLabel).toContain('partial cost');
    expect(model.models[0].partialLabel).not.toContain('partial tokens');
  });

  it('uses collapsed profile sample count rather than run count for profile partial labels', () => {
    const model = selectEfficiencyAnalyticsViewModel(summary({
      profiles: [{
        profileName: 'shared',
        runCount: 2,
        successCount: 2,
        failureCount: 0,
        sampleCount: 1,
        costSampleCount: 1,
        tokenSampleCount: 1,
        durationSampleCount: 1,
        durationUnavailableCount: 0,
        speedExcludedSampleCount: 0,
        outputRateSampleCount: 1,
        outputRateUnavailableCount: 0,
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        cacheReadTokens: 25,
        totalCostUsd: 1,
        costPerRunUsd: 0.5,
        costPerMinuteUsd: 0.5,
        outputTokensPerDollar: 50,
        cachePercentage: 25,
        outputTokensPerSecondP50: 2,
        outputTokensPerSecondP95: 2,
        totalTokensPerSecondP50: 3,
        totalTokensPerSecondP95: 3,
      }],
    }));

    expect(model.profiles[0].partialLabel).toBeNull();
  });

  it('marks null metrics as partial or unavailable instead of zero', () => {
    const model = selectEfficiencyAnalyticsViewModel(summary({
      models: [{
        model: 'claude-sonnet-4-5',
        harness: null,
        provider: null,
        runCount: 1,
        successCount: 0,
        failureCount: 1,
        sampleCount: 1,
        costSampleCount: 1,
        tokenSampleCount: 0,
        durationSampleCount: 0,
        durationUnavailableCount: 1,
        speedExcludedSampleCount: 1,
        outputRateSampleCount: 0,
        outputRateUnavailableCount: 0,
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        cacheReadTokens: null,
        totalCostUsd: null,
        costPerRunUsd: null,
        costPerMinuteUsd: null,
        outputTokensPerDollar: null,
        cachePercentage: null,
        outputTokensPerSecondP50: null,
        outputTokensPerSecondP95: null,
        totalTokensPerSecondP50: null,
        totalTokensPerSecondP95: null,
      }],
    }));

    expect(model.models[0].costPerRunUsd.availability).toBe('partial');
    expect(model.models[0].p50OutputTokensPerSecond.availability).toBe('unavailable');
    expect(model.models[0].partialLabel).toContain('partial tokens');
  });

  it('returns a no-data state when model and profile rollups are empty', () => {
    const model = selectEfficiencyAnalyticsViewModel(summary({ windowDays: 30 }));

    expect(model.hasData).toBe(false);
    expect(model.noDataLabel).toContain('last 30d');
  });
});
