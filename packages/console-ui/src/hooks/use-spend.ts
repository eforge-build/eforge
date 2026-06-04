/**
 * useSpend — fetches the daily token/dollar spend rollup (GET /api/spend).
 *
 * Spend is a REST read rather than part of the SSE snapshot: it is a `GROUP BY
 * day` aggregation over the events table, not per-run state. The hook polls on
 * a slow interval and refetches whenever `refreshKey` changes (the dashboard
 * passes its run count so a completed build refreshes the totals promptly).
 * Keeps the last good payload across transient fetch failures.
 */
import * as React from 'react';
import { API_ROUTES } from '@eforge-build/client/browser';
import type { SpendSummary } from '@eforge-build/client/browser';

const POLL_INTERVAL_MS = 60_000;

export function useSpend(windowDays = 7, refreshKey?: number): SpendSummary | null {
  const [data, setData] = React.useState<SpendSummary | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch(`${API_ROUTES.spend}?days=${windowDays}`);
        if (!res.ok) return;
        const json = (await res.json()) as SpendSummary;
        if (!cancelled) setData(json);
      } catch {
        // Keep the last good payload; the next tick retries.
      }
    };

    void load();
    const id = setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [windowDays, refreshKey]);

  return data;
}
