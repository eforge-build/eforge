import type { ReviewIssue } from './events.js';
import {
  categorizeFiles,
  determineApplicableReviewsWithRules,
  isBuiltInReviewPerspective,
  isSecuritySensitivePath,
  type ReviewPerspective,
} from './review-heuristics.js';

export interface ReviewCycleEvaluationFileSummary {
  file: string;
  mode: 'file' | 'hunks';
  action?: 'accept' | 'reject' | 'review';
  acceptedHunks: number[];
  rejectedHunks: number[];
  reviewHunks: number[];
}

export interface ReviewCycleEvaluationSummary {
  ran: boolean;
  accepted: number;
  rejected: number;
  review: number;
  files: ReviewCycleEvaluationFileSummary[];
}

// --- eforge:region plan-01-dynamic-perspective-contracts ---
export interface SelectNextReviewPerspectivesInput {
  /** Stable ordering from the first review round; may include dynamic keys. */
  initialOrder: string[];
  /** Perspectives that were active in the previous review round; may include dynamic keys. */
  previousActive: string[];
  /** Issues collected from the previous review indexed by perspective key. */
  issuesByPerspective?: Partial<Record<string, ReviewIssue[]>>;
  evaluation?: ReviewCycleEvaluationSummary;
  previousReviewWasParallel: boolean;
  /** Perspective keys that errored in the previous review round. */
  perspectiveErrors?: string[];
  /**
   * Perspectives that must always be retained regardless of issue severity or
   * evaluation evidence. Used by sharded builds to keep `verify` mandatory.
   */
  mandatoryPerspectives?: string[];
}

export interface SelectNextReviewPerspectivesResult {
  /** Perspectives to use in the next review round; may include dynamic keys. */
  perspectives: string[];
  /** Perspectives dropped from the next round; may include dynamic keys. */
  dropped: string[];
  rationale: string;
  fallback: boolean;
}
// --- eforge:endregion plan-01-dynamic-perspective-contracts ---

// ---------------------------------------------------------------------------
// Early termination
// ---------------------------------------------------------------------------

export interface EarlyTerminationInput {
  /** Evaluation summary from the last evaluate stage. */
  evaluation: ReviewCycleEvaluationSummary | undefined;
  /** Issues from the previous review round, indexed by perspective key. */
  issuesByPerspective: Partial<Record<string, ReviewIssue[]>>;
  /** Active perspectives in the previous review round. */
  previousActive: string[];
  /** Perspectives that errored in the previous review round. */
  perspectiveErrors: string[];
  /** Whether the build pipeline includes a test-cycle stage. */
  hasTestCycle?: boolean;
  /** Whether the verify perspective was active in the previous review round. */
  verifyWasActive?: boolean;
}

export interface EarlyTerminationResult {
  terminate: boolean;
  rationale: string;
}

/**
 * Decide whether to terminate the review cycle early after evaluation,
 * before scheduling the next review round.
 *
 * Terminates when:
 * - All fixer changes were accepted (rejected=0, review=0, accepted>0)
 * - No perspective errored
 * - No critical issues remain in any active perspective
 * - Command/integration confidence is satisfied by one of:
 *   - Docs-only accepted changes (no runtime risk)
 *   - Test-cycle coverage in the build pipeline
 *   - Verify perspective passed in the current round
 */
