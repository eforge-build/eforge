import { isBacklogStatus, isClosedStatus } from './backlog-domain.js';
import { summarizeRecommendations } from './recommendations-store.js';
import type { RecommendationReferenceValidationIssue, RecommendationReferenceValidationResult } from './backlog-curation-schemas.js';
import type { BacklogRecommendationModel, RecommendationSummary } from './schema.js';

// --- eforge:region plan-04-plan-03-prospective-overlay-apply ---
export interface RecommendationReferenceRecord {
  id: string;
  kind: 'item' | 'epic';
  title?: string;
  slug?: string;
  status: string;
  lifecycleState?: string;
}

export interface RecommendationRepositionedTarget {
  itemId: string;
  from: string;
  to: string;
}

export interface ProspectiveCurationProjection {
  prospectiveItems: RecommendationReferenceRecord[];
  prospectiveEpics: RecommendationReferenceRecord[];
  effectiveRecommendations?: BacklogRecommendationModel;
  removed: { itemIds: string[]; epicIds: string[] };
  repositioned: RecommendationRepositionedTarget[];
  validation: RecommendationReferenceValidationResult;
  summary: RecommendationSummary | undefined;
}

export interface CurationRecommendationOverlayResult {
  recommendations: BacklogRecommendationModel;
  removed: {
    itemIds: string[];
    epicIds: string[];
  };
}

type ItemRef = BacklogRecommendationModel['readyCandidates'][number];
type Group = BacklogRecommendationModel['safeParallelizableGroups'][number];
type BlockedChain = BacklogRecommendationModel['blockedChains'][number];

type DraftStatusChange = { id: string; status: string };

export function buildProspectiveCurationProjection(input: {
  currentItems: readonly RecommendationReferenceRecord[];
  currentEpics: readonly RecommendationReferenceRecord[];
  draft: unknown;
  generatedRecommendations?: BacklogRecommendationModel;
}): ProspectiveCurationProjection {
  const prospectiveItems = applyDraftStatusChanges(input.currentItems, deriveStatusChanges(input.draft, 'itemChanges'));
  const prospectiveEpics = applyDraftStatusChanges(input.currentEpics, deriveStatusChanges(input.draft, 'epicChanges'));
  const epicCatalog = new Map(prospectiveEpics.map((epic) => [epic.id, epic]));
  const closedItemIds = new Set([...deriveStatusChanges(input.draft, 'itemChanges').values()].filter((change) => isClosedStatusString(change.status)).map((change) => change.id));
  const closedEpicIds = new Set([...deriveStatusChanges(input.draft, 'epicChanges').values()].filter((change) => isClosedStatusString(change.status)).map((change) => change.id));

  if (input.generatedRecommendations === undefined) {
    return { prospectiveItems, prospectiveEpics, removed: { itemIds: [], epicIds: [] }, repositioned: [], validation: { valid: true, issues: [] }, summary: undefined };
  }

  const overlay = overlayRecommendations(input.generatedRecommendations, epicCatalog, closedItemIds, closedEpicIds, deriveStatusChanges(input.draft, 'itemChanges'));
  const validation = collectProspectiveRecommendationValidationIssues(overlay.recommendations, prospectiveItems, prospectiveEpics);
  return {
    prospectiveItems,
    prospectiveEpics,
    effectiveRecommendations: overlay.recommendations,
    removed: { itemIds: [...overlay.removedItemIds].sort(), epicIds: [...overlay.removedEpicIds].sort() },
    repositioned: overlay.repositioned.sort(byRepositionedTarget),
    validation,
    summary: summarizeRecommendations(overlay.recommendations),
  };
}

export function filterRecommendationsForCurationDraftStatusOverlay(model: BacklogRecommendationModel, draft: unknown): CurationRecommendationOverlayResult {
  const itemIds = collectModelItemIds(model);
  const epicIds = collectModelEpicIds(model);
  const itemStatusChanges = deriveStatusChanges(draft, 'itemChanges');
  const epicStatusChanges = deriveStatusChanges(draft, 'epicChanges');
  const projection = buildProspectiveCurationProjection({
    currentItems: [...itemIds].map((id) => ({ id, kind: 'item', status: itemStatusChanges.get(id)?.status ?? 'candidate' })),
    currentEpics: [...epicIds].map((id) => ({ id, kind: 'epic', status: epicStatusChanges.get(id)?.status ?? 'candidate' })),
    draft,
    generatedRecommendations: model,
  });
  return { recommendations: projection.effectiveRecommendations ?? cloneRecommendationModel(model), removed: projection.removed };
}

