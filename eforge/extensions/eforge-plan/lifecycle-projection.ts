import type { SessionPlan } from '@eforge-build/input';
import type {
  BacklogEpic,
  BacklogItem,
  EpicProgressProjection,
  ItemLifecycleProjection,
  LifecycleLinkRow,
  LifecycleState,
  PlanSourceRefs,
  SessionPlanLifecycleProjection,
  TraceSummary,
} from './backlog-domain.js';
import type { TraceLandingResult, TraceSidecar } from './schema.js';
import { getSessionPlanSourceMetadata } from './session-plan-metadata.js';

const FAILURE_STATUSES = new Set(['failed', 'skipped', 'cancelled', 'canceled']);
const SHIPPED_STATUSES = new Set(['shipped', 'landed', 'auto-merged']);
const MERGED_STATUSES = new Set(['merged']);
const PR_OPEN_STATUSES = new Set(['pr-open']);

// --- eforge:region plan-02-plan-04-trace-lifecycle-freshness ---
const TERMINAL_TRACE_STATUSES = new Set(['submitted', 'abandoned', 'completed', 'cancelled', 'canceled', 'failed', 'landed', 'shipped', 'skipped', 'superseded', 'stale', 'merged', 'auto-merged']);
const ACTIVE_LANDING_STATUSES = new Set(['pr-open', 'started', 'running']);

export interface TraceActivityContext {
  liveEditableSessionIds?: ReadonlySet<string>;
}

export function isActiveSessionPlanTraceEntry(
  entry: { session?: string; status?: string },
  context?: TraceActivityContext,
): boolean {
  if (entry.session === undefined || entry.session.length === 0) return false;
  if (entry.status !== undefined && TERMINAL_TRACE_STATUSES.has(entry.status)) return false;
  return context?.liveEditableSessionIds?.has(entry.session) === true;
}

export function isActiveQueueOrBuildTraceEntry(entry: { status?: string; completedAt?: string }): boolean {
  if (entry.completedAt !== undefined && entry.completedAt.length > 0) return false;
  return entry.status === undefined || !TERMINAL_TRACE_STATUSES.has(entry.status);
}

export function isActiveLandingTraceEntry(entry: { status?: string; prUrl?: string }): boolean {
  return entry.status !== undefined && ACTIVE_LANDING_STATUSES.has(entry.status);
}
// --- eforge:endregion plan-02-plan-04-trace-lifecycle-freshness ---

export interface TraceLifecycleProjection {
  lifecycleState: LifecycleState;
  linkRows: LifecycleLinkRow[];
  prRefs: LifecycleLinkRow[];
  landingRefs: LifecycleLinkRow[];
  failureEvidence: LifecycleLinkRow[];
}

export function projectTraceLifecycle(trace: TraceSidecar, context?: TraceActivityContext): TraceLifecycleProjection {
  const linkRows = [
    ...trace.promotedSessionPlans.map((entry) => compactRow({
      kind: 'session-plan',
      stage: 'planned',
      status: entry.status ?? 'planned',
      label: `Session plan ${entry.session}`,
      session: entry.session,
      path: entry.path,
      timestamp: entry.promotedAt,
      affectedItemIds: [trace.itemId],
    })),
    ...trace.queuePrds.map((entry) => compactRow({
      kind: 'queue-prd',
      stage: 'queue',
      status: entry.status ?? 'queued',
      label: `Queue PRD ${entry.prdId}`,
      prdId: entry.prdId,
      path: entry.path,
      timestamp: entry.queuedAt,
      affectedItemIds: [trace.itemId],
    })),
    ...trace.buildRuns.map((entry) => compactRow({
      kind: 'build-run',
      stage: 'build',
      status: entry.status ?? 'running',
      label: `Build run ${entry.runId}`,
      runId: entry.runId,
      sessionId: entry.sessionId,
      timestamp: entry.completedAt ?? entry.startedAt,
      completedAt: entry.completedAt,
      affectedItemIds: [trace.itemId],
    })),
    ...trace.buildSessions.map((entry) => compactRow({
      kind: 'build-session',
      stage: 'build',
      status: entry.status ?? 'running',
      label: `Build session ${entry.sessionId}`,
      sessionId: entry.sessionId,
      runId: entry.runId,
      timestamp: entry.completedAt ?? entry.startedAt,
      completedAt: entry.completedAt,
      affectedItemIds: [trace.itemId],
    })),
    ...trace.landingResults.map((entry) => landingRow(trace.itemId, entry)),
    ...(trace.lastEvent ? [compactRow({
      kind: 'last-event',
      stage: 'event',
      status: stringOrDefault(trace.lastEvent.type, 'recorded'),
      label: `Last event ${stringOrDefault(trace.lastEvent.type, 'recorded')}`,
      sessionId: trace.lastEvent.sessionId,
      runId: trace.lastEvent.runId,
      timestamp: trace.lastEvent.timestamp,
      affectedItemIds: [trace.itemId],
    })] : []),
  ].sort(compareRows);
  const failureEvidence = linkRows.filter((row) => FAILURE_STATUSES.has(row.status));
  const landingRefs = linkRows.filter((row) => row.kind === 'landing');
  const prRefs = linkRows.filter((row) => row.prUrl !== undefined || row.kind === 'pr');
  return {
    lifecycleState: stateFromRows(linkRows, context),
    linkRows,
    prRefs,
    landingRefs,
    failureEvidence,
  };
}

