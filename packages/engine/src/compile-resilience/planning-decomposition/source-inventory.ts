import type { CompilePreflightRisk } from '@eforge-build/client';
import type { PipelineComposition } from '../../schemas.js';
import { extractExpectedAcceptanceCriteria, normalizeCriterionText, type ExpectedAcceptanceCriterion } from '../../validation/acceptance-criteria.js';
import { actionableEvidencePaths, extractEvidenceCandidatesFromText, rankEvidenceCandidates, type PlanningEvidenceCandidate } from './evidence-hygiene.js';
import { boundEvidence, hashText, inferInterfaceKeys, inferSubsystemHints, parseMarkdownLines, stableSlug, utf8ByteLength, type MarkdownLine } from './source-analysis.js';

export interface SourceInventoryInput { content: string; hash?: string; path?: string; preflightRisk?: CompilePreflightRisk; pipelineComposition?: PipelineComposition }
export interface SourceInventoryHeading { line: number; depth: number; title: string; path: string[]; byteStart: number; byteEnd: number }
export interface SourceInventoryCriterion { id: string; text: string; raw: string; line: number; headingPath: string[]; byteStart: number; byteEnd: number; byteLength: number; subsystemHints: string[]; interfaceKeys: string[]; evidencePaths: string[]; dependencyHints: string[]; evidence: string }
export interface SourceInventorySummary { sourceHash: string; sourcePath?: string; byteLength: number; lineCount: number; criterionCount: number; headingCount: number; subsystemHints: string[]; actionableEvidenceCount: number }
export interface SourceInventory { sourceHash: string; sourcePath?: string; byteLength: number; lineCount: number; headings: SourceInventoryHeading[]; criteria: SourceInventoryCriterion[]; evidenceCandidates: PlanningEvidenceCandidate[]; subsystemHints: string[]; summary: SourceInventorySummary }

export function deriveSourceInventory(input: SourceInventoryInput): SourceInventory {
  const sourceHash = input.hash ?? hashText(input.content);
  const lines = parseMarkdownLines(input.content);
  const headings = extractHeadings(lines);
  const criteria = locateCriteria(extractExpectedAcceptanceCriteria(input.content, { allowFallbackSections: true }), lines);
  const metadataHints = metadataSubsystemHints(input.preflightRisk, input.pipelineComposition);
  const withMetadata = applyMetadataHints(criteria, metadataHints);
  const evidenceCandidates = rankEvidenceCandidates([
    ...extractEvidenceCandidatesFromText(input.content).map((candidate) => candidate.value),
    ...withMetadata.flatMap((criterion) => criterion.evidencePaths),
  ]);
  const subsystemHints = [...new Set([...withMetadata.flatMap((criterion) => criterion.subsystemHints), ...metadataHints])].sort();
  const byteLength = utf8ByteLength(input.content);
  return {
    sourceHash,
    ...(input.path ? { sourcePath: input.path } : {}),
    byteLength,
    lineCount: lines.length,
    headings,
    criteria: withMetadata,
    evidenceCandidates,
    subsystemHints,
    summary: {
      sourceHash,
      ...(input.path ? { sourcePath: input.path } : {}),
      byteLength,
      lineCount: lines.length,
      criterionCount: withMetadata.length,
      headingCount: headings.length,
      subsystemHints,
      actionableEvidenceCount: evidenceCandidates.filter((candidate) => candidate.actionable).length,
    },
  };
}

function extractHeadings(lines: MarkdownLine[]): SourceInventoryHeading[] {
  return lines.flatMap((line) => {
    const match = /^(#{1,6})\s+(.+)$/.exec(line.text.trim());
    if (!match) return [];
    return [{ line: line.line, depth: match[1].length, title: match[2].trim(), path: line.headingPath, byteStart: line.startByte, byteEnd: line.endByte }];
  });
}

function locateCriteria(criteria: ExpectedAcceptanceCriterion[], lines: MarkdownLine[]): SourceInventoryCriterion[] {
  const usedLines = new Set<number>();
  return criteria.map((criterion) => locateCriterion(criterion, lines, usedLines));
}

function locateCriterion(criterion: ExpectedAcceptanceCriterion, lines: MarkdownLine[], usedLines: Set<number>): SourceInventoryCriterion {
  const rawNorm = normalizeCriterionText(criterion.raw);
  const textNorm = normalizeCriterionText(criterion.text);
  const found = lines.find((line) => !usedLines.has(line.line) && (normalizeCriterionText(line.text) === rawNorm || normalizeCriterionText(line.text).includes(textNorm))) ?? lines.find((line) => !usedLines.has(line.line) && normalizeCriterionText(line.text).includes(textNorm));
  const line = found ?? { line: 1, text: criterion.raw, startByte: 0, endByte: utf8ByteLength(criterion.raw), headingPath: [] };
  usedLines.add(line.line);
  const evidencePaths = actionableEvidencePaths(extractEvidenceCandidatesFromText(`${criterion.text} ${criterion.raw}`).map((candidate) => candidate.value));
  const subsystemHints = inferSubsystemHints(`${criterion.text} ${line.headingPath.join(' ')} ${evidencePaths.join(' ')}`);
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
    evidencePaths,
    dependencyHints: inferDependencyHints(criterion.text),
    evidence: boundEvidence(criterion.text),
  };
}

function metadataSubsystemHints(preflightRisk?: CompilePreflightRisk, pipelineComposition?: PipelineComposition): string[] {
  const preflightHints = preflightRisk?.subsystemBreadth.subsystems ?? [];
  const pipelineHints = preflightHints.length === 0 && pipelineComposition?.scope === 'expedition' ? ['engine', 'client', 'console', 'cli'] : [];
  return [...new Set([...preflightHints, ...pipelineHints].map((hint) => stableSlug(hint)).filter((hint) => hint && hint !== 'general'))].sort();
}

function applyMetadataHints(criteria: SourceInventoryCriterion[], metadataHints: string[]): SourceInventoryCriterion[] {
  if (metadataHints.length === 0) return criteria;
  return criteria.map((criterion, index) => criterion.subsystemHints.length === 0 || (criterion.subsystemHints.length === 1 && criterion.subsystemHints[0] === 'general')
    ? { ...criterion, subsystemHints: [metadataHints[index % metadataHints.length]] }
    : criterion);
}

function inferDependencyHints(value: string): string[] {
  const hints = new Set<string>();
  for (const match of value.matchAll(/(?:depends on|requires|after|blocks|before)\s+`?([A-Za-z0-9._/-]+)`?/gi)) hints.add(match[1].replace(/[),.;:]+$/g, ''));
  return [...hints].sort();
}
