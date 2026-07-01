import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { API_ROUTES, type EfficiencyAnalyticsSummary } from '@eforge-build/client/browser';
import { useEfficiencyAnalytics, type EfficiencyAnalyticsWindowDays } from '@/hooks/use-efficiency-analytics';

function summary(windowDays: number): EfficiencyAnalyticsSummary {
  return {
    windowDays,
    startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: '2026-01-08T00:00:00.000Z',
    agentResultCount: 0,
    runCount: 0,
    sessionCount: 0,
    missingModelAttributionCount: 0,
    missingProfileAttributionCount: 0,
    models: [],
    profiles: [],
  };
}

function Harness({ days, refreshKey }: { days: EfficiencyAnalyticsWindowDays; refreshKey?: number }) {
  const data = useEfficiencyAnalytics(days, refreshKey);
  return <div>{data ? `window:${data.windowDays}` : 'loading'}</div>;
}

describe('useEfficiencyAnalytics', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it('fetches the client-owned analytics route with the selected days query', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      const days = Number(new URL(url, 'http://localhost').searchParams.get('days'));
      return Promise.resolve({ ok: true, json: () => Promise.resolve(summary(days)) } as Response);
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const { rerender } = render(<Harness days={7} />);

    await screen.findByText('window:7');
    expect(fetchMock).toHaveBeenCalledWith(`${API_ROUTES.efficiencyAnalytics}?days=7`);

    rerender(<Harness days={30} />);

    await screen.findByText('window:30');
    expect(fetchMock).toHaveBeenCalledWith(`${API_ROUTES.efficiencyAnalytics}?days=30`);
  });

  it('preserves the last successful payload across transient fetch failures', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(summary(14)) } as Response)
      .mockResolvedValueOnce({ ok: false, status: 503 } as Response);
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const { rerender } = render(<Harness days={14} refreshKey={1} />);

    await screen.findByText('window:14');
    rerender(<Harness days={14} refreshKey={2} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(screen.getByText('window:14')).toBeDefined();
  });
});
