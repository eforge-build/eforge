import type { EforgeEvent, ReviewIssue } from '../events.js';
import type { BuildStageContext } from './types.js';
import type { ReviewCycleFeedback } from './review-cycle-feedback.js';

export type SamePlanRecoveryBlockerKind = 'review' | 'test';
export type SamePlanRecoverySkipReason =
  | 'not-active-plan'
  | 'manual-gate'
  | 'human-review-gate'
  | 'cross-plan-blocker'
  | 'upstream-or-base-owned'
  | 'low-confidence'
  | 'incomplete-classification'
  | 'unsupported-blocker'
  | 'unsafe-worktree'
  | 'budget-exhausted'
  | 'stale-pass-data';

export interface SamePlanRecoveryClassifierInput {
  planId: string;
  activePlanId: string;
  blockerKind: SamePlanRecoveryBlockerKind;
  issues: ReviewIssue[];
  feedback?: ReviewCycleFeedback;
  confidence: number;
  complete: boolean;
  worktreeSafe: boolean;
  hasFreshBlockingCheck: boolean;
  deterministicActivePlanOwnership: boolean;
}

export type SamePlanRecoveryClassification =
  | { eligible: true; blockerKind: SamePlanRecoveryBlockerKind; issues: ReviewIssue[]; confidence: number }
  | { eligible: false; reason: SamePlanRecoverySkipReason; details: string; confidence?: number };

export interface SamePlanRecoveryAttemptCallbacks {
  runFix: (attempt: number, context: string) => AsyncIterable<EforgeEvent>;
  runBlockingCheck: (attempt: number) => AsyncIterable<EforgeEvent>;
  hasBlockers: () => boolean;
  currentIssues?: () => ReviewIssue[];
  currentFeedback?: () => ReviewCycleFeedback | undefined;
}

export interface SamePlanRecoveryVerdictSummary {
  file: string;
  action: string;
  reason: string;
  hunk?: number;
  issueOutcome?: string;
  issueIds?: string[];
  retryGuidance?: string;
}

export interface SamePlanRecoveryRunOptions {
  ctx: BuildStageContext;
  blockerKind: SamePlanRecoveryBlockerKind;
  issues: ReviewIssue[];
  feedback?: ReviewCycleFeedback;
  finalVerdicts?: SamePlanRecoveryVerdictSummary[];
  changedFiles?: string[];
  diffContext?: string;
  priorRepairAttempts?: string[];
  maxAttempts: number;
  activePlanId: string;
  confidence: number;
  complete: boolean;
  worktreeSafe: boolean;
  hasFreshBlockingCheck: boolean;
  deterministicActivePlanOwnership: boolean;
  callbacks: SamePlanRecoveryAttemptCallbacks;
}

const MIN_CONFIDENCE = 0.8;

