import * as React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockRecommendationFreshnessFresh, mockRecommendationFreshnessMissing, mockRecommendationFreshnessStale, mockRecommendationStatusFresh } from '@/fixtures/mock-data';
import { RecommendationFreshnessBadge, RecommendationFreshnessLine } from './recommendation-freshness';

describe('RecommendationFreshnessBadge', () => {
  it('renders missing, fresh, and stale states from server freshness views', () => {
    const { rerender } = render(<RecommendationFreshnessBadge freshness={mockRecommendationFreshnessMissing} />);
    expect(screen.getByText('missing')).toBeTruthy();

    rerender(<RecommendationFreshnessBadge freshness={mockRecommendationFreshnessFresh} />);
    expect(screen.getByText('fresh')).toBeTruthy();

    rerender(<RecommendationFreshnessBadge freshness={mockRecommendationFreshnessStale} />);
    expect(screen.getByText('stale')).toBeTruthy();
  });

  it('does not infer fresh when no server freshness or status is present', () => {
    render(<RecommendationFreshnessBadge />);
    expect(screen.queryByText('fresh')).toBeNull();
  });

  it('falls back to compatibility status when supplied', () => {
    render(<RecommendationFreshnessBadge status={mockRecommendationStatusFresh} />);
    expect(screen.getByText('fresh')).toBeTruthy();
  });
});

describe('RecommendationFreshnessLine', () => {
  it('renders reason text and abbreviated fingerprints with full title values', () => {
    render(<RecommendationFreshnessLine freshness={mockRecommendationFreshnessStale} />);

    expect(screen.getByText(/Recommendation source fingerprint drifted/i)).toBeTruthy();
    expect(screen.getByTitle('old-source-fingerprint')).toBeTruthy();
    expect(screen.getByTitle('current-source-fingerprint')).toBeTruthy();
    expect(screen.getByText('old-sour…gerprint')).toBeTruthy();
    expect(screen.getByText('current-…gerprint')).toBeTruthy();
  });
});
