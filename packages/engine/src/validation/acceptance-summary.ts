/**
 * Shared helpers for counting and summarizing acceptance criterion verdicts.
 *
 * Used by:
 * - recovery/sidecar.ts — to render acceptance evidence sections in Markdown
 * - eforge.ts — to build verdict-aware final build summary text
 * - recovery/event-history.ts — to build compact acceptance evidence objects
 */

import type { AcceptanceCriterionVerdict } from '@eforge-build/client';

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
export function formatAcceptanceFailureSummary(verdicts: AcceptanceCriterionVerdict[]): string {
  const { fail, unknown } = countVerdicts(verdicts);
  const nonPass = fail + unknown;

  if (fail > 0 && unknown > 0) {
    return `Acceptance criteria validation failed: ${fail} criterion/criteria not met, ${unknown} inconclusive`;
  } else if (fail > 0) {
    return `Acceptance criteria validation failed: ${fail} criterion/criteria not met`;
  } else if (unknown > 0) {
    return `Acceptance criteria validation failed: ${unknown} criterion/criteria inconclusive (insufficient evidence)`;
  }
  // Fallback: shouldn't normally reach here if called on a failure, but be defensive
  return `Acceptance criteria validation failed: ${Math.max(nonPass, 1)} criterion/criteria not met`;
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
}

/**
 * Build a compact acceptance evidence object for recovery summaries.
 */
export function buildAcceptanceEvidence(
  verdicts: AcceptanceCriterionVerdict[],
  passed: boolean,
): AcceptanceEvidence {
  return {
    passed,
    ...countVerdicts(verdicts),
    verdicts,
  };
}
