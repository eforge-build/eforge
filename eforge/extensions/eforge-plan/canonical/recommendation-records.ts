import type { BacklogRecommendationModel, RecommendationSummary } from '../schema.js';
import type { EforgePlanStore, LaneKind, RecommendationRunRow } from '../sqlite/index.js';
import { clearCurrentRecommendationRuns, getBacklogItem, getCurrentRecommendationRun, replaceRecommendationLaneItems, upsertRecommendationLane, upsertRecommendationRun } from '../sqlite/index.js';
import { markRecommendationDirty } from './search-dirty.js';
import { canonicalNowIso, canonicalSha256, stableCanonicalId, withCanonicalTransaction } from './store.js';

export function readCanonicalRecommendations(cwd: string): BacklogRecommendationModel | null {
  return withCanonicalTransaction(cwd, (store) => {
    const current = getCurrentRecommendationRun(store);
    return (current?.rawModel ?? null) as BacklogRecommendationModel | null;
  });
}

export function writeCanonicalRecommendations(cwd: string, model: BacklogRecommendationModel, summary?: RecommendationSummary): RecommendationRunRow {
  return withCanonicalTransaction(cwd, (store) => writeCanonicalRecommendationsRecord(store, model, summary));
}

export function writeCanonicalRecommendationsRecord(store: EforgePlanStore, model: BacklogRecommendationModel, summary?: RecommendationSummary): RecommendationRunRow {
  const sourceFingerprint = canonicalSha256(JSON.stringify(model));
  const runId = `rec-${sourceFingerprint.slice(0, 24)}`;
  const createdAt = model.updatedAt ?? canonicalNowIso();
  clearCurrentRecommendationRuns(store);
  const run = upsertRecommendationRun(store, { runId, sourceFingerprint, createdAt, isCurrent: true, rawModel: model, summary, freshness: { status: 'fresh', updatedAt: createdAt } });
  replaceRunLanes(store, runId, model);
  markRecommendationDirty(store, runId);
  return run;
}

export function markCanonicalRecommendationsStale(cwd: string, reason: string, refs: string[] = []): RecommendationRunRow | undefined {
  return withCanonicalTransaction(cwd, (store) => {
    const current = getCurrentRecommendationRun(store);
    if (!current) return undefined;
    const updated = upsertRecommendationRun(store, { ...current, freshness: { status: 'stale', reason, refs, updatedAt: canonicalNowIso() }, isCurrent: true });
    markRecommendationDirty(store, current.runId, 'recommendations-stale');
    return updated;
  });
}

function replaceRunLanes(store: EforgePlanStore, runId: string, model: BacklogRecommendationModel): void {
  const lanes: Array<{ kind: LaneKind; entries: Array<{ itemId: string; ref?: string; rationale?: string; confidence?: string }>; groups?: never }> = [
    { kind: 'activeWork', entries: model.activeWork },
    { kind: 'readyCandidates', entries: model.readyCandidates },
    { kind: 'recommendedNextSequence', entries: model.recommendedNextSequence },
  ];
  let sequence = 0;
  for (const lane of lanes) {
    const laneId = `lane-${stableCanonicalId([runId, lane.kind, 'default'])}`;
    upsertRecommendationLane(store, { laneId, runId, laneKind: lane.kind, sequence: sequence++ });
    replaceRecommendationLaneItems(store, laneId, lane.entries.map((entry, index) => ({ itemRef: entry.itemId, itemId: getBacklogItem(store, entry.itemId)?.id, role: 'member', sequence: index, rationale: entry.rationale, confidence: entry.confidence ? Number(entry.confidence) : undefined })));
  }
  for (const [index, group] of model.safeParallelizableGroups.entries()) {
    const laneId = `lane-${stableCanonicalId([runId, 'safeParallelizableGroup', group.ref])}`;
    upsertRecommendationLane(store, { laneId, runId, laneKind: 'safeParallelizableGroup', laneRef: group.ref, title: group.title, sequence: sequence++, profile: group.recommendedProfile, rationale: group.rationale });
    replaceRecommendationLaneItems(store, laneId, group.itemIds.map((itemId, itemIndex) => ({ itemRef: itemId, itemId: getBacklogItem(store, itemId)?.id, role: 'member', sequence: itemIndex + index * 100 })));
  }
  for (const [index, chain] of model.blockedChains.entries()) {
    const laneRef = chain.ref ?? `blocked-${index}`;
    const laneId = `lane-${stableCanonicalId([runId, 'blockedChain', laneRef])}`;
    upsertRecommendationLane(store, { laneId, runId, laneKind: 'blockedChain', laneRef, sequence: sequence++, rationale: chain.rationale });
    replaceRecommendationLaneItems(store, laneId, [
      ...chain.itemIds.map((itemId, itemIndex) => ({ itemRef: itemId, itemId: getBacklogItem(store, itemId)?.id, role: 'blocked' as const, sequence: itemIndex })),
      ...chain.blockedBy.map((itemId, itemIndex) => ({ itemRef: itemId, itemId: getBacklogItem(store, itemId)?.id, role: 'blocker' as const, sequence: itemIndex + chain.itemIds.length })),
    ]);
  }
}
