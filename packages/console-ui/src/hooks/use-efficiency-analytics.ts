import * as React from 'react';
import { API_ROUTES } from '@eforge-build/client/browser';
import type { EfficiencyAnalyticsSummary } from '@eforge-build/client/browser';

const POLL_INTERVAL_MS = 60_000;

export const EFFICIENCY_ANALYTICS_WINDOWS = [1, 7, 14, 30, 90] as const;
export type EfficiencyAnalyticsWindowDays = (typeof EFFICIENCY_ANALYTICS_WINDOWS)[number];

export function useEfficiencyAnalytics(
  windowDays: EfficiencyAnalyticsWindowDays,
  refreshKey?: number,
): EfficiencyAnalyticsSummary | null {
  const [dataByWindow, setDataByWindow] = React.useState<Partial<Record<EfficiencyAnalyticsWindowDays, EfficiencyAnalyticsSummary>>>({});

  React.useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const query = new URLSearchParams({ days: String(windowDays) });
        const res = await fetch(`${API_ROUTES.efficiencyAnalytics}?${query.toString()}`);
        if (!res.ok) return;
        const json = (await res.json()) as EfficiencyAnalyticsSummary;
        if (!cancelled) setDataByWindow((current) => ({ ...current, [windowDays]: json }));
      } catch {
        // Keep the last successful payload across transient transport failures.
      }
    };

    void load();
    const id = setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [windowDays, refreshKey]);

  return dataByWindow[windowDays] ?? null;
}
