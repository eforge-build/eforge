import { describe, expect, it } from 'vitest';
import type { ReviewIssue } from '@eforge-build/engine/events';
import { assignReviewIssueIds, normalizeReviewIssueId } from '@eforge-build/engine/review-issue-traceability';

describe('review issue traceability helpers', () => {
  it('normalizes blank issue IDs to undefined', () => {
    expect(normalizeReviewIssueId(' custom-1 ')).toBe('custom-1');
    expect(normalizeReviewIssueId('   ')).toBeUndefined();
    expect(normalizeReviewIssueId(undefined)).toBeUndefined();
  });

  it('preserves unique supplied IDs and replaces duplicates with deterministic generated IDs', () => {
    const issues: ReviewIssue[] = [
      { issueId: 'custom-1', severity: 'warning', category: 'bugs', file: 'a.ts', description: 'A' },
      { issueId: 'custom-1', severity: 'warning', category: 'bugs', file: 'b.ts', description: 'B' },
      { severity: 'warning', category: 'bugs', file: 'c.ts', description: 'C' },
    ];

    expect(assignReviewIssueIds(issues, { round: 4, lane: 'code' }).map((issue) => issue.issueId)).toEqual([
      'custom-1',
      'review-r4-code-2',
      'review-r4-code-3',
    ]);
  });

  it('suffixes generated collisions while treating missing rounds as round zero', () => {
    const issues: ReviewIssue[] = [
      { issueId: 'review-r0-aggregate-2', severity: 'warning', category: 'bugs', file: 'a.ts', description: 'A' },
      { issueId: 'review-r0-aggregate-2', severity: 'warning', category: 'bugs', file: 'b.ts', description: 'B' },
    ];

    expect(assignReviewIssueIds(issues, { lane: 'aggregate' }).map((issue) => issue.issueId)).toEqual([
      'review-r0-aggregate-2',
      'review-r0-aggregate-2-2',
    ]);
  });

  it('reserves later unique supplied IDs before generating earlier IDs', () => {
    const issues: ReviewIssue[] = [
      { severity: 'warning', category: 'bugs', file: 'a.ts', description: 'A' },
      { issueId: 'review-r0-code-1', severity: 'warning', category: 'bugs', file: 'b.ts', description: 'B' },
    ];

    expect(assignReviewIssueIds(issues, { lane: 'code' }).map((issue) => issue.issueId)).toEqual([
      'review-r0-code-1-2',
      'review-r0-code-1',
    ]);
  });
});
