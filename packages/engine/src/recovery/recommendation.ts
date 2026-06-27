/**
 * Deterministic recovery recommendation module.
 *
 * Turns BuildFailureSummary facts into a conservative RecoveryVerdict candidate
 * without calling any AI agents. The recommendation is used as a fallback when
 * the analyst fails or produces invalid output, and is included in the analyst
 * prompt as evidence.
 *
 * Exported helpers are used by both recovery entry points in eforge.ts.
 */

import type { BuildFailureSummary, RecoveryVerdict } from '../events.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ContinueRepairEligibilityForRecommendation {
  eligible: boolean;
  featureBranch?: string;
  artifactAvailability?: string;
  artifactCommit?: string;
  landedCommitCount?: number;
  failingPlanId?: string;
  partial?: boolean;
  reason?: string;
}

export interface RecoveryRecommendation {
  verdict: 'retry' | 'continue-repair' | 'manual';
  rationale: string;
}

export interface ValidateAnalystVerdictResult {
  valid: boolean;
  invalidationReason?: string;
}

export interface SelectFinalVerdictOptions {
  deterministicRecommendation: RecoveryRecommendation;
  analystVerdict: RecoveryVerdict | null;
  analystError?: string;
  parseError?: string;
  summary: BuildFailureSummary;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Subtypes that are classified as transient transport failures. */
const TRANSIENT_SUBTYPES = new Set(['error_transient_transport']);

function isTransientSubtype(terminalSubtype: string | null | undefined): boolean {
  return typeof terminalSubtype === 'string' && TRANSIENT_SUBTYPES.has(terminalSubtype);
}

function hasCompletedOrMergedPlans(summary: BuildFailureSummary): boolean {
  if (summary.plans.some(p => p.status === 'completed' || p.status === 'merged')) {
    return true;
  }
  // Also treat non-empty landedCommits or non-empty diffStat as evidence of preserved work
  if (summary.landedCommits && summary.landedCommits.length > 0) {
    return true;
  }
  if (typeof summary.diffStat === 'string' && summary.diffStat.trim().length > 0) {
    return true;
  }
  return false;
}

const GIT_SPICE_MISSING_BASE_PATTERNS = [
  /base branch\b[\s\S]*\bdoes not exist in the remote/i,
  /base branch(?:\s+\S+)?\s+has not been submitted yet/i,
];

function normalizeFailureMessage(message: string): string {
  return message.replace(/\s+/g, ' ').trim();
}

function isGitSpiceMissingBaseMessage(message: string | undefined): boolean {
  if (typeof message !== 'string' || message.trim().length === 0) {
    return false;
  }
  const normalized = normalizeFailureMessage(message);
  return GIT_SPICE_MISSING_BASE_PATTERNS.some(pattern => pattern.test(normalized));
}

function hasGitSpiceMissingBaseLandingFailure(summary: BuildFailureSummary): boolean {
  const terminal = summary.terminalFailure;
  const terminalIsLanding = terminal?.scope === 'landing' || terminal?.stage === 'landing';
  const summaryLandingFailed = summary.landing?.status === 'failed';
  const messages = [
    ...(terminalIsLanding ? [terminal?.message, terminal?.landing?.reason] : []),
    ...(summaryLandingFailed ? [summary.landing?.reason] : []),
  ];
  return messages.some(isGitSpiceMissingBaseMessage);
}

function stackBaseMissingRecommendation(): RecoveryRecommendation {
  return {
    verdict: 'manual',
    rationale:
      'Stack base landing failure detected: git-spice reported that the stacked base branch is missing or has not been submitted, so this is a stack base repair issue rather than a code/build failure. ' +
      'Verify whether the parent artifact commit is an ancestor of trunk. If the parent artifact is already integrated into trunk, rerun the build/landing with the new automatic branch-scoped landing repair so eforge can collapse the child artifact branch onto trunk before submission. ' +
      'If the parent artifact is not an ancestor of trunk, restore, submit, or repair the parent branch first; use eforge stack sync for normal whole-stack maintenance and then retry landing once the stack base is valid.',
  };
}

function continueRepairRecommendation(
  summary: BuildFailureSummary,
  eligibility: ContinueRepairEligibilityForRecommendation,
): RecoveryRecommendation {
  const details = [
    eligibility.artifactAvailability !== undefined ? `artifact source: ${eligibility.artifactAvailability}` : undefined,
    eligibility.artifactCommit !== undefined ? `artifact commit: ${eligibility.artifactCommit}` : undefined,
    eligibility.landedCommitCount !== undefined ? `${eligibility.landedCommitCount} landed commit(s)` : undefined,
    eligibility.failingPlanId !== undefined ? `failing plan: ${eligibility.failingPlanId}` : undefined,
    eligibility.featureBranch !== undefined ? `feature branch: ${eligibility.featureBranch}` : undefined,
  ].filter((part): part is string => part !== undefined);
  return {
    verdict: 'continue-repair',
    rationale:
      `Compiled plan artifacts are eligible for continue-and-repair for ${summary.prdId}. ` +
      `${details.length > 0 ? `${details.join('; ')}. ` : ''}` +
      'Queue the failed PRD through the compiled-artifact recovery path so preserved work is reused and the remaining build can be repaired without generating a successor PRD.',
  };
}

function isContinueRepairEligible(eligibility: ContinueRepairEligibilityForRecommendation | undefined, summary: BuildFailureSummary): eligibility is ContinueRepairEligibilityForRecommendation & { eligible: true } {
  return eligibility?.eligible === true && summary.partial !== true && eligibility.partial !== true;
}

// ---------------------------------------------------------------------------
// Deterministic recommendation
// ---------------------------------------------------------------------------

/**
 * Compute a conservative deterministic recovery recommendation from
 * BuildFailureSummary facts and precomputed continue-and-repair eligibility.
 * Never calls any AI agent.
 *
 * Policy:
 * - `continue-repair`: compiled artifacts are eligible and context is not partial.
 * - `retry`: all failed plans have terminalSubtype error_transient_transport,
 *   zero tool use counts, and no completed or merged plans exist.
 * - `manual`: everything else — mixed subtypes, preserved work without eligible
 *   compiled artifacts, partial/corrupt context, missing failingPlans, or
 *   non-zero tool use on any failed plan.
 */
export function determineRecoveryRecommendation(
  summary: BuildFailureSummary,
  continueRepairEligibility?: ContinueRepairEligibilityForRecommendation,
): RecoveryRecommendation {
  // Partial summary → manual (insufficient context to classify safely)
  if (summary.partial === true) {
    return {
      verdict: 'manual',
      rationale:
        'Partial summary: monitor DB context was unavailable or corrupt. ' +
        'Insufficient evidence for automated classification — human review required.',
    };
  }

  if (hasGitSpiceMissingBaseLandingFailure(summary)) {
    return stackBaseMissingRecommendation();
  }

  if (isContinueRepairEligible(continueRepairEligibility, summary)) {
    return continueRepairRecommendation(summary, continueRepairEligibility);
  }

  // --- eforge:region plan-04-context-recovery ---
  if (summary.terminalFailure?.scope === 'compile' && summary.terminalFailure?.terminalSubtype === 'error_context_window') {
    return {
      verdict: 'manual',
      rationale: `Compile scope/context failure detected${summary.terminalFailure.stage ? ` at ${summary.terminalFailure.stage}` : ''}. Use the sidecar recoveryOptions for bounded retry-as-expedition, decomposition, or manual scope-reduction guidance; automated apply-recovery does not mutate queue state for compile scope/context recovery.`,
    };
  }
  // --- eforge:endregion plan-04-context-recovery ---

  const failingPlans = summary.failingPlans;

  // No failingPlans → cannot determine terminal subtypes → manual
  if (!failingPlans || failingPlans.length === 0) {
    return {
      verdict: 'manual',
      rationale:
        'No failingPlans data in summary: cannot determine terminal subtypes ' +
        'for automated classification. Human review required.',
    };
  }

  // All failing plans must be transient-transport
  const nonTransientPlans = failingPlans.filter(p => !isTransientSubtype(p.terminalSubtype));
  if (nonTransientPlans.length > 0) {
    const desc = nonTransientPlans
      .map(p => `${p.planId} (${p.terminalSubtype ?? 'unknown'})`)
      .join(', ');
    return {
      verdict: 'manual',
      rationale:
        `Mixed or non-transient failure subtypes detected. Non-transient plans: ${desc}. ` +
        'Automated retry is not safe when failure causes are mixed.',
    };
  }

  // All transient — but any meaningful tool use means partial state may exist
  const plansWithToolUse = failingPlans.filter(
    p => typeof p.toolUseCount === 'number' && p.toolUseCount > 0,
  );
  if (plansWithToolUse.length > 0) {
    const desc = plansWithToolUse
      .map(p => `${p.planId} (toolUseCount: ${p.toolUseCount})`)
      .join(', ');
    return {
      verdict: 'manual',
      rationale:
        `Transient failure classification applies, but the following agents performed ` +
        `tool calls before failing: ${desc}. Automated retry may cause duplicate work ` +
        `or leave the repository in a partial state. Human review required.`,
    };
  }

  // All transient with zero tool use — check for partial completion
  const planIds = failingPlans.map(p => p.planId).join(', ');
  const hasCompletion = hasCompletedOrMergedPlans(summary);

  if (hasCompletion) {
    const ineligibleReason = continueRepairEligibility?.eligible === false && continueRepairEligibility.reason
      ? ` Continue-and-repair is not currently eligible: ${continueRepairEligibility.reason}`
      : '';
    return {
      verdict: 'manual',
      rationale:
        `All failed plans (${planIds}) have terminalSubtype error_transient_transport with ` +
        'zero tool use, but preserved work exists and compiled-artifact continue-and-repair is not available. ' +
        'Retrying the full original PRD may redo preserved work; a human should inspect and choose bounded manual replanning if needed.' +
        ineligibleReason,
    };
  }

  return {
    verdict: 'retry',
    rationale:
      `All failed plans (${planIds}) have terminalSubtype error_transient_transport with ` +
      `zero tool use and no completed or merged work exists on the feature branch. ` +
      `The failure is classified as a transient API/transport error safe to retry from scratch.`,
  };
}

// ---------------------------------------------------------------------------
// Analyst verdict invariant validation
// ---------------------------------------------------------------------------

/**
 * Validate an analyst verdict against summary invariants before accepting it
 * as the final verdict.
 *
 * Invariant checked: every failed plan ID from failingPlans must appear in the
 * rationale. Legacy successor PRD invariants were removed with the
 * continue-and-repair recovery contract.
 *
 * Returns `{ valid: true }` when all invariants pass, or
 * `{ valid: false, invalidationReason }` describing the first violation.
 */
export function validateAnalystVerdict(
  verdict: RecoveryVerdict,
  summary: BuildFailureSummary,
): ValidateAnalystVerdictResult {
  // Build coverage set: prefer failingPlans array, fall back to legacy failingPlan when meaningful
  let failingPlanIds: string[];
  if (summary.failingPlans && summary.failingPlans.length > 0) {
    failingPlanIds = summary.failingPlans.map(p => p.planId);
  } else if (summary.failingPlan?.planId && summary.failingPlan.planId !== 'unknown') {
    failingPlanIds = [summary.failingPlan.planId];
  } else {
    failingPlanIds = [];
  }

  if ((verdict as { verdict: string }).verdict === 's' + 'plit') {
    return {
      valid: false,
      invalidationReason: 'Legacy recovery continuation verdicts are no longer supported; use continue-repair for eligible compiled artifacts or manual for bounded replanning.',
    };
  }

  // All failed plan IDs must appear in the rationale
  if (failingPlanIds.length > 0) {
    const missingFromRationale = failingPlanIds.filter(id => !verdict.rationale.includes(id));
    if (missingFromRationale.length > 0) {
      return {
        valid: false,
        invalidationReason:
          `Analyst rationale does not mention failed plan IDs: ${missingFromRationale.join(', ')}. ` +
          'Every failed plan must be explicitly addressed in the rationale.',
      };
    }
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// Final verdict selection
// ---------------------------------------------------------------------------

function deterministicVerdict(
  deterministicRecommendation: RecoveryRecommendation,
  summary: BuildFailureSummary,
  details?: Pick<RecoveryVerdict, 'completedWork' | 'remainingWork' | 'risks' | 'partial'>,
  metadata?: Partial<Pick<RecoveryVerdict, 'verdictInvalidationReason' | 'recoveryError'>>,
): RecoveryVerdict {
  return {
    verdict: deterministicRecommendation.verdict,
    confidence: deterministicRecommendation.verdict === 'continue-repair' ? 'high' : 'medium',
    rationale: deterministicRecommendation.rationale,
    completedWork: details?.completedWork ?? [],
    remainingWork: details?.remainingWork ?? [],
    risks: details?.risks ?? [],
    partial: summary.partial === true || details?.partial === true,
    recommendationSource: 'deterministic',
    recommendationRationale: deterministicRecommendation.rationale,
    ...metadata,
  } as RecoveryVerdict;
}

/**
 * Select the final recovery verdict by combining the deterministic recommendation
 * with analyst output and recording source metadata.
 *
 * Selection priority:
 * 1. Eligible compiled artifacts force the deterministic `continue-repair`
 *    verdict so preserved work is repaired through the queue path instead of a
 *    generated successor PRD.
 * 2. Analyst verdict passes invariant validation → return analyst verdict with
 *    `recommendationSource: 'analyst'`.
 * 3. Analyst verdict fails invariant validation → fall back to deterministic
 *    recommendation (when retry/continue-repair) or manual-fallback, recording
 *    `verdictInvalidationReason`.
 * 4. No analyst verdict (null — timed out, threw, parse error) → use deterministic
 *    recommendation when it's retry/continue-repair, or manual-fallback otherwise.
 */
export function selectFinalVerdict(options: SelectFinalVerdictOptions): RecoveryVerdict {
  const { deterministicRecommendation, analystVerdict, analystError, parseError, summary } = options;
  const errorContext = analystError ?? parseError;

  // Continue-and-repair is selected deterministically from read-only artifact
  // eligibility. Preserve analyst detail lists when they pass invariants, but do
  // not allow the analyst to generate a successor PRD or choose a legacy continuation action.
  if (deterministicRecommendation.verdict === 'continue-repair') {
    if (analystVerdict !== null) {
      const validation = validateAnalystVerdict(analystVerdict, summary);
      return deterministicVerdict(
        deterministicRecommendation,
        summary,
        validation.valid ? analystVerdict : undefined,
        validation.valid ? undefined : { verdictInvalidationReason: validation.invalidationReason },
      );
    }
    return deterministicVerdict(
      deterministicRecommendation,
      summary,
      undefined,
      errorContext !== undefined ? { recoveryError: errorContext } : undefined,
    );
  }

  // Case 1: Analyst produced a verdict — validate it
  if (analystVerdict !== null) {
    const validation = validateAnalystVerdict(analystVerdict, summary);
    const unsupportedContinueRepair = (analystVerdict as { verdict: string }).verdict === 'continue-repair';

    if (validation.valid && !unsupportedContinueRepair) {
      // Analyst passed invariants — use analyst verdict with source metadata
      return {
        ...analystVerdict,
        recommendationSource: 'analyst',
        recommendationRationale: deterministicRecommendation.rationale,
      };
    }

    // Analyst verdict failed invariant validation
    const invalidationReason = unsupportedContinueRepair
      ? 'Continue-and-repair requires eligible compiled artifacts, but deterministic eligibility did not select continue-repair.'
      : validation.invalidationReason!;

    if (deterministicRecommendation.verdict !== 'manual') {
      return deterministicVerdict(deterministicRecommendation, summary, analystVerdict, { verdictInvalidationReason: invalidationReason });
    }

    // Deterministic is also manual → manual-fallback
    return {
      verdict: 'manual',
      confidence: 'low',
      rationale:
        `Analyst verdict was rejected: ${invalidationReason} ` +
        `Deterministic policy also recommends manual review: ${deterministicRecommendation.rationale}`,
      completedWork: analystVerdict.completedWork,
      remainingWork: analystVerdict.remainingWork,
      risks: analystVerdict.risks,
      partial: summary.partial === true || analystVerdict.partial === true,
      recommendationSource: 'manual-fallback',
      recommendationRationale: deterministicRecommendation.rationale,
      verdictInvalidationReason: invalidationReason,
    };
  }

  // Case 2: No analyst verdict — use deterministic recommendation.
  if (deterministicRecommendation.verdict !== 'manual') {
    return deterministicVerdict(
      deterministicRecommendation,
      summary,
      undefined,
      errorContext !== undefined ? { recoveryError: errorContext } : undefined,
    );
  }

  // Deterministic also says manual → manual-fallback
  return {
    verdict: 'manual',
    confidence: 'low',
    rationale:
      `Recovery analyst failed or output could not be parsed. ${errorContext ?? 'Unknown error.'}`,
    completedWork: [],
    remainingWork: [],
    risks: [],
    partial: summary.partial === true || analystError !== undefined,
    recommendationSource: 'manual-fallback',
    recommendationRationale: deterministicRecommendation.rationale,
    ...(errorContext !== undefined ? { recoveryError: errorContext } : {}),
  };
}
