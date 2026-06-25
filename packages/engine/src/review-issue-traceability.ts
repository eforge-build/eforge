import { ReviewIssueIdSchema, safeParseWithSchema } from '@eforge-build/client';

import type { ReviewIssue } from './events.js';

export interface ReviewIssueIdContext {
  /** Zero-based review-cycle round. Missing rounds generate IDs as round 0. */
  round?: number;
  /** Review lane used in generated IDs (single, perspective key, aggregate, review-contract). */
  lane: string;
}

/** Normalize and validate an optional agent-supplied review issue ID hint. */
export function normalizeReviewIssueId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  const result = safeParseWithSchema(ReviewIssueIdSchema, normalized);
  return result.success ? normalized : undefined;
}

/** Assign canonical, unique issue IDs for one review-complete issue array. */
export function assignReviewIssueIds(
  issues: ReviewIssue[],
  context: ReviewIssueIdContext,
): ReviewIssue[] {
  const used = new Set<string>();
  const reservedSupplied = collectUniqueSuppliedIssueIds(issues);
  const round = context.round ?? 0;
  const lane = normalizeLane(context.lane);

  return issues.map((issue, index) => {
    const supplied = normalizeReviewIssueId(issue.issueId);
    const generatedBase = `review-r${round}-${lane}-${index + 1}`;
    const issueId = supplied && !used.has(supplied)
      ? supplied
      : nextAvailableIssueId(generatedBase, used, reservedSupplied);
    used.add(issueId);
    return { ...issue, issueId };
  });
}

function collectUniqueSuppliedIssueIds(issues: ReviewIssue[]): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const issue of issues) {
    const supplied = normalizeReviewIssueId(issue.issueId);
    if (!supplied) continue;
    if (seen.has(supplied)) {
      duplicates.add(supplied);
    } else {
      seen.add(supplied);
    }
  }
  for (const duplicate of duplicates) {
    seen.delete(duplicate);
  }
  return seen;
}

function nextAvailableIssueId(base: string, used: Set<string>, reserved: Set<string>): string {
  if (!used.has(base) && !reserved.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}-${suffix}`) || reserved.has(`${base}-${suffix}`)) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
}

function normalizeLane(lane: string): string {
  const normalized = lane.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized.length > 0 ? normalized : 'unknown';
}