export function shouldTerminateCycleEarly(
  input: EarlyTerminationInput,
): EarlyTerminationResult {
  const { evaluation, issuesByPerspective, previousActive, perspectiveErrors } = input;

  // Cannot terminate without a completed evaluation
  if (!evaluation || !evaluation.ran) {
    return { terminate: false, rationale: 'No evaluation ran; cannot terminate early' };
  }

  // Cannot terminate if any fixes were rejected or flagged for review
  if (evaluation.rejected > 0 || evaluation.review > 0) {
    return {
      terminate: false,
      rationale: `${evaluation.rejected} fix(es) rejected, ${evaluation.review} flagged for review — cycle must continue`,
    };
  }

  // Cannot terminate if no changes were accepted (nothing resolved)
  if (evaluation.accepted === 0) {
    return { terminate: false, rationale: 'No fixer changes were accepted; issues may be unresolved' };
  }

  // Cannot terminate if any perspective errored
  if (perspectiveErrors.length > 0) {
    return {
      terminate: false,
      rationale: `Perspective error(s) in: ${perspectiveErrors.join(', ')} — cannot confirm resolution`,
    };
  }

  // Cannot terminate if any active perspective has a critical prior issue
  const criticalPerspectives = previousActive.filter(p =>
    (issuesByPerspective[p] ?? []).some(i => i.severity === 'critical'),
  );
  if (criticalPerspectives.length > 0) {
    return {
      terminate: false,
      rationale: `Critical issues remain in: ${criticalPerspectives.join(', ')} — confirmation required`,
    };
  }

  // All fixes accepted and no critical concerns — check command/integration confidence

  const acceptedFiles = evaluation.files.filter(hasAcceptedVerdict).map(s => s.file);

  // Docs-only accepted changes: no command/runtime risk
  if (acceptedFiles.length > 0 && acceptedFiles.every(isDocsPath)) {
    const names = acceptedFiles.join(', ');
    return {
      terminate: true,
      rationale: `Terminated: all fixes accepted and docs-only scope — no command/integration risk. Accepted: ${names}`,
    };
  }

  const highRiskAcceptedFiles = acceptedFiles.filter(isHighRiskAcceptedFile);
  if (highRiskAcceptedFiles.length > 0) {
    return {
      terminate: false,
      rationale: `Accepted command/integration-risk file(s) require follow-up confirmation: ${highRiskAcceptedFiles.join(', ')}`,
    };
  }

  // Test-cycle in pipeline: tests confirm command-level behavior
  if (input.hasTestCycle) {
    return {
      terminate: true,
      rationale: 'Terminated: all fixes accepted and test-cycle provides command/integration coverage',
    };
  }

  // Verify perspective passed this round: confirms build/runtime correctness
  if (input.verifyWasActive) {
    const noCriticalVerify = !(issuesByPerspective['verify'] ?? []).some(i => i.severity === 'critical');
    if (noCriticalVerify) {
      return {
        terminate: true,
        rationale: 'Terminated: all fixes accepted and no unresolved high-risk concerns — verify passed in this round',
      };
    }
  }

  return {
    terminate: false,
    rationale: 'No command/integration confidence signal (no docs-only scope, test-cycle, or verify pass)',
  };
}

function uniqueOrdered(perspectives: string[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const perspective of perspectives) {
    if (seen.has(perspective)) continue;
    seen.add(perspective);
    ordered.push(perspective);
  }
  return ordered;
}

function stableActiveOrder(initialOrder: string[], previousActive: string[]): string[] {
  const active = new Set(previousActive);
  const baseOrder = initialOrder.length > 0 ? initialOrder : previousActive;
  const ordered = uniqueOrdered(baseOrder).filter(perspective => active.has(perspective));
  for (const perspective of previousActive) {
    if (!ordered.includes(perspective)) ordered.push(perspective);
  }
  return ordered;
}

function fallback(previousActive: string[], rationale: string): SelectNextReviewPerspectivesResult {
  return {
    perspectives: [...previousActive],
    dropped: [],
    rationale: `Fallback: ${rationale}; retained ${previousActive.length} perspective(s), dropped 0.`,
    fallback: true,
  };
}

function hasCompletionForEveryActive(input: SelectNextReviewPerspectivesInput): boolean {
  if (!input.issuesByPerspective) return false;
  return input.previousActive.every(perspective =>
    Object.prototype.hasOwnProperty.call(input.issuesByPerspective, perspective),
  );
}

function hasAcceptedVerdict(summary: ReviewCycleEvaluationFileSummary): boolean {
  if (summary.mode === 'file') return summary.action === 'accept';
  return summary.acceptedHunks.length > 0;
}

function hasRejectedOrReviewVerdict(summary: ReviewCycleEvaluationFileSummary): boolean {
  if (summary.mode === 'file') return summary.action === 'reject' || summary.action === 'review';
  return summary.rejectedHunks.length > 0 || summary.reviewHunks.length > 0;
}

function isHighRiskAcceptedFile(file: string): boolean {
  const categories = categorizeFiles([file]);
  return categories.deps.length > 0 || categories.config.length > 0 ||
    categories.test.length > 0 || isSecuritySensitivePath(file);
}

/**
 * Returns true when the perspective has at least one critical prior issue.
 * Warning and suggestion issues alone do not retain a perspective — only
 * critical severity warrants a mandatory confirmation round.
 */
function hasCriticalIssues(
  perspective: string,
  issuesByPerspective: Partial<Record<string, ReviewIssue[]>>,
): boolean {
  return (issuesByPerspective[perspective] ?? []).some(i => i.severity === 'critical');
}

