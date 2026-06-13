import { describe, expect, it } from 'vitest';
import { mockBacklogCurationDraft, mockRecommendations } from '@/fixtures/mock-data';
import { curationEvidencePreview, displayRecommendationsForDraft, recommendationSummaryCounts } from './backlog-curation-view-model';

describe('backlog curation view model', () => {
  it('extracts shipped evidence labels, PR identifiers, and commit identifiers', () => {
    const preview = curationEvidencePreview([
      'Shipped evidence: lifecycle trace — merge commit 1234567890abcdef.',
      'Shipped evidence: inferred from git/PR history — commit abcdef1234567890 via PR #191 and https://host/repo/pull/192.',
      'Ambiguous shipped candidate: needs input — #193 needs review.',
      'Shipped evidence: inferred from git/PR history — git deadbee / PR #194: land formatCitation-style evidence.',
    ]);

    expect(preview.labels).toEqual([
      'Shipped evidence: lifecycle trace',
      'Shipped evidence: inferred from git/PR history',
      'Ambiguous shipped candidate: needs input',
    ]);
    expect(preview.prIds).toEqual(['#191', '#192', '#193', '#194']);
    expect(preview.commitIds).toEqual(['1234567890abcdef', 'abcdef1234567890', 'deadbee']);
  });

  it('filters generated recommendation targets proposed shipped in the same draft', () => {
    const display = displayRecommendationsForDraft(mockBacklogCurationDraft, mockRecommendations);

    expect(display?.removedTargetItemIds).toEqual(['add-import-preview', 'recommend-next-work']);
    expect(display?.readyCandidates?.map((entry) => entry.itemId)).toEqual(['traceability']);
    expect(display?.recommendedNextSequence.map((entry) => entry.itemId)).toEqual([]);
    expect(display?.safeParallelizableGroups).toEqual([]);
    expect(recommendationSummaryCounts(display)).toMatchObject({ readyCandidates: 1, nextSequence: 0, safeParallelGroups: 0 });
  });
});
