import { describe, expect, it } from 'vitest';
import { buildRecommendationIndex } from '../recommendation-index.js';
import type { BacklogRecommendationModel } from '../schema.js';

const model: BacklogRecommendationModel = {
  schemaVersion: 1,
  activeWork: [],
  readyCandidates: [],
  recommendedNextSequence: [
    { itemId: 'alpha', rationale: 'first' },
    { itemId: 'beta', rationale: 'second' },
    { itemId: 'alpha', rationale: 'duplicate ignored' },
  ],
  safeParallelizableGroups: [
    { ref: 'group-1', title: 'Foundations', itemIds: ['alpha', 'gamma'] },
    { ref: 'group-2', itemIds: ['gamma'] },
  ],
  blockedChains: [
    { ref: 'chain-1', itemIds: ['delta'], blockedBy: ['alpha'], rationale: 'Ship alpha first.' },
    { itemIds: ['epsilon'], blockedBy: ['beta'] },
  ],
  rationaleAndAssumptions: [],
};

describe('buildRecommendationIndex', () => {
  it('ranks the recommended sequence by position, keeping the first occurrence', () => {
    const index = buildRecommendationIndex(model);
    expect(index.rankById.get('alpha')).toBe(1);
    expect(index.rankById.get('beta')).toBe(2);
  });

  it('collects parallel lanes by group title or ref', () => {
    const index = buildRecommendationIndex(model);
    expect(index.lanesById.get('alpha')).toEqual(['Foundations']);
    expect(index.lanesById.get('gamma')).toEqual(['Foundations', 'group-2']);
  });

  it('maps unblock notes from blocked chains and ignores chains without a rationale', () => {
    const index = buildRecommendationIndex(model);
    expect(index.unblockById.get('delta')).toBe('Ship alpha first.');
    expect(index.unblockById.has('epsilon')).toBe(false);
  });

  it('returns empty maps for a null model', () => {
    const index = buildRecommendationIndex(null);
    expect(index.rankById.size).toBe(0);
    expect(index.lanesById.size).toBe(0);
    expect(index.unblockById.size).toBe(0);
  });
});
