import type { EvaluationVerdict } from '../schemas.js';

export type EvaluationIssueOutcome = NonNullable<EvaluationVerdict['issueOutcome']>;

export interface EvaluationIssueOutcomeCounts {
  resolvedIssueOutcomes: number;
  falsePositiveIssueOutcomes: number;
  unresolvedIssueOutcomes: number;
  unresolvedNonBlockingIssueOutcomes: number;
  needsHumanReviewIssueOutcomes: number;
  acceptedRiskIssueOutcomes: number;
  splitToFollowupIssueOutcomes: number;
  blockingIssueOutcomes: number;
}

export function normalizeEvaluationIssueOutcome(verdict: Pick<EvaluationVerdict, 'action' | 'issueOutcome'>): EvaluationIssueOutcome {
  if (verdict.issueOutcome) return verdict.issueOutcome;
  return verdict.action === 'accept' ? 'resolved' : 'unresolved';
}

export function isBlockingEvaluationIssueOutcome(outcome: EvaluationIssueOutcome): boolean {
  return outcome === 'unresolved' || outcome === 'unresolved_blocking' || outcome === 'needs_human_review';
}

export function countEvaluationIssueOutcomes(verdicts: readonly EvaluationVerdict[]): EvaluationIssueOutcomeCounts {
  const counts: EvaluationIssueOutcomeCounts = {
    resolvedIssueOutcomes: 0,
    falsePositiveIssueOutcomes: 0,
    unresolvedIssueOutcomes: 0,
    unresolvedNonBlockingIssueOutcomes: 0,
    needsHumanReviewIssueOutcomes: 0,
    acceptedRiskIssueOutcomes: 0,
    splitToFollowupIssueOutcomes: 0,
    blockingIssueOutcomes: 0,
  };

  for (const verdict of verdicts) {
    const outcome = normalizeEvaluationIssueOutcome(verdict);
    if (outcome === 'resolved') counts.resolvedIssueOutcomes += 1;
    if (outcome === 'false_positive') counts.falsePositiveIssueOutcomes += 1;
    if (outcome === 'unresolved' || outcome === 'unresolved_blocking') counts.unresolvedIssueOutcomes += 1;
    if (outcome === 'unresolved_nonblocking') counts.unresolvedNonBlockingIssueOutcomes += 1;
    if (outcome === 'needs_human_review') counts.needsHumanReviewIssueOutcomes += 1;
    if (outcome === 'accepted_risk') counts.acceptedRiskIssueOutcomes += 1;
    if (outcome === 'split_to_followup') counts.splitToFollowupIssueOutcomes += 1;
    if (isBlockingEvaluationIssueOutcome(outcome)) counts.blockingIssueOutcomes += 1;
  }

  return counts;
}
