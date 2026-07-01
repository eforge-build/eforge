import { createHash } from 'node:crypto';
import { extractExpectedAcceptanceCriteria, normalizeCriterionText, type ExpectedAcceptanceCriterion } from '../validation/acceptance-criteria.js';

export interface MarkdownLine { line: number; text: string; startByte: number; endByte: number; headingPath: string[] }
export interface RequirementRecord { id: string; text: string; raw: string; line: number; headingPath: string[]; byteStart: number; byteEnd: number; byteLength: number; subsystemHints: string[]; interfaceKeys: string[]; sharedFileKeys: string[]; evidence: string }

// --- eforge:region plan-01-source-localization-foundation ---
const GENERIC_SURFACE_TERMS = ['manifest', 'entrypoint', 'schema', 'contract', 'route', 'command', 'ui', 'docs', 'test', 'plugin', 'extension', 'config', 'api'];
const PATH_LIKE_RE = /(?:\.\/)?[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+/g;
const INTERFACE_PATTERNS: Array<[string, RegExp]> = [
  ['schema-contract', /\b(?:schema|contract|interface)s?\b|\bwire\s+shape\b|\bdata\s+model\b/i],
  ['configuration', /\b(?:config(?:uration)?|settings|options)\b/i],
  ['route-api', /\b(?:route|endpoint)s?\b|\bapi\s+surface\b|\/api\//i],
  ['command-surface', /\b(?:command|cli|handler)s?\b/i],
  ['ui-surface', /\b(?:ui|component|view|page|screen)s?\b/i],
  ['extension-surface', /\b(?:plugin|extension|contribution|hook)s?\b/i],
];
// --- eforge:endregion plan-01-source-localization-foundation ---

export function utf8ByteLength(value: string): number { return new TextEncoder().encode(value).length; }
export function hashText(value: string): string { return createHash('sha256').update(value).digest('hex'); }
export function boundEvidence(value: string, max = 280): string { return value.length <= max ? value : `${value.slice(0, max - 1)}…`; }
export function stableSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'general';
}

export function parseMarkdownLines(content: string): MarkdownLine[] {
  const lines = content.split('\n');
  const headings: string[] = [];
  let cursor = 0;
  return lines.map((text, index) => {
    const startByte = cursor;
    const lineBytes = utf8ByteLength(text);
    cursor += lineBytes + 1;
    const match = /^(#{1,6})\s+(.+)$/.exec(text.trim());
    if (match) {
      const depth = match[1].length;
      headings.splice(depth - 1);
      headings[depth - 1] = match[2].trim();
    }
    return { line: index + 1, text, startByte, endByte: startByte + lineBytes, headingPath: headings.filter(Boolean) };
  });
}

export function analyzePlanningSource(content: string): RequirementRecord[] {
  const criteria = extractExpectedAcceptanceCriteria(content, { allowFallbackSections: true });
  const lines = parseMarkdownLines(content);
  const usedLines = new Set<number>();
  return criteria.map((criterion) => locateRequirement(criterion, lines, usedLines));
}

function locateRequirement(criterion: ExpectedAcceptanceCriterion, lines: MarkdownLine[], usedLines: Set<number>): RequirementRecord {
  const rawNorm = normalizeCriterionText(criterion.raw);
  const textNorm = normalizeCriterionText(criterion.text);
  const found = lines.find((line) => !usedLines.has(line.line) && (normalizeCriterionText(line.text) === rawNorm || normalizeCriterionText(line.text).includes(textNorm))) ?? lines.find((line) => !usedLines.has(line.line) && normalizeCriterionText(line.text).includes(textNorm));
  const line = found ?? { line: 1, text: criterion.raw, startByte: 0, endByte: utf8ByteLength(criterion.raw), headingPath: [] };
  usedLines.add(line.line);
  const subsystemHints = inferSubsystemHints(`${criterion.text} ${line.headingPath.join(' ')}`);
  return {
    id: criterion.id,
    text: criterion.text,
    raw: criterion.raw,
    line: line.line,
    headingPath: line.headingPath,
    byteStart: line.startByte,
    byteEnd: line.endByte,
    byteLength: Math.max(1, line.endByte - line.startByte),
    subsystemHints,
    interfaceKeys: inferInterfaceKeys(criterion.text),
    sharedFileKeys: inferSharedFileKeys(criterion.text),
    evidence: boundEvidence(criterion.text),
  };
}

// --- eforge:region plan-01-source-localization-foundation ---
export function inferSubsystemHints(value: string): string[] {
  const lower = value.toLowerCase();
  const hints = new Set<string>();
  for (const term of GENERIC_SURFACE_TERMS) if (new RegExp(`\\b${term}s?\\b`, 'i').test(lower)) hints.add(term);
  for (const pathValue of pathLikeValues(value)) {
    const segments = pathValue.split('/').filter(Boolean);
    for (const segment of meaningfulPathSegments(segments)) hints.add(stableSlug(segment));
  }
  return [...hints].filter((hint) => hint && hint !== 'general').sort().slice(0, 8).concat(hints.size === 0 ? ['general'] : []);
}

export function inferInterfaceKeys(value: string): string[] {
  const keys = new Set(INTERFACE_PATTERNS.filter(([, pattern]) => pattern.test(value)).map(([key]) => key));
  for (const surface of GENERIC_SURFACE_TERMS) if (new RegExp(`\\b${surface}s?\\b`, 'i').test(value)) keys.add(surface);
  return [...keys].sort();
}

export function inferSharedFileKeys(value: string): string[] {
  return pathLikeValues(value).filter((candidate) => candidate.includes('/') && !candidate.endsWith('/')).sort();
}

function pathLikeValues(value: string): string[] {
  return [...new Set([...value.matchAll(PATH_LIKE_RE)].map((match) => match[0].replace(/^\.\//, '').replace(/[),.;:]+$/g, '')))].sort();
}

function meaningfulPathSegments(segments: string[]): string[] {
  const genericContainers = new Set(['packages', 'apps', 'services', 'src', 'lib', 'test', 'tests', 'docs', 'web', 'cmd']);
  return segments
    .map((segment) => segment.replace(/\.[A-Za-z0-9]+$/, ''))
    .filter((segment) => segment.length > 1 && !genericContainers.has(segment) && !/^index|main$/.test(segment));
}
// --- eforge:endregion plan-01-source-localization-foundation ---