/**
 * Returns a short reason string for why a perspective was kept, or null if it
 * should be dropped.
 */
function keepReason(
  perspective: string,
  keepForCritical: boolean,
  keepForConcern: boolean,
  keepForVerify: boolean,
  isMandatory: boolean,
): string | null {
  if (isMandatory) return 'mandatory';
  if (keepForCritical) return 'critical prior issue';
  if (keepForVerify) return 'verify retention (non-docs accepted or mandatory)';
  if (keepForConcern) return 'concern overlap with evaluation verdicts';
  return null;
}

/**
 * Returns a short reason string for why a perspective was dropped.
 */
function dropReason(
  perspective: string,
  issuesByPerspective: Partial<Record<string, ReviewIssue[]>>,
): string {
  const issues = issuesByPerspective[perspective] ?? [];
  if (issues.length === 0) return `Dropped ${perspective}: no prior issues`;
  const severities = issues.map(i => i.severity).join(', ');
  return `Dropped ${perspective}: only ${severities} issue(s) — no critical severity or unresolved risk`;
}

export function isDocsPath(file: string): boolean {
  const categories = categorizeFiles([file]);
  return categories.docs.length > 0;
}

/**
 * Returns true when verify should be retained based on evaluation verdicts.
 * Verify stays when any accepted fixer file is NOT a docs-only path, signalling
 * that command or runtime behavior may have changed.
 * Verify drops when all accepted changes are docs-only (no runtime risk).
 */
function verifyShouldRemain(evaluation: ReviewCycleEvaluationSummary): boolean {
  const acceptedFiles = evaluation.files
    .filter(hasAcceptedVerdict)
    .map(summary => summary.file);
  if (acceptedFiles.length === 0) return false;
  return acceptedFiles.some(file => !isDocsPath(file));
}

/**
 * Returns a rationale string for verify keep/drop decision.
 */
function verifyKeepRationale(
  evaluation: ReviewCycleEvaluationSummary,
  hasCritical: boolean,
  isMandatory: boolean,
): string {
  if (isMandatory) return 'Kept verify: mandatory for sharded build';
  if (hasCritical) return 'Kept verify: critical prior issues';
  const acceptedFiles = evaluation.files.filter(hasAcceptedVerdict).map(s => s.file);
  if (acceptedFiles.length > 0 && acceptedFiles.some(f => !isDocsPath(f))) {
    // Find a non-docs accepted file for the rationale
    const nonDocExample = acceptedFiles.find(f => !isDocsPath(f)) ?? '';
    const categories = categorizeFiles([nonDocExample]);
    const kind = categories.config.length > 0 ? 'config'
      : categories.deps.length > 0 ? 'dep'
      : categories.test.length > 0 ? 'test'
      : isSecuritySensitivePath(nonDocExample) ? 'security-sensitive'
      : 'non-doc';
    return `Kept verify: accepted ${kind} change (${nonDocExample})`;
  }
  if (acceptedFiles.length > 0 && acceptedFiles.every(isDocsPath)) return 'Dropped verify: docs-only accepted fixes — no command/integration risk';
  return 'Dropped verify: no accepted command/integration-risk files';
}

// --- eforge:region plan-01-dynamic-perspective-contracts ---
/**
 * Derive which built-in concern perspectives apply to the files touched by
 * evaluation verdicts. Returns a Set of strings (built-in names) for
 * intersection with the current active perspective list which may also
 * contain dynamic keys. Dynamic keys won't appear here — they're retained
 * only via prior-issues logic, not concern inference.
 *
 * Accepted verdicts on ordinary code files (not deps, config, docs, test, or
 * security-sensitive) do NOT create concern overlap — an accepted fix on low-risk
 * code signals the concern was resolved, not that it persists. Non-accepted
 * (rejected/review) verdicts always create concern, regardless of file type.
 */
function concernPerspectives(evaluation: ReviewCycleEvaluationSummary): Set<string> {
  const nonAcceptedFiles = evaluation.files
    .filter(hasRejectedOrReviewVerdict)
    .map(summary => summary.file);
  const acceptedFiles = evaluation.files
    .filter(hasAcceptedVerdict)
    .map(summary => summary.file);
  // Accepted ordinary-code files are excluded from concern inference — the fix was
  // accepted, so the code concern is resolved. Only accepted high-risk files (deps,
  // config, docs, test, security-sensitive paths) still warrant re-review.
  const highRiskAcceptedFiles = acceptedFiles.filter(file => isDocsPath(file) || isHighRiskAcceptedFile(file));
  const relevantFiles = [...nonAcceptedFiles, ...highRiskAcceptedFiles];
  const categories = categorizeFiles(relevantFiles);
  return new Set<string>(determineApplicableReviewsWithRules(categories).perspectives);
}

