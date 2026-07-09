import { readFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { createSessionPlanningWorkflowAdapter } from '@eforge-build/input';
import { canonicalSha256 } from '../canonical/store.js';
import { buildBoardDebugProjection } from './board.js';
import { buildBoard, projectBoardOutput } from '../board-actions.js';
import { pageMetadata, paginateProjection } from './pagination.js';
import { withProjectionStore } from './store.js';
import { getAssociatedPlanBuildLinksForItemsFromStore } from './links.js';
import { getProjectionSessionPlan, listProjectionSessionPlanEpics, listProjectionSessionPlanItems, listProjectionSessionPlans, type ProjectionSessionPlanRow } from '../sqlite/repositories/projections/session-plans.js';
import { getProjectionItem, listProjectionItems } from '../sqlite/repositories/projections/items.js';
import { listCurrentLifecycleEvidence, listProjectionPlanningTaskItems, listProjectionQueueBuildLinks, listProjectionSessionItems, type ProjectionLifecycleEvidenceRow, type ProjectionQueueBuildRow } from '../sqlite/repositories/projections/lifecycle.js';
import type { EforgePlanStore } from '../sqlite/index.js';
import { computeEffectiveLifecycle } from './lifecycle.js';
import type { AssociatedPlanBuildLink, ListPlanningArtifactsInput } from './types.js';

export const SESSION_PLAN_STATUS_SOURCE_DISCLOSURE = 'status source = canonical eforge-plan SQLite session-plan status records in the eforge-plan extension store; lifecycle/projection records, monitor events, event-tail output, and status fields are derived evidence or diagnostics.';
export const SESSION_PLAN_MARKDOWN_FALLBACK_DISCLOSURE = 'status source = Markdown compatibility fallback because canonical eforge-plan SQLite session-plan status records were unavailable; lifecycle/projection records, monitor events, event-tail output, and status fields are derived evidence or diagnostics.';

const EMPTY_READINESS = { ready: false, missingDimensions: [], coveredDimensions: [], skippedDimensions: [] };

function readinessFromSummary(value: unknown) {
  if (!value || typeof value !== 'object') return EMPTY_READINESS;
  const raw = value as Record<string, unknown>;
  return { ready: raw.ready === true, missingDimensions: arrayValue(raw.missingDimensions), coveredDimensions: arrayValue(raw.coveredDimensions), skippedDimensions: arrayValue(raw.skippedDimensions), ...(Array.isArray(raw.acDiagnostics) ? { acDiagnostics: raw.acDiagnostics } : {}) };
}
function arrayValue(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function cleanObject<T extends Record<string, unknown>>(value: T): T { return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T; }
function plainSections(sections: Map<string, string> | Record<string, string> | undefined): Record<string, string> { return sections instanceof Map ? Object.fromEntries(sections) : sections ?? {}; }
function resolveArtifactPath(cwd: string, path: string): string { return isAbsolute(path) ? path : join(cwd, path); }
function sessionPlanReadinessFingerprint(markdown: string): string { return canonicalSha256(markdown); }
function normalizedTimestamp(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}
function nestedObject(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function timestampFromRecord(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = normalizedTimestamp(record[key]);
    if (value) return value;
  }
  return undefined;
}
function planReadyAt(plan: ProjectionSessionPlanRow): string | undefined {
  const frontmatter = nestedObject(plan.frontmatter);
  const eforgePlan = nestedObject(frontmatter.eforge_plan);
  return timestampFromRecord(frontmatter, ['ready_at', 'readyAt', 'status_ready_at', 'session_plan_ready_at'])
    ?? timestampFromRecord(eforgePlan, ['ready_at', 'readyAt']);
}
function latestTimestamp(values: readonly unknown[]): string | undefined { return values.map(normalizedTimestamp).filter((value): value is string => value !== undefined).sort().at(-1); }
function lifecycleTimestamps(plan: ProjectionSessionPlanRow, lifecycle: ReturnType<typeof sessionLifecycleFromStore>) {
  const buildKinds = new Set(['queue-prd', 'build-run', 'build-session', 'landing']);
  return cleanObject({
    createdAt: normalizedTimestamp(plan.createdAt),
    updatedAt: normalizedTimestamp(plan.updatedAt),
    readyAt: planReadyAt(plan),
    submittedAt: normalizedTimestamp(plan.submittedAt),
    lastBuildActivityAt: latestTimestamp([
      ...lifecycle.linkRows.filter((row) => buildKinds.has(String(row.kind)) && row.session === plan.session).map((row) => row.timestamp),
      ...lifecycle.sessionBuildRows.map((row) => row.timestamp),
    ]),
  });
}
async function readinessProjection(cwd: string, plan: ProjectionSessionPlanRow, absolutePath: string, body?: string) {
  const currentBody = body ?? await readFile(absolutePath, 'utf8').catch(() => '');
  const currentArtifactBodyHash = currentBody.length > 0 ? sessionPlanReadinessFingerprint(currentBody) : undefined;
  const storedArtifactBodyHash = plan.artifactBodyHash;
  if (plan.readinessSummary !== undefined && currentArtifactBodyHash !== undefined && storedArtifactBodyHash === currentArtifactBodyHash) {
    return { readiness: readinessFromSummary(plan.readinessSummary), readinessSource: 'cache' as const, readinessFreshness: { state: 'fresh' as const, storedArtifactBodyHash, currentArtifactBodyHash } };
  }
  const planning = createSessionPlanningWorkflowAdapter();
  try {
    const readiness = await planning.flat.readiness({ cwd, session: plan.session });
    return { readiness, readinessSource: 'markdown' as const, readinessFreshness: { state: plan.readinessSummary === undefined ? 'missing' as const : 'stale' as const, storedArtifactBodyHash, currentArtifactBodyHash } };
  } catch {
    return { readiness: readinessFromSummary(plan.readinessSummary), readinessSource: plan.readinessSummary === undefined ? 'empty' as const : 'cache' as const, readinessFreshness: { state: currentArtifactBodyHash === undefined ? 'missing' as const : 'stale' as const, storedArtifactBodyHash, currentArtifactBodyHash } };
  }
}

function sourceRefsFromRows(items: ReturnType<typeof listProjectionSessionPlanItems>, epics: ReturnType<typeof listProjectionSessionPlanEpics>) {
  return {
    sourceItemIds: [...new Set(items.map((i) => i.itemId ?? i.itemRef))].sort(),
    sourceEpicIds: [...new Set(epics.map((e) => e.epicId ?? e.epicRef))].sort(),
    ...((items.find((i) => i.sourceRecommendationRef)?.sourceRecommendationRef) ? { recommendationRef: items.find((i) => i.sourceRecommendationRef)?.sourceRecommendationRef } : {}),
    ...((items.find((i) => i.promotedAt)?.promotedAt) ? { promotedAt: items.find((i) => i.promotedAt)?.promotedAt } : {}),
  };
}
function sourceRefRows(items: ReturnType<typeof listProjectionSessionPlanItems>, epics: ReturnType<typeof listProjectionSessionPlanEpics>) {
  return [
    ...items.map((item) => cleanObject({ itemRef: item.itemRef, itemId: item.itemId, provenance: item.provenance, sourceRecommendationRef: item.sourceRecommendationRef, promotedAt: item.promotedAt })),
    ...epics.map((epic) => { const row = epic as typeof epic & { sourceRecommendationRef?: string; promotedAt?: string }; return cleanObject({ epicRef: row.epicRef, epicId: row.epicId, provenance: row.provenance, sourceRecommendationRef: row.sourceRecommendationRef, promotedAt: row.promotedAt }); }),
  ];
}
function lifecycleLinkRows(links: AssociatedPlanBuildLink[]) {
  return links.map((link) => cleanObject({ kind: link.kind, stage: String(link.reasonCode ?? link.kind), label: link.label ?? link.id, status: link.status ?? '', session: link.session, runId: link.runId, buildSessionId: link.buildSessionId, prUrl: link.prUrl ?? link.url, path: link.path, timestamp: link.timestamp, affectedItemIds: link.affectedItemIds ?? link.itemIds ?? [] }));
}
function sessionLifecycleAggregate(itemIds: string[], itemRows: Array<{ lifecycleState: string; unresolvedSourceRef?: boolean; missingLifecycleEvidence?: boolean }>) {
  if (itemIds.length === 0) return { lifecycleState: 'none', partialReasons: [] };
  const partialReasons = [];
  if (itemRows.length < itemIds.length || itemRows.some((row) => row.unresolvedSourceRef)) partialReasons.push({ code: 'incomplete-coverage', message: 'Lifecycle projection is partial because one or more linked source items could not be resolved.' });
  if (itemRows.some((row) => row.missingLifecycleEvidence) || itemRows.some((row) => row.lifecycleState === 'none')) partialReasons.push({ code: 'missing-lifecycle-evidence', message: 'Lifecycle projection is partial because at least one linked source item has no lifecycle evidence.' });
  const states = [...new Set(itemRows.map((row) => row.lifecycleState))];
  if (states.length === 1 && states[0] === 'partial' && partialReasons.length === 0) partialReasons.push({ code: 'partial-source-state', message: 'Lifecycle projection is partial because one or more linked source items are partial.' });
  if (partialReasons.length > 0) return { lifecycleState: 'partial', partialReasons };
  if (states.length === 1) return { lifecycleState: states[0], partialReasons: [] };
  return { lifecycleState: 'partial', partialReasons: [{ code: 'mixed-source-states', message: `Lifecycle projection is partial because linked source items have mixed lifecycle states: ${states.sort().join(', ')}.` }] };
}

function currentSessionEvidenceIds(evidenceRows: ProjectionLifecycleEvidenceRow[], session: string) {
  const current = evidenceRows.filter((row) => row.session === session && row.isCurrent);
  return {
    queuePrdIds: new Set(current.map((row) => row.queuePrdId).filter((id): id is string => id !== undefined)),
    runIds: new Set(current.map((row) => row.runId).filter((id): id is string => id !== undefined)),
    buildSessionIds: new Set(current.map((row) => row.buildSessionId).filter((id): id is string => id !== undefined)),
  };
}

function hasCurrentSessionEvidenceIds(currentIds: ReturnType<typeof currentSessionEvidenceIds>): boolean {
  return currentIds.queuePrdIds.size > 0 || currentIds.runIds.size > 0 || currentIds.buildSessionIds.size > 0;
}

function isCurrentSessionBuildLink(link: AssociatedPlanBuildLink, session: string, currentIds: ReturnType<typeof currentSessionEvidenceIds>): boolean {
  if (link.session !== session || !hasCurrentSessionEvidenceIds(currentIds)) return true;
  if (link.kind === 'queue-prd') return currentIds.queuePrdIds.has(link.id);
  if (link.kind === 'build-run') return link.runId !== undefined && currentIds.runIds.has(link.runId);
  if (link.kind === 'build-session') return link.buildSessionId !== undefined && currentIds.buildSessionIds.has(link.buildSessionId);
  return true;
}

function isCurrentSessionBuildRow(row: ProjectionQueueBuildRow, session: string, currentIds: ReturnType<typeof currentSessionEvidenceIds>): boolean {
  if (row.session !== session || !hasCurrentSessionEvidenceIds(currentIds)) return true;
  if (row.kind === 'queue-prd') return currentIds.queuePrdIds.has(row.id);
  if (row.kind === 'build-run') return row.runId !== undefined && currentIds.runIds.has(row.runId);
  if (row.kind === 'build-session') return row.buildSessionId !== undefined && currentIds.buildSessionIds.has(row.buildSessionId);
  return true;
}

function sessionLifecycleFromStore(store: EforgePlanStore, session: string) {
  const evidenceRows = listCurrentLifecycleEvidence(store);
  const currentIds = currentSessionEvidenceIds(evidenceRows, session);
  const sessionBuildRows = listProjectionQueueBuildLinks(store).filter((row) => row.session === session && isCurrentSessionBuildRow(row, session, currentIds));
  const items = listProjectionSessionPlanItems(store, session);
  const epics = listProjectionSessionPlanEpics(store, session);
  const sourceRefs = sourceRefsFromRows(items, epics);
  const itemIds = sourceRefs.sourceItemIds;
  const allSessionItems = listProjectionSessionItems(store);
  const allTaskItems = listProjectionPlanningTaskItems(store);
  const itemRows = itemIds.map((itemId) => {
    const item = getProjectionItem(store, itemId) ?? listProjectionItems(store).find((candidate) => candidate.id === itemId);
    const linkRows = lifecycleLinkRows(getAssociatedPlanBuildLinksForItemsFromStore(store, [itemId]).filter((link) => isCurrentSessionBuildLink(link, session, currentIds)));
    const evidence = evidenceRows.filter((e) => e.itemId === itemId || e.itemRef === itemId);
    const sessionItems = allSessionItems.filter((s) => (s.itemId ?? s.itemRef) === itemId);
    const taskItems = allTaskItems.filter((t) => (t.itemId ?? t.itemRef) === itemId);
    const substantiveLinkRows = linkRows.filter((row) => row.kind !== 'session-plan');
    const missingLifecycleEvidence = evidence.length === 0 && substantiveLinkRows.length === 0 && taskItems.length === 0;
    const life = missingLifecycleEvidence ? { lifecycleState: 'none' } : computeEffectiveLifecycle({ userStatus: item?.userStatus ?? 'candidate', evidence, sessionItems, taskItems, hasUnresolvedDependency: false });
    return { itemId, title: item?.title ?? itemId, status: item?.userStatus ?? 'candidate', ...(item?.epicId ? { epic: item.epicId } : {}), lifecycleState: life.lifecycleState, unresolvedSourceRef: !item, missingLifecycleEvidence, linkRows, failureEvidence: linkRows.filter((row) => row.status === 'failed') };
  });
  const linkRows = lifecycleLinkRows(getAssociatedPlanBuildLinksForItemsFromStore(store, itemIds).filter((link) => isCurrentSessionBuildLink(link, session, currentIds)));
  const aggregate = sessionLifecycleAggregate(itemIds, itemRows);
  return { session, sourceRefs, sourceRefRows: sourceRefRows(items, epics), lifecycleState: aggregate.lifecycleState, state: aggregate.lifecycleState, partialReasons: aggregate.partialReasons, itemIds, itemRows, linkRows, sessionBuildRows, associatedLinks: linkRows, failureEvidence: linkRows.filter((row) => row.status === 'failed') };
}

async function artifactFromPlan(cwd: string, plan: ReturnType<typeof listProjectionSessionPlans>[number], lifecycle: ReturnType<typeof sessionLifecycleFromStore>) {
  const path = plan.path ?? `.eforge/session-plans/${plan.session}.md`;
  const readinessInfo = await readinessProjection(cwd, plan, resolveArtifactPath(cwd, path));
  const readiness = readinessInfo.readiness;
  const timestamps = lifecycleTimestamps(plan, lifecycle);
  return { kind: 'plan' as const, key: `plan:${plan.session}`, session: plan.session, title: plan.topic ?? plan.session, topic: plan.topic ?? plan.session, status: plan.status ?? 'draft', statusSource: 'eforge-plan-sqlite-session-plan-status', statusSourceDisclosure: SESSION_PLAN_STATUS_SOURCE_DISCLOSURE, path, ready: readiness.ready, missingDimensions: readiness.missingDimensions, coveredDimensions: readiness.coveredDimensions, skippedDimensions: readiness.skippedDimensions, readiness, readinessSource: readinessInfo.readinessSource, readinessFreshness: readinessInfo.readinessFreshness, ...(plan.eforgeSessionId ? { eforge_session: plan.eforgeSessionId } : {}), ...timestamps, sourceRefs: lifecycle.sourceRefs, lifecycle, lifecycleState: lifecycle.lifecycleState, partialReasons: lifecycle.partialReasons, itemRows: lifecycle.itemRows, linkRows: lifecycle.linkRows, failureEvidence: lifecycle.failureEvidence };
}
function planSetArtifact(p: { planSetId: string; title?: string; status?: string; path?: string; updatedAt?: string }) { return { kind: 'plan-set' as const, key: `plan-set:${p.planSetId}`, ...p }; }
function projectPlan(plan: ProjectionSessionPlanRow, body: string) { return { ...plan, session: plan.session, topic: plan.topic ?? plan.session, status: plan.status ?? 'draft', body }; }
function fallbackArtifact(entry: { session: string; topic?: string; status?: string; path: string; ready?: boolean; missingDimensions?: unknown[]; coveredDimensions?: unknown[]; skippedDimensions?: unknown[]; readiness?: unknown; createdAt?: string; updatedAt?: string; readyAt?: string; submittedAt?: string }) { const readiness = readinessFromSummary(entry.readiness ?? { ready: entry.ready === true, missingDimensions: entry.missingDimensions ?? [], coveredDimensions: entry.coveredDimensions ?? [], skippedDimensions: entry.skippedDimensions ?? [] }); return cleanObject({ kind: 'plan' as const, key: `plan:${entry.session}`, session: entry.session, title: entry.topic ?? entry.session, topic: entry.topic ?? entry.session, status: entry.status ?? 'draft', statusSource: 'markdown-compatibility-fallback', statusSourceDisclosure: SESSION_PLAN_MARKDOWN_FALLBACK_DISCLOSURE, path: entry.path, ready: readiness.ready, missingDimensions: readiness.missingDimensions, coveredDimensions: readiness.coveredDimensions, skippedDimensions: readiness.skippedDimensions, readiness, readinessSource: 'markdown' as const, readinessFreshness: { state: 'missing' as const }, createdAt: normalizedTimestamp(entry.createdAt), updatedAt: normalizedTimestamp(entry.updatedAt), readyAt: normalizedTimestamp(entry.readyAt), submittedAt: normalizedTimestamp(entry.submittedAt), sourceRefs: { sourceItemIds: [], sourceEpicIds: [] }, lifecycleState: 'none', partialReasons: [], itemRows: [], linkRows: [], failureEvidence: [] }); }

async function listFlatArtifacts(cwd: string, includeSubmitted?: boolean) {
  const planning = createSessionPlanningWorkflowAdapter();
  try { return (await planning.flat.list({ cwd, includeSubmitted })).map(fallbackArtifact); } catch { return []; }
}
async function listPlanSetArtifacts(cwd: string, includeSubmitted?: boolean) {
  const planning = createSessionPlanningWorkflowAdapter();
  try { return (await planning.planSets.list({ cwd, includeSubmitted })).map(planSetArtifact); } catch { return []; }
}

export async function getSessionPlanLifecycleProjection(cwd: string, session: string): Promise<any> {
  return withProjectionStore<any>(cwd, (store) => sessionLifecycleFromStore(store, session), () => ({ session, sourceRefs: { sourceItemIds: [], sourceEpicIds: [] }, lifecycleState: 'none', state: 'none', partialReasons: [], itemIds: [], itemRows: [], linkRows: [], associatedLinks: [], failureEvidence: [] }));
}

export async function listPlanningArtifactsProjection(cwd: string, input: ListPlanningArtifactsInput): Promise<any> {
  type ArtifactDescriptor =
    | { descriptorKind: 'sql-plan'; key: string; session: string; planSetId?: string; updatedAt?: string; plan: ProjectionSessionPlanRow }
    | { descriptorKind: 'artifact'; key: string; session?: string; planSetId?: string; updatedAt?: string; artifact: any };
  const { sqlPlans, sqlSessions } = await withProjectionStore(cwd, (store) => {
    const plans = listProjectionSessionPlans(store, input.includeSubmitted);
    return { sqlPlans: plans, sqlSessions: new Set(listProjectionSessionPlans(store, true).map((plan) => plan.session)) };
  }, () => ({ sqlPlans: [] as ProjectionSessionPlanRow[], sqlSessions: new Set<string>() }));
  const flat = (await listFlatArtifacts(cwd, input.includeSubmitted)).filter((artifact) => !sqlSessions.has(artifact.session));
  const planSets = await listPlanSetArtifacts(cwd, input.includeSubmitted);
  const descriptors: ArtifactDescriptor[] = [
    ...sqlPlans.map((plan) => ({ descriptorKind: 'sql-plan' as const, key: `plan:${plan.session}`, session: plan.session, updatedAt: plan.updatedAt, plan })),
    ...flat.map((artifact) => ({ descriptorKind: 'artifact' as const, key: artifact.key, session: artifact.session, updatedAt: artifact.updatedAt, artifact })),
    ...planSets.map((artifact) => ({ descriptorKind: 'artifact' as const, key: artifact.key, planSetId: artifact.planSetId, updatedAt: artifact.updatedAt, artifact })),
  ];
  descriptors.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '') || (a.session ?? a.planSetId ?? '').localeCompare(b.session ?? b.planSetId ?? ''));
  const page = paginateProjection(descriptors, input, 50, 100);
  const sqlPagePlans = page.entries.filter((entry): entry is Extract<ArtifactDescriptor, { descriptorKind: 'sql-plan' }> => entry.descriptorKind === 'sql-plan');
  const hydratedSql = await withProjectionStore(cwd, async (store) => await Promise.all(sqlPagePlans.map(async (entry) => [entry.key, await artifactFromPlan(cwd, entry.plan, sessionLifecycleFromStore(store, entry.session))] as const)), () => []);
  const hydratedSqlByKey = new Map(hydratedSql);
  const entries = page.entries.map((entry) => entry.descriptorKind === 'sql-plan' ? hydratedSqlByKey.get(entry.key) : entry.artifact).filter((entry): entry is any => entry !== undefined);
  const base: Record<string, unknown> = { artifacts: entries, plans: entries.filter((a: any) => a.kind === 'plan'), planSets: entries.filter((a: any) => a.kind === 'plan-set'), total: page.total, limit: page.limit, offset: page.offset, pagination: pageMetadata(page, page.total) };
  if (input.includeBoard === true) base.board = await boardProjection(cwd, input);
  return base;
}
async function boardProjection(cwd: string, input: ListPlanningArtifactsInput) {
  const legacy = projectBoardOutput(await buildBoard(cwd, { epic: input.epic, includeArchive: input.includeArchive }));
  const board = legacy.lanes.some((lane: any) => lane.items.length > 0) ? legacy : await buildBoardDebugProjection(cwd, { epic: input.epic, includeArchive: input.includeArchive });
  return input.includeArchive === true ? board : { ...board, lanes: Array.isArray(board?.lanes) ? board.lanes.filter((lane: any) => lane.lane !== 'archive') : [] };
}

