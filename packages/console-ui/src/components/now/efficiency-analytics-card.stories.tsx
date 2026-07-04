import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { EfficiencyAnalyticsCard } from './efficiency-analytics-card';
import { selectEfficiencyAnalyticsViewModel } from '@/lib/selectors/efficiency-analytics';
import type { EfficiencyAnalyticsSummary, EfficiencyMetricRollup, EfficiencyModelRollup, EfficiencyProfileRollup } from '@eforge-build/client/browser';

/**
 * Stories author wire-level EfficiencyAnalyticsSummary fixtures and route them
 * through the *real* selectEfficiencyAnalyticsViewModel, so the card always
 * reflects the live view-model shape. Rows collapse to a P50 output-rate
 * comparison bar + cost/run; click a row to expand the full stat tiles.
 */

function rollup(overrides: Partial<EfficiencyMetricRollup> = {}): EfficiencyMetricRollup {
  return {
    runCount: 20,
    successCount: 18,
    failureCount: 2,
    sampleCount: 200,
    costSampleCount: 200,
    tokenSampleCount: 200,
    durationSampleCount: 200,
    durationUnavailableCount: 0,
    speedExcludedSampleCount: 0,
    outputRateSampleCount: 200,
    outputRateUnavailableCount: 0,
    inputTokens: 400_000_000,
    outputTokens: 4_000_000,
    totalTokens: 404_000_000,
    cacheReadTokens: 360_000_000,
    totalCostUsd: 420,
    costPerRunUsd: 21,
    costPerMinuteUsd: 0.33,
    outputTokensPerDollar: 9_500,
    cachePercentage: 90,
    outputTokensPerSecondP50: 43,
    outputTokensPerSecondP95: 54,
    totalTokensPerSecondP50: 4_300,
    totalTokensPerSecondP95: 5_400,
    ...overrides,
  };
}

function modelRollup(model: string, overrides: Partial<EfficiencyModelRollup> = {}): EfficiencyModelRollup {
  return { ...rollup(), model, harness: 'pi', provider: 'openai-codex', ...overrides };
}

function profileRollup(profileName: string, overrides: Partial<EfficiencyProfileRollup> = {}): EfficiencyProfileRollup {
  return { ...rollup(), profileName, ...overrides };
}

function summary(overrides: Partial<EfficiencyAnalyticsSummary> = {}): EfficiencyAnalyticsSummary {
  return {
    windowDays: 7,
    startedAt: '2026-06-27T00:00:00.000Z',
    endedAt: '2026-07-04T00:00:00.000Z',
    agentResultCount: 596,
    runCount: 57,
    sessionCount: 48,
    missingModelAttributionCount: 0,
    missingProfileAttributionCount: 21,
    models: [],
    profiles: [],
    ...overrides,
  };
}

const meta = {
  title: 'Now/EfficiencyAnalyticsCard',
  component: EfficiencyAnalyticsCard,
  parameters: { layout: 'padded' },
  args: { selectedWindow: 7 as const, onWindowChange: fn() },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 360 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof EfficiencyAnalyticsCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Several models with clearly different speeds/costs — the comparison bars carry the story. */
export const MultiModelComparison: Story = {
  args: {
    model: selectEfficiencyAnalyticsViewModel(summary({
      models: [
        modelRollup('gpt-5.5', { outputTokensPerSecondP50: 43, costPerRunUsd: 11.43 }),
        modelRollup('claude-opus-4-8', { harness: 'claude-sdk', provider: null, outputTokensPerSecondP50: 61, costPerRunUsd: 18.2, failureCount: 0, successCount: 20 }),
        modelRollup('claude-haiku-4-5', { harness: 'claude-sdk', provider: null, outputTokensPerSecondP50: 96, costPerRunUsd: 2.1 }),
      ],
      profiles: [
        profileRollup('pi-codex-5-5', { outputTokensPerSecondP50: 47, costPerRunUsd: 8.46, failureCount: 17, successCount: 12 }),
        profileRollup('default', { outputTokensPerSecondP50: 51, costPerRunUsd: 16.51 }),
      ],
    })),
  },
};

/** Rows with missing cost/duration samples render partial tints instead of bars. */
export const PartialAvailability: Story = {
  args: {
    model: selectEfficiencyAnalyticsViewModel(summary({
      models: [
        modelRollup('gpt-5.5'),
        modelRollup('mystery-model', {
          harness: null,
          provider: null,
          outputTokensPerSecondP50: null,
          outputTokensPerSecondP95: null,
          costPerRunUsd: null,
          costPerMinuteUsd: null,
          outputTokensPerDollar: null,
          cachePercentage: null,
          totalCostUsd: null,
          outputTokens: null,
          totalTokens: null,
          outputRateSampleCount: 3,
          outputRateUnavailableCount: 5,
          durationUnavailableCount: 4,
          costSampleCount: 1,
        }),
      ],
      missingModelAttributionCount: 2,
    })),
  },
};

/** A single model/profile pair — the common small-project shape. */
export const SingleModel: Story = {
  args: {
    model: selectEfficiencyAnalyticsViewModel(summary({
      models: [modelRollup('gpt-5.5')],
      profiles: [profileRollup('pi-codex-5-5')],
    })),
  },
};

/** More rows than the section cap — exercises the "+N more" disclosure. */
export const ManyModels: Story = {
  args: {
    model: selectEfficiencyAnalyticsViewModel(summary({
      models: Array.from({ length: 7 }, (_, i) =>
        modelRollup(`model-${i + 1}`, { outputTokensPerSecondP50: 30 + i * 9, costPerRunUsd: 3 + i * 2 }),
      ),
    })),
  },
};

/** Empty window. */
export const NoData: Story = {
  args: { model: selectEfficiencyAnalyticsViewModel(null) },
};
