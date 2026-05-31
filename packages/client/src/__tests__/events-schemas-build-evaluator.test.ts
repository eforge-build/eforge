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
