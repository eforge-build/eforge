import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { createSessionPlanningWorkflowAdapter } from '@eforge-build/input';
import { buildBoardDebugProjection } from './board.js';
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
  return {
    ready: raw.ready === true,
    missingDimensions: Array.isArray(raw.missingDimensions) ? raw.missingDimensions : [],
    coveredDimensions: Array.isArray(raw.coveredDimensions) ? raw.coveredDimensions : [],
    skippedDimensions: Array.isArray(raw.skippedDimensions) ? raw.skippedDimensions : [],
    ...(Array.isArray(raw.acDiagnostics) ? { acDiagnostics: raw.acDiagnostics } : {}),
  };
}

function sourceRefsFromRows(items: ReturnType<typeof listProjectionSessionPlanItems>, epics: ReturnType<typeof listProjectionSessionPlanEpics>) {
  return {
    sourceItemIds: [...new Set(items.map((i) => i.itemId ?? i.itemRef))].sort(),
    sourceEpicIds: [...new Set(epics.map((e) => e.epicId ?? e.epicRef))].sort(),
    ...((items.find((i) => i.sourceRecommendationRef)?.sourceRecommendationRef) ? { recommendationRef: items.find((i) => i.sourceRecommendationRef)?.sourceRecommendationRef } : {}),
    ...((items.find((i) => i.promotedAt)?.promotedAt) ? { promotedAt: items.find((i) => i.promotedAt)?.promotedAt } : {}),
  };
}

function lifecycleLinkRows(links: AssociatedPlanBuildLink[]) {
  return links.map((link) => cleanObject({
    kind: link.kind,
    stage: String(link.reasonCode ?? link.kind),
    label: link.label ?? link.id,
    status: link.status ?? '',
    session: link.session,
    runId: link.runId,
    prUrl: link.prUrl ?? link.url,
    path: link.path,
    timestamp: link.timestamp,
    affectedItemIds: link.affectedItemIds ?? link.itemIds ?? [],
  }));
}
function cleanObject<T extends Record<string, unknown>>(value: T): T { return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T; }

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
    const failureEvidence = linkRows.filter((row) => row.status === 'failed');
    const evidence = evidenceRows.filter((e) => e.itemId === itemId || e.itemRef === itemId);
    const sessionItems = allSessionItems.filter((s) => (s.itemId ?? s.itemRef) === itemId);
    const taskItems = allTaskItems.filter((t) => (t.itemId ?? t.itemRef) === itemId);
    const life = computeEffectiveLifecycle({ userStatus: item?.userStatus ?? 'candidate', evidence, sessionItems, taskItems, hasUnresolvedDependency: false });
    return { itemId, title: item?.title ?? itemId, status: item?.userStatus ?? 'candidate', ...(item?.epicId ? { epic: item.epicId } : {}), lifecycleState: life.lifecycleState, linkRows, failureEvidence };
  });
  const linkRows = lifecycleLinkRows(getAssociatedPlanBuildLinksForItemsFromStore(store, itemIds));
  const failureEvidence = linkRows.filter((row) => row.status === 'failed');
  const states = [...new Set(itemRows.map((row) => row.lifecycleState))];
  const lifecycleState = states.length === 0 ? 'none' : states.length === 1 ? states[0] : 'partial';
  return { sourceRefs, lifecycleState, itemRows, linkRows, failureEvidence };
}

function artifactFromPlan(plan: ReturnType<typeof listProjectionSessionPlans>[number], lifecycle: ReturnType<typeof sessionLifecycleFromStore>) {
  const readiness = readinessFromSummary(plan.readinessSummary);
  return { kind: 'plan' as const, key: `plan:${plan.session}`, session: plan.session, title: plan.topic ?? plan.session, topic: plan.topic ?? plan.session, status: plan.status ?? 'draft', path: plan.path ?? `.eforge/session-plans/${plan.session}.md`, ready: readiness.ready, missingDimensions: readiness.missingDimensions, coveredDimensions: readiness.coveredDimensions, skippedDimensions: readiness.skippedDimensions, ...(plan.eforgeSessionId ? { eforge_session: plan.eforgeSessionId } : {}), updatedAt: plan.updatedAt, createdAt: plan.createdAt, sourceRefs: lifecycle.sourceRefs, lifecycleState: lifecycle.lifecycleState, itemRows: lifecycle.itemRows, linkRows: lifecycle.linkRows, failureEvidence: lifecycle.failureEvidence };
}
function planSetArtifact(p: { planSetId: string; title?: string; status?: string; path?: string; updatedAt?: string }) { return { kind: 'plan-set' as const, key: `plan-set:${p.planSetId}`, ...p }; }
function projectPlan(plan: ProjectionSessionPlanRow, body: string) { return { ...plan, session: plan.session, topic: plan.topic ?? plan.session, status: plan.status ?? 'draft', body }; }

export async function getSessionPlanLifecycleProjection(cwd: string, session: string): Promise<any> { return withProjectionStore<any>(cwd, (store) => sessionLifecycleFromStore(store, session), () => ({ sourceRefs: { sourceItemIds: [], sourceEpicIds: [] }, lifecycleState: 'none', itemRows: [], linkRows: [], failureEvidence: [] })); }
export async function listPlanningArtifactsProjection(cwd: string, input: ListPlanningArtifactsInput): Promise<any> { const flat = await withProjectionStore(cwd, (store) => listProjectionSessionPlans(store, input.includeSubmitted).map((p) => artifactFromPlan(p, sessionLifecycleFromStore(store, p.session))), () => []); const planning = createSessionPlanningWorkflowAdapter(); let planSets: unknown[] = []; try { planSets = (await planning.planSets.list({ cwd, includeSubmitted: input.includeSubmitted })).map(planSetArtifact); } catch { planSets = []; } const artifacts = [...flat, ...planSets].sort((a: any, b: any) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '') || (a.session ?? a.planSetId ?? '').localeCompare(b.session ?? b.planSetId ?? '')); const page = paginateProjection(artifacts, input, 50, 100); const base: Record<string, unknown> = { artifacts: page.entries, plans: page.entries.filter((a: any) => a.kind === 'plan'), planSets: page.entries.filter((a: any) => a.kind === 'plan-set'), total: page.total, limit: page.limit, offset: page.offset, pagination: pageMetadata(page, page.total) }; if (input.includeBoard === true) base.board = await buildBoardDebugProjection(cwd, { epic: input.epic, includeArchive: input.includeArchive }); return base; }
export async function showSessionPlanProjection(cwd: string, session: string): Promise<any> { return withProjectionStore<any>(cwd, async (store) => { const plan = getProjectionSessionPlan(store, session); if (!plan) throw new Error(`Session plan "${session}" was not found.`); const lifecycle = sessionLifecycleFromStore(store, session); const path = plan.path ?? join('.eforge', 'session-plans', `${session}.md`); let body = ''; try { body = await readFile(join(cwd, path), 'utf8'); } catch { body = ''; } return { path, relativePath: relative(cwd, join(cwd, path)).replace(/\\/g, '/'), plan: projectPlan(plan, body), lifecycle, sourceRefs: lifecycle.sourceRefs, readiness: readinessFromSummary(plan.readinessSummary) }; }, () => { throw new Error(`Session plan "${session}" was not found.`); }); }
