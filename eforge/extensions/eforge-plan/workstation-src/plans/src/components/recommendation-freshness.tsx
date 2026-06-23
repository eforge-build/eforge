import * as React from 'react';
import { ToneChip } from '@/components/ui/tone-chip';
import { recommendationStateTone } from '@/lib/tone';
import type { RecommendationFreshnessView, RecommendationStatus, RecommendationStatusState } from '@/types';

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
  return <ToneChip tone={recommendationStateTone(state)} className="font-normal uppercase tracking-wide">{prefix ? `${prefix} ${state}` : state}</ToneChip>;
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