function overlayRecommendations(
  model: BacklogRecommendationModel,
  epicCatalog: ReadonlyMap<string, RecommendationReferenceRecord>,
  closedItemIds: ReadonlySet<string>,
  closedEpicIds: ReadonlySet<string>,
  itemStatusChanges: ReadonlyMap<string, DraftStatusChange>,
): { recommendations: BacklogRecommendationModel; removedItemIds: Set<string>; removedEpicIds: Set<string>; repositioned: RecommendationRepositionedTarget[] } {
  const removedItemIds = new Set<string>();
  const removedEpicIds = new Set<string>();
  const repositioned: RecommendationRepositionedTarget[] = [];
  const movedToActive = new Map<string, ItemRef>();
  const movedToReady = new Map<string, ItemRef>();

  const activeWork = filterItemRefs(model.activeWork, 'activeWork', closedItemIds, removedItemIds, repositioned, movedToActive, movedToReady, itemStatusChanges);
  const readyCandidates = filterItemRefs(model.readyCandidates, 'readyCandidates', closedItemIds, removedItemIds, repositioned, movedToActive, movedToReady, itemStatusChanges);
  const recommendedNextSequence = filterItemRefs(model.recommendedNextSequence, 'recommendedNextSequence', closedItemIds, removedItemIds, repositioned, movedToActive, movedToReady, itemStatusChanges);
  const safeParallelizableGroups = model.safeParallelizableGroups.flatMap((group) => overlayGroup(group, epicCatalog, closedItemIds, closedEpicIds, removedItemIds, removedEpicIds, repositioned, movedToActive, itemStatusChanges));
  const blockedChains = model.blockedChains.flatMap((chain) => overlayBlockedChain(chain, closedItemIds, removedItemIds, repositioned, movedToActive, itemStatusChanges));

  const activeIds = new Set(activeWork.map((ref) => ref.itemId));
  for (const [itemId, ref] of movedToActive) if (!activeIds.has(itemId)) activeWork.push(ref);
  const readyIds = new Set(readyCandidates.map((ref) => ref.itemId));
  for (const [itemId, ref] of movedToReady) {
    if (!readyIds.has(itemId) && !appearsInNonActiveLane(itemId, readyCandidates, recommendedNextSequence, safeParallelizableGroups, blockedChains)) readyCandidates.push(ref);
  }

  const recommendations: BacklogRecommendationModel = {
    ...cloneRecommendationModel(model),
    activeWork: uniqueItemRefs(activeWork),
    readyCandidates: uniqueItemRefs(readyCandidates),
    recommendedNextSequence: uniqueItemRefs(recommendedNextSequence),
    safeParallelizableGroups,
    blockedChains,
    rationaleAndAssumptions: appendOverlayNote(model.rationaleAndAssumptions, removedItemIds, removedEpicIds, repositioned),
  };
  return { recommendations, removedItemIds, removedEpicIds, repositioned };
}

function filterItemRefs(
  refs: readonly ItemRef[],
  lane: string,
  closedItemIds: ReadonlySet<string>,
  removedItemIds: Set<string>,
  repositioned: RecommendationRepositionedTarget[],
  movedToActive: Map<string, ItemRef>,
  movedToReady: Map<string, ItemRef>,
  itemStatusChanges: ReadonlyMap<string, DraftStatusChange>,
): ItemRef[] {
  const result: ItemRef[] = [];
  for (const ref of refs) {
    if (closedItemIds.has(ref.itemId)) {
      removedItemIds.add(ref.itemId);
      continue;
    }
    const changedStatus = itemStatusChanges.get(ref.itemId)?.status;
    if (changedStatus === 'active' && lane !== 'activeWork') {
      if (!movedToActive.has(ref.itemId)) movedToActive.set(ref.itemId, cloneItemRef(ref));
      repositioned.push({ itemId: ref.itemId, from: lane, to: 'activeWork' });
      continue;
    }
    if (changedStatus === 'planned' && lane === 'activeWork') {
      if (!movedToReady.has(ref.itemId)) movedToReady.set(ref.itemId, cloneItemRef(ref));
      repositioned.push({ itemId: ref.itemId, from: 'activeWork', to: 'readyCandidates' });
      continue;
    }
    result.push(cloneItemRef(ref));
  }
  return result;
}

