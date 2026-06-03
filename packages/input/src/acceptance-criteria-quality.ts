/**
 * Acceptance criteria quality analyzer.
 *
 * Detects malformed acceptance criteria: grouping labels, bare command fragments,
 * and vague/unverifiable criteria. Used by session-plan readiness and engine
 * enqueue gates to prevent poorly-specified criteria from entering the build queue.
 *
 * This module is intentionally dependency-free (no workspace imports) so it can
 * be used by both @eforge-build/input and re-exported by @eforge-build/engine
 * without introducing circular dependencies.
 */

// ---------------------------------------------------------------------------
// Types
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

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Strip common Markdown list markers from the beginning of a string. */
function stripListMarkers(text: string): string {
  let s = text.replace(/^\[[ xX]\]\s*/, '');
  s = s.replace(/^\d+[.)]\s+/, '');
  s = s.replace(/^[-*+]\s+/, '');
  s = s.replace(/^\[[ xX]\]\s*/, '');
  return s;
}

/** Normalize a criterion text: trim, strip list markers, collapse whitespace. */
function normalizeLine(raw: string): string {
  return stripListMarkers(raw.trim()).replace(/\s+/g, ' ').trim();
}

/**
 * Returns true when the text is a grouping label — a bullet that ends with `:`
 * (possibly with trailing whitespace), indicating it is a header for a
 * nested list of sub-criteria rather than a standalone criterion.
 *
 * Examples:
 *   - `Tests cover:` → grouping label
 *   - `Targeted validation passes:` → grouping label
 */
function isGroupingLabel(normalized: string): boolean {
  return normalized.endsWith(':');
}

/**
 * Returns true when the text is a bare command fragment — the entire criterion
 * consists of a single backtick code span with no meaningful outcome after it
 * (only whitespace or a lone period).
 *
 * Examples:
 *   - `` `pnpm type-check`. `` → bare command (only trailing period)
 *   - `` `pnpm type-check` exits 0. `` → NOT bare (meaningful outcome follows)
 */
function isBareCommand(normalized: string): boolean {
  return /^`[^`]+`\.?\s*$/.test(normalized) || /^run\s+(?:pnpm|npm|yarn|bun)\s+[\w:-]+\.?$/i.test(normalized);
}

/**
 * Generic outcome verbs that indicate vague criteria when they appear as the
 * first meaningful word of a criterion with no concrete specifics.
 */
const VAGUE_VERB_RE = /^(works?|improves?|handles?|fixes?|addresses?|makes?\s+\w+\s+(?:faster|better|more\s+\w+)|ensures?\s+(?:it\s+works|correct|proper|better)|allows?|supports?|provides?\s+better)\b/i;

/**
 * Returns true when the criterion is vague — it uses generic outcome language
 * without specifying a concrete verifiable behavior.
 *
 * A criterion is considered concrete (and never flagged as vague) when it contains:
 * - A backtick code span (specific command or identifier)
 * - CamelCase/PascalCase identifiers
 * - Digits
 * - File path patterns (containing `/` or a file extension pattern)
 *
 * Examples:
 *   - `Works correctly.` → vague
 *   - `Improves reliability.` → vague
 *   - `Type checking passes.` → NOT vague (contains technical signal word)
 *   - `` `pnpm type-check` exits 0. `` → NOT vague (has code span)
 */
function isVague(normalized: string): boolean {
  // Has backtick code spans → concrete
  if (/`[^`]+`/.test(normalized)) return false;
  // Has CamelCase/PascalCase identifiers → concrete
  if (/[A-Z][a-z]+[A-Z]|[a-z][A-Z]/.test(normalized)) return false;
  // Has digit → concrete
  if (/\d/.test(normalized)) return false;
  // Has file path or extension pattern → concrete
  if (/\/|\.(?:[a-z]{2,4})\b/.test(normalized)) return false;
  // Check for vague verb pattern
  return VAGUE_VERB_RE.test(normalized);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Analyze a single criterion line for quality issues.
 *
 * Only list-item lines (bullet, ordered, checklist) are meaningful inputs here.
 * Passing non-list prose will return null (no diagnostic).
 *
 * @param rawLine - The raw line text (with list markers if any).
 * @returns A diagnostic when a quality issue is found, or `null` when valid.
 */