// --- eforge:region plan-02-extension-perspective-runtime ---
/**
 * Returns true when the perspective key is a built-in perspective name.
 * Extension perspectives are not built-in.
 */
function isBuiltInKey(key: string): boolean {
  return isBuiltInReviewPerspective(key);
}
// --- eforge:endregion plan-02-extension-perspective-runtime ---
// --- eforge:endregion plan-01-dynamic-perspective-contracts ---

export function selectNextReviewPerspectives(
  input: SelectNextReviewPerspectivesInput,
): SelectNextReviewPerspectivesResult {
  const previousActive = uniqueOrdered(input.previousActive);

  if (!input.previousReviewWasParallel) {
    return fallback(previousActive, 'previous review was not parallel');
  }

  if ((input.perspectiveErrors ?? []).length > 0) {
    return fallback(previousActive, 'one or more perspectives errored');
  }

  if (!hasCompletionForEveryActive(input)) {
    return fallback(previousActive, 'completion data was missing for one or more active perspectives');
  }

  if (!input.evaluation) {
    return fallback(previousActive, 'evaluation summary data was missing');
  }

  if (!input.evaluation.ran) {
    return fallback(previousActive, 'evaluation did not run, so evaluator file verdict data was unavailable');
  }

  const verdictCount = input.evaluation.accepted + input.evaluation.rejected + input.evaluation.review;
  if (verdictCount > 0 && input.evaluation.files.length === 0) {
    return fallback(previousActive, 'evaluation verdict counts were present but file verdict summaries were missing');
  }

  const issuesByPerspective = input.issuesByPerspective ?? {};
  const stableOrder = stableActiveOrder(input.initialOrder, previousActive);
  const overlappingConcerns = concernPerspectives(input.evaluation);
  const keepVerifyForAcceptedChanges = verifyShouldRemain(input.evaluation);
  const mandatorySet = new Set(input.mandatoryPerspectives ?? []);

  const perspectives: string[] = [];
  const dropped: string[] = [];
  const keepReasons: string[] = [];
  const dropReasons: string[] = [];

  for (const perspective of stableOrder) {
    const isMandatory = mandatorySet.has(perspective);
    const keepForCritical = hasCriticalIssues(perspective, issuesByPerspective);
    // --- eforge:region plan-02-extension-perspective-runtime ---
    // For extension perspectives (non-built-in keys), concern inference via file categories
    // does not apply — they are retained only when they have critical issues or are mandatory.
    // Built-in perspectives may also be retained by concern overlap or verify logic.
    const keepForConcern = !isBuiltInKey(perspective) ? false : overlappingConcerns.has(perspective);
    // --- eforge:endregion plan-02-extension-perspective-runtime ---
    const keepForVerify = perspective === 'verify' && (keepForCritical || keepVerifyForAcceptedChanges || isMandatory);

    const reason = keepReason(perspective, keepForCritical, keepForConcern, keepForVerify, isMandatory);
    if (reason !== null) {
      perspectives.push(perspective);
      keepReasons.push(
        perspective === 'verify'
          ? verifyKeepRationale(input.evaluation, keepForCritical, isMandatory)
          : `Kept ${perspective}: ${reason}`,
      );
    } else {
      dropped.push(perspective);
      dropReasons.push(
        perspective === 'verify'
          ? verifyKeepRationale(input.evaluation, keepForCritical, isMandatory)
          : dropReason(perspective, issuesByPerspective),
      );
    }
  }

  const rationaleFragments = [...keepReasons, ...dropReasons];
  const rationale = rationaleFragments.length > 0
    ? `Retained ${perspectives.length} perspective(s) and dropped ${dropped.length} after prior issues and evaluator file verdicts. ${rationaleFragments.join('. ')}.`
    : `Retained ${perspectives.length} perspective(s) and dropped ${dropped.length} after prior issues and evaluator file verdicts.`;

  return {
    perspectives,
    dropped,
    rationale,
    fallback: false,
  };
}

export type { ReviewPerspective };
