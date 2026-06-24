import { readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { createSessionPlanningWorkflowAdapter } from '@eforge-build/input';
import { buildBoardDebugProjection } from './board.js';
import { buildBoard, projectBoardOutput } from '../board-actions.js';
import { pageMetadata, paginateProjection } from './pagination.js';
import { withProjectionStore } from './store.js';
import { getAssociatedPlanBuildLinksForItemsFromStore } from './links.js';
import { getProjectionSessionPlan, listProjectionSessionPlanEpics, listProjectionSessionPlanItems, listProjectionSessionPlans, type ProjectionSessionPlanRow } from '../sqlite/repositories/projections/session-plans.js';
import { getProjectionItem, listProjectionItems } from '../sqlite/repositories/projections/items.js';
import { listCurrentLifecycleEvidence, listProjectionPlanningTaskItems, listProjectionSessionItems } from '../sqlite/repositories/projections/lifecycle.js';
import type { EforgePlanStore } from '../sqlite/index.js';
import { computeEffectiveLifecycle } from './lifecycle.js';
import type { AssociatedPlanBuildLink, ListPlanningArtifactsInput } from './types.js';

const EMPTY_READINESS = { ready: false, missingDimensions: [], coveredDimensions: [], skippedDimensions: [] };

function readinessFromSummary(value: unknown) {
  if (!value || typeof value !== 'object') return EMPTY_READINESS;
  const raw = value as Record<string, unknown>;
  return { ready: raw.ready === true, missingDimensions: arrayValue(raw.missingDimensions), coveredDimensions: arrayValue(raw.coveredDimensions), skippedDimensions: arrayValue(raw.skippedDimensions), ...(Array.isArray(raw.acDiagnostics) ? { acDiagnostics: raw.acDiagnostics } : {}) };
}
function arrayValue(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function cleanObject<T extends Record<string, unknown>>(value: T): T { return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T; }
function plainSections(sections: Map<string, string> | Record<string, string> | undefined): Record<string, string> { return sections instanceof Map ? Object.fromEntries(sections) : sections ?? {}; }

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

function sessionLifecycleFromStore(store: EforgePlanStore, session: string) {
  const items = listProjectionSessionPlanItems(store, session);
  const epics = listProjectionSessionPlanEpics(store, session);
  const sourceRefs = sourceRefsFromRows(items, epics);
  const itemIds = sourceRefs.sourceItemIds;
  const allSessionItems = listProjectionSessionItems(store);
  const allTaskItems = listProjectionPlanningTaskItems(store);
  const evidenceRows = listCurrentLifecycleEvidence(store);
  const itemRows = itemIds.map((itemId) => {
    const item = getProjectionItem(store, itemId) ?? listProjectionItems(store).find((candidate) => candidate.id === itemId);
    const linkRows = lifecycleLinkRows(getAssociatedPlanBuildLinksForItemsFromStore(store, [itemId]));
    const evidence = evidenceRows.filter((e) => e.itemId === itemId || e.itemRef === itemId);
    const sessionItems = allSessionItems.filter((s) => (s.itemId ?? s.itemRef) === itemId);
    const taskItems = allTaskItems.filter((t) => (t.itemId ?? t.itemRef) === itemId);
    const life = computeEffectiveLifecycle({ userStatus: item?.userStatus ?? 'candidate', evidence, sessionItems, taskItems, hasUnresolvedDependency: false });
    return { itemId, title: item?.title ?? itemId, status: item?.userStatus ?? 'candidate', ...(item?.epicId ? { epic: item.epicId } : {}), lifecycleState: life.lifecycleState, linkRows, failureEvidence: linkRows.filter((row) => row.status === 'failed') };
  });
  const linkRows = lifecycleLinkRows(getAssociatedPlanBuildLinksForItemsFromStore(store, itemIds));
  const states = [...new Set(itemRows.map((row) => row.lifecycleState))];
  const lifecycleState = states.length === 0 ? 'none' : itemIds.length > 1 ? 'partial' : states[0];
  return { session, sourceRefs, sourceRefRows: sourceRefRows(items, epics), lifecycleState, state: lifecycleState, itemIds, itemRows, linkRows, associatedLinks: linkRows, failureEvidence: linkRows.filter((row) => row.status === 'failed') };
}

function artifactFromPlan(plan: ReturnType<typeof listProjectionSessionPlans>[number], lifecycle: ReturnType<typeof sessionLifecycleFromStore>) {
  const readiness = readinessFromSummary(plan.readinessSummary);
  return { kind: 'plan' as const, key: `plan:${plan.session}`, session: plan.session, title: plan.topic ?? plan.session, topic: plan.topic ?? plan.session, status: plan.status ?? 'draft', path: plan.path ?? `.eforge/session-plans/${plan.session}.md`, ready: readiness.ready, missingDimensions: readiness.missingDimensions, coveredDimensions: readiness.coveredDimensions, skippedDimensions: readiness.skippedDimensions, ...(plan.eforgeSessionId ? { eforge_session: plan.eforgeSessionId } : {}), updatedAt: plan.updatedAt, createdAt: plan.createdAt, sourceRefs: lifecycle.sourceRefs, lifecycle, lifecycleState: lifecycle.lifecycleState, itemRows: lifecycle.itemRows, linkRows: lifecycle.linkRows, failureEvidence: lifecycle.failureEvidence };
}
function planSetArtifact(p: { planSetId: string; title?: string; status?: string; path?: string; updatedAt?: string }) { return { kind: 'plan-set' as const, key: `plan-set:${p.planSetId}`, ...p }; }
function projectPlan(plan: ProjectionSessionPlanRow, body: string) { return { ...plan, session: plan.session, topic: plan.topic ?? plan.session, status: plan.status ?? 'draft', body }; }
function fallbackArtifact(entry: { session: string; topic?: string; status?: string; path: string; ready?: boolean; missingDimensions?: unknown[] }) { return { kind: 'plan' as const, key: `plan:${entry.session}`, session: entry.session, title: entry.topic ?? entry.session, topic: entry.topic ?? entry.session, status: entry.status ?? 'draft', path: entry.path, ready: entry.ready === true, missingDimensions: entry.missingDimensions ?? [], coveredDimensions: [], skippedDimensions: [], updatedAt: undefined, createdAt: undefined, sourceRefs: { sourceItemIds: [], sourceEpicIds: [] }, lifecycleState: 'none', itemRows: [], linkRows: [], failureEvidence: [] }; }

async function listFlatArtifacts(cwd: string, includeSubmitted?: boolean) {
  const planning = createSessionPlanningWorkflowAdapter();
  try { return (await planning.flat.list({ cwd, includeSubmitted })).map(fallbackArtifact); } catch { return []; }
}
async function listPlanSetArtifacts(cwd: string, includeSubmitted?: boolean) {
  const planning = createSessionPlanningWorkflowAdapter();
  try { return (await planning.planSets.list({ cwd, includeSubmitted })).map(planSetArtifact); } catch { return []; }
}

export async function getSessionPlanLifecycleProjection(cwd: string, session: string): Promise<any> {
  return withProjectionStore<any>(cwd, (store) => sessionLifecycleFromStore(store, session), () => ({ session, sourceRefs: { sourceItemIds: [], sourceEpicIds: [] }, lifecycleState: 'none', state: 'none', itemIds: [], itemRows: [], linkRows: [], associatedLinks: [], failureEvidence: [] }));
}

export async function listPlanningArtifactsProjection(cwd: string, input: ListPlanningArtifactsInput): Promise<any> {
  const sqlFlat = await withProjectionStore(cwd, (store) => listProjectionSessionPlans(store, input.includeSubmitted).map((p) => artifactFromPlan(p, sessionLifecycleFromStore(store, p.session))), () => []);
  const sqlSessions = new Set(sqlFlat.map((artifact) => artifact.session));
  const flat = [...sqlFlat, ...(await listFlatArtifacts(cwd, input.includeSubmitted)).filter((artifact) => !sqlSessions.has(artifact.session))];
  const artifacts = [...flat, ...(await listPlanSetArtifacts(cwd, input.includeSubmitted))].sort((a: any, b: any) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '') || (a.session ?? a.planSetId ?? '').localeCompare(b.session ?? b.planSetId ?? ''));
  const page = paginateProjection(artifacts, input, 50, 100);
  const base: Record<string, unknown> = { artifacts: page.entries, plans: page.entries.filter((a: any) => a.kind === 'plan'), planSets: page.entries.filter((a: any) => a.kind === 'plan-set'), total: page.total, limit: page.limit, offset: page.offset, pagination: pageMetadata(page, page.total) };
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
    let body = '';
    try { body = await readFile(join(cwd, path), 'utf8'); } catch { body = ''; }
    return { session, path, relativePath: relative(cwd, join(cwd, path)).replace(/\\/g, '/'), body, plan: projectPlan(plan, body), lifecycle, sourceRefs: lifecycle.sourceRefRows, readiness: readinessFromSummary(plan.readinessSummary) };
  }, () => undefined);
  if (sql) return sql;
  const planning = createSessionPlanningWorkflowAdapter();
  const loaded = await planning.flat.load({ cwd, session });
  const path = loaded.path;
  const plan = loaded.plan as any;
  const sourceRefs = sourceRefsFromFrontmatter(plan);
  const lifecycle = await getSessionPlanLifecycleProjection(cwd, session);
  return { session, path: resolve(path), relativePath: relative(cwd, path).replace(/\\/g, '/'), body: plan.body, plan: { ...plan, sections: plainSections(plan.sections) }, lifecycle: lifecycle.itemRows.length > 0 ? lifecycle : await legacyLifecycleProjection(cwd, session, sourceRefs), sourceRefs, readiness: loaded.readiness };
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
    const state = item?.lifecycleState ?? traces.get(itemId)?.lifecycleState ?? 'planned';
    const trace = traces.get(itemId) as any;
    return { itemId, title: item?.title ?? itemId, status: item?.status ?? 'candidate', lifecycleState: state, linkRows: item?.linkRows ?? trace?.linkRows ?? [], failureEvidence: item?.failureEvidence ?? trace?.failureEvidence ?? [] };
  });
  const states = [...new Set(itemRows.map((row) => row.lifecycleState))];
  const lifecycleState = itemRows.length === 0 ? 'none' : itemRows.length > 1 ? 'partial' : states[0];
  return { session, sourceRefs, sourceRefRows: [], lifecycleState, state: lifecycleState, itemIds: sourceRefs.sourceItemIds, itemRows, linkRows: itemRows.flatMap((row) => row.linkRows), associatedLinks: itemRows.flatMap((row) => row.linkRows), failureEvidence: itemRows.flatMap((row) => row.failureEvidence) };
}
function asStrings(value: unknown): string[] { return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : typeof value === 'string' ? [value] : []; }
