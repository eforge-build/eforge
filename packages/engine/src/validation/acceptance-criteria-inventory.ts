import { analyzeAcceptanceCriteriaItem, normalizeCriterionText, type ExpectedAcceptanceCriterion } from './acceptance-criteria.js';

export const AC_INVENTORY_VERSION = 1;
export const AC_EXTRACTION_MIN_CONFIDENCE = 0.7;

export interface CanonicalAcceptanceCriterion extends ExpectedAcceptanceCriterion {
  sourceQuote: string;
  confidence: number;
  warnings?: string[];
}

export interface CanonicalAcceptanceCriteriaInventory {
  version: typeof AC_INVENTORY_VERSION;
  criteria: CanonicalAcceptanceCriterion[];
  warnings?: string[];
}

export interface AcceptanceInventoryDiagnostic {
  kind: 'invalid-json' | 'invalid-schema' | 'empty' | 'blank-text' | 'missing-source-quote' | 'ungrounded-source-quote' | 'low-confidence' | 'duplicate' | 'quality' | 'invalid-id' | 'multiple-blocks' | 'missing-block';
  message: string;
  path?: string;
}

export interface AcceptanceInventoryValidationOptions {
  allowNoAcceptanceCriteria?: boolean;
  requireIds?: boolean;
}

export type AcceptanceInventoryValidationResult =
  | { valid: true; inventory: CanonicalAcceptanceCriteriaInventory }
  | { valid: false; diagnostics: AcceptanceInventoryDiagnostic[] };

const BLOCK_START = '<!-- eforge:acceptance-criteria-inventory';
const BLOCK_END = 'eforge:end-acceptance-criteria-inventory -->';
const BLOCK_RE = /<!-- eforge:acceptance-criteria-inventory\s*\n([\s\S]*?)\n\s*eforge:end-acceptance-criteria-inventory -->/g;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function parseJsonObject(text: string): { value?: unknown; diagnostic?: AcceptanceInventoryDiagnostic } {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i);
  const jsonText = fenced ? fenced[1].trim() : trimmed;
  try {
    return { value: JSON.parse(jsonText) };
  } catch (err) {
    return { diagnostic: { kind: 'invalid-json', message: `Acceptance criteria inventory JSON is invalid: ${err instanceof Error ? err.message : String(err)}` } };
  }
}

