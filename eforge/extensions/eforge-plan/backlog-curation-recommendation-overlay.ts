import { isBacklogStatus, isClosedStatus } from './backlog-domain.js';
import type { BacklogRecommendationModel } from './schema.js';

export interface CurationRecommendationOverlayResult {
  recommendations: BacklogRecommendationModel;
  removed: {
    itemIds: string[];
    epicIds: string[];
  };
}

export function filterRecommendationsForCurationDraftStatusOverlay(model: BacklogRecommendationModel, draft: unknown): CurationRecommendationOverlayResult {
  const closedItemIds = deriveClosedIds(draft, 'itemChanges');
  const closedEpicIds = deriveClosedIds(draft, 'epicChanges');
  let removed = false;

  const filterItemRefs = (refs: BacklogRecommendationModel['readyCandidates']) => refs.filter((ref) => {
    const keep = !closedItemIds.has(ref.itemId);
    if (!keep) removed = true;
    return keep;
  }).map((ref) => ({ ...ref }));

  const recommendations: BacklogRecommendationModel = {
    ...model,
    activeWork: filterItemRefs(model.activeWork),
    readyCandidates: filterItemRefs(model.readyCandidates),
    recommendedNextSequence: filterItemRefs(model.recommendedNextSequence),
    safeParallelizableGroups: model.safeParallelizableGroups
      .map((group) => {
        const itemIds = group.itemIds.filter((itemId) => !closedItemIds.has(itemId));
        const epicIds = group.epicIds?.filter((epicId) => !closedEpicIds.has(epicId));
        if (itemIds.length !== group.itemIds.length || epicIds?.length !== group.epicIds?.length) removed = true;
        return { ...group, itemIds, ...(group.epicIds !== undefined && { epicIds }) };
      })
      .filter((group) => {
        const keep = group.itemIds.length > 0;
        if (!keep) removed = true;
        return keep;
      }),
    blockedChains: model.blockedChains
      .map((chain) => {
        const itemIds = chain.itemIds.filter((itemId) => !closedItemIds.has(itemId));
        const blockedBy = chain.blockedBy.filter((itemId) => !closedItemIds.has(itemId));
        if (itemIds.length !== chain.itemIds.length || blockedBy.length !== chain.blockedBy.length) removed = true;
        return { ...chain, itemIds, blockedBy };
      })
      .filter((chain) => {
        const keep = chain.itemIds.length > 0;
        if (!keep) removed = true;
        return keep;
      }),
    rationaleAndAssumptions: removed ? appendFilteringNote(model.rationaleAndAssumptions, closedItemIds, closedEpicIds) : [...model.rationaleAndAssumptions],
  };

  return { recommendations, removed: { itemIds: [...closedItemIds].sort(), epicIds: [...closedEpicIds].sort() } };
}

function deriveClosedIds(draft: unknown, field: 'itemChanges' | 'epicChanges'): Set<string> {
  if (draft === null || typeof draft !== 'object') return new Set();
  const changes = (draft as Record<string, unknown>)[field];
  if (!Array.isArray(changes)) return new Set();
  return new Set(changes.flatMap((change) => {
    if (change === null || typeof change !== 'object') return [];
    const record = change as Record<string, unknown>;
    const status = metadataStatus(record.metadata);
    return typeof record.id === 'string' && isBacklogStatus(status) && isClosedStatus(status) ? [record.id] : [];
  }));
}

function metadataStatus(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const status = (value as Record<string, unknown>).status;
  return typeof status === 'string' ? status : undefined;
}

function appendFilteringNote(rationaleAndAssumptions: readonly string[], itemIds: ReadonlySet<string>, epicIds: ReadonlySet<string>): string[] {
  const parts = [
    itemIds.size > 0 ? `items ${[...itemIds].sort().join(', ')}` : undefined,
    epicIds.size > 0 ? `epics ${[...epicIds].sort().join(', ')}` : undefined,
  ].filter((part): part is string => part !== undefined);
  return [...rationaleAndAssumptions, `Filtered recommendation targets closed by this curation draft (${parts.join('; ')}).`];
}
