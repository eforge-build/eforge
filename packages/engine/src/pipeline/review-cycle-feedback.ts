import type { EvaluationVerdict } from '../schemas.js';
import type { BuildStageContext } from './types.js';

export type ReviewCycleFeedbackItem = Pick<EvaluationVerdict, 'file' | 'action' | 'reason' | 'hunk' | 'issueOutcome' | 'retryGuidance' | 'issueIds'>;

export interface ReviewCycleFeedback {
  blockingRetryGuidance: ReviewCycleFeedbackItem[];
  falsePositiveIssues: ReviewCycleFeedbackItem[];
  nonBlockingIssues: ReviewCycleFeedbackItem[];
  acceptedRiskIssues: ReviewCycleFeedbackItem[];
  splitToFollowupIssues: ReviewCycleFeedbackItem[];
}

type BuildStageContextWithReviewCycleFeedback = BuildStageContext & {
  __reviewCycleFeedback?: ReviewCycleFeedback;
};

export function buildReviewCycleFeedback(verdicts: EvaluationVerdict[]): ReviewCycleFeedback {
  const feedback: ReviewCycleFeedback = {
    blockingRetryGuidance: [],
    falsePositiveIssues: [],
    nonBlockingIssues: [],
    acceptedRiskIssues: [],
    splitToFollowupIssues: [],
  };

  for (const verdict of verdicts) {
    const outcome = verdict.issueOutcome ?? (verdict.action === 'accept' ? 'resolved' : 'unresolved');
    const item = feedbackItem(verdict);
    if (outcome === 'unresolved' || outcome === 'unresolved_blocking' || outcome === 'needs_human_review') {
      feedback.blockingRetryGuidance.push(item);
    } else if (outcome === 'false_positive') {
      feedback.falsePositiveIssues.push(item);
    } else if (outcome === 'unresolved_nonblocking') {
      feedback.nonBlockingIssues.push(item);
    } else if (outcome === 'accepted_risk') {
      feedback.acceptedRiskIssues.push(item);
    } else if (outcome === 'split_to_followup') {
      feedback.splitToFollowupIssues.push(item);
    }
  }

  return feedback;
}

export function setReviewCycleFeedback(ctx: BuildStageContext, feedback: ReviewCycleFeedback | undefined): void {
  (ctx as BuildStageContextWithReviewCycleFeedback).__reviewCycleFeedback = hasReviewCycleFeedback(feedback) ? feedback : undefined;
}

export function getReviewCycleFeedback(ctx: BuildStageContext): ReviewCycleFeedback | undefined {
  return (ctx as BuildStageContextWithReviewCycleFeedback).__reviewCycleFeedback;
}

export function renderReviewFixerEvaluatorFeedback(feedback: ReviewCycleFeedback | undefined): string {
  if (!hasReviewCycleFeedback(feedback)) return '';
  const lines: string[] = [
    '# Previous Evaluator Feedback',
    '',
    'A previous review-fixer attempt was evaluated. Use this memory to avoid repeating rejected broad fixes and to retry only the still-blocking issues narrowly.',
  ];
  if (feedback.blockingRetryGuidance.length > 0) {
    const rejected = feedback.blockingRetryGuidance.filter(item => item.action === 'reject');
    const unresolved = feedback.blockingRetryGuidance.filter(item => item.action !== 'reject');
    lines.push('', '## Rejected verifier issues', '');
    lines.push(...formatFeedbackGroup(rejected, 'No rejected verifier issues.'));
    lines.push('', '## Unresolved verifier issues', '');
    lines.push(...formatFeedbackGroup(unresolved, 'No unresolved verifier issues.'));
  }
  const nonBlocking = nonBlockingFeedbackItems(feedback);
  if (nonBlocking.length > 0) {
    lines.push('', '## Issues the evaluator classified as non-blocking for this build', '', 'Do not implement fixes for these unless the current reviewer issue includes materially new evidence.');
    lines.push(...nonBlocking.map(formatFeedbackLine));
  }
  return lines.join('\n');
}

