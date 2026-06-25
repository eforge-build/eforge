import { resolveBacklogEpicRelativePath, resolveBacklogItemRelativePath } from '../markdown-store.js';
import type { EforgePlanStore } from '../sqlite/index.js';
import { getProjectionEpic, getProjectionItem, listProjectionDependencies, listProjectionEpicSections, listProjectionEpics, listProjectionItemSections, listProjectionItems, type ProjectionEpicRow, type ProjectionItemRow } from '../sqlite/repositories/projections/items.js';
import { listCurrentLifecycleEvidence, listProjectionPlanningTaskItems, listProjectionQueueBuildLinks, listProjectionSessionItems, type ProjectionLifecycleEvidenceRow } from '../sqlite/repositories/projections/lifecycle.js';
import { withProjectionStore } from './store.js';
import { computeEffectiveLifecycle, isTerminalProjectionStatus } from './lifecycle.js';
import { getAssociatedPlanBuildLinksForItemsFromStore } from './links.js';
import { paginateProjection, uniqueStrings } from './pagination.js';
import type { CompactItemProjection, CompactItemSearchHydrationInput, CompactItemSearchHydrationOutput, GetEpicProjectionInput, GetItemProjectionInput } from './types.js';

export async function getItemDetailProjection(cwd: string, input: GetItemProjectionInput): Promise<any> { return withProjectionStore<any>(cwd, (store) => getItemDetailFromStore(cwd, store, input), () => { throw new Error(`Backlog item "${input.id}" was not found.`); }); }
export async function getEpicDetailProjection(cwd: string, input: GetEpicProjectionInput): Promise<any> { return withProjectionStore<any>(cwd, (store) => getEpicDetailFromStore(cwd, store, input), () => { throw new Error(`Backlog epic "${input.id}" was not found.`); }); }

function durableQueueBuildEvidence(store: EforgePlanStore, itemId: string, sessionItems: ReturnType<typeof listProjectionSessionItems>, existingEvidence: ProjectionLifecycleEvidenceRow[], queueBuildLinks = listProjectionQueueBuildLinks(store)): ProjectionLifecycleEvidenceRow[] {
  const sessions = new Set(sessionItems.map((s) => s.session));
  const hasSubmittedEvidence = existingEvidence.some((e) => e.lifecycleState === 'submitted');
  return queueBuildLinks.flatMap((row): ProjectionLifecycleEvidenceRow[] => {
    if (row.itemId !== itemId && (!row.session || !sessions.has(row.session))) return [];
    if (row.kind === 'queue-prd' && hasSubmittedEvidence) return [];
    const status = row.status?.toLowerCase();
    const state = row.kind === 'landing' ? (status === 'shipped' ? 'shipped' : status === 'merged' ? 'merged' : status && !isTerminalProjectionStatus(status) ? 'pr-open' : undefined) : status === 'failed' ? 'failed' : isTerminalProjectionStatus(status) ? undefined : row.kind === 'queue-prd' ? 'queued' : 'build';
    if (!state) return [];
    const reasonCode = state === 'shipped' ? 'shipped' : state === 'merged' ? 'merged' : state === 'failed' ? 'failed' : row.kind === 'queue-prd' ? 'queued-trace' : row.kind === 'build-session' ? 'active-build-session-trace' : state === 'pr-open' ? 'pr-open' : 'building-trace';
    return [{ evidenceKey: `durable:${row.kind}:${row.id}:${itemId}`, itemId, itemRef: itemId, lifecycleState: state, reasonCode, status: row.status, session: row.session, queuePrdId: row.queuePrdId, runId: row.runId, buildSessionId: row.buildSessionId, landingId: row.kind === 'landing' ? row.id : undefined, occurredAt: row.timestamp, isCurrent: true, isTerminal: state === 'shipped' || state === 'merged' || state === 'failed' }];
  });
}

interface CompactItemContext { dependencies?: ReturnType<typeof listProjectionDependencies>; sessionItems?: ReturnType<typeof listProjectionSessionItems>; evidenceRows?: ReturnType<typeof listCurrentLifecycleEvidence>; taskItems?: ReturnType<typeof listProjectionPlanningTaskItems>; queueBuildLinks?: ReturnType<typeof listProjectionQueueBuildLinks> }