export function projectItemLifecycle(item: BacklogItem, trace: TraceSummary | undefined): ItemLifecycleProjection {
  return compactObject({
    itemId: item.id,
    title: item.title,
    status: item.status,
    epic: item.epic,
    lifecycleState: trace?.lifecycleState ?? stateFromBacklogStatus(item.status),
    linkRows: trace?.linkRows ?? [],
    failureEvidence: trace?.failureEvidence ?? [],
  }) as ItemLifecycleProjection;
}

export function projectSessionPlanSourceRefs(plan: SessionPlan): PlanSourceRefs {
  const metadata = getSessionPlanSourceMetadata(plan);
  if (metadata) {
    return compactObject({
      sourceItemIds: [...metadata.sourceItemIds].sort(),
      sourceEpicIds: [...metadata.sourceEpicIds].sort(),
      recommendationRef: metadata.sourceRecommendationRef,
      promotedAt: metadata.promotedAt,
    }) as PlanSourceRefs;
  }
  const extensionMetadata = asRecord((plan as SessionPlan & { eforge_plan?: unknown }).eforge_plan);
  return compactObject({
    sourceItemIds: uniqueStrings([...stringArray(extensionMetadata.source_item_ids), ...stringArray(extensionMetadata.source_item_id)]).sort(),
    sourceEpicIds: uniqueStrings([...stringArray(extensionMetadata.source_epic_ids), ...stringArray(extensionMetadata.source_epic_id)]).sort(),
    recommendationRef: stringOrUndefined(extensionMetadata.source_recommendation_ref),
    promotedAt: stringOrUndefined(extensionMetadata.promoted_at),
  }) as PlanSourceRefs;
}

export function projectSessionPlanLifecycle(input: {
  session: string;
  sourceRefs?: PlanSourceRefs;
  items: readonly BacklogItem[];
  epics: readonly BacklogEpic[];
  traceSummaries: readonly TraceSummary[];
}): SessionPlanLifecycleProjection {
  const traceByItemId = new Map(input.traceSummaries.map((trace) => [trace.itemId, trace]));
  const itemById = new Map(input.items.map((item) => [item.id, item]));
  const tracedSourceIds = input.traceSummaries
    .filter((trace) => trace.linkRows.some((row) => row.session === input.session))
    .map((trace) => trace.itemId);
  const sourceRefs = compactObject({
    sourceItemIds: uniqueStrings([...(input.sourceRefs?.sourceItemIds ?? []), ...tracedSourceIds]).sort(),
    sourceEpicIds: uniqueStrings(input.sourceRefs?.sourceEpicIds ?? []).sort(),
    recommendationRef: input.sourceRefs?.recommendationRef,
    promotedAt: input.sourceRefs?.promotedAt,
  }) as PlanSourceRefs;
  const itemRows = sourceRefs.sourceItemIds
    .map((itemId) => itemById.get(itemId))
    .filter((item): item is BacklogItem => item !== undefined)
    .map((item) => projectItemLifecycle(item, traceByItemId.get(item.id)))
    .sort(compareItemRows);
  const linkRows = input.traceSummaries
    .filter((trace) => sourceRefs.sourceItemIds.includes(trace.itemId) || trace.linkRows.some((row) => row.session === input.session))
    .flatMap((trace) => trace.linkRows.filter((row) => row.session === input.session || sourceRefs.sourceItemIds.includes(trace.itemId)))
    .sort(compareRows);
  return {
    sourceRefs,
    lifecycleState: aggregateLifecycleState(itemRows.map((row) => row.lifecycleState), linkRows),
    itemRows,
    linkRows,
    failureEvidence: linkRows.filter((row) => FAILURE_STATUSES.has(row.status)),
  };
}

