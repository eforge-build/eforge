/**
 * useBuildMetricHistory — accrues a short rolling history of each active
 * build's cumulative tokens and cost, sampled once per dashboard tick. The
 * run-state only exposes current totals, so the sparklines need this
 * client-side buffer to show velocity over time.
 *
 * Sampling is keyed on the `now` tick: at most one sample per session per tick,
 * regardless of how many times the component re-renders within that tick.
 */
import * as React from 'react';
import type { SparklineSample } from '@/components/charts/velocity-sparkline';

export interface BuildMetricSamples {
  tokens: SparklineSample[];
  cost: SparklineSample[];
}

export interface BuildMetricInput {
  sessionId: string;
  tokens: number;
  cost: number;
}

/** Keep ~5 minutes of history at a 5s cadence. */
const MAX_SAMPLES = 60;

function appended(prev: SparklineSample[], t: number, value: number): SparklineSample[] {
  const next = [...prev, { t, value }];
  return next.length > MAX_SAMPLES ? next.slice(next.length - MAX_SAMPLES) : next;
}

export function useBuildMetricHistory(
  builds: BuildMetricInput[],
  now: number,
): Map<string, BuildMetricSamples> {
  const storeRef = React.useRef<Map<string, BuildMetricSamples>>(new Map());
  const lastTickRef = React.useRef<number | null>(null);

  // Sample once per tick. Mutating the ref during render is idempotent here
  // because the tick guard prevents duplicate appends for the same `now`.
  if (lastTickRef.current !== now) {
    lastTickRef.current = now;
    const store = storeRef.current;
    const liveIds = new Set(builds.map((b) => b.sessionId));
    for (const id of [...store.keys()]) {
      if (!liveIds.has(id)) store.delete(id);
    }
    for (const build of builds) {
      const prev = store.get(build.sessionId) ?? { tokens: [], cost: [] };
      store.set(build.sessionId, {
        tokens: appended(prev.tokens, now, build.tokens),
        cost: appended(prev.cost, now, build.cost),
      });
    }
  }

  return storeRef.current;
}