function overlayGroup(
  group: Group,
  epicCatalog: ReadonlyMap<string, RecommendationReferenceRecord>,
  closedItemIds: ReadonlySet<string>,
  closedEpicIds: ReadonlySet<string>,
  removedItemIds: Set<string>,
  removedEpicIds: Set<string>,
  repositioned: RecommendationRepositionedTarget[],
  movedToActive: Map<string, ItemRef>,
  itemStatusChanges: ReadonlyMap<string, DraftStatusChange>,
): Group[] {
  const itemIds: string[] = [];
  for (const itemId of group.itemIds) {
    if (closedItemIds.has(itemId)) {
      removedItemIds.add(itemId);
    } else if (itemStatusChanges.get(itemId)?.status === 'active') {
      if (!movedToActive.has(itemId)) movedToActive.set(itemId, { itemId, ...(group.rationale !== undefined && { rationale: group.rationale }) });
      repositioned.push({ itemId, from: `safeParallelizableGroups.${group.ref}.itemIds`, to: 'activeWork' });
    } else {
      itemIds.push(itemId);
    }
  }
  const epicIds = group.epicIds?.filter((epicId) => {
    const remove = closedEpicIds.has(epicId) && epicCatalog.has(epicId);
    if (remove) removedEpicIds.add(epicId);
    return !remove;
  });
  if (itemIds.length === 0 && group.itemIds.length > 0) return [];
  return [{ ...group, itemIds, ...(group.epicIds !== undefined && { epicIds }) }];
}

function overlayBlockedChain(
  chain: BlockedChain,
  closedItemIds: ReadonlySet<string>,
  removedItemIds: Set<string>,
  repositioned: RecommendationRepositionedTarget[],
  movedToActive: Map<string, ItemRef>,
  itemStatusChanges: ReadonlyMap<string, DraftStatusChange>,
): BlockedChain[] {
  const itemIds: string[] = [];
  const ref = chain.ref ?? '<unreferenced>';
  for (const itemId of chain.itemIds) {
    if (closedItemIds.has(itemId)) {
      removedItemIds.add(itemId);
    } else if (itemStatusChanges.get(itemId)?.status === 'active') {
      if (!movedToActive.has(itemId)) movedToActive.set(itemId, { itemId, ...(chain.rationale !== undefined && { rationale: chain.rationale }) });
      repositioned.push({ itemId, from: `blockedChains.${ref}.itemIds`, to: 'activeWork' });
    } else {
      itemIds.push(itemId);
    }
  }
  const blockedBy = chain.blockedBy.filter((itemId) => {
    const remove = closedItemIds.has(itemId);
    if (remove) removedItemIds.add(itemId);
    return !remove;
  });
  if (itemIds.length === 0) return [];
  return [{ ...chain, itemIds, blockedBy }];
}

