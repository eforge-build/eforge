/**
 * Acceptance criteria extraction, normalization, and verdict matching utilities.
 *
 * This module provides a deterministic `ExpectedAcceptanceCriterion` model derived
 * from PRD/source markdown or plan-file bodies, plus helpers for matching validator
 * verdicts against expected criteria and synthesizing missing-verdict evidence.
 *
 * Design constraints:
 * - IDs are positional (`ac-001`, `ac-002`, …) so they are stable within a single
 *   extraction call but not across edits. Callers must not persist IDs across PRD
 *   revisions.
 * - Normalization is lossy-but-deterministic: bullet style changes (-, *, 1., [ ])
 *   do not affect criterion identity.
 * - Blank, placeholder, and sentinel lines are rejected at extraction time.
 */

import type { AcceptanceCriterionVerdict } from '@eforge-build/client';

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

/** An expected acceptance criterion derived from a PRD or plan-file source. */
export interface ExpectedAcceptanceCriterion {
  /** Positional identifier, e.g. `ac-001`. Stable within one extraction call. */
  id: string;
  /** Normalized criterion text: trimmed, whitespace-collapsed, list markers stripped. */
  text: string;
  /** Original raw line text before normalization. */
  raw: string;
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/**
 * Sentinel values treated as blank/placeholder criteria and excluded from the
 * extracted inventory.
 */
const PLACEHOLDER_SENTINELS = new Set(['tbd', 'n/a', 'na', 'none', '-', '']);

/**
 * Strip common Markdown list markers from the beginning of a string:
 * - Unordered: `- `, `* `, `+ `
 * - Ordered: `1. `, `12. `, etc.
 * - Checkbox (open or closed): `[ ] `, `[x] `, `[X] `
 * - Combinations: `- [ ] `, `* [x] `
 */
function stripListMarkers(text: string): string {
  // Strip leading checkbox (may appear alone or after a bullet)
  let s = text.replace(/^\[[ xX]\]\s*/, '');
  // Strip leading ordered marker: digits followed by `.` or `)` then whitespace
  s = s.replace(/^\d+[.)]\s+/, '');
  // Strip leading unordered marker: `-`, `*`, or `+` followed by whitespace
  s = s.replace(/^[-*+]\s+/, '');
  // One more pass for checkbox in case it came after a bullet (e.g. `- [ ] text`)
  s = s.replace(/^\[[ xX]\]\s*/, '');
  return s;
}

/**
 * Normalize a criterion line to a canonical form used for identity comparison:
 * 1. Trim leading/trailing whitespace.
 * 2. Strip list markers (bullets, ordered, checkboxes).
 * 3. Collapse internal runs of whitespace to single spaces.
 * 4. Trim again.
 */
export function normalizeCriterionText(raw: string): string {
  const stripped = stripListMarkers(raw.trim());
  return stripped.replace(/\s+/g, ' ').trim();
}

/**
 * Returns true when the normalized text is a placeholder or blank sentinel
 * that should not produce an expected criterion.
 */
function isPlaceholder(normalized: string): boolean {
  return PLACEHOLDER_SENTINELS.has(normalized.toLowerCase());
}

// ---------------------------------------------------------------------------
// Extraction helpers
// ---------------------------------------------------------------------------

