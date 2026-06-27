import type { SectionUpsert } from '../sqlite/index.js';

export interface ItemSectionOperation { heading: string; action: 'replace' | 'append'; content: string }
export interface PatchItemBodySectionsInput { title?: string; sections?: Record<string, string>; sectionOperations?: ItemSectionOperation[] }
export interface PatchItemBodySectionsResult { body: string; changedSections: string[] }

const KNOWN_SECTION_HEADINGS = new Map<string, string>([
  ['claim', 'Claim'],
  ['evidence', 'Evidence'],
  ['acceptancecriteria', 'Acceptance Criteria'],
  ['acceptance criteria', 'Acceptance Criteria'],
  ['acceptance-criteria', 'Acceptance Criteria'],
  ['acceptance_criteria', 'Acceptance Criteria'],
  ['recheck', 'Recheck'],
  ['notes', 'Notes'],
]);
const CANONICAL_KNOWN_HEADINGS = new Set(['Claim', 'Evidence', 'Acceptance Criteria', 'Recheck', 'Notes']);

export function normalizeItemSectionHeading(heading: string): string {
  const trimmed = heading.trim();
  return KNOWN_SECTION_HEADINGS.get(trimmed.replace(/\s+/gu, ' ').toLowerCase()) ?? trimmed;
}

export function patchItemBodySections(body: string, input: PatchItemBodySectionsInput): PatchItemBodySectionsResult {
  let next = input.title !== undefined ? renderItemTitle(body, input.title) : body;
  assertValidTitle(input.title);
  assertNoDuplicateCanonicalSections(next);
  assertNoDuplicateCanonicalSectionReplacements(input.sections ?? {});
  for (const operation of input.sectionOperations ?? []) assertValidOperation(operation);
  const changedSections: string[] = [];
  for (const [heading, content] of Object.entries(input.sections ?? {})) {
    const canonical = normalizeValidSectionHeading(heading);
    next = applySectionOperation(next, { heading: canonical, action: 'replace', content });
    changedSections.push(canonical);
  }
  for (const operation of input.sectionOperations ?? []) {
    assertValidOperation(operation);
    const canonical = normalizeValidSectionHeading(operation.heading);
    next = applySectionOperation(next, { heading: canonical, action: operation.action, content: operation.content });
    changedSections.push(canonical);
  }
  assertNoDuplicateCanonicalSections(next);
  return { body: next, changedSections: uniqueInOrder(changedSections) };
}

export function deriveItemSectionRows(body: string): SectionUpsert[] {
  const parsed = parseSections(body);
  assertNoDuplicateCanonicalParsedSections(parsed);
  return parsed.map((section) => ({ sectionName: section.canonicalHeading, content: section.content.trim() }));
}