export async function showSessionPlanProjection(cwd: string, session: string): Promise<any> {
  const sql = await withProjectionStore<any>(cwd, async (store) => {
    const plan = getProjectionSessionPlan(store, session);
    if (!plan) return undefined;
    const lifecycle = sessionLifecycleFromStore(store, session);
    const path = plan.path ?? join('.eforge', 'session-plans', `${session}.md`);
    const absolutePath = resolveArtifactPath(cwd, path);
    let body = '';
    try { body = await readFile(absolutePath, 'utf8'); } catch { body = ''; }
    const readinessInfo = await readinessProjection(cwd, plan, absolutePath, body);
    const timestamps = lifecycleTimestamps(plan, lifecycle);
    let projectedPlan: Record<string, unknown> = { ...projectPlan(plan, body), ...timestamps };
    try {
      const loaded = await createSessionPlanningWorkflowAdapter().flat.load({ cwd, session });
      projectedPlan = { ...loaded.plan, session: plan.session, topic: plan.topic ?? loaded.plan.topic ?? plan.session, status: plan.status ?? loaded.plan.status ?? 'draft', body: loaded.plan.body, sections: plainSections((loaded.plan as any).sections), sourceRefs: lifecycle.sourceRefs, ...timestamps };
    } catch { /* Keep the SQL-shaped fallback when the Markdown adapter cannot load the file. */ }
    return { session, path: absolutePath, relativePath: relative(cwd, absolutePath).replace(/\\/g, '/'), body, plan: projectedPlan, statusSource: 'eforge-plan-sqlite-session-plan-status', statusSourceDisclosure: SESSION_PLAN_STATUS_SOURCE_DISCLOSURE, lifecycle, sourceRefs: lifecycle.sourceRefs, sourceRefRows: lifecycle.sourceRefRows, readiness: readinessInfo.readiness, readinessSource: readinessInfo.readinessSource, readinessFreshness: readinessInfo.readinessFreshness, ...timestamps };
  }, () => undefined);
  if (sql) return sql;
  const planning = createSessionPlanningWorkflowAdapter();
  const loaded = await planning.flat.load({ cwd, session });
  const path = loaded.path;
  const plan = loaded.plan as any;
  const sourceRefs = sourceRefsFromFrontmatter(plan);
  const lifecycle = await getSessionPlanLifecycleProjection(cwd, session);
  return { session, path: resolve(path), relativePath: relative(cwd, path).replace(/\\/g, '/'), body: plan.body, plan: { ...plan, sections: plainSections(plan.sections) }, statusSource: 'markdown-compatibility-fallback', statusSourceDisclosure: SESSION_PLAN_MARKDOWN_FALLBACK_DISCLOSURE, lifecycle: lifecycle.itemRows.length > 0 ? lifecycle : await legacyLifecycleProjection(cwd, session, sourceRefs), sourceRefs, readiness: loaded.readiness, readinessSource: 'markdown', readinessFreshness: { state: 'missing' } };
}
function sourceRefsFromFrontmatter(plan: Record<string, any>) {
  const meta = plan.eforge_plan && typeof plan.eforge_plan === 'object' ? plan.eforge_plan : {};
  return { sourceItemIds: asStrings(meta.source_item_ids ?? meta.source_item_id), sourceEpicIds: asStrings(meta.source_epic_ids ?? meta.source_epic_id), ...(typeof meta.source_recommendation_ref === 'string' ? { recommendationRef: meta.source_recommendation_ref } : {}), ...(typeof meta.promoted_at === 'string' ? { promotedAt: meta.promoted_at } : {}) };
}
async function legacyLifecycleProjection(cwd: string, session: string, sourceRefs: ReturnType<typeof sourceRefsFromFrontmatter>) {
  const board = await buildBoard(cwd, { includeArchive: true });
  const traces = new Map<string, any>((board.traceSummaries ?? []).map((trace: any) => [trace.itemId, trace]));
  const itemRows = sourceRefs.sourceItemIds.map((itemId) => {
    const item = board.items.find((candidate: any) => candidate.id === itemId) as any;
    const trace = traces.get(itemId) as any;
    const linkRows = item?.linkRows ?? trace?.linkRows ?? [];
    const failureEvidence = item?.failureEvidence ?? trace?.failureEvidence ?? [];
    const missingLifecycleEvidence = !item?.lifecycleState && !trace?.lifecycleState;
    const state = missingLifecycleEvidence ? 'none' : item?.lifecycleState ?? trace?.lifecycleState;
    return { itemId, title: item?.title ?? itemId, status: item?.status ?? 'candidate', lifecycleState: state, unresolvedSourceRef: !item, missingLifecycleEvidence, linkRows, failureEvidence };
  });
  const aggregate = sessionLifecycleAggregate(sourceRefs.sourceItemIds, itemRows);
  return { session, sourceRefs, sourceRefRows: [], lifecycleState: aggregate.lifecycleState, state: aggregate.lifecycleState, partialReasons: aggregate.partialReasons, itemIds: sourceRefs.sourceItemIds, itemRows, linkRows: itemRows.flatMap((row) => row.linkRows), associatedLinks: itemRows.flatMap((row) => row.linkRows), failureEvidence: itemRows.flatMap((row) => row.failureEvidence) };
}
function asStrings(value: unknown): string[] { return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : typeof value === 'string' ? [value] : []; }