export function projectEpicProgress(input: {
  epics: readonly BacklogEpic[];
  items: readonly BacklogItem[];
  traceSummaries: readonly TraceSummary[];
}): EpicProgressProjection[] {
  const traceByItemId = new Map(input.traceSummaries.map((trace) => [trace.itemId, trace]));
  return input.epics.map((epic) => {
    const itemRows = input.items
      .filter((item) => item.epic === epic.id)
      .map((item) => projectItemLifecycle(item, traceByItemId.get(item.id)))
      .sort(compareItemRows);
    return {
      epicId: epic.id,
      title: epic.title,
      status: epic.status,
      lifecycleState: aggregateLifecycleState(itemRows.map((row) => row.lifecycleState), []),
      countsByBacklogStatus: countBy(itemRows.map((row) => row.status)),
      countsByLifecycleState: countBy(itemRows.map((row) => row.lifecycleState)),
      itemRows,
    };
  }).sort((left, right) => left.epicId.localeCompare(right.epicId));
}

export function aggregateLifecycleLinks(summaries: readonly TraceSummary[]): LifecycleLinkRow[] {
  return summaries.flatMap((summary) => summary.linkRows).sort(compareRows);
}

export function aggregateLifecycleState(states: readonly LifecycleState[], linkRows: readonly LifecycleLinkRow[]): LifecycleState {
  if (states.length === 0) return stateFromRows(linkRows);
  const unique = uniqueStrings(states);
  if (unique.length === 1) return unique[0] as LifecycleState;
  const meaningful = unique.filter((state) => state !== 'none');
  if (meaningful.length > 1) return 'partial';
  return meaningful[0] as LifecycleState | undefined ?? 'none';
}

export function compactLifecycleRowsForFingerprint(rows: readonly LifecycleLinkRow[]): Array<Record<string, unknown>> {
  return rows.map((row) => compactObject({
    kind: row.kind,
    stage: row.stage,
    status: row.status,
    session: row.session,
    prdId: row.prdId,
    runId: row.runId,
    sessionId: row.sessionId,
    featureBranch: row.featureBranch,
    commitSha: row.commitSha,
    prUrl: row.prUrl,
    completedAt: row.completedAt,
    affectedItemIds: [...row.affectedItemIds].sort(),
  })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

function landingRow(itemId: string, entry: TraceLandingResult): LifecycleLinkRow {
  return compactRow({
    kind: entry.prUrl && entry.status === 'pr-open' ? 'pr' : 'landing',
    stage: entry.status === 'pr-open' ? 'pr-open' : 'landing',
    status: entry.status,
    label: entry.prUrl ? `PR ${entry.prUrl}` : `Landing ${entry.featureBranch ?? entry.commitSha}`,
    featureBranch: entry.featureBranch,
    commitSha: entry.commitSha,
    prUrl: entry.prUrl,
    timestamp: entry.landedAt,
    affectedItemIds: [itemId],
  });
}

function stateFromRows(rows: readonly LifecycleLinkRow[], context?: TraceActivityContext): LifecycleState {
  const statuses = rows.map((row) => row.status);
  if (statuses.some((status) => SHIPPED_STATUSES.has(status))) return 'shipped';
  if (statuses.some((status) => MERGED_STATUSES.has(status))) return 'merged';
  if (statuses.some((status) => PR_OPEN_STATUSES.has(status))) return 'pr-open';
  if (statuses.some((status) => FAILURE_STATUSES.has(status))) return 'failed';
  if (rows.some((row) => row.stage === 'landing' && isActiveLandingTraceEntry(row))) return 'active';
  if (rows.some((row) => row.stage === 'build' && isActiveQueueOrBuildTraceEntry(row))) return 'build';
  if (rows.some((row) => row.stage === 'queue' && isActiveQueueOrBuildTraceEntry(row))) return 'queue';
  if (rows.some((row) => row.stage === 'planned' && isActiveSessionPlanTraceEntry(row, context))) return 'planned';
  return 'none';
}

function stateFromBacklogStatus(status: BacklogItem['status']): LifecycleState {
  if (status === 'shipped') return 'shipped';
  if (status === 'active') return 'active';
  if (status === 'planned') return 'planned';
  return 'none';
}

function highestState(states: readonly LifecycleState[]): LifecycleState {
  const priority: LifecycleState[] = ['shipped', 'merged', 'pr-open', 'failed', 'build', 'queue', 'active', 'planned', 'none'];
  return priority.find((state) => states.includes(state)) ?? 'none';
}

function compactRow(row: LifecycleLinkRow): LifecycleLinkRow {
  return compactObject(row) as LifecycleLinkRow;
}

function compareRows(left: LifecycleLinkRow, right: LifecycleLinkRow): number {
  return [left.timestamp ?? '', left.kind, left.stage, left.label, left.status].join('\0')
    .localeCompare([right.timestamp ?? '', right.kind, right.stage, right.label, right.status].join('\0'));
}

function compareItemRows(left: ItemLifecycleProjection, right: ItemLifecycleProjection): number {
  return left.itemId.localeCompare(right.itemId);
}

function countBy(values: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function compactObject<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function stringOrDefault(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
  if (typeof value === 'string' && value.length > 0) return [value];
  return [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
