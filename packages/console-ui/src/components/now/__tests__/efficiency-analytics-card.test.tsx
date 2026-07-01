import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { EfficiencyAnalyticsCard } from '@/components/now/efficiency-analytics-card';
import type { EfficiencyAnalyticsViewModel } from '@/lib/selectors/efficiency-analytics';

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
    models: [{
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
    }],
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
    }],
    ...overrides,
  };
}

describe('EfficiencyAnalyticsCard', () => {
  it('renders metric labels, model/profile rows, and partial state text', () => {
    render(<EfficiencyAnalyticsCard model={viewModel()} selectedWindow={7} onWindowChange={vi.fn()} />);

    expect(screen.getByText('Efficiency analytics')).toBeDefined();
    expect(screen.getByText('opus-4-7')).toBeDefined();
    expect(screen.getByText('pi · openrouter')).toBeDefined();
    expect(screen.getByText('Unattributed profile')).toBeDefined();
    expect(screen.getAllByText('p50 output rate').length).toBeGreaterThan(0);
    expect(screen.getAllByText('p95 output rate').length).toBeGreaterThan(0);
    expect(screen.getAllByText('cost / run').length).toBeGreaterThan(0);
    expect(screen.getAllByText('cost / min').length).toBeGreaterThan(0);
    expect(screen.getAllByText('output tokens / $').length).toBeGreaterThan(0);
    expect(screen.getByText('3 speed samples')).toBeDefined();
    expect(screen.getByText('1 run samples')).toBeDefined();
    expect(screen.getByText(/partial: 1 missing duration/)).toBeDefined();
    expect(screen.getAllByText('partial').length).toBeGreaterThan(0);
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
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
