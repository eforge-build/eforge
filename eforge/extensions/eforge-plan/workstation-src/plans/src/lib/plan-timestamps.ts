import type { Artifact, LifecycleLinkRow, PlanData, PlanDetail } from '@/types';

export const TIMESTAMP_PLACEHOLDER = '—';

export type ProjectedTimestampKey = 'createdAt' | 'updatedAt' | 'readyAt' | 'submittedAt' | 'lastBuildActivityAt';

export interface ProjectedTimestampFields {
  createdAt?: string | null;
  updatedAt?: string | null;
  readyAt?: string | null;
  submittedAt?: string | null;
  lastBuildActivityAt?: string | null;
}

export interface LifecycleTimestampRows {
  lifecycleLinks?: LifecycleLinkRow[];
  linkRows?: LifecycleLinkRow[];
  failureEvidence?: LifecycleLinkRow[];
}

type TimestampSource = ProjectedTimestampFields & LifecycleTimestampRows & {
  prRefs?: Array<{ status?: string; updatedAt?: string | null; createdAt?: string | null }>;
  landingRefs?: Array<{ landedAt?: string | null; updatedAt?: string | null }>;
};

export function normalizeTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString();
}

export function selectFirstTimestamp(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const normalized = normalizeTimestamp(value);
    if (normalized) return normalized;
  }
  return null;
}

export function selectLatestTimestamp(values: Array<string | null | undefined>): string | null {
  let latest: string | null = null;
  let latestMs = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    const normalized = normalizeTimestamp(value);
    if (!normalized) continue;
    const ms = Date.parse(normalized);
    if (ms > latestMs) {
      latest = normalized;
      latestMs = ms;
    }
  }
  return latest;
}

export function selectBuildActivityTimestamp(source: TimestampSource | null | undefined): string | null {
  if (!source) return null;
  return selectFirstTimestamp(source.lastBuildActivityAt, selectLatestTimestamp([
    ...timestampsFromRows(source.lifecycleLinks),
    ...timestampsFromRows(source.linkRows),
    ...timestampsFromRows(source.failureEvidence),
    ...(source.prRefs ?? []).flatMap((ref) => [ref.updatedAt, ref.createdAt]),
    ...(source.landingRefs ?? []).flatMap((ref) => [ref.landedAt, ref.updatedAt]),
  ]));
}

export function selectPlanRecencyTimestamp(source: TimestampSource | null | undefined): string | null {
  if (!source) return null;
  return selectLatestTimestamp([
    source.updatedAt,
    source.readyAt,
    source.submittedAt,
    source.createdAt,
    selectBuildActivityTimestamp(source),
  ]);
}

export function planLifecycleTimestamps(detail: (PlanDetail & { plan?: PlanData }) | null | undefined, artifact?: Artifact | null): Record<ProjectedTimestampKey, string | null> {
  const plan = detail?.plan as (PlanData & ProjectedTimestampFields) | undefined;
  const artifactTimestamps = artifact as (Artifact & ProjectedTimestampFields) | null | undefined;
  const merged: TimestampSource = {
    ...artifactTimestamps,
    ...plan,
    lifecycleLinks: plan?.lifecycleLinks ?? artifact?.lifecycleLinks ?? detail?.lifecycle?.linkRows,
    linkRows: plan?.linkRows ?? artifact?.linkRows ?? detail?.lifecycle?.linkRows,
    failureEvidence: plan?.failureEvidence ?? artifact?.failureEvidence ?? detail?.lifecycle?.failureEvidence,
    prRefs: plan?.prRefs ?? artifact?.prRefs,
    landingRefs: plan?.landingRefs ?? artifact?.landingRefs,
  };
  return {
    createdAt: selectFirstTimestamp(plan?.createdAt, artifactTimestamps?.createdAt),
    updatedAt: selectFirstTimestamp(plan?.updatedAt, artifactTimestamps?.updatedAt),
    readyAt: selectFirstTimestamp(plan?.readyAt, artifactTimestamps?.readyAt),
    submittedAt: selectFirstTimestamp(plan?.submittedAt, artifactTimestamps?.submittedAt),
    lastBuildActivityAt: selectBuildActivityTimestamp(merged),
  };
}

function timestampsFromRows(rows: LifecycleLinkRow[] | undefined): Array<string | null | undefined> {
  return (rows ?? []).flatMap((row) => [row.timestamp, row.promotedAt, row.queuedAt, row.startedAt, row.completedAt, row.landedAt]);
}