function collectProspectiveRecommendationValidationIssues(model: BacklogRecommendationModel, items: readonly RecommendationReferenceRecord[], epics: readonly RecommendationReferenceRecord[]): RecommendationReferenceValidationResult {
  const itemCatalog = new Map(items.map((item) => [item.id, item]));
  const epicCatalog = new Map(epics.map((epic) => [epic.id, epic]));
  const issues: RecommendationReferenceValidationIssue[] = [];
  model.activeWork.forEach((ref, index) => {
    collectKnownOpenRefIssue(`activeWork[${index}].itemId`, ref.itemId, itemCatalog, 'item', issues);
    collectLaneIssue(`activeWork[${index}].itemId`, ref.itemId, itemCatalog, 'activeWork', issues);
  });
  for (const [field, refs] of [['readyCandidates', model.readyCandidates], ['recommendedNextSequence', model.recommendedNextSequence]] as const) {
    refs.forEach((ref, index) => {
      collectKnownOpenRefIssue(`${field}[${index}].itemId`, ref.itemId, itemCatalog, 'item', issues);
      collectLaneIssue(`${field}[${index}].itemId`, ref.itemId, itemCatalog, field, issues);
    });
  }
  for (const group of model.safeParallelizableGroups) {
    if (group.itemIds.length === 0) issues.push(buildIssue(`safeParallelizableGroups.${group.ref}.itemIds`, '', 'item', 'empty', undefined, 'Recommendation safe parallel group must include at least one open item id.'));
    for (const itemId of group.itemIds) {
      collectKnownOpenRefIssue(`safeParallelizableGroups.${group.ref}.itemIds`, itemId, itemCatalog, 'item', issues);
      collectLaneIssue(`safeParallelizableGroups.${group.ref}.itemIds`, itemId, itemCatalog, 'safeParallelizableGroups.itemIds', issues);
    }
    for (const epicId of group.epicIds ?? []) collectKnownOpenRefIssue(`safeParallelizableGroups.${group.ref}.epicIds`, epicId, epicCatalog, 'epic', issues);
  }
  for (const chain of model.blockedChains) {
    const ref = chain.ref ?? '<unreferenced>';
    for (const itemId of chain.itemIds) {
      collectKnownOpenRefIssue(`blockedChains.${ref}.itemIds`, itemId, itemCatalog, 'item', issues);
      collectLaneIssue(`blockedChains.${ref}.itemIds`, itemId, itemCatalog, 'blockedChains.itemIds', issues);
    }
    for (const blockerId of chain.blockedBy) collectKnownOpenRefIssue(`blockedChains.${ref}.blockedBy`, blockerId, itemCatalog, 'item', issues);
  }
  return { valid: issues.length === 0, issues };
}

function collectLaneIssue(path: string, id: string, catalog: ReadonlyMap<string, RecommendationReferenceRecord>, lane: string, issues: RecommendationReferenceValidationIssue[]): void {
  const record = catalog.get(id);
  if (record === undefined || isClosedStatusString(record.status)) return;
  const lifecycle = record.lifecycleState;
  const activeLifecycle = lifecycle === 'active' || lifecycle === 'queue' || lifecycle === 'build' || lifecycle === 'pr-open';
  if (lane === 'activeWork') {
    if (record.status !== 'active' && !activeLifecycle) issues.push(buildWrongLaneIssue(path, id, record, 'activeWork expects prospective status "active" or lifecycle state active/queue/build/pr-open'));
    return;
  }
  if (record.status === 'active') issues.push(buildWrongLaneIssue(path, id, record, `${lane} must not reference prospective active items`));
}

function collectKnownOpenRefIssue(path: string, id: string, catalog: ReadonlyMap<string, RecommendationReferenceRecord>, kind: 'item' | 'epic', issues: RecommendationReferenceValidationIssue[]): void {
  const record = catalog.get(id);
  if (record === undefined) {
    issues.push(buildIssue(path, id, kind, 'unknown', undefined, `Recommendation ${path} references unknown ${kind} id "${id}".`));
    return;
  }
  if (isClosedStatusString(record.status)) issues.push(buildIssue(path, id, kind, 'closed', record, `Recommendation ${path} references closed ${kind} id "${id}" with prospective status "${record.status}".`));
}

function buildWrongLaneIssue(path: string, id: string, record: RecommendationReferenceRecord, rule: string): RecommendationReferenceValidationIssue {
  return buildIssue(path, id, 'item', 'wrong-lane', record, `Recommendation ${path} references item id "${id}" with prospective status "${record.status}"; ${rule}.`);
}

function buildIssue(path: string, id: string, kind: 'item' | 'epic', reason: RecommendationReferenceValidationIssue['reason'], record: RecommendationReferenceRecord | undefined, message: string): RecommendationReferenceValidationIssue {
  return { path, id, kind, reason, ...(record?.status !== undefined && isBacklogStatus(record.status) && { status: record.status }), ...(record?.title !== undefined && { title: record.title }), message };
}

function applyDraftStatusChanges(records: readonly RecommendationReferenceRecord[], changes: ReadonlyMap<string, DraftStatusChange>): RecommendationReferenceRecord[] {
  return records.map((record) => ({ ...record, ...(changes.get(record.id)?.status !== undefined && { status: changes.get(record.id)!.status }) }));
}

