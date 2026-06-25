import { describe, expect, it } from 'vitest';
import { safeParseEforgeEvent, type EforgeEvent } from '../events.schemas.js';

describe('safeParseEforgeEvent — build evaluator enriched payloads', () => {
  it('accepts plan:build:evaluate:complete verdict summaries with hunk metadata', () => {
    const event: EforgeEvent = {
      type: 'plan:build:evaluate:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      planId: 'plan-01',
      accepted: 1,
      rejected: 1,
      round: 0,
      resolvedIssueOutcomes: 1,
      falsePositiveIssueOutcomes: 1,
      blockingIssueOutcomes: 0,
      verdicts: [
        { file: 'src/foo.ts', hunk: 1, action: 'accept', issueOutcome: 'resolved', reason: 'Correct fix' },
        { file: 'src/foo.ts', hunk: 2, action: 'reject', issueOutcome: 'false_positive', retryGuidance: 'Do not retry without new evidence', reason: 'Alters intent' },
      ],
    };

    expect(safeParseEforgeEvent(event).success).toBe(true);
  });

  it('accepts legacy evaluate-complete events without issueIds', () => {
    const result = safeParseEforgeEvent({
      type: 'plan:build:evaluate:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      planId: 'plan-01',
      accepted: 1,
      rejected: 0,
      verdicts: [{ file: 'src/foo.ts', action: 'accept', reason: 'Legacy verdict' }],
    });

    expect(result.success).toBe(true);
  });

  it('accepts evaluator verdicts with multiple issueIds', () => {
    const result = safeParseEforgeEvent({
      type: 'plan:build:evaluate:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      planId: 'plan-01',
      accepted: 1,
      rejected: 0,
      verdicts: [{
        file: 'src/foo.ts',
        hunk: 1,
        action: 'accept',
        reason: 'Both issues were addressed by the same hunk',
        issueIds: ['review-issue-1', 'review-issue-2'],
      }],
    });

    expect(result.success).toBe(true);
  });

  it('accepts evaluator verdict issueIds without requiring matching reviewer issues', () => {
    const result = safeParseEforgeEvent({
      type: 'plan:build:evaluate:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      planId: 'plan-01',
      accepted: 0,
      rejected: 1,
      verdicts: [{
        file: 'src/foo.ts',
        action: 'reject',
        reason: 'Unknown ID is still valid wire metadata',
        issueIds: ['unknown-review-issue'],
      }],
    });

    expect(result.success).toBe(true);
  });

  it('accepts review-failure evaluation verdicts with issueIds', () => {
    const result = safeParseEforgeEvent({
      type: 'recovery:summary',
      timestamp: '2025-01-01T00:00:00.000Z',
      prdId: 'prd-1',
      summary: {
        prdId: 'prd-1',
        setName: 'set-1',
        featureBranch: 'eforge/set-1',
        baseBranch: 'main',
        plans: [],
        failingPlan: { planId: 'plan-01' },
        landedCommits: [],
        diffStat: '',
        modelsUsed: [],
        failedAt: '2025-01-01T00:00:00.000Z',
        reviewFailure: {
          planId: 'plan-01',
          issues: [],
          evaluation: {
            accepted: 1,
            rejected: 0,
            review: 0,
            verdicts: [{ file: 'src/foo.ts', action: 'accept', reason: 'Resolved', issueIds: ['review-issue-1'] }],
          },
        },
      },
    });

    expect(result.success).toBe(true);
  });

  it('accepts enriched cycle-terminated build decisions', () => {
    const event: EforgeEvent = {
      type: 'plan:build:decision',
      timestamp: '2025-01-01T00:00:00.000Z',
      planId: 'plan-01',
      decision: {
        kind: 'cycle-terminated',
        rationale: 'Review cycle exhausted; final evaluation ran',
        round: 1,
        reason: 'max-rounds',
        issuesRemaining: 0,
        lastReviewIssueCount: 2,
        finalEvaluationRan: true,
        finalEvaluationAccepted: 1,
        finalEvaluationRejected: 1,
        finalEvaluationFalsePositive: 1,
        finalEvaluationBlocking: 0,
      },
    };

    expect(safeParseEforgeEvent(event).success).toBe(true);
  });
});
