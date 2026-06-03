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
 *   do not affect criterion identity. Verdict matching also ignores harmless
 *   inline Markdown formatting so validator prose does not create false misses.
 * - Blank, placeholder, and sentinel lines are rejected at extraction time.
 */

import type { AcceptanceCriterionVerdict } from '@eforge-build/client';

// ---------------------------------------------------------------------------
// AC quality analysis — inlined here to avoid a dependency on @eforge-build/input
// (the engine must not import from that package per boundary constraints).
// The canonical copy lives in packages/input/src/acceptance-criteria-quality.ts;
// keep these in sync when making changes to the analysis logic.
// ---------------------------------------------------------------------------

/** A diagnostic produced by the AC quality analyzer for a single criterion. */
export interface AcDiagnostic {
  /** Classification of the quality issue. */
  kind: 'grouping-label' | 'bare-command' | 'vague';
  /** The raw line text that triggered the diagnostic (with list markers). */
  line: string;
  /** Human-readable description of the issue. */
  message: string;
  /** Suggestion for how to fix the criterion. */
  suggestion: string;
}

/** Result of analyzing an acceptance criteria section. */
export interface AcQualityResult {
  /** True when no quality issues were found. */
  valid: boolean;
  /** Diagnostics for each criterion that failed quality analysis. */
  diagnostics: AcDiagnostic[];
}

/** Strip common Markdown list markers from the beginning of a string. */
function _stripListMarkersForQuality(text: string): string {
  let s = text.replace(/^\[[ xX]\]\s*/, '');
  s = s.replace(/^\d+[.)]\s+/, '');
  s = s.replace(/^[-*+]\s+/, '');
  s = s.replace(/^\[[ xX]\]\s*/, '');
  return s;
}

/** Normalize a criterion text for quality checks: trim, strip list markers, collapse whitespace. */
function _normalizeLineForQuality(raw: string): string {
  return _stripListMarkersForQuality(raw.trim()).replace(/\s+/g, ' ').trim();
}

function _isGroupingLabel(normalized: string): boolean {
  return normalized.endsWith(':');
}

function _isBareCommand(normalized: string): boolean {
  return /^`[^`]+`\.?\s*$/.test(normalized) || /^run\s+(?:pnpm|npm|yarn|bun)\s+[\w:-]+\.?$/i.test(normalized);
}

const _VAGUE_VERB_RE =
  /^(works?|improves?|handles?|fixes?|addresses?|makes?\s+\w+\s+(?:faster|better|more\s+\w+)|ensures?\s+(?:it\s+works|correct|proper|better)|allows?|supports?|provides?\s+better)\b/i;

function _isVague(normalized: string): boolean {
  if (/`[^`]+`/.test(normalized)) return false;
  if (/[A-Z][a-z]+[A-Z]|[a-z][A-Z]/.test(normalized)) return false;
  if (/\d/.test(normalized)) return false;
  if (/\/|\.(?:[a-z]{2,4})\b/.test(normalized)) return false;
  return _VAGUE_VERB_RE.test(normalized);
}

/**
 * Analyze a single criterion line for quality issues.
 */
export function analyzeAcceptanceCriteriaItem(rawLine: string): AcDiagnostic | null {
  const normalized = _normalizeLineForQuality(rawLine);
  if (normalized === '') return null;

  if (_isGroupingLabel(normalized)) {
    return {
      kind: 'grouping-label',
      line: rawLine,
      message: `"${normalized}" is a grouping label, not a standalone criterion. Acceptance criteria must not use bullets ending in ":" to introduce nested sub-criteria.`,
      suggestion:
        'Replace this grouping label with individual standalone criterion bullets — each a complete, verifiable statement.',
    };
  }

  if (_isBareCommand(normalized)) {
    return {
      kind: 'bare-command',
      line: rawLine,
      message: `"${normalized}" is a bare command fragment. Acceptance criteria must state the expected outcome, not just a command to run.`,
      suggestion:
        'Append the expected outcome after the command, e.g., change "`pnpm type-check`." to "`pnpm type-check` exits 0."',
    };
  }

  if (_isVague(normalized)) {
    return {
      kind: 'vague',
      line: rawLine,
      message: `"${normalized}" is too vague to be objectively verified. Acceptance criteria must state a specific, observable behavior or outcome.`,
      suggestion:
        'Replace with a concrete, testable criterion that names a specific behavior, command, event, file, or API response.',
    };
  }

  return null;
}

/**
 * Analyze the text content of an acceptance criteria section for quality issues.
 */
export function analyzeAcceptanceCriteria(content: string): AcQualityResult {
  const diagnostics: AcDiagnostic[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') continue;

    const isBullet = /^[-*+]\s/.test(trimmed);
    const isOrdered = /^\d+[.)]\s/.test(trimmed);
    const isCheckbox = /^\[[ xX]\]/.test(trimmed);
    if (!isBullet && !isOrdered && !isCheckbox) continue;

    const diagnostic = analyzeAcceptanceCriteriaItem(trimmed);
    if (diagnostic) {
      diagnostics.push(diagnostic);
    }
  }

  return { valid: diagnostics.length === 0, diagnostics };
}