function stripYamlFrontmatter(markdown: string): string {
  return markdown.replace(/^\s*---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
}

/**
 * Normalize text for sourceQuote grounding comparisons. Applied to both the
 * PRD body and each criterion's sourceQuote so cosmetic differences (line
 * wrapping, smart quotes, backticks) never break grounding.
 */
export function normalizeGroundingText(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeGrounding(text: string): string {
  return normalizeGroundingText(stripAcceptanceCriteriaInventoryBlock(stripYamlFrontmatter(text)));
}

function pathFor(index: number, field?: string): string {
  return field ? `criteria[${index}].${field}` : `criteria[${index}]`;
}

function expectedId(index: number): string {
  return `ac-${String(index + 1).padStart(3, '0')}`;
}

function coerceWarnings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const warnings = value.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map((item) => item.trim());
  return warnings.length > 0 ? warnings : undefined;
}

export function validateCanonicalAcceptanceCriteriaInventory(
  value: unknown,
  source: string,
  options: AcceptanceInventoryValidationOptions = {},
): AcceptanceInventoryValidationResult {
  const diagnostics: AcceptanceInventoryDiagnostic[] = [];
  const root = asRecord(value);
  if (!root) {
    return { valid: false, diagnostics: [{ kind: 'invalid-schema', message: 'Acceptance criteria inventory must be a JSON object.' }] };
  }
  if (root.version !== AC_INVENTORY_VERSION) {
    diagnostics.push({ kind: 'invalid-schema', message: `Acceptance criteria inventory version must be ${AC_INVENTORY_VERSION}.`, path: 'version' });
  }
  if (!Array.isArray(root.criteria)) {
    diagnostics.push({ kind: 'invalid-schema', message: 'Acceptance criteria inventory must contain a criteria array.', path: 'criteria' });
    return { valid: false, diagnostics };
  }
  if (root.criteria.length === 0 && !options.allowNoAcceptanceCriteria) {
    diagnostics.push({ kind: 'empty', message: 'Acceptance criteria inventory is empty.' });
  }

  const groundedSource = normalizeGrounding(source);
  const seen = new Map<string, number>();
  const criteria: CanonicalAcceptanceCriterion[] = [];

  root.criteria.forEach((rawItem, index) => {
    const item = asRecord(rawItem);
    if (!item) {
      diagnostics.push({ kind: 'invalid-schema', message: 'Criterion must be an object.', path: pathFor(index) });
      return;
    }

    if (options.requireIds) {
      const id = typeof item.id === 'string' ? item.id.trim() : '';
      if (id !== expectedId(index)) {
        diagnostics.push({ kind: 'invalid-id', message: `Criterion id must be ${expectedId(index)}.`, path: pathFor(index, 'id') });
      }
    }

    const rawText = typeof item.raw === 'string' && item.raw.trim() !== '' ? item.raw : item.text;
    const text = typeof item.text === 'string' ? normalizeCriterionText(item.text) : '';
    const raw = typeof rawText === 'string' ? rawText.trim() : '';
    if (text === '') {
      diagnostics.push({ kind: 'blank-text', message: 'Criterion text must not be blank.', path: pathFor(index, 'text') });
    }

    const sourceQuote = typeof item.sourceQuote === 'string' ? item.sourceQuote.trim() : '';
    if (sourceQuote === '') {
      diagnostics.push({ kind: 'missing-source-quote', message: 'Criterion must include a non-blank sourceQuote.', path: pathFor(index, 'sourceQuote') });
    } else if (!groundedSource.includes(normalizeGroundingText(sourceQuote))) {
      diagnostics.push({ kind: 'ungrounded-source-quote', message: 'Criterion sourceQuote must appear in the formatted PRD body.', path: pathFor(index, 'sourceQuote') });
    }

    const confidence = typeof item.confidence === 'number' ? item.confidence : Number.NaN;
    if (!Number.isFinite(confidence) || confidence < AC_EXTRACTION_MIN_CONFIDENCE) {
      diagnostics.push({ kind: 'low-confidence', message: `Criterion confidence must be at least ${AC_EXTRACTION_MIN_CONFIDENCE}.`, path: pathFor(index, 'confidence') });
    }

    if (text !== '') {
      const duplicateOf = seen.get(text.toLowerCase());
      if (duplicateOf !== undefined) {
        diagnostics.push({ kind: 'duplicate', message: `Criterion duplicates criteria[${duplicateOf}].`, path: pathFor(index, 'text') });
      } else {
        seen.set(text.toLowerCase(), index);
      }
      const qualityDiagnostic = analyzeAcceptanceCriteriaItem(`- ${text}`);
      if (qualityDiagnostic) {
        diagnostics.push({ kind: 'quality', message: qualityDiagnostic.message, path: pathFor(index, 'text') });
      }
    }

    criteria.push({
      id: expectedId(index),
      text,
      raw,
      sourceQuote,
      confidence: Number.isFinite(confidence) ? confidence : 0,
      ...(coerceWarnings(item.warnings) ? { warnings: coerceWarnings(item.warnings) } : {}),
    });
  });

  if (diagnostics.length > 0) return { valid: false, diagnostics };
  return { valid: true, inventory: { version: AC_INVENTORY_VERSION, criteria, ...(coerceWarnings(root.warnings) ? { warnings: coerceWarnings(root.warnings) } : {}) } };
}

export function formatAcceptanceInventoryDiagnostics(diagnostics: readonly AcceptanceInventoryDiagnostic[]): string {
  if (diagnostics.length === 0) return '';
  return [
    `Acceptance criteria inventory issues (${diagnostics.length}):`,
    ...diagnostics.map((diagnostic, index) => `  ${index + 1}. [${diagnostic.kind}]${diagnostic.path ? ` ${diagnostic.path}:` : ''} ${diagnostic.message}`),
  ].join('\n');
}

function invalidInventoryError(diagnostics: AcceptanceInventoryDiagnostic[]): Error {
  return new Error(formatAcceptanceInventoryDiagnostics(diagnostics));
}

export function appendAcceptanceCriteriaInventoryBlock(body: string, inventory: CanonicalAcceptanceCriteriaInventory): string {
  const cleanBody = stripAcceptanceCriteriaInventoryBlock(body).trimEnd();
  const json = JSON.stringify(inventory);
  return `${cleanBody}\n\n${BLOCK_START}\n${json}\n${BLOCK_END}\n`;
}

export function readAcceptanceCriteriaInventoryBlock(markdown: string): string | null {
  const startCount = markdown.split(BLOCK_START).length - 1;
  const endCount = markdown.split(BLOCK_END).length - 1;
  const matches = [...markdown.matchAll(BLOCK_RE)];
  if (startCount === 0 && endCount === 0) return null;
  if (startCount !== 1 || endCount !== 1 || matches.length !== 1) {
    const kind = startCount > 1 || endCount > 1 ? 'multiple-blocks' : 'invalid-json';
    const message = kind === 'multiple-blocks'
      ? 'Expected exactly one acceptance criteria inventory block, found multiple; re-enqueue the PRD.'
      : 'Acceptance criteria inventory block is malformed; re-enqueue the PRD.';
    throw invalidInventoryError([{ kind, message }]);
  }
  return matches[0][1].trim();
}

export function stripAcceptanceCriteriaInventoryBlock(markdown: string): string {
  return markdown
    .replace(BLOCK_RE, '')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
}

export function requireAcceptanceCriteriaInventoryFromPrd(
  markdown: string,
  options: AcceptanceInventoryValidationOptions = {},
): CanonicalAcceptanceCriteriaInventory {
  const raw = readAcceptanceCriteriaInventoryBlock(markdown);
  if (raw === null) {
    throw invalidInventoryError([{ kind: 'missing-block', message: 'Queued PRD is missing the canonical acceptance criteria inventory; re-enqueue the PRD.' }]);
  }
  const parsed = parseJsonObject(raw);
  if (parsed.diagnostic) {
    throw invalidInventoryError([{ ...parsed.diagnostic, message: `${parsed.diagnostic.message}; re-enqueue the PRD.` }]);
  }
  const result = validateCanonicalAcceptanceCriteriaInventory(parsed.value, markdown, { ...options, requireIds: true });
  if (!result.valid) {
    throw invalidInventoryError(result.diagnostics.map((diagnostic) => ({ ...diagnostic, message: `${diagnostic.message} re-enqueue the PRD.` })));
  }
  return result.inventory;
}