function renderItemTitle(body: string, title: string): string {
  assertValidTitle(title);
  const lines = splitLinesPreservingEndings(body);
  const firstH1 = lines.findIndex((line) => /^#\s+.+\s*\r?\n?$/u.test(line));
  if (firstH1 === -1) return `# ${title}\n\n${body}`;
  const newline = lines[firstH1].endsWith('\r\n') ? '\r\n' : lines[firstH1].endsWith('\n') ? '\n' : '';
  lines[firstH1] = `# ${title}${newline}`;
  return lines.join('');
}

interface ParsedSection { start: number; end: number; heading: string; canonicalHeading: string; content: string }

function parseSections(body: string): ParsedSection[] {
  const lines = splitLinesPreservingEndings(body);
  const headings: Array<{ index: number; heading: string; canonicalHeading: string }> = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(#{2,6})\s+(.+?)\s*\r?\n?$/u.exec(lines[index]);
    if (match) {
      const heading = match[2].trim();
      headings.push({ index, heading, canonicalHeading: normalizeItemSectionHeading(heading) });
    }
  }
  return headings.map((heading, position) => {
    const start = heading.index;
    const end = headings[position + 1]?.index ?? lines.length;
    return { start, end, heading: heading.heading, canonicalHeading: heading.canonicalHeading, content: lines.slice(start + 1, end).join('') };
  });
}

function applySectionOperation(body: string, operation: ItemSectionOperation): string {
  const heading = normalizeValidSectionHeading(operation.heading);
  const lines = splitLinesPreservingEndings(body);
  const sections = parseSections(body);
  const existing = sections.find((section) => section.canonicalHeading === heading || (!isKnownCanonicalHeading(heading) && section.heading === heading));
  if (!existing) return appendNewSection(body, heading, operation.content);
  const beforeHeading = lines.slice(0, existing.start).join('');
  const afterSection = lines.slice(existing.end).join('');
  const headingLine = renderSectionHeadingLine(lines[existing.start], heading);
  const currentContent = existing.content.trim();
  const operationContent = operation.content.trim();
  const content = operation.action === 'replace' || currentContent.length === 0 ? operationContent : `${currentContent}\n\n${operationContent}`;
  return `${beforeHeading}${headingLine}\n${content}\n${afterSection.startsWith('\n') || afterSection.length === 0 ? '' : '\n'}${afterSection}`;
}

function appendNewSection(body: string, heading: string, content: string): string {
  return `${body.trimEnd()}\n\n## ${heading}\n\n${content.trim()}\n`;
}

function renderSectionHeadingLine(existingLine: string, heading: string): string {
  const match = /^(#{2,6})/u.exec(existingLine);
  const level = match?.[1] ?? '##';
  const newline = existingLine.endsWith('\r\n') ? '\r\n' : existingLine.endsWith('\n') ? '\n' : '';
  return `${level} ${heading}${newline}`;
}

function normalizeValidSectionHeading(heading: string): string {
  const normalized = normalizeItemSectionHeading(heading);
  if (normalized.length === 0 || normalized.includes('\n') || normalized.includes('\r') || normalized.startsWith('#')) throw new Error('Section heading must be non-empty, single-line, and must not begin with #.');
  return normalized;
}

function assertValidOperation(operation: ItemSectionOperation): void {
  normalizeValidSectionHeading(operation.heading);
  if (operation.action !== 'replace' && operation.action !== 'append') throw new Error('Section operation action must be "replace" or "append".');
  if (typeof operation.content !== 'string') throw new Error('Section operation content must be a string.');
}

function assertNoDuplicateCanonicalSectionReplacements(sections: Record<string, string>): void {
  const seen = new Set<string>();
  for (const heading of Object.keys(sections)) {
    const canonical = normalizeValidSectionHeading(heading);
    if (seen.has(canonical)) throw new Error(`Duplicate section replacement for ${canonical}.`);
    seen.add(canonical);
  }
}

function assertNoDuplicateCanonicalSections(body: string): void {
  assertNoDuplicateCanonicalParsedSections(parseSections(body));
}

function assertNoDuplicateCanonicalParsedSections(sections: readonly ParsedSection[]): void {
  const seen = new Set<string>();
  for (const section of sections) {
    if (seen.has(section.canonicalHeading)) throw new Error(`Duplicate section ${section.canonicalHeading}.`);
    seen.add(section.canonicalHeading);
  }
}

function assertValidTitle(title: string | undefined): void {
  if (title === undefined) return;
  if (title.trim().length === 0 || title.includes('\n') || title.includes('\r')) throw new Error('Title must be a non-empty single-line backlog title.');
}

function isKnownCanonicalHeading(heading: string): boolean {
  return CANONICAL_KNOWN_HEADINGS.has(heading);
}

function splitLinesPreservingEndings(value: string): string[] {
  const matches = value.match(/.*(?:\r?\n|$)/gu) ?? [];
  return matches.filter((line, index) => line.length > 0 || index < matches.length - 1);
}

function uniqueInOrder(values: readonly string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => (seen.has(value) ? false : (seen.add(value), true)));
}