export function compactItemFromStore(store: EforgePlanStore, item: ProjectionItemRow, options: { includeDependencies?: boolean; includeLinks?: boolean; cwd?: string; context?: CompactItemContext } = {}): CompactItemProjection {
  const deps = (options.context?.dependencies ?? listProjectionDependencies(store)).filter((d) => d.itemId === item.id);
  const unresolved = deps.filter((d) => d.dependencyStatus !== 'closed' && d.dependencyStatus !== 'external').map((d) => d.resolvedDependencyItemId ?? d.dependencyRef);
  const sessionItems = (options.context?.sessionItems ?? listProjectionSessionItems(store)).filter((s) => (s.itemId ?? s.itemRef) === item.id);
  const existingEvidence = (options.context?.evidenceRows ?? listCurrentLifecycleEvidence(store)).filter((e) => e.itemId === item.id || e.itemRef === item.id);
  const evidence = [...existingEvidence, ...durableQueueBuildEvidence(store, item.id, sessionItems, existingEvidence, options.context?.queueBuildLinks)];
  const taskItems = (options.context?.taskItems ?? listProjectionPlanningTaskItems(store)).filter((t) => (t.itemId ?? t.itemRef) === item.id);
  const allLinks = getAssociatedPlanBuildLinksForItemsFromStore(store, [item.id]).slice(0, 20);
  const life = computeEffectiveLifecycle({ userStatus: item.userStatus, evidence, sessionItems, taskItems, hasUnresolvedDependency: unresolved.length > 0, itemId: item.id, links: allLinks });
  const links = options.includeLinks ? allLinks : undefined;
  return { id: item.id, title: item.title, status: item.userStatus, userStatus: item.userStatus, priority: item.priority ?? 'normal', tags: item.tags, lane: life.lane, reasons: life.reasons, reasonCodes: [life.reasonCode], updatedAt: item.updatedAt, planEligible: life.planEligible, ...(life.planEligibilityReasonCode ? { planEligibilityReasonCode: life.planEligibilityReasonCode } : {}), ...(life.planEligibilityReasonMessage ? { planEligibilityReasonMessage: life.planEligibilityReasonMessage } : {}), ...(life.planEligibilityLinks ? { planEligibilityLinks: life.planEligibilityLinks } : {}), ...(options.includeDependencies === false ? {} : { dependsOn: deps.map((d) => d.resolvedDependencyItemId ?? d.dependencyRef), unresolvedDependsOn: unresolved }), activeTraceReasons: [], blocked: life.blocked, ready: life.ready, reviewDue: life.reviewDue, closed: life.closed, ...(item.epicId ? { epic: item.epicId } : {}), lifecycleState: life.lifecycleState, effectiveLifecycle: life.lifecycleState, ...(links ? { associatedLinks: links } : {}), ...(options.cwd ? { path: resolveBacklogItemRelativePath(options.cwd, item.id) } : {}), hasBody: item.body.trim().length > 0 };
}
export function compactEpicFromRows(epic: ProjectionEpicRow, items: readonly ProjectionItemRow[]) { const epicItems = items.filter((i) => i.epicId === epic.id); return { id: epic.id, title: epic.title, status: epic.userStatus, userStatus: epic.userStatus, ...(epic.priority ? { priority: epic.priority } : {}), tags: epic.tags, itemCount: epicItems.length, totalItems: epicItems.length, openItemCount: epicItems.filter((i) => i.userStatus !== 'shipped' && i.userStatus !== 'stale' && i.userStatus !== 'superseded').length, hasBody: epic.body.trim().length > 0 }; }
function sections(rows: Array<{ sectionName: string; content: string }>) { return Object.fromEntries(rows.map((r) => [r.sectionName, r.content])); }
function getItemDetailFromStore(cwd: string, store: EforgePlanStore, input: GetItemProjectionInput) { const item = getProjectionItem(store, input.id); if (!item) throw new Error(`Backlog item "${input.id}" was not found.`); const items = listProjectionItems(store); const epic = item.epicId ? getProjectionEpic(store, item.epicId) : undefined; const context = compactItemContext(store); const allCards = new Map(items.map((i) => [i.id, compactItemFromStore(store, i, { includeDependencies: input.includeDependencies !== false, context })])); const deps = context.dependencies ?? []; return { schemaVersion: 1 as const, item: { ...compactItemFromStore(store, item, { includeDependencies: input.includeDependencies !== false, includeLinks: input.includeLifecycleRows !== false, cwd, context }), ...(input.includeSections !== false ? { sections: sections(listProjectionItemSections(store, item.id)) } : {}), ...(input.includeLifecycleRows !== false ? { linkRows: getAssociatedPlanBuildLinksForItemsFromStore(store, [item.id]), failureEvidence: (context.evidenceRows ?? []).filter((e) => (e.itemId === item.id || e.itemRef === item.id) && e.lifecycleState === 'failed') } : {}), ...(input.includeBody ? { body: item.body } : {}) }, ...(input.includeEpic !== false && epic ? { epic: compactEpicFromRows(epic, items) } : {}), ...(input.includeDependencies !== false ? { dependencies: uniqueStrings(deps.filter((d) => d.itemId === item.id).map((d) => d.resolvedDependencyItemId)).map((id) => allCards.get(id)).filter((card): card is CompactItemProjection => card !== undefined) } : {}), ...(input.includeDependents !== false ? { dependents: uniqueStrings(deps.filter((d) => d.resolvedDependencyItemId === item.id).map((d) => d.itemId)).map((id) => allCards.get(id)).filter((card): card is CompactItemProjection => card !== undefined) } : {}) }; }
function getEpicDetailFromStore(cwd: string, store: EforgePlanStore, input: GetEpicProjectionInput) { const epic = getProjectionEpic(store, input.id); if (!epic) throw new Error(`Backlog epic "${input.id}" was not found.`); const items = listProjectionItems(store); const context = compactItemContext(store); const epicItems = input.includeItems === false ? [] : items.filter((i) => i.epicId === epic.id).map((i) => compactItemFromStore(store, i, { includeDependencies: input.includeItemDependencies !== false, context })); const page = paginateProjection(epicItems, input); return { schemaVersion: 1 as const, epic: { ...compactEpicFromRows(epic, items), path: resolveBacklogEpicRelativePath(cwd, epic.id), ...(input.includeSections !== false ? { sections: sections(listProjectionEpicSections(store, epic.id)) } : {}), ...(input.includeBody ? { body: epic.body } : {}) }, items: page.entries, totalItems: items.filter((i) => i.epicId === epic.id).length, itemCount: items.filter((i) => i.epicId === epic.id).length, openItemCount: items.filter((i) => i.epicId === epic.id && i.userStatus !== 'shipped' && i.userStatus !== 'stale' && i.userStatus !== 'superseded').length, limit: page.limit, offset: page.offset }; }
function compactItemContext(store: EforgePlanStore): CompactItemContext { return { dependencies: listProjectionDependencies(store), sessionItems: listProjectionSessionItems(store), evidenceRows: listCurrentLifecycleEvidence(store), taskItems: listProjectionPlanningTaskItems(store), queueBuildLinks: listProjectionQueueBuildLinks(store) }; }
export function listAllCompactItemsFromStore(store: EforgePlanStore, input: { includeArchive?: boolean; epic?: string; includeDependencies?: boolean; includeLinks?: boolean } = {}) { const context = compactItemContext(store); return listProjectionItems(store).filter((i) => input.epic === undefined || i.epicId === input.epic).map((i) => compactItemFromStore(store, i, { includeDependencies: input.includeDependencies !== false, includeLinks: input.includeLinks === true, context })).filter((i) => input.includeArchive === true || i.lane !== 'archive'); }
export function listAllCompactEpicsFromStore(store: EforgePlanStore) { const items = listProjectionItems(store); return listProjectionEpics(store).map((e) => compactEpicFromRows(e, items)); }
export function hydrateCompactItemSearchResults(store: EforgePlanStore, input: CompactItemSearchHydrationInput): CompactItemSearchHydrationOutput {
  const wanted = input.ids ? new Set(input.ids) : undefined;
  const order = new Map((input.ids ?? []).map((id, index) => [id, index]));
  const context = compactItemContext(store);
  const compact = listProjectionItems(store)
    .filter((item) => wanted === undefined || wanted.has(item.id))
    .map((item) => compactItemFromStore(store, item, { includeDependencies: input.includeDependencies !== false, includeLinks: input.includeLinks === true, context }))
    .filter((item) => input.includeArchive === true || item.lane !== 'archive')
    .filter((item) => input.epic === undefined || item.epic === input.epic)
    .filter((item) => input.status === undefined || item.status === input.status)
    .filter((item) => input.lane === undefined || item.lane === input.lane)
    .filter((item) => input.tags === undefined || input.tags.every((tag) => item.tags.includes(tag)))
    .sort((a, b) => (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.id) ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id));
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? 20), 1), 100);
  const offset = Math.max(Math.trunc(input.offset ?? 0), 0);
  return { items: compact.slice(offset, offset + limit), total: compact.length, limit, offset };
}