export function classifySamePlanRecoveryBlockers(input: SamePlanRecoveryClassifierInput): SamePlanRecoveryClassification {
  const confidence = input.confidence;
  if (input.planId !== input.activePlanId) return { eligible: false, reason: 'not-active-plan', details: 'Blocker does not belong to the active plan.', confidence };
  if (input.complete !== true) return { eligible: false, reason: 'incomplete-classification', details: 'Classifier output was incomplete.', confidence };
  if (confidence === undefined || confidence < MIN_CONFIDENCE) return { eligible: false, reason: 'low-confidence', details: `Classifier confidence ${confidence ?? 'missing'} is below ${MIN_CONFIDENCE}.`, confidence };
  if (input.worktreeSafe !== true) return { eligible: false, reason: 'unsafe-worktree', details: 'Worktree safety preflight refused recovery.', confidence };
  if (input.hasFreshBlockingCheck !== true) return { eligible: false, reason: 'stale-pass-data', details: 'Blocking-check data is stale or missing.', confidence };
  if (hasHumanReviewFeedback(input.feedback)) return { eligible: false, reason: 'human-review-gate', details: 'Evaluator feedback requires human review.', confidence };
  if (input.issues.length === 0) return { eligible: false, reason: 'unsupported-blocker', details: 'No concrete active-plan blockers were supplied.', confidence };

  for (const issue of input.issues) {
    const metadata = issue.metadata ?? {};
    if (issue.repairClass === 'manual' || metadata.recovery === 'manual' || metadata.gate === 'manual') {
      return { eligible: false, reason: 'manual-gate', details: `Issue ${issue.issueId ?? issue.file} requires manual handling.`, confidence };
    }
    if (metadata.needsHumanReview === true || metadata.gate === 'human-review') {
      return { eligible: false, reason: 'human-review-gate', details: `Issue ${issue.issueId ?? issue.file} requires human review.`, confidence };
    }
    if (typeof metadata.planId !== 'string' && input.deterministicActivePlanOwnership !== true) {
      return { eligible: false, reason: 'incomplete-classification', details: `Issue ${issue.issueId ?? issue.file} is missing active-plan ownership evidence.`, confidence };
    }
    if (typeof metadata.planId === 'string' && metadata.planId !== input.planId) {
      return { eligible: false, reason: 'cross-plan-blocker', details: `Issue ${issue.issueId ?? issue.file} belongs to ${metadata.planId}.`, confidence };
    }
    if (metadata.owner === 'upstream' || metadata.owner === 'base' || metadata.baseOwned === true || metadata.upstreamOwned === true) {
      return { eligible: false, reason: 'upstream-or-base-owned', details: `Issue ${issue.issueId ?? issue.file} is upstream/base-owned.`, confidence };
    }
    if (issue.repairClass === 'followup') {
      return { eligible: false, reason: 'unsupported-blocker', details: `Issue ${issue.issueId ?? issue.file} is follow-up scope.`, confidence };
    }
  }

  return { eligible: true, blockerKind: input.blockerKind, issues: input.issues, confidence };
}

