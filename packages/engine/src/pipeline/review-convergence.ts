import { emitBuildDecision, type BuildDecisionEvent } from '../decisions.js';
import type { BuildStageContext } from './types.js';

export type RecoveryBudget =
  | { extended: false; maxAttempts: number }
  | { extended: true; maxAttempts: number; previousBlockingIssueOutcomes: number; lastBlockingIssueOutcomes: number };

/**
 * Convergence check for the review cycle's same-plan recovery budget: the
 * blocking-outcome count must have dropped by half or more between the last
 * two evaluated rounds while blockers remain, and there must be a base budget
 * to extend. Entries are per-round blocking counts (undefined when a round's
 * evaluation did not run).
 */
export function convergenceExtension(blockingHistory: ReadonlyArray<number | undefined>, baseAttempts: number): RecoveryBudget {
  const counts = blockingHistory.filter((count): count is number => typeof count === 'number');
  const previous = counts.at(-2), last = counts.at(-1);
  if (baseAttempts < 1 || previous === undefined || last === undefined || last <= 0 || last > previous / 2) {
    return { extended: false, maxAttempts: baseAttempts };
  }
  return { extended: true, maxAttempts: baseAttempts + 1, previousBlockingIssueOutcomes: previous, lastBlockingIssueOutcomes: last };
}

/**
 * Builds the recovery-budget-extended decision event for an extended budget,
 * or undefined when no extension applies. The caller hands the event to
 * runSamePlanRecovery, which records it only if recovery actually starts —
 * an extension that recovery then skips must not appear in the decision log.
 */
export function buildConvergenceBudgetDecision(ctx: BuildStageContext, budget: RecoveryBudget): BuildDecisionEvent | undefined {
  if (!budget.extended) return undefined;
  return emitBuildDecision(ctx, {
    kind: 'recovery-budget-extended',
    rationale: `Blocking issue outcomes dropped from ${budget.previousBlockingIssueOutcomes} to ${budget.lastBlockingIssueOutcomes} in the last review round; granting one additional same-plan recovery attempt.`,
    previousBlockingIssueOutcomes: budget.previousBlockingIssueOutcomes,
    lastBlockingIssueOutcomes: budget.lastBlockingIssueOutcomes,
    maxAttempts: budget.maxAttempts,
  });
}

interface TerminalEvaluationCounts { ran: boolean; blockingIssueOutcomes: number; unresolvedIssueOutcomes: number; needsHumanReviewIssueOutcomes: number; rejected: number; review: number }

/**
 * Composes the review-cycle terminal failure message. Prefers the
 * post-recovery evaluation only when recovery's blocking check ran AND
 * produced a verdict — a no-change recovery fix records a not-run evaluation,
 * and the pre-recovery counts are then still accurate. When recovery
 * re-evaluated a narrowed issue subset, the message discloses the scope.
 */
export function composeReviewCycleTerminalError(input: {
  maxRounds: number;
  finalEvaluation: TerminalEvaluationCounts | undefined;
  latestEvaluation: TerminalEvaluationCounts | undefined;
  recoveryBlockingCheckRan: boolean;
  recoveryScopeCount: number;
  blockingSnapshotCount: number;
}): string {
  const recoveryEvaluationRan = input.recoveryBlockingCheckRan && input.latestEvaluation?.ran === true;
  const terminal = recoveryEvaluationRan ? input.latestEvaluation : input.finalEvaluation;
  if (!terminal?.ran) return `Review cycle exhausted ${input.maxRounds} round(s) without a final evaluation verdict.`;
  const scopeNote = recoveryEvaluationRan && input.recoveryScopeCount < input.blockingSnapshotCount
    ? ` Recovery re-evaluated ${input.recoveryScopeCount} of ${input.blockingSnapshotCount} blocking issue(s); counts reflect that subset.`
    : '';
  return `${terminal.blockingIssueOutcomes} blocking issue outcome(s) remain after ${input.maxRounds} review round(s) (${terminal.unresolvedIssueOutcomes} unresolved, ${terminal.needsHumanReviewIssueOutcomes} need human review; ${terminal.rejected} rejected, ${terminal.review} under review).${scopeNote}`;
}
