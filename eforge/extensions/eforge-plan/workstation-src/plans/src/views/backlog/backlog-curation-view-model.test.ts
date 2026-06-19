import { describe, expect, it } from 'vitest';
import { mockBacklogCurationDraft, mockBacklogCurationPreview, mockFullAuditBacklogCurationPreview } from '@/fixtures/mock-data';
import { curationEvidencePreview, curationScanModeLabel, effectiveRecommendationsFromProjection, formatFullAuditCaps, formatFullAuditCoverage, matchFullAuditEvidenceForPatch, projectionMetadataDisplay, recommendationSummaryCounts } from './backlog-curation-view-model';

describe('backlog curation view model', () => {
  it('extracts shipped evidence labels, PR identifiers, and commit identifiers', () => {
    const preview = curationEvidencePreview([
      'Shipped evidence: lifecycle trace — merge commit 1234567890abcdef.',
      'Shipped evidence: inferred from git/PR history — commit abcdef1234567890 via PR #191 and https://host/repo/pull/192.',
      'Ambiguous shipped candidate: needs input — #193 needs review.',
      'Superseded evidence: lifecycle trace — replaced by a newer plan.',
      'Superseded evidence: inferred from git/PR history — PR #195 landed a replacement.',
      'Ambiguous superseded candidate: needs input — replacement needs review.',
      'Shipped evidence: inferred from git/PR history — git deadbee / PR #194: land formatCitation-style evidence.',
    ]);

    expect(preview.labels).toEqual([
      'Shipped evidence: lifecycle trace',
      'Shipped evidence: inferred from git/PR history',
      'Superseded evidence: lifecycle trace',
      'Superseded evidence: inferred from git/PR history',
      'Ambiguous shipped candidate: needs input',
      'Ambiguous superseded candidate: needs input',
    ]);
    expect(preview.prIds).toEqual(['#191', '#192', '#193', '#195', '#194']);
    expect(preview.commitIds).toEqual(['1234567890abcdef', 'abcdef1234567890', 'deadbee']);
  });

  it('reads effective recommendation counts and metadata from server projection', () => {
    const projection = mockBacklogCurationPreview.recommendationProjection;
    const display = effectiveRecommendationsFromProjection(projection);
    const metadata = projectionMetadataDisplay(projection);

    expect(mockBacklogCurationDraft.itemChanges.length).toBeGreaterThan(0);
    expect(metadata.removedItemIds).toEqual(['add-import-preview']);
    expect(metadata.removedEpicIds).toEqual(['planning']);
    expect(metadata.repositioned).toEqual(['recommend-next-work: readyCandidates → recommendedNextSequence']);
    expect(display?.readyCandidates?.map((entry) => entry.itemId)).toEqual(['traceability']);
    expect(display?.recommendedNextSequence.map((entry) => entry.itemId)).toEqual(['recommend-next-work']);
    expect(recommendationSummaryCounts(display)).toMatchObject({ readyCandidates: 1, nextSequence: 1, safeParallelGroups: 1 });
  });

  it('formats scan modes and full-audit metadata from server preview details', () => {
    expect(curationScanModeLabel(undefined)).toBe('Delta curation');
    expect(curationScanModeLabel('full-implementation-audit')).toBe('Full implementation audit');
    expect(formatFullAuditCoverage(mockFullAuditBacklogCurationPreview.fullImplementationAudit)).toContainEqual({ label: 'Audited items', value: '6' });
    expect(formatFullAuditCaps(mockFullAuditBacklogCurationPreview.fullImplementationAudit)).toContainEqual({ label: 'File scan cap', value: '250' });
  });

  it('matches full-audit evidence summaries to proposed item evidence only from preview metadata', () => {
    const patch = mockBacklogCurationDraft.itemChanges.find((entry) => entry.id === 'recommend-next-work');
    expect(patch).toBeTruthy();

    const evidence = matchFullAuditEvidenceForPatch(mockFullAuditBacklogCurationPreview.fullImplementationAudit, patch!);

    expect(evidence).toEqual([expect.objectContaining({ source: 'combined', confidence: 'strong', path: 'src/recommendations.ts' })]);
  });
});
