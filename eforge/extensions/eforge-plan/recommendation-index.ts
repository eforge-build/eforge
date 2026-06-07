import type { BacklogRecommendationModel } from './schema.js';

// Per-item recommendation signals projected onto board cards: a "next up" rank,
// the parallel lanes an item belongs to, and an unblock note for blocked chains.
export interface RecommendationIndex {
  rankById: Map<string, number>;
  lanesById: Map<string, string[]>;
  unblockById: Map<string, string>;
}

export function emptyRecommendationIndex(): RecommendationIndex {
  return { rankById: new Map(), lanesById: new Map(), unblockById: new Map() };
}

export function buildRecommendationIndex(model: BacklogRecommendationModel | null | undefined): RecommendationIndex {
  const index = emptyRecommendationIndex();
  if (!model) return index;
  model.recommendedNextSequence.forEach((entry, position) => {
    if (!index.rankById.has(entry.itemId)) index.rankById.set(entry.itemId, position + 1);
  });
  for (const group of model.safeParallelizableGroups) {
    const lane = group.title ?? group.ref;
    for (const itemId of group.itemIds) {
      const lanes = index.lanesById.get(itemId) ?? [];
      if (!lanes.includes(lane)) lanes.push(lane);
      index.lanesById.set(itemId, lanes);
    }
  }
  for (const chain of model.blockedChains) {
    const note = chain.rationale?.trim();
    if (!note) continue;
    for (const itemId of chain.itemIds) {
      if (!index.unblockById.has(itemId)) index.unblockById.set(itemId, note);
    }
  }
  return index;
}
