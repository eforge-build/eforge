import { describe, expect, it } from 'vitest';
import { buildProspectiveCurationProjection, filterRecommendationsForCurationDraftStatusOverlay } from '../backlog-curation-recommendation-overlay.js';
import { createEmptyRecommendationModel } from '../recommendations-store.js';

const currentItems = [
  { id: 'ship-me', kind: 'item' as const, status: 'candidate' },
  { id: 'stale-me', kind: 'item' as const, status: 'planned' },
  { id: 'activate-me', kind: 'item' as const, status: 'planned' },
  { id: 'plan-me', kind: 'item' as const, status: 'active' },
  { id: 'candidate-me', kind: 'item' as const, status: 'candidate' },
  { id: 'open-blocker', kind: 'item' as const, status: 'candidate' },
];
const currentEpics = [
  { id: 'closed-epic', kind: 'epic' as const, status: 'candidate' },
  { id: 'open-epic', kind: 'epic' as const, status: 'candidate' },
];
const draft = {
  itemChanges: [
    { kind: 'item', id: 'ship-me', metadata: { status: 'shipped' } },
    { kind: 'item', id: 'stale-me', metadata: { status: 'stale' } },
    { kind: 'item', id: 'activate-me', metadata: { status: 'active' } },
    { kind: 'item', id: 'plan-me', metadata: { status: 'planned' } },
  ],
  epicChanges: [{ kind: 'epic', id: 'closed-epic', metadata: { status: 'superseded' } }],
};

describe('backlog curation recommendation overlay', () => {
  it('builds an immutable prospective projection with closed filtering and deterministic metadata', () => {
    const model = {
      ...createEmptyRecommendationModel(),
      activeWork: [{ itemId: 'ship-me', rationale: 'Active.' }, { itemId: 'plan-me', rationale: 'Plan.' }],
      readyCandidates: [{ itemId: 'ship-me', rationale: 'Ready.' }, { itemId: 'activate-me', rationale: 'Ready.' }],
      recommendedNextSequence: [{ itemId: 'ship-me', rationale: 'Next.' }, { itemId: 'candidate-me', rationale: 'Next.' }],
      safeParallelizableGroups: [{ ref: 'mixed', itemIds: ['ship-me', 'activate-me', 'candidate-me'], epicIds: ['closed-epic', 'open-epic'], rationale: 'Together.' }],
      blockedChains: [{ ref: 'mixed-chain', itemIds: ['ship-me', 'activate-me'], blockedBy: ['stale-me', 'open-blocker'], rationale: 'Blocked.' }],
      rationaleAndAssumptions: ['Original rationale.'],
    };
    const originalModel = structuredClone(model);
    const originalDraft = structuredClone(draft);

    const projection = buildProspectiveCurationProjection({ currentItems, currentEpics, draft, generatedRecommendations: model });

    expect(projection.removed).toEqual({ itemIds: ['ship-me', 'stale-me'], epicIds: ['closed-epic'] });
    expect(projection.repositioned.map((entry) => entry.itemId)).toEqual(['activate-me', 'activate-me', 'activate-me', 'plan-me']);
    expect(projection.effectiveRecommendations?.activeWork.map((entry) => entry.itemId)).toEqual(['activate-me']);
    expect(projection.effectiveRecommendations?.readyCandidates.map((entry) => entry.itemId)).toEqual(['plan-me']);
    expect(projection.effectiveRecommendations?.recommendedNextSequence.map((entry) => entry.itemId)).toEqual(['candidate-me']);
    expect(projection.effectiveRecommendations?.safeParallelizableGroups).toEqual([{ ref: 'mixed', itemIds: ['candidate-me'], epicIds: ['open-epic'], rationale: 'Together.' }]);
    expect(projection.effectiveRecommendations?.blockedChains).toEqual([]);
    expect(projection.summary?.recommendedNextItemIds).toEqual(['candidate-me']);
    expect(projection.validation.valid).toBe(true);
    expect(model).toEqual(originalModel);
    expect(draft).toEqual(originalDraft);
  });

  it('drops groups and blocked chains whose item ids become empty after prospective closure', () => {
    const model = {
      ...createEmptyRecommendationModel(),
      safeParallelizableGroups: [{ ref: 'empty-group', itemIds: ['ship-me'], epicIds: ['closed-epic'], rationale: 'No longer possible.' }],
      blockedChains: [{ ref: 'empty-chain', itemIds: ['ship-me'], blockedBy: ['stale-me'], rationale: 'No remaining target.' }],
    };

    const projection = buildProspectiveCurationProjection({ currentItems, currentEpics, draft, generatedRecommendations: model });

    expect(projection.effectiveRecommendations?.safeParallelizableGroups).toEqual([]);
    expect(projection.effectiveRecommendations?.blockedChains).toEqual([]);
    expect(projection.removed).toEqual({ itemIds: ['ship-me', 'stale-me'], epicIds: ['closed-epic'] });
    expect(projection.validation.valid).toBe(true);
  });

  it('reports unknown, closed, and empty validation issues using stable target paths', () => {
    const projection = buildProspectiveCurationProjection({
      currentItems: [...currentItems, { id: 'already-shipped', kind: 'item' as const, status: 'shipped' }],
      currentEpics,
      draft: {},
      generatedRecommendations: {
        ...createEmptyRecommendationModel(),
        readyCandidates: [{ itemId: 'missing-item' }, { itemId: 'already-shipped' }],
        safeParallelizableGroups: [{ ref: 'empty', itemIds: [], epicIds: ['missing-epic'], rationale: 'Invalid group.' }],
      },
    });

    expect(projection.validation.valid).toBe(false);
    expect(projection.validation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'readyCandidates[0].itemId', id: 'missing-item', kind: 'item', reason: 'unknown' }),
      expect.objectContaining({ path: 'readyCandidates[1].itemId', id: 'already-shipped', kind: 'item', reason: 'closed', status: 'shipped' }),
      expect.objectContaining({ path: 'safeParallelizableGroups.empty.itemIds', reason: 'empty' }),
      expect.objectContaining({ path: 'safeParallelizableGroups.empty.epicIds', id: 'missing-epic', kind: 'epic', reason: 'unknown' }),
    ]));
  });

  it('validates wrong active-work and ready lanes against the prospective state', () => {
    const activeWrong = buildProspectiveCurationProjection({ currentItems, currentEpics, draft: {}, generatedRecommendations: { ...createEmptyRecommendationModel(), activeWork: [{ itemId: 'candidate-me' }] } });
    expect(activeWrong.validation.issues).toEqual([expect.objectContaining({ path: 'activeWork[0].itemId', reason: 'wrong-lane', id: 'candidate-me' })]);

    const readyWrong = buildProspectiveCurationProjection({ currentItems, currentEpics, draft: {}, generatedRecommendations: { ...createEmptyRecommendationModel(), readyCandidates: [{ itemId: 'plan-me' }] } });
    expect(readyWrong.validation.issues).toEqual([expect.objectContaining({ path: 'readyCandidates[0].itemId', reason: 'wrong-lane', id: 'plan-me' })]);
  });

  it('keeps the compatibility helper compiling while delegating to the projection', () => {
    const model = { ...createEmptyRecommendationModel(), activeWork: [{ itemId: 'ship-me' }], readyCandidates: [{ itemId: 'activate-me' }] };
    const result = filterRecommendationsForCurationDraftStatusOverlay(model, draft);
    expect(result.removed.itemIds).toContain('ship-me');
    expect(result.recommendations.activeWork.map((entry) => entry.itemId)).toEqual(['activate-me']);
  });
});
