import type { RecommendationStaleReason, RecommendationStatusSidecar } from './recommendation-status-schemas.js';

export interface StoredRecommendationFreshnessStatus {
  currentExists: boolean;
  sidecar: RecommendationStatusSidecar | null;
  invalidReason?: RecommendationStaleReason;
}

export interface RecommendationFreshnessView {
  state: 'missing' | 'fresh' | 'stale';
  reason: string;
  storedSourceFingerprint?: string;
  comparedSourceFingerprint: string;
  baselineTaskId?: string;
}

export function deriveRecommendationFreshnessView(input: {
  storedStatus: StoredRecommendationFreshnessStatus;
  comparedSourceFingerprint: string;
  baselineTaskId?: string;
}): RecommendationFreshnessView {
  const { storedStatus, comparedSourceFingerprint, baselineTaskId } = input;
  const storedSourceFingerprint = storedStatus.sidecar?.lastAppliedSourceFingerprint;
  const base = {
    comparedSourceFingerprint,
    ...(storedSourceFingerprint !== undefined && { storedSourceFingerprint }),
    ...(baselineTaskId !== undefined && { baselineTaskId }),
  };
  if (storedStatus.invalidReason !== undefined) {
    return { state: 'stale', reason: staleReasonText(storedStatus.invalidReason, 'Recommendation status metadata is invalid.'), ...base };
  }
  if (!storedStatus.currentExists && storedStatus.sidecar === null) {
    return { state: 'missing', reason: 'No current recommendation model or freshness metadata exists.', ...base };
  }
  if (storedStatus.sidecar === null) {
    return { state: 'stale', reason: 'Recommendation status metadata sidecar is missing.', ...base };
  }
  if (!storedStatus.currentExists) {
    return { state: 'stale', reason: 'Recommendation status metadata exists but the current recommendation model is missing.', ...base };
  }
  if (storedStatus.sidecar.lastAppliedAt === undefined || storedStatus.sidecar.lastAppliedSourceFingerprint === undefined) {
    return { state: 'stale', reason: 'Recommendation status metadata is missing freshness metadata.', ...base };
  }
  const persistedReason = sidecarReasons(storedStatus.sidecar)[0];
  if (persistedReason !== undefined) {
    return { state: 'stale', reason: staleReasonText(persistedReason, 'Recommendation status metadata contains persisted stale reasons.'), ...base };
  }
  if (storedStatus.sidecar.lastAppliedSourceFingerprint !== comparedSourceFingerprint) {
    return { state: 'stale', reason: 'Recommendation source fingerprint drifted since the model was last applied.', ...base };
  }
  return { state: 'fresh', reason: 'Recommendation model is fresh for the compared source fingerprint.', ...base };
}

function sidecarReasons(sidecar: RecommendationStatusSidecar): RecommendationStaleReason[] {
  return sidecar.reasons ?? sidecar.staleReasons ?? [];
}

function staleReasonText(reason: RecommendationStaleReason, fallback: string): string {
  return firstNonEmpty(reason.summary, reason.message, fallback);
}

function firstNonEmpty(...values: Array<string | undefined>): string {
  return values.find((value): value is string => value !== undefined && value.length > 0) ?? 'Recommendation freshness is stale.';
}
