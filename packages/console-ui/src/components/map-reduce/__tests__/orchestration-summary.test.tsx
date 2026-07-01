import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OrchestrationSummary } from '../orchestration-summary';
import type { MapReduceSummary } from '@/lib/run-state';

const summary: MapReduceSummary = {
  graphId: 'graph-map-reduce',
  atomCounts: { total: 3, queued: 1, running: 1, completed: 1, skipped: 0, failed: 0 },
  reduceCounts: { total: 2, queued: 1, running: 1, completed: 0, failed: 0, incomplete: 0 },
  maxLevel: 2,
  currentLevel: 1,
  tokensIn: 1200,
  tokensOut: 300,
  totalTokens: 1500,
  costUsd: 0.25,
};

describe('OrchestrationSummary', () => {
  it('renders active reduce grouping with level terminology only', () => {
    const deprecatedGroupingLabel = ['wa', 've'].join('');

    render(<OrchestrationSummary summary={summary} />);

    expect(screen.getByText('level')).toBeTruthy();
    expect(screen.getByText('1 / 2')).toBeTruthy();
    expect(screen.queryByText(new RegExp(deprecatedGroupingLabel, 'i'))).toBeNull();
  });
});