export async function* runSamePlanRecovery(options: SamePlanRecoveryRunOptions): AsyncGenerator<EforgeEvent, boolean> {
  const { ctx, blockerKind, maxAttempts, callbacks } = options;
  let issues = options.issues;
  let feedback = options.feedback;
  const classifyCurrent = () => classifySamePlanRecoveryBlockers({
    planId: ctx.planId,
    activePlanId: options.activePlanId,
    blockerKind,
    issues,
    feedback,
    complete: options.complete,
    confidence: options.confidence,
    worktreeSafe: options.worktreeSafe,
    hasFreshBlockingCheck: options.hasFreshBlockingCheck,
    deterministicActivePlanOwnership: options.deterministicActivePlanOwnership,
  });
  const initialClassification = classifyCurrent();

  if (!initialClassification.eligible) {
    yield recoverySkipEvent(ctx.planId, blockerKind, initialClassification.reason, initialClassification.details, maxAttempts);
    return false;
  }
  if (maxAttempts <= 0) {
    yield recoveryExhaustedEvent(ctx.planId, blockerKind, 0, maxAttempts, 'No same-plan recovery attempts remain.');
    return false;
  }

  yield { timestamp: ts(), type: 'plan:build:recovery:start', planId: ctx.planId, blockerKind, issueCount: issues.length, maxAttempts, attemptsRemaining: maxAttempts } as EforgeEvent;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    issues = callbacks.currentIssues?.() ?? issues;
    feedback = callbacks.currentFeedback?.() ?? feedback;
    const attemptClassification = classifyCurrent();
    if (!attemptClassification.eligible) {
      yield recoverySkipEvent(ctx.planId, blockerKind, attemptClassification.reason, attemptClassification.details, maxAttempts - attempt + 1);
      return false;
    }
    const attemptsRemainingBefore = maxAttempts - attempt + 1;
    yield { timestamp: ts(), type: 'plan:build:recovery:attempt:start', planId: ctx.planId, blockerKind, attempt, maxAttempts, attemptsRemaining: attemptsRemainingBefore } as EforgeEvent;
    try {
      for await (const event of callbacks.runFix(attempt, renderSamePlanRecoveryFixerContext({
        planId: ctx.planId,
        blockerKind,
        issues,
        feedback,
        finalVerdicts: options.finalVerdicts,
        changedFiles: options.changedFiles,
        diffContext: options.diffContext,
        priorRepairAttempts: options.priorRepairAttempts,
      }))) {
        yield event;
        if (ctx.buildFailed) {
          yield recoveryAttemptResultEvent(ctx.planId, blockerKind, attempt, maxAttempts, false);
          return false;
        }
      }
      for await (const event of callbacks.runBlockingCheck(attempt)) {
        yield event;
        if (ctx.buildFailed) {
          yield recoveryAttemptResultEvent(ctx.planId, blockerKind, attempt, maxAttempts, false);
          return false;
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') throw err;
      yield recoveryAttemptResultEvent(ctx.planId, blockerKind, attempt, maxAttempts, false);
      return false;
    }
    issues = callbacks.currentIssues?.() ?? issues;
    feedback = callbacks.currentFeedback?.() ?? feedback;
    const blockersRemaining = callbacks.hasBlockers();
    yield recoveryAttemptResultEvent(ctx.planId, blockerKind, attempt, maxAttempts, !blockersRemaining);
    if (!blockersRemaining) return true;
  }

  yield recoveryExhaustedEvent(ctx.planId, blockerKind, maxAttempts, maxAttempts, 'Same-plan recovery budget exhausted with blockers still present.');
  return false;
}

export function renderSamePlanRecoveryFixerContext(input: {
  planId: string;
  blockerKind: SamePlanRecoveryBlockerKind;
  issues: ReviewIssue[];
  feedback?: ReviewCycleFeedback;
  finalVerdicts?: SamePlanRecoveryVerdictSummary[];
  changedFiles?: string[];
  diffContext?: string;
  priorRepairAttempts?: string[];
}): string {
  const sortedIssues = [...input.issues].sort((a, b) => (a.issueId ?? `${a.file}:${a.line ?? 0}:${a.description}`).localeCompare(b.issueId ?? `${b.file}:${b.line ?? 0}:${b.description}`));
  const lines = [
    '# Same-plan Recovery Context',
    '',
    `Active plan: ${input.planId}`,
    `Blocker kind: ${input.blockerKind}`,
    '',
    'Only fix blockers owned by this active plan. Do not address manual, human-review, cross-plan, upstream, or base-owned concerns.',
    '',
    '## Active blockers',
    '',
    ...formatIssueGroup(sortedIssues, 'No active blockers were supplied.'),
  ];
  const rejected = input.feedback?.blockingRetryGuidance.filter(item => item.action === 'reject') ?? [];
  const unresolved = input.feedback?.blockingRetryGuidance.filter(item => item.action !== 'reject') ?? [];
  lines.push('', '## Rejected verifier issues', '', ...formatFeedbackGroup(rejected, 'No rejected verifier issues.'));
  lines.push('', '## Unresolved verifier issues', '', ...formatFeedbackGroup(unresolved, 'No unresolved verifier issues.'));
  lines.push('', '## Final verifier/test verdicts', '', ...formatVerdictGroup(input.finalVerdicts ?? [], 'No final verifier/test verdicts were captured.'));
  lines.push('', '## Changed files', '', ...formatChangedFiles(input.changedFiles ?? []));
  lines.push('', '## Diff context', '', ...formatDiffContext(input.diffContext));
  lines.push('', '## Prior repair attempts', '', ...formatPriorRepairAttempts(input.priorRepairAttempts ?? []));
  return lines.join('\n');
}

function recoverySkipEvent(planId: string, blockerKind: SamePlanRecoveryBlockerKind, reason: SamePlanRecoverySkipReason, details: string, maxAttempts: number): EforgeEvent {
  return { timestamp: ts(), type: 'plan:build:recovery:skip', planId, blockerKind, reason, details, attemptsRemaining: Math.max(0, maxAttempts) } as EforgeEvent;
}

function recoveryExhaustedEvent(planId: string, blockerKind: SamePlanRecoveryBlockerKind, attemptsUsed: number, maxAttempts: number, details: string): EforgeEvent {
  return { timestamp: ts(), type: 'plan:build:recovery:exhausted', planId, blockerKind, attemptsUsed, maxAttempts, details } as EforgeEvent;
}

function recoveryAttemptResultEvent(planId: string, blockerKind: SamePlanRecoveryBlockerKind, attempt: number, maxAttempts: number, blockersCleared: boolean): EforgeEvent {
  return { timestamp: ts(), type: 'plan:build:recovery:attempt:result', planId, blockerKind, attempt, maxAttempts, blockersCleared, attemptsRemaining: maxAttempts - attempt } as EforgeEvent;
}

function hasHumanReviewFeedback(feedback: ReviewCycleFeedback | undefined): boolean {
  return feedback?.blockingRetryGuidance.some(item => item.issueOutcome === 'needs_human_review') ?? false;
}

function formatIssueGroup(issues: ReviewIssue[], empty: string): string[] {
  if (issues.length === 0) return [`- ${empty}`];
  return issues.map(issue => `- ${issue.issueId ?? '(no-id)'} — ${issue.file}${issue.line ? `:${issue.line}` : ''} — ${issue.category}: ${issue.description}${issue.fix ? ` Fix: ${issue.fix}` : ''}`);
}

function formatFeedbackGroup(items: NonNullable<ReviewCycleFeedback['blockingRetryGuidance']>, empty: string): string[] {
  if (items.length === 0) return [`- ${empty}`];
  return [...items]
    .sort((a, b) => `${a.file}:${a.hunk ?? 0}:${a.reason}`.localeCompare(`${b.file}:${b.hunk ?? 0}:${b.reason}`))
    .map(item => {
      const ids = item.issueIds && item.issueIds.length > 0 ? item.issueIds.join(', ') : '(no issue ids)';
      const location = item.hunk !== undefined ? `${item.file} hunk ${item.hunk}` : item.file;
      const outcome = item.issueOutcome ?? (item.action === 'accept' ? 'resolved' : 'unresolved');
      return `- ${ids} — ${location} — ${outcome}: ${item.reason}${item.retryGuidance ? ` Retry guidance: ${item.retryGuidance}` : ''}`;
    });
}

function formatVerdictGroup(verdicts: SamePlanRecoveryVerdictSummary[], empty: string): string[] {
  if (verdicts.length === 0) return [`- ${empty}`];
  return [...verdicts]
    .sort((a, b) => `${a.file}:${a.hunk ?? 0}:${a.reason}`.localeCompare(`${b.file}:${b.hunk ?? 0}:${b.reason}`))
    .map(verdict => {
      const ids = verdict.issueIds && verdict.issueIds.length > 0 ? ` Issue IDs: ${verdict.issueIds.join(', ')}.` : '';
      const location = verdict.hunk !== undefined ? `${verdict.file} hunk ${verdict.hunk}` : verdict.file;
      const outcome = verdict.issueOutcome ?? (verdict.action === 'accept' ? 'resolved' : 'unresolved');
      return `- ${location} — action=${verdict.action}, issueOutcome=${outcome}.${ids} Reason: ${verdict.reason}${verdict.retryGuidance ? ` Retry guidance: ${verdict.retryGuidance}` : ''}`;
    });
}

function formatChangedFiles(files: string[]): string[] {
  if (files.length === 0) return ['- No changed files were captured.'];
  return [...files].sort((a, b) => a.localeCompare(b)).map(file => `- ${file}`);
}

function formatDiffContext(diffContext: string | undefined): string[] {
  const trimmed = diffContext?.trim();
  if (!trimmed) return ['No diff context was captured.'];
  return ['```diff', trimmed, '```'];
}

function formatPriorRepairAttempts(attempts: string[]): string[] {
  if (attempts.length === 0) return ['- No prior repair attempts were captured.'];
  return attempts.map((attempt, index) => `- Attempt ${index + 1}: ${attempt}`);
}

function ts(): string {
  return new Date().toISOString();
}
