import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { EfficiencyAnalyticsCard } from '@/components/now/efficiency-analytics-card';
import type { EfficiencyAnalyticsRow, EfficiencyAnalyticsViewModel } from '@/lib/selectors/efficiency-analytics';

function modelRow(overrides: Partial<EfficiencyAnalyticsRow> = {}): EfficiencyAnalyticsRow {
  return {
    kind: 'model',
    id: 'claude-opus::pi::openrouter',
    label: 'claude-opus-4-7',
    sublabel: 'pi · openrouter',
    p50OutputTokensPerSecond: { value: 4.2, availability: 'available', sampleCount: 3 },
    p95OutputTokensPerSecond: { value: 9.8, availability: 'available', sampleCount: 3 },
    costPerRunUsd: { value: 1.25, availability: 'available', sampleCount: 2 },
    costPerMinuteUsd: { value: 0.5, availability: 'available', sampleCount: 2 },
    outputTokensPerDollar: { value: 1234, availability: 'available', sampleCount: 2 },
    successCount: 1,
    failureCount: 1,
    runCount: 2,
    sampleCount: 2,
    speedSampleCount: 3,
    runSampleCount: 2,
    partialLabel: null,
    cachePercentage: 88.4,
    totalCostUsd: 12.5,
    outputTokens: 1_200_000,
    ...overrides,
  };
}

function viewModel(overrides: Partial<EfficiencyAnalyticsViewModel> = {}): EfficiencyAnalyticsViewModel {
  return {
    hasData: true,
    windowDays: 7,
    agentResultCount: 2,
    runCount: 2,
    sessionCount: 1,
    missingModelAttributionCount: 1,
    missingProfileAttributionCount: 0,
    noDataLabel: 'No efficiency analytics in the last 7d yet.',
    models: [modelRow()],
    profiles: [{
      kind: 'profile',
      id: 'unattributed',
      label: 'Unattributed profile',
      sublabel: null,
      p50OutputTokensPerSecond: { value: null, availability: 'partial', sampleCount: 1 },
      p95OutputTokensPerSecond: { value: null, availability: 'unavailable', sampleCount: 0 },
      costPerRunUsd: { value: null, availability: 'partial', sampleCount: 1 },
      costPerMinuteUsd: { value: null, availability: 'unavailable', sampleCount: 0 },
      outputTokensPerDollar: { value: null, availability: 'partial', sampleCount: 1 },
      successCount: 1,
      failureCount: 0,
      runCount: 1,
      sampleCount: 1,
      speedSampleCount: 0,
      runSampleCount: 1,
      partialLabel: '1 missing duration',
      cachePercentage: null,
      totalCostUsd: null,
      outputTokens: null,
    }],
    ...overrides,
  };
}

describe('EfficiencyAnalyticsCard - compact rows', () => {
  it('renders collapsed rows with name, rate, cost/run, and ok/failed counts', () => {
    render(<EfficiencyAnalyticsCard model={viewModel()} selectedWindow={7} onWindowChange={vi.fn()} />);

    expect(screen.getByText('Efficiency analytics')).toBeDefined();
    expect(screen.getByText('opus-4-7')).toBeDefined();
    expect(screen.getByText('pi · openrouter')).toBeDefined();
    expect(screen.getByText('Unattributed profile')).toBeDefined();
    expect(screen.getByText('4 out tok/s')).toBeDefined();
    expect(screen.getByText('$1.25')).toBeDefined();
    // Collapsed rows keep the detail tiles hidden.
    expect(screen.queryByText('p95 output rate')).toBeNull();
    expect(screen.queryByText('cost / min')).toBeNull();
  });

  it('does not render the explanatory paragraph in the card body (moved to tooltip)', () => {
    render(<EfficiencyAnalyticsCard model={viewModel()} selectedWindow={7} onWindowChange={vi.fn()} />);
    expect(screen.queryByText(/Historical telemetry proxies/)).toBeNull();
    expect(screen.getByLabelText('How these metrics are computed')).toBeDefined();
  });

  it('expands a row on click to reveal the full stat tiles and partial detail', () => {
    render(<EfficiencyAnalyticsCard model={viewModel()} selectedWindow={7} onWindowChange={vi.fn()} />);

    fireEvent.click(screen.getByText('opus-4-7'));
    expect(screen.getByText('p50 output rate')).toBeDefined();
    expect(screen.getByText('p95 output rate')).toBeDefined();
    expect(screen.getByText('cost / min')).toBeDefined();
    expect(screen.getByText('output tokens / $')).toBeDefined();
    expect(screen.getByText('cache hit')).toBeDefined();
    expect(screen.getByText('88%')).toBeDefined();
    expect(screen.getByText('total cost')).toBeDefined();
    expect(screen.getByText('3 speed samples')).toBeDefined();

    fireEvent.click(screen.getByText('Unattributed profile'));
    expect(screen.getByText(/partial: 1 missing duration/)).toBeDefined();
    expect(screen.getByText('1 run samples')).toBeDefined();
  });

  it('caps each section at four rows with a show-all disclosure', () => {
    const models = Array.from({ length: 6 }, (_, i) =>
      modelRow({ id: `model-${i}`, label: `model-${i}`, sublabel: null }),
    );
    render(<EfficiencyAnalyticsCard model={viewModel({ models })} selectedWindow={7} onWindowChange={vi.fn()} />);

    expect(screen.queryByText('model-5')).toBeNull();
    fireEvent.click(screen.getByText('+ 2 more — show all'));
    expect(screen.getByText('model-5')).toBeDefined();
  });

  it('renders selectable window controls', () => {
    const onWindowChange = vi.fn();
    render(<EfficiencyAnalyticsCard model={viewModel()} selectedWindow={7} onWindowChange={onWindowChange} />);

    const group = screen.getByLabelText('Efficiency analytics window');
    for (const label of ['1d', '7d', '14d', '30d', '90d']) {
      expect(within(group).getByRole('button', { name: label })).toBeDefined();
    }

    fireEvent.click(within(group).getByRole('button', { name: '30d' }));
    expect(onWindowChange).toHaveBeenCalledWith(30);
  });

  it('renders a no-data state', () => {
    render(<EfficiencyAnalyticsCard model={viewModel({ hasData: false, models: [], profiles: [] })} selectedWindow={7} onWindowChange={vi.fn()} />);

    expect(screen.getByText('No efficiency analytics in the last 7d yet.')).toBeDefined();
    expect(screen.queryByText('By model')).toBeNull();
  });
});
