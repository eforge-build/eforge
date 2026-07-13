import type { ReviewIssue } from '../../events.js';
import type { ReviewCycleFeedback } from '../review-cycle-feedback.js';

/**
 * Selector for the still-active recovery scope. Evaluate passes clear
 * ctx.reviewIssues and refresh evaluator feedback, so each recovery attempt
 * re-derives its scope from the latest verdicts via the feedback getter,
 * falling back to the full base set when guidance is incomplete.
 */
export function makeActiveRecoveryIssueSelector(baseIssues: ReviewIssue[], getFeedback: () => ReviewCycleFeedback | undefined): () => ReviewIssue[] {
  return () => {
    const selection = selectActiveRecoveryIssues(baseIssues, getFeedback());
    return selection.complete ? selection.issues : baseIssues;
  };
}

export function selectActiveRecoveryIssues(suppliedIssues: ReviewIssue[], feedback?: ReviewCycleFeedback) {
  const guidance = feedback?.blockingRetryGuidance ?? [];
  if (guidance.length === 0) return { complete: false, issues: [] as ReviewIssue[] };
  const issueIds = new Set<string>();
  for (const item of guidance) {
    if (!item.issueIds || item.issueIds.length === 0) return { complete: false, issues: [] as ReviewIssue[] };
    for (const issueId of item.issueIds) issueIds.add(issueId);
  }
  const suppliedById = new Map(suppliedIssues.flatMap(issue => issue.issueId ? [[issue.issueId, issue] as const] : []));
  const issues: ReviewIssue[] = [];
  for (const issueId of issueIds) {
    const issue = suppliedById.get(issueId);
    if (!issue) return { complete: false, issues: [] as ReviewIssue[] };
    issues.push(issue);
  }
  return { complete: true, issues };
}