const _AC_HEADING_NAMES_LOWER_FOR_QUALITY = ['acceptance criteria', 'acs'];

/**
 * Extract and analyze the acceptance criteria section content from a full PRD body.
 */
export function analyzeAcceptanceCriteriaInBody(body: string): AcQualityResult | null {
  const lines = body.split('\n');
  let inSection = false;
  let sectionDepth: number | null = null;
  const sectionLines: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const depth = headingMatch[1].length;
      const headingText = headingMatch[2].trim().toLowerCase();

      if (!inSection) {
        if (_AC_HEADING_NAMES_LOWER_FOR_QUALITY.includes(headingText)) {
          inSection = true;
          sectionDepth = depth;
        }
      } else {
        if (depth <= sectionDepth!) break;
      }
    } else if (inSection) {
      sectionLines.push(line);
    }
  }

  if (!inSection) return null;
  return analyzeAcceptanceCriteria(sectionLines.join('\n'));
}

/**
 * Format AC diagnostics into a human-readable summary suitable for error messages.
 */
export function formatAcDiagnostics(diagnostics: AcDiagnostic[]): string {
  if (diagnostics.length === 0) return '';
  const lines = [
    `Acceptance criteria quality issues (${diagnostics.length}):`,
    ...diagnostics.map((d, i) => `  ${i + 1}. [${d.kind}] ${d.message}\n     Fix: ${d.suggestion}`),
  ];
  return lines.join('\n');
}

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
 * Normalize text for matching validator verdicts back to expected criteria.
 *
 * This intentionally goes a little further than `normalizeCriterionText`: an
 * LLM may preserve the criterion wording while dropping harmless inline
 * Markdown (for example `` `/eforge:plan` `` → `/eforge:plan`). Treat those as
 * the same criterion without relaxing into semantic/fuzzy matching.
 */
export function normalizeCriterionMatchText(raw: string): string {
  return normalizeCriterionText(raw)
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
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
 *
 * When `listItemsOnly` is true, only lines that look like bullet, ordered-list,
 * or checklist items are collected. This prevents introductory prose lines such as
 * "The implementation is accepted when:" from becoming required criteria.
 */
function linesToCriteria(lines: string[], startIndex = 1, listItemsOnly = false): ExpectedAcceptanceCriterion[] {
  const criteria: ExpectedAcceptanceCriterion[] = [];
  let counter = startIndex;

  for (const raw of lines) {
    const trimmed = raw.trim();
    // Skip blank lines
    if (trimmed === '') continue;
    // Skip sub-headings inside the section
    if (headingDepth(trimmed) !== null) continue;

    if (listItemsOnly) {
      const isBullet = /^[-*+]\s/.test(trimmed);
      const isOrdered = /^\d+[.)]\s/.test(trimmed);
      const isCheckbox = /^\[[ xX]\]/.test(trimmed);
      if (!isBullet && !isOrdered && !isCheckbox) continue;
    }

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
    return linesToCriteria(acLines, 1, true);
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
 * Each verdict can satisfy at most one expected criterion. Exact criterion ID
 * matches are preferred; remaining criteria are matched by normalized text.
 * Consumed verdicts are not reused for subsequent criteria.
 *
 * Returns a map from expected criterion ID to the matching verdict, or
 * `undefined` when no verdict matches the criterion.
 */
export function matchVerdictsToExpected(
  expected: readonly ExpectedAcceptanceCriterion[],
  verdicts: readonly AcceptanceCriterionVerdict[],
): Map<string, AcceptanceCriterionVerdict | undefined> {
  const result = new Map<string, AcceptanceCriterionVerdict | undefined>();
  const consumed = new Set<number>();

  // Pass 1: criterion ID matches. Accept either a bare ID (`ac-001`) or an
  // ID-prefixed field (`ac-001: original criterion text`) so the validator can
  // be prompted with stable IDs without exact output formatting becoming brittle.
  for (const criterion of expected) {
    const idx = verdicts.findIndex((v, i) => {
      if (consumed.has(i)) return false;
      const trimmed = v.criterion.trim();
      return trimmed === criterion.id || trimmed.startsWith(`${criterion.id}:`);
    });
    if (idx !== -1) {
      result.set(criterion.id, verdicts[idx]);
      consumed.add(idx);
    }
  }

  // Pass 2: normalized text matches for criteria not yet matched. Ignore only
  // harmless Markdown formatting; do not use semantic or substring matching.
  for (const criterion of expected) {
    if (result.has(criterion.id)) continue;
    const expectedText = normalizeCriterionMatchText(criterion.text);
    const idx = verdicts.findIndex((v, i) => !consumed.has(i) && normalizeCriterionMatchText(v.criterion) === expectedText);
    if (idx !== -1) {
      result.set(criterion.id, verdicts[idx]);
      consumed.add(idx);
    } else {
      result.set(criterion.id, undefined);
    }
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
