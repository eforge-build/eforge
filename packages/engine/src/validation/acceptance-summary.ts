/**
 * Shared helpers for counting and summarizing acceptance criterion verdicts.
 *
 * Used by:
 * - recovery/sidecar.ts — to render acceptance evidence sections in Markdown
 * - eforge.ts — to build verdict-aware final build summary text
 * - recovery/event-history.ts — to build compact acceptance evidence objects
 */

import type { AcceptanceCriteriaConflict, AcceptanceCriterionVerdict } from '@eforge-build/client';

// ---------------------------------------------------------------------------
// Verdict counts
// ---------------------------------------------------------------------------

export interface VerdictCounts {
  total: number;
  pass: number;
  fail: number;
  unknown: number;
}

/**
 * Count acceptance verdicts by outcome.
 */
export function countVerdicts(verdicts: AcceptanceCriterionVerdict[]): VerdictCounts {
  let pass = 0, fail = 0, unknown = 0;
  for (const v of verdicts) {
    if (v.verdict === 'pass') pass++;
    else if (v.verdict === 'fail') fail++;
    else unknown++;
  }
  return { total: verdicts.length, pass, fail, unknown };
}

// ---------------------------------------------------------------------------
// Failure summary text
// ---------------------------------------------------------------------------

/**
 * Build verdict-aware failure summary text for the final build summary.
 *
 * Distinguishes between explicitly failed criteria (verdict: 'fail') and
 * inconclusive criteria (verdict: 'unknown'). An all-unknown failure does
 * not contain only "not met" — it says "inconclusive" instead.
 */
export function formatAcceptanceFailureSummary(
  verdicts: AcceptanceCriterionVerdict[],
  conflicts: AcceptanceCriteriaConflict[] = [],
): string {
  const { fail, unknown } = countVerdicts(verdicts);
  const nonPass = fail + unknown;
  const conflictSuffix = conflicts.length > 0
    ? `; ${conflicts.length} acceptance criterion conflict(s) need review`
    : '';

  if (fail > 0 && unknown > 0) {
    return `Acceptance criteria validation failed: ${fail} criterion/criteria not met, ${unknown} inconclusive${conflictSuffix}`;
  } else if (fail > 0) {
    return `Acceptance criteria validation failed: ${fail} criterion/criteria not met${conflictSuffix}`;
  } else if (unknown > 0) {
    return `Acceptance criteria validation failed: ${unknown} criterion/criteria inconclusive (insufficient evidence)${conflictSuffix}`;
  }
  // Fallback: shouldn't normally reach here if called on a failure, but be defensive
  return `Acceptance criteria validation failed: ${Math.max(nonPass, 1)} criterion/criteria not met${conflictSuffix}`;
}

// ---------------------------------------------------------------------------
// Compact acceptance evidence for recovery
// ---------------------------------------------------------------------------

export interface AcceptanceEvidence {
  passed: boolean;
  total: number;
  pass: number;
  fail: number;
  unknown: number;
  verdicts: AcceptanceCriterionVerdict[];
  waivers?: string[];
  conflicts?: AcceptanceCriteriaConflict[];
}

/**
 * Build a compact acceptance evidence object for recovery summaries.
 */
export function buildAcceptanceEvidence(
  verdicts: AcceptanceCriterionVerdict[],
  passed: boolean,
  options: { waivers?: string[]; conflicts?: AcceptanceCriteriaConflict[] } = {},
): AcceptanceEvidence {
  return {
    passed,
    ...countVerdicts(verdicts),
    verdicts,
    ...(options.waivers && options.waivers.length > 0 ? { waivers: options.waivers } : {}),
    ...(options.conflicts && options.conflicts.length > 0 ? { conflicts: options.conflicts } : {}),
  };
}
