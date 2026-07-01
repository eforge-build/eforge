import type { CompilePreflightRisk } from '@eforge-build/client';
import type { PipelineComposition } from '../schemas.js';
import { extractExpectedAcceptanceCriteria, normalizeCriterionText, type ExpectedAcceptanceCriterion } from '../validation/acceptance-criteria.js';
import { actionableEvidencePaths, extractEvidenceCandidatesFromText, rankEvidenceCandidates, type PlanningEvidenceCandidate } from './evidence-hygiene.js';
import { boundEvidence, hashText, inferInterfaceKeys, inferSubsystemHints, parseMarkdownLines, stableSlug, utf8ByteLength, type MarkdownLine } from './source-analysis.js';
import type { SourceLocalizationNeedKind } from './source-localization-contracts.js';

export interface SourceInventoryInput { content: string; hash?: string; path?: string; preflightRisk?: CompilePreflightRisk; pipelineComposition?: PipelineComposition }
export interface SourceInventoryHeading { line: number; depth: number; title: string; path: string[]; byteStart: number; byteEnd: number }
export interface SourceInventoryCriterion { id: string; text: string; raw: string; line: number; headingPath: string[]; byteStart: number; byteEnd: number; byteLength: number; subsystemHints: string[]; interfaceKeys: string[]; evidencePaths: string[]; dependencyHints: string[]; evidence: string }
// --- eforge:region plan-01-source-localization-foundation ---
export interface SourceInventoryGlobalNeed { id: string; kind: SourceLocalizationNeedKind; query: string; criterionIds: string[]; subsystemHints: string[]; interfaceKeys: string[]; reason: string }
export interface SourceInventorySummary { sourceHash: string; sourcePath?: string; byteLength: number; lineCount: number; criterionCount: number; headingCount: number; subsystemHints: string[]; interfaceKeys: string[]; actionableEvidenceCount: number; globalLocalizationNeedCount: number }
export interface SourceInventory { sourceHash: string; sourcePath?: string; byteLength: number; lineCount: number; headings: SourceInventoryHeading[]; criteria: SourceInventoryCriterion[]; evidenceCandidates: PlanningEvidenceCandidate[]; subsystemHints: string[]; interfaceKeys: string[]; globalLocalizationNeeds: SourceInventoryGlobalNeed[]; summary: SourceInventorySummary }
// --- eforge:endregion plan-01-source-localization-foundation ---

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
  const interfaceKeys = [...new Set(withMetadata.flatMap((criterion) => criterion.interfaceKeys))].sort();
  const globalLocalizationNeeds = deriveGlobalLocalizationNeeds(withMetadata, evidenceCandidates, subsystemHints, interfaceKeys);
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
    interfaceKeys,
    globalLocalizationNeeds,
    summary: {
      sourceHash,
      ...(input.path ? { sourcePath: input.path } : {}),
      byteLength,
      lineCount: lines.length,
      criterionCount: withMetadata.length,
      headingCount: headings.length,
      subsystemHints,
      interfaceKeys,
      actionableEvidenceCount: evidenceCandidates.filter((candidate) => candidate.actionable).length,
      globalLocalizationNeedCount: globalLocalizationNeeds.length,
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

function metadataSubsystemHints(preflightRisk?: CompilePreflightRisk, _pipelineComposition?: PipelineComposition): string[] {
  const preflightHints: string[] = preflightRisk?.subsystemBreadth.subsystems ?? [];
  return [...new Set(preflightHints.map((hint) => stableSlug(hint)).filter((hint) => hint && hint !== 'general'))].sort();
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

// --- eforge:region plan-01-source-localization-foundation ---
function deriveGlobalLocalizationNeeds(criteria: SourceInventoryCriterion[], candidates: PlanningEvidenceCandidate[], subsystemHints: string[], interfaceKeys: string[]): SourceInventoryGlobalNeed[] {
  const needs: SourceInventoryGlobalNeed[] = [];
  for (const candidate of candidates.filter((item) => item.actionable)) needs.push(globalNeed(`evidence-${stableSlug(candidate.value)}`, candidate.kind === 'directory' ? 'directory' : 'literal-path', candidate.value, criteriaForEvidence(criteria, candidate.value), inferSubsystemHints(candidate.value), inferInterfaceKeys(candidate.value), candidate.reason));
  for (const key of interfaceKeys) needs.push(globalNeed(`interface-${stableSlug(key)}`, 'interface', key, criteriaForInterface(criteria, key), subsystemHints, [key], 'inventory-interface-key'));
  for (const subsystem of subsystemHints.filter((hint) => hint !== 'general')) needs.push(globalNeed(`subsystem-${stableSlug(subsystem)}`, 'subsystem', subsystem, criteriaForSubsystem(criteria, subsystem), [subsystem], [], 'inventory-subsystem-hint'));
  return dedupeGlobalNeeds(needs).sort((a, b) => a.id.localeCompare(b.id));
}

function globalNeed(id: string, kind: SourceLocalizationNeedKind, query: string, criterionIds: string[], subsystemHints: string[], interfaceKeys: string[], reason: string): SourceInventoryGlobalNeed {
  return { id, kind, query, criterionIds: [...new Set(criterionIds)].sort(), subsystemHints: [...new Set(subsystemHints)].sort(), interfaceKeys: [...new Set(interfaceKeys)].sort(), reason };
}

function criteriaForEvidence(criteria: SourceInventoryCriterion[], value: string): string[] { return criteria.filter((criterion) => criterion.evidencePaths.includes(value)).map((criterion) => criterion.id); }
function criteriaForInterface(criteria: SourceInventoryCriterion[], key: string): string[] { return criteria.filter((criterion) => criterion.interfaceKeys.includes(key)).map((criterion) => criterion.id); }
function criteriaForSubsystem(criteria: SourceInventoryCriterion[], key: string): string[] { return criteria.filter((criterion) => criterion.subsystemHints.includes(key)).map((criterion) => criterion.id); }
function dedupeGlobalNeeds(needs: SourceInventoryGlobalNeed[]): SourceInventoryGlobalNeed[] { return [...new Map(needs.map((item) => [item.id, item])).values()]; }
// --- eforge:endregion plan-01-source-localization-foundation ---
