import { createHash } from 'node:crypto';
import { extractExpectedAcceptanceCriteria, normalizeCriterionText, type ExpectedAcceptanceCriterion } from '../../validation/acceptance-criteria.js';

export interface MarkdownLine { line: number; text: string; startByte: number; endByte: number; headingPath: string[] }
export interface RequirementRecord { id: string; text: string; raw: string; line: number; headingPath: string[]; byteLength: number; subsystemHints: string[]; interfaceKeys: string[]; sharedFileKeys: string[]; evidence: string }

const SUBSYSTEMS = ['engine', 'client', 'console', 'cli', 'input', 'test', 'docs', 'plugin', 'pi', 'monitor', 'web', 'scopes'];
const INTERFACE_PATTERNS: Array<[string, RegExp]> = [
  ['event-schemas', /event\s+schema|event\s+variant|wire\s+event/i],
  ['config-contract', /config\s+contract|configuration\s+schema|compile\.planningUnit|planningUnit/i],
  ['route-contracts', /route\s+constant|api\s+route|\/api\//i],
  ['client-api', /client\s+api|@eforge-build\/client|daemon\s+http\s+client/i],
  ['data-model', /data\s+model|shared\s+model|wire\s+shape/i],
];

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
    byteLength: Math.max(1, line.endByte - line.startByte),
    subsystemHints,
    interfaceKeys: inferInterfaceKeys(criterion.text),
    sharedFileKeys: inferSharedFileKeys(criterion.text),
    evidence: boundEvidence(criterion.text),
  };
}

export function inferSubsystemHints(value: string): string[] {
  const lower = value.toLowerCase();
  const hits = SUBSYSTEMS.filter((name) => new RegExp(`\\b${name}\\b|packages/${name}|${name}-`, 'i').test(lower));
  return [...new Set(hits.length > 0 ? hits : ['general'])].sort();
}

export function inferInterfaceKeys(value: string): string[] {
  return INTERFACE_PATTERNS.filter(([, pattern]) => pattern.test(value)).map(([key]) => key).sort();
}

export function inferSharedFileKeys(value: string): string[] {
  const paths = new Set<string>();
  for (const match of value.matchAll(/(?:packages|test|web|eforge-plugin|docs)\/[A-Za-z0-9._/-]+/g)) {
    paths.add(match[0].replace(/[),.;:]+$/g, ''));
  }
  return [...paths].sort();
}