export function renderReviewerPriorOutcomeContext(feedback: ReviewCycleFeedback | undefined): string {
  if (!hasReviewCycleFeedback(feedback)) return '';
  const nonBlocking = nonBlockingFeedbackItems(feedback);
  if (nonBlocking.length === 0) return '';
  return [
    '## Prior Evaluator Issue Outcomes',
    '',
    'Previous evaluator rounds classified the following concerns as false-positive, accepted-risk, nonblocking, or follow-up scope. Do not re-raise them unless you find new concrete evidence in the current code.',
    '',
    ...nonBlocking.map(formatFeedbackLine),
  ].join('\n');
}

export function summarizeEvaluationVerdicts(verdicts: EvaluationVerdict[]) {
  return verdicts.map(v => ({
    file: v.file,
    action: v.action,
    reason: v.reason,
    ...(v.hunk !== undefined && { hunk: v.hunk }),
    ...(v.issueOutcome !== undefined && { issueOutcome: v.issueOutcome }),
    ...(v.issueIds !== undefined && { issueIds: v.issueIds }),
    ...(v.retryGuidance !== undefined && { retryGuidance: v.retryGuidance }),
  }));
}

export function appendPromptSection(existing: string | undefined, section: string): string | undefined {
  if (section.trim().length === 0) return existing;
  return existing && existing.trim().length > 0 ? `${existing}\n\n${section}` : section;
}

function feedbackItem(verdict: EvaluationVerdict): ReviewCycleFeedbackItem {
  return {
    file: verdict.file,
    action: verdict.action,
    reason: verdict.reason,
    ...(verdict.hunk !== undefined && { hunk: verdict.hunk }),
    ...(verdict.issueOutcome !== undefined && { issueOutcome: verdict.issueOutcome }),
    ...(verdict.issueIds !== undefined && { issueIds: verdict.issueIds }),
    ...(verdict.retryGuidance !== undefined && { retryGuidance: verdict.retryGuidance }),
  };
}

function hasReviewCycleFeedback(feedback: ReviewCycleFeedback | undefined): feedback is ReviewCycleFeedback {
  return feedback !== undefined && (
    feedback.blockingRetryGuidance.length > 0 ||
    feedback.falsePositiveIssues.length > 0 ||
    feedback.nonBlockingIssues.length > 0 ||
    feedback.acceptedRiskIssues.length > 0 ||
    feedback.splitToFollowupIssues.length > 0
  );
}

function nonBlockingFeedbackItems(feedback: ReviewCycleFeedback): ReviewCycleFeedbackItem[] {
  return [
    ...feedback.falsePositiveIssues,
    ...feedback.nonBlockingIssues,
    ...feedback.acceptedRiskIssues,
    ...feedback.splitToFollowupIssues,
  ];
}

function formatFeedbackLocation(item: ReviewCycleFeedbackItem): string {
  return item.hunk !== undefined ? `${item.file} hunk ${item.hunk}` : item.file;
}

function formatFeedbackLine(item: ReviewCycleFeedbackItem): string {
  const outcome = item.issueOutcome ?? (item.action === 'accept' ? 'resolved' : 'unresolved');
  const guidance = item.retryGuidance ? ` Retry guidance: ${item.retryGuidance}` : '';
  const issueIds = item.issueIds && item.issueIds.length > 0 ? ` Issue IDs: ${item.issueIds.join(', ')}.` : '';
  return `- ${formatFeedbackLocation(item)} — action=${item.action}, issueOutcome=${outcome}.${issueIds} Reason: ${item.reason}${guidance}`;
}

function formatFeedbackGroup(items: ReviewCycleFeedbackItem[], empty: string): string[] {
  if (items.length === 0) return [`- ${empty}`];
  return [...items]
    .sort((a, b) => `${a.file}:${a.hunk ?? 0}:${a.reason}`.localeCompare(`${b.file}:${b.hunk ?? 0}:${b.reason}`))
    .map(formatFeedbackLine);
}