export function analyzeAcceptanceCriteriaItem(rawLine: string): AcDiagnostic | null {
  const normalized = normalizeLine(rawLine);
  if (normalized === '') return null;

  if (isGroupingLabel(normalized)) {
    return {
      kind: 'grouping-label',
      line: rawLine,
      message: `"${normalized}" is a grouping label, not a standalone criterion. Acceptance criteria must not use bullets ending in ":" to introduce nested sub-criteria.`,
      suggestion: 'Replace this grouping label with individual standalone criterion bullets — each a complete, verifiable statement.',
    };
  }

  if (isBareCommand(normalized)) {
    return {
      kind: 'bare-command',
      line: rawLine,
      message: `"${normalized}" is a bare command fragment. Acceptance criteria must state the expected outcome, not just a command to run.`,
      suggestion: 'Append the expected outcome after the command, e.g., change "`pnpm type-check`." to "`pnpm type-check` exits 0."',
    };
  }

  if (isVague(normalized)) {
    return {
      kind: 'vague',
      line: rawLine,
      message: `"${normalized}" is too vague to be objectively verified. Acceptance criteria must state a specific, observable behavior or outcome.`,
      suggestion: 'Replace with a concrete, testable criterion that names a specific behavior, command, event, file, or API response.',
    };
  }

  return null;
}

/**
 * Analyze the text content of an acceptance criteria section for quality issues.
 *
 * Only list-item lines (bullet, ordered, checklist) are analyzed. Prose, blank
 * lines, and sub-headings are skipped.
 *
 * @param content - The trimmed text content of the Acceptance Criteria section
 *   (without the heading line itself).
 * @returns An `AcQualityResult` with `valid: true` when no issues are found.
 */
export function analyzeAcceptanceCriteria(content: string): AcQualityResult {
  const diagnostics: AcDiagnostic[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') continue;

    // Only analyze list-item lines
    const isBullet = /^[-*+]\s/.test(trimmed);
    const isOrdered = /^\d+[.)]\s/.test(trimmed);
    const isCheckbox = /^\[[ xX]\]/.test(trimmed);
    if (!isBullet && !isOrdered && !isCheckbox) continue;

    const diagnostic = analyzeAcceptanceCriteriaItem(trimmed);
    if (diagnostic) {
      diagnostics.push(diagnostic);
    }
  }

  return {
    valid: diagnostics.length === 0,
    diagnostics,
  };
}

/**
 * Heading names that mark an acceptance criteria section in a PRD or plan body.
 * Must stay in sync with the extractor in acceptance-criteria.ts.
 */
const AC_HEADING_NAMES_LOWER = ['acceptance criteria', 'acceptance criteria', 'acs'];

/**
 * Extract and analyze the acceptance criteria section content from a full PRD body.
 *
 * Looks for the first heading matching known AC heading names, extracts its
 * content up to the next heading of equal or lesser depth, then runs the quality
 * analyzer on the extracted content.
 *
 * @param body - Full markdown body of the PRD or session plan.
 * @returns An `AcQualityResult` when an AC section is found, or `null` when no
 *   AC section exists (no gate to apply).
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
        if (AC_HEADING_NAMES_LOWER.includes(headingText)) {
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
 *
 * @param diagnostics - Non-empty array of diagnostics from `analyzeAcceptanceCriteria`.
 * @returns A multi-line string describing the issues and how to fix them.
 */
export function formatAcDiagnostics(diagnostics: AcDiagnostic[]): string {
  if (diagnostics.length === 0) return '';
  const lines = [
    `Acceptance criteria quality issues (${diagnostics.length}):`,
    ...diagnostics.map(
      (d, i) => `  ${i + 1}. [${d.kind}] ${d.message}\n     Fix: ${d.suggestion}`,
    ),
  ];
  return lines.join('\n');
}
