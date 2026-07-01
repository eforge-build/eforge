import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SummaryCards } from '../summary-cards';
import type { RunEfficiencyMetrics } from '@/lib/run-state';

function m(label: string, value: number | null, formula = `${label} formula`) {
  return { label, value, formula, availability: value == null ? 'unavailable' as const : 'available' as const, detail: `${label} detail` };
}

const efficiency: RunEfficiencyMetrics = {
  outputGenerationRate: m('output generation rate', 12),
  tokenTraffic: m('token traffic', 1200),
  costBurn: m('cost burn', 0.5),
  outputTokensPerDollar: m('output tokens / $', 2000),
  cacheContext: m('cache context', 25),
  raw: {
    outputTokensForRate: 120,
    durationApiMsForRate: 10_000,
    totalTokensWallClock: 1200,
    totalCostUsd: 1,
    totalCostUsdWallClock: 1,
    elapsedWallClockMs: 60_000,
    inputTokens: 1000,
    outputTokens: 200,
    cacheReadTokens: 250,
    cacheCreationTokens: 50,
  },
};

describe('SummaryCards', () => {
  it('renders build detail efficiency labels with formula tooltips', () => {
    render(
      <SummaryCards
        duration="1m"
        tokensIn={1000}
        tokensOut={200}
        cacheRead={250}
        cacheCreation={50}
        totalCost={1}
        plansCompleted={1}
        plansFailed={0}
        plansTotal={1}
        totalTurns={7}
        filesChanged={9}
        reviewCritical={2}
        reviewWarning={3}
        efficiency={efficiency}
      />,
    );
    for (const label of ['output generation rate', 'token traffic', 'cost burn', 'output tokens / $', 'cache context']) {
      expect(screen.getByText(`${label}:`)).toBeTruthy();
    }
    expect(screen.getByTitle(/output generation rate formula/)).toBeTruthy();
    expect(screen.getByText('Running')).toBeTruthy();
    expect(screen.getByText('1m')).toBeTruthy();
    expect(screen.getByText('1/1')).toBeTruthy();
    expect(screen.getByText('7')).toBeTruthy();
    expect(screen.getByText('1.2k')).toBeTruthy();
    expect(screen.getByText('(25% cached)')).toBeTruthy();
    expect(screen.getByText('$1.0000')).toBeTruthy();
    expect(screen.getByText('9')).toBeTruthy();
    expect(screen.getByText('2 critical')).toBeTruthy();
    expect(screen.getByText('3 warning')).toBeTruthy();
  });

  it('renders partial and unavailable efficiency metrics with detail in tooltips', () => {
    const partialEfficiency: RunEfficiencyMetrics = {
      ...efficiency,
      outputGenerationRate: {
        ...m('output generation rate', null),
        availability: 'partial',
        detail: 'Only finalized agent results are included.',
        sampleCounts: { included: 1, omitted: 2, total: 3 },
      },
      tokenTraffic: { ...m('token traffic', 0), availability: 'available' },
      outputTokensPerDollar: {
        ...m('output tokens / $', null),
        availability: 'unavailable',
        detail: 'Unavailable when total cost is zero or missing.',
      },
      cacheContext: {
        ...m('cache context', 25),
        detail: 'Cache creation tokens: 75.',
        availability: 'available',
      },
    };

    render(
      <SummaryCards
        duration="1m"
        tokensIn={1000}
        tokensOut={200}
        cacheRead={250}
        cacheCreation={75}
        totalCost={1}
        plansCompleted={1}
        plansFailed={0}
        plansTotal={1}
        totalTurns={1}
        filesChanged={0}
        reviewCritical={0}
        reviewWarning={0}
        efficiency={partialEfficiency}
      />,
    );

    expect(screen.getByText('partial')).toBeTruthy();
    expect(screen.getAllByText('unavailable').length).toBeGreaterThan(0);
    expect(screen.queryByText('0 out tok/s')).toBeNull();
    expect(screen.getByTitle(/output generation rate formula\. Only finalized agent results are included\. Samples: 1\/3\./)).toBeTruthy();
    expect(screen.getByTitle(/cache context formula\. Cache creation tokens: 75\./)).toBeTruthy();
    expect(screen.getByTitle(/output tokens \/ \$ formula\. Unavailable when total cost is zero or missing\./)).toBeTruthy();
  });
});