/** Heading depth: number of leading `#` characters (1–6). */
function headingDepth(line: string): number | null {
  const m = line.match(/^(#{1,6})\s/);
  return m ? m[1].length : null;
}

/**
 * Extract text lines from `body` that fall within the first heading whose
 * text matches one of `headingNames`, stopping at the next heading of equal
 * or lesser depth (i.e. same or higher in the document hierarchy).
 *
 * Returns `null` when no matching heading is found.
 */
function extractSectionLines(body: string, headingNames: readonly string[]): string[] | null {
  const lines = body.split('\n');
  let sectionDepth: number | null = null;
  const result: string[] = [];
  let inSection = false;

  for (const line of lines) {
    const depth = headingDepth(line);

    if (depth !== null) {
      // Extract the heading text (strip leading `#` and whitespace)
      const headingText = line.replace(/^#{1,6}\s+/, '').trim();

      if (!inSection) {
        // Check whether this heading opens our target section
        if (headingNames.some((name) => name.toLowerCase() === headingText.toLowerCase())) {
          inSection = true;
          sectionDepth = depth;
        }
        // Not our section — keep scanning
      } else {
        // We are inside the section. Stop at next heading of same or higher depth.
        if (depth <= sectionDepth!) {
          break;
        }
        // Sub-heading inside our section — include it as content (its text may be criteria)
      }
    } else if (inSection) {
      result.push(line);
    }
  }

  return inSection ? result : null;
}

/**
 * Convert raw content lines into `ExpectedAcceptanceCriterion` records.
 * Blank lines, headings, and placeholder sentinels are skipped.
 * IDs are assigned in order starting at `ac-001`.
 */
function linesToCriteria(lines: string[], startIndex = 1): ExpectedAcceptanceCriterion[] {
  const criteria: ExpectedAcceptanceCriterion[] = [];
  let counter = startIndex;

  for (const raw of lines) {
    const trimmed = raw.trim();
    // Skip blank lines
    if (trimmed === '') continue;
    // Skip sub-headings inside the section
    if (headingDepth(trimmed) !== null) continue;

    const normalized = normalizeCriterionText(trimmed);
    if (isPlaceholder(normalized)) continue;

    const id = `ac-${String(counter).padStart(3, '0')}`;
    criteria.push({ id, text: normalized, raw: trimmed });
    counter++;
  }

  return criteria;
}

// ---------------------------------------------------------------------------
// Primary extraction API
// ---------------------------------------------------------------------------

/** Heading names that mark an explicit acceptance criteria section. */
const AC_HEADING_NAMES = ['Acceptance Criteria', 'Acceptance criteria', 'ACs'] as const;

/** Fallback section heading names used when no explicit AC section exists. */
const FALLBACK_HEADING_NAMES = ['Verification', 'Scope'] as const;

/**
 * Extract expected acceptance criteria from a PRD or source markdown body.
 *
 * Extraction strategy:
 * 1. Look for a heading named `Acceptance Criteria`, `Acceptance criteria`, or
 *    `ACs`. Extract all bullet/checklist lines until the next heading of equal
 *    or higher depth.
 * 2. If no explicit AC section is found and `allowFallbackSections` is true,
 *    fall back to `## Verification` and `## Scope` sections, collecting
 *    checklist/bullet lines as candidate criteria. This fallback is intended
 *    only for plan-file bodies, not PRD content — PRDs without an explicit
 *    AC section should return an empty array so the no-AC policy applies.
 *
 * Blank, `TBD`, `N/A`, `none`, and similar placeholder lines are excluded.
 *
 * @param body - Full markdown body of the PRD or plan file.
 * @param options.allowFallbackSections - When true, fall back to Verification/Scope
 *   sections if no explicit AC section is found. Default false.
 * @returns Array of expected criteria, possibly empty.
 */
export function extractExpectedAcceptanceCriteria(
  body: string,
  options?: { allowFallbackSections?: boolean },
): ExpectedAcceptanceCriterion[] {
  // 1. Try explicit AC section first
  const acLines = extractSectionLines(body, AC_HEADING_NAMES);
  if (acLines !== null) {
    return linesToCriteria(acLines);
  }

  if (!options?.allowFallbackSections) {
    return [];
  }

  // 2. Fallback: collect bullet/checklist lines from Verification + Scope in source order
  const fallbackSectionNames = new Set(FALLBACK_HEADING_NAMES.map((n) => n.toLowerCase()));
  const bodyLines = body.split('\n');
  let sectionDepth: number | null = null;
  let inFallbackSection = false;
  let inOutOfScopeSubsection = false;
  const fallbackCriteria: ExpectedAcceptanceCriterion[] = [];
  let counter = 1;

  for (const line of bodyLines) {
    const depth = headingDepth(line);

    if (depth !== null) {
      const headingText = line.replace(/^#{1,6}\s+/, '').trim();

      if (inFallbackSection && depth <= sectionDepth!) {
        inFallbackSection = false;
        sectionDepth = null;
        inOutOfScopeSubsection = false;
      }

      if (!inFallbackSection && fallbackSectionNames.has(headingText.toLowerCase()) && depth === 2) {
        inFallbackSection = true;
        sectionDepth = depth;
        inOutOfScopeSubsection = false;
      } else if (inFallbackSection && depth > sectionDepth!) {
        // Subsection inside a fallback section — skip bullets under "Out of Scope"
        inOutOfScopeSubsection = /out\s+of\s+scope/i.test(headingText);
      }
    } else if (inFallbackSection && !inOutOfScopeSubsection) {
      const trimmed = line.trim();
      if (trimmed === '') continue;
      if (headingDepth(trimmed) !== null) continue;

      // Only collect lines that look like checklist or bullet items
      const isBullet = /^[-*+]\s/.test(trimmed);
      const isOrdered = /^\d+[.)]\s/.test(trimmed);
      const isCheckbox = /^\[[ xX]\]/.test(trimmed);

      if (!isBullet && !isOrdered && !isCheckbox) continue;

      const normalized = normalizeCriterionText(trimmed);
      if (isPlaceholder(normalized)) continue;

      const id = `ac-${String(counter).padStart(3, '0')}`;
      fallbackCriteria.push({ id, text: normalized, raw: trimmed });
      counter++;
    }
  }

  return fallbackCriteria;
}

// ---------------------------------------------------------------------------
// Verdict matching
// ---------------------------------------------------------------------------

/**
 * Match a validator's `AcceptanceCriterionVerdict` list against an inventory of
 * expected criteria using normalized text comparison.
 *
 * Returns a map from expected criterion ID to the first matching verdict, or
 * `undefined` when no verdict matches the criterion.
 */
export function matchVerdictsToExpected(
  expected: readonly ExpectedAcceptanceCriterion[],
  verdicts: readonly AcceptanceCriterionVerdict[],
): Map<string, AcceptanceCriterionVerdict | undefined> {
  const result = new Map<string, AcceptanceCriterionVerdict | undefined>();

  for (const criterion of expected) {
    const match = verdicts.find(
      (v) => normalizeCriterionText(v.criterion) === criterion.text || v.criterion.trim() === criterion.id,
    );
    result.set(criterion.id, match);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Missing-verdict synthesis
// ---------------------------------------------------------------------------

/**
 * Synthesize `unknown` verdicts for any expected criteria that have no matching
 * entry in the provided verdicts array.
 *
 * This function does NOT produce a final pass/fail decision — it only fills
 * coverage gaps so downstream consumers always have a verdict for every expected
 * criterion.
 *
 * @param expected - Full inventory of expected criteria.
 * @param verdicts - Verdicts already produced by the PRD validator.
 * @returns A combined array with validator verdicts first, followed by synthesized
 *   `unknown` verdicts for any unmatched criteria.
 */
export function synthesizeMissingVerdicts(
  expected: readonly ExpectedAcceptanceCriterion[],
  verdicts: readonly AcceptanceCriterionVerdict[],
): AcceptanceCriterionVerdict[] {
  const matched = matchVerdictsToExpected(expected, verdicts);
  const synthesized: AcceptanceCriterionVerdict[] = [];

  for (const [id, verdict] of matched) {
    if (verdict === undefined) {
      const criterion = expected.find((e) => e.id === id)!;
      synthesized.push({
        criterion: criterion.text,
        verdict: 'unknown',
        evidence: `Validator did not provide evidence for expected criterion ${id}: ${criterion.text}`,
      });
    }
  }

  return [...verdicts, ...synthesized];
}
