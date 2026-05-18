import type { ReviewIssue } from './events.js';
import {
  categorizeFiles,
  determineApplicableReviewsWithRules,
  isBuiltInReviewPerspective,
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

function hasAnyVerdict(summary: ReviewCycleEvaluationFileSummary): boolean {
  if (summary.mode === 'file') return summary.action !== undefined;
  return summary.acceptedHunks.length > 0 || summary.rejectedHunks.length > 0 || summary.reviewHunks.length > 0;
}

function hasAcceptedVerdict(summary: ReviewCycleEvaluationFileSummary): boolean {
  if (summary.mode === 'file') return summary.action === 'accept';
  return summary.acceptedHunks.length > 0;
}

function hasPriorIssues(
  perspective: string,
  issuesByPerspective: Partial<Record<string, ReviewIssue[]>>,
): boolean {
  return (issuesByPerspective[perspective]?.length ?? 0) > 0;
}

function isDocsPath(file: string): boolean {
  const categories = categorizeFiles([file]);
  return categories.docs.length > 0;
}

function verifyShouldRemain(evaluation: ReviewCycleEvaluationSummary): boolean {
  const acceptedFiles = evaluation.files
    .filter(hasAcceptedVerdict)
    .map(summary => summary.file);
  if (acceptedFiles.length === 0) return false;
  return acceptedFiles.some(file => !isDocsPath(file));
}

// --- eforge:region plan-01-dynamic-perspective-contracts ---
/**
 * Derive which built-in concern perspectives apply to the files touched by
 * evaluation verdicts. Returns a Set of strings (built-in names) for
 * intersection with the current active perspective list which may also
 * contain dynamic keys. Dynamic keys won't appear here — they're retained
 * only via prior-issues logic, not concern inference.
 */
function concernPerspectives(evaluation: ReviewCycleEvaluationSummary): Set<string> {
  const relevantFiles = evaluation.files
    .filter(hasAnyVerdict)
    .map(summary => summary.file);
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

  const perspectives: string[] = [];
  const dropped: string[] = [];

  for (const perspective of stableOrder) {
    const keepForIssues = hasPriorIssues(perspective, issuesByPerspective);
    // --- eforge:region plan-02-extension-perspective-runtime ---
    // For extension perspectives (non-built-in keys), concern inference via file categories
    // does not apply — they are retained only when they have prior issues.
    // Built-in perspectives may also be retained by concern overlap or verify logic.
    const keepForConcern = !isBuiltInKey(perspective) ? false : overlappingConcerns.has(perspective);
    // --- eforge:endregion plan-02-extension-perspective-runtime ---
    const keepForVerify = perspective === 'verify' && (keepForIssues || keepVerifyForAcceptedChanges);

    if (keepForIssues || keepForConcern || keepForVerify) {
      perspectives.push(perspective);
    } else {
      dropped.push(perspective);
    }
  }

  return {
    perspectives,
    dropped,
    rationale: `Retained ${perspectives.length} perspective(s) and dropped ${dropped.length} after prior issues and evaluator file verdicts.`,
    fallback: false,
  };
}

export type { ReviewPerspective };