function deriveStatusChanges(draft: unknown, field: 'itemChanges' | 'epicChanges'): Map<string, DraftStatusChange> {
  if (draft === null || typeof draft !== 'object') return new Map();
  const changes = (draft as Record<string, unknown>)[field];
  if (!Array.isArray(changes)) return new Map();
  return new Map(changes.flatMap((change): Array<[string, DraftStatusChange]> => {
    if (change === null || typeof change !== 'object') return [];
    const record = change as Record<string, unknown>;
    const status = metadataStatus(record.metadata);
    return typeof record.id === 'string' && typeof status === 'string' ? [[record.id, { id: record.id, status }]] : [];
  }));
}

function metadataStatus(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const status = (value as Record<string, unknown>).status;
  return typeof status === 'string' ? status : undefined;
}

function appendOverlayNote(rationaleAndAssumptions: readonly string[], itemIds: ReadonlySet<string>, epicIds: ReadonlySet<string>, repositioned: readonly RecommendationRepositionedTarget[]): string[] {
  if (itemIds.size === 0 && epicIds.size === 0 && repositioned.length === 0) return [...rationaleAndAssumptions];
  const parts = [
    itemIds.size > 0 ? `removed items ${[...itemIds].sort().join(', ')}` : undefined,
    epicIds.size > 0 ? `removed epics ${[...epicIds].sort().join(', ')}` : undefined,
    repositioned.length > 0 ? `repositioned items ${[...new Set(repositioned.map((entry) => entry.itemId))].sort().join(', ')}` : undefined,
  ].filter((part): part is string => part !== undefined);
  return [...rationaleAndAssumptions, `Adjusted generated recommendations for the prospective curation state (${parts.join('; ')}).`];
}

function appearsInNonActiveLane(itemId: string, ready: readonly ItemRef[], next: readonly ItemRef[], groups: readonly Group[], chains: readonly BlockedChain[]): boolean {
  return ready.some((ref) => ref.itemId === itemId) || next.some((ref) => ref.itemId === itemId) || groups.some((group) => group.itemIds.includes(itemId)) || chains.some((chain) => chain.itemIds.includes(itemId));
}

function uniqueItemRefs(refs: readonly ItemRef[]): ItemRef[] {
  const seen = new Set<string>();
  return refs.flatMap((ref) => {
    if (seen.has(ref.itemId)) return [];
    seen.add(ref.itemId);
    return [cloneItemRef(ref)];
  });
}

function cloneRecommendationModel(model: BacklogRecommendationModel): BacklogRecommendationModel {
  return {
    ...model,
    activeWork: model.activeWork.map(cloneItemRef),
    readyCandidates: model.readyCandidates.map(cloneItemRef),
    recommendedNextSequence: model.recommendedNextSequence.map(cloneItemRef),
    safeParallelizableGroups: model.safeParallelizableGroups.map((group) => ({ ...group, itemIds: [...group.itemIds], ...(group.epicIds !== undefined && { epicIds: [...group.epicIds] }) })),
    blockedChains: model.blockedChains.map((chain) => ({ ...chain, itemIds: [...chain.itemIds], blockedBy: [...chain.blockedBy] })),
    rationaleAndAssumptions: [...model.rationaleAndAssumptions],
  };
}

function cloneItemRef(ref: ItemRef): ItemRef {
  return { ...ref };
}

function collectModelItemIds(model: BacklogRecommendationModel): Set<string> {
  return new Set([
    ...model.activeWork.map((ref) => ref.itemId),
    ...model.readyCandidates.map((ref) => ref.itemId),
    ...model.recommendedNextSequence.map((ref) => ref.itemId),
    ...model.safeParallelizableGroups.flatMap((group) => group.itemIds),
    ...model.blockedChains.flatMap((chain) => [...chain.itemIds, ...chain.blockedBy]),
  ]);
}

function collectModelEpicIds(model: BacklogRecommendationModel): Set<string> {
  return new Set(model.safeParallelizableGroups.flatMap((group) => group.epicIds ?? []));
}

function isClosedStatusString(status: string | undefined): boolean {
  return isBacklogStatus(status) && isClosedStatus(status);
}

function byRepositionedTarget(left: RecommendationRepositionedTarget, right: RecommendationRepositionedTarget): number {
  return left.itemId.localeCompare(right.itemId) || left.from.localeCompare(right.from) || left.to.localeCompare(right.to);
}
// --- eforge:endregion plan-04-plan-03-prospective-overlay-apply ---
