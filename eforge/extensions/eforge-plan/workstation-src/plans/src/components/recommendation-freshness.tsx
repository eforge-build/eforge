import * as React from 'react';
import type { RecommendationFreshnessView, RecommendationStatus, RecommendationStatusState } from '@/types';

const BADGE_TONE: Record<RecommendationStatusState, string> = {
  missing: 'border-[color:var(--prio-medium)]/40 text-[color:var(--prio-medium)] bg-[color:var(--prio-medium)]/10',
  fresh: 'border-[color:var(--lane-ready)]/40 text-[color:var(--lane-ready)] bg-[color:var(--lane-ready)]/10',
  stale: 'border-[color:var(--prio-medium)]/40 text-[color:var(--prio-medium)] bg-[color:var(--prio-medium)]/10',
};

export function abbreviateSourceFingerprint(value: string | undefined): string {
  if (!value) return 'unknown';
  return value.length <= 16 ? value : `${value.slice(0, 8)}…${value.slice(-8)}`;
}

export function recommendationFreshnessState(freshness?: RecommendationFreshnessView | null, status?: RecommendationStatus | null): RecommendationStatusState | null {
  return freshness?.state ?? status?.state ?? null;
}

export function RecommendationFreshnessBadge({ freshness, status, prefix }: { freshness?: RecommendationFreshnessView | null; status?: RecommendationStatus | null; prefix?: string }) {
  const state = recommendationFreshnessState(freshness, status);
  if (!state) return null;
  return <span className={`rounded border px-1.5 py-0.5 text-2xs uppercase tracking-wide ${BADGE_TONE[state]}`}>{prefix ? `${prefix} ${state}` : state}</span>;
}

export function RecommendationFreshnessLine({ freshness, status }: { freshness?: RecommendationFreshnessView | null; status?: RecommendationStatus | null }) {
  if (freshness) {
    return (
      <p className="mt-0.5 text-2xs text-muted-foreground">
        {freshness.reason}
        <Fingerprint label="stored" value={freshness.storedSourceFingerprint} />
        <Fingerprint label="compared" value={freshness.comparedSourceFingerprint} />
        {freshness.baselineTaskId && <> · baseline task <span title={freshness.baselineTaskId}>{freshness.baselineTaskId}</span></>}
      </p>
    );
  }
  if (!status) return null;
  const parts: React.ReactNode[] = [];
  if (status.sourceFingerprint) parts.push(<Fingerprint key="source" label="source" value={status.sourceFingerprint} />);
  if (status.lastAppliedSourceFingerprint) parts.push(<Fingerprint key="applied" label="applied" value={status.lastAppliedSourceFingerprint} />);
  return parts.length > 0 ? <p className="mt-0.5 text-2xs text-muted-foreground">{parts}</p> : null;
}

function Fingerprint({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return <> · {label} <span title={value}>{abbreviateSourceFingerprint(value)}</span></>;
}
