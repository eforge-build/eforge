import { describe, expect, it } from 'vitest';
import { filterRecommendationsForCurationDraftStatusOverlay } from '../backlog-curation-recommendation-overlay.js';
import { createEmptyRecommendationModel } from '../recommendations-store.js';

const draft = {
  itemChanges: [
    { kind: 'item', id: 'ship-me', metadata: { status: 'shipped' } },
    { kind: 'item', id: 'stale-me', metadata: { status: 'stale' } },
    { kind: 'item', id: 'keep-me', metadata: { status: 'planned' } },
  ],
  epicChanges: [{ kind: 'epic', id: 'closed-epic', metadata: { status: 'superseded' } }],
};

describe('backlog curation recommendation overlay', () => {
  it('filters proposed closed item ids from active, ready, and recommended-next targets without mutating input', () => {
    const model = {
      ...createEmptyRecommendationModel(),
      activeWork: [{ itemId: 'ship-me', rationale: 'Active.' }, { itemId: 'keep-me', rationale: 'Keep.' }],
      readyCandidates: [{ itemId: 'ship-me', rationale: 'Ready.' }, { itemId: 'keep-me', rationale: 'Ready.' }],
      recommendedNextSequence: [{ itemId: 'ship-me', rationale: 'Next.' }, { itemId: 'keep-me', rationale: 'Next.' }],
      rationaleAndAssumptions: ['Original rationale.'],
    };

    const result = filterRecommendationsForCurationDraftStatusOverlay(model, draft).recommendations;

    expect(result.activeWork.map((entry) => entry.itemId)).toEqual(['keep-me']);
    expect(result.readyCandidates.map((entry) => entry.itemId)).toEqual(['keep-me']);
    expect(result.recommendedNextSequence.map((entry) => entry.itemId)).toEqual(['keep-me']);
    expect(result.rationaleAndAssumptions).toEqual(['Original rationale.', expect.stringContaining('Filtered recommendation targets')]);
    expect(model.readyCandidates.map((entry) => entry.itemId)).toEqual(['ship-me', 'keep-me']);
  });

  it('filters safe-parallel item and epic ids and drops groups whose item ids become empty', () => {
    const model = {
      ...createEmptyRecommendationModel(),
      safeParallelizableGroups: [
        { ref: 'mixed', itemIds: ['ship-me', 'keep-me'], epicIds: ['closed-epic', 'open-epic'], rationale: 'Together.' },
        { ref: 'empty-after-filter', itemIds: ['stale-me'], epicIds: ['open-epic'], rationale: 'Drop.' },
      ],
    };

    const originalGroups = structuredClone(model.safeParallelizableGroups);
    const result = filterRecommendationsForCurationDraftStatusOverlay(model, draft).recommendations;

    expect(result.safeParallelizableGroups).toEqual([{ ref: 'mixed', itemIds: ['keep-me'], epicIds: ['open-epic'], rationale: 'Together.' }]);
    expect(model.safeParallelizableGroups).toEqual(originalGroups);
  });

  it('filters blocked-chain item and blocker ids and drops chains whose item ids become empty', () => {
    const model = {
      ...createEmptyRecommendationModel(),
      blockedChains: [
        { ref: 'mixed-chain', itemIds: ['ship-me', 'keep-me'], blockedBy: ['stale-me', 'open-blocker'], rationale: 'Blocked.' },
        { ref: 'empty-chain', itemIds: ['ship-me'], blockedBy: ['open-blocker'], rationale: 'Drop.' },
      ],
    };

    const originalChains = structuredClone(model.blockedChains);
    const result = filterRecommendationsForCurationDraftStatusOverlay(model, draft).recommendations;

    expect(result.blockedChains).toEqual([{ ref: 'mixed-chain', itemIds: ['keep-me'], blockedBy: ['open-blocker'], rationale: 'Blocked.' }]);
    expect(model.blockedChains).toEqual(originalChains);
  });
});
