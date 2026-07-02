import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

import type { BoundedPlannerCompilerResult } from './compiler-runner.js';
import { derivePlanningAspectCoverage } from './coverage-accounting.js';
import type { PlanningReduceConflict, PlanningReduceGap, PlanningReduceOutput } from './reduce-contracts.js';
import type { PlanningResidueCandidate } from './residue-contracts.js';
import { utf8ByteLength } from './source-analysis.js';
import type { SourceLocalizationRepairCoverageStatus, SourceLocalizationRepairDiagnostic } from './source-localization-repair.js';
import {
  COMPILER_DIAGNOSTICS_ARTIFACT,
  COMPILER_DIAGNOSTICS_VERSION,
  MAX_COMPILER_DIAGNOSTICS_BYTES,
  type CompilerDiagnostics,
  type CompilerDiagnosticsConflict,
  type CompilerDiagnosticsGap,
  type CompilerDiagnosticsOmittedCounts,
  type CompilerDiagnosticsRepairAttempt,
} from './compiler-diagnostics-contracts.js';

export interface BuildCompilerDiagnosticsInput { compilerResult: BoundedPlannerCompilerResult; planSetName: string }
export interface WriteCompilerDiagnosticsArtifactInput { cwd: string; outputDir: string; planSetName: string; diagnostics: CompilerDiagnostics; fileName?: string }

const COMPACT_DESCRIPTION_LENGTH = 500;

// --- eforge:region compiler-diagnostics-entrypoints ---
export function buildCompilerDiagnostics(input: BuildCompilerDiagnosticsInput): CompilerDiagnostics {
  const result = input.compilerResult;
  const omitted = emptyOmittedCounts();
  const representedBy = residueRepresentationIndex(result.residue.candidates);
  const reduceOutputs = result.reduce.finalOutput ? [result.reduce.finalOutput] : result.reduce.outputs;
  return {
    version: COMPILER_DIAGNOSTICS_VERSION,
    planSetName: bounded(input.planSetName, 200),
    sourceHash: bounded(result.sourceInventory.sourceHash, 80),
    graphId: bounded(result.atomGraph.graphId, 160),
    compilerStatus: result.status,
    validationErrors: cap(result.validationErrors.map((error) => bounded(error, 500)), 128, omitted, 'validationErrors'),
    coverage: coverageSection(result, omitted),
    reduce: {
      gaps: cap(gapEntries(reduceOutputs, representedBy, omitted), 128, omitted, 'gaps'),
      conflicts: cap(conflictEntries(reduceOutputs, representedBy, omitted), 128, omitted, 'conflicts'),
    },
    repair: repairSection(result.repairDiagnostics, omitted),
    residue: residueSection(result, omitted),
    evidenceFailures: cap(evidenceFailureEntries(result), 128, omitted, 'evidenceFailures'),
    sharedBriefBudget: cap(sharedBriefBudgetEntries(result), 128, omitted, 'sharedBriefBudget'),
    omitted,
  };
}

function sharedBriefBudgetEntries(result: BoundedPlannerCompilerResult): CompilerDiagnostics['sharedBriefBudget'] {
  return (result.sharedBrief.budgetDiagnostics ?? []).map((diagnostic) => ({
    code: diagnostic.code,
    sectionId: bounded(diagnostic.sectionId, 300),
    ...(diagnostic.atomId ? { atomId: bounded(diagnostic.atomId, 160) } : {}),
    ...(diagnostic.path ? { path: bounded(diagnostic.path, 300) } : {}),
    message: bounded(diagnostic.message, 500),
  }));
}

export function serializeCompilerDiagnostics(diagnostics: CompilerDiagnostics): string {
  let current = diagnostics;
  for (const compact of [dropCoverageAspects, dropRepairCoverageAspects, truncateDescriptions, dropCoverageCriteria]) {
    const text = `${JSON.stringify(current, null, 2)}\n`;
    if (utf8ByteLength(text) <= MAX_COMPILER_DIAGNOSTICS_BYTES) return text;
    current = compact(current);
  }
  return `${JSON.stringify(current, null, 2)}\n`;
}

export async function writeCompilerDiagnosticsArtifact(input: WriteCompilerDiagnosticsArtifactInput): Promise<string> {
  const planSetName = safeRelativePathComponent(input.planSetName, 'planSetName');
  const fileName = safeRelativePathComponent(input.fileName ?? COMPILER_DIAGNOSTICS_ARTIFACT, 'fileName');
  const dir = resolve(input.cwd, input.outputDir, planSetName);
  await mkdir(dir, { recursive: true });
  const artifactPath = resolve(dir, fileName);
  if (!isInsideDirectory(artifactPath, dir)) throw new Error(`Compiler diagnostics artifact path escapes output directory: ${fileName}`);
  await writeFile(artifactPath, serializeCompilerDiagnostics(input.diagnostics), 'utf8');
  return artifactPath;
}
// --- eforge:endregion compiler-diagnostics-entrypoints ---

// --- eforge:region compiler-diagnostics-projections ---
function coverageSection(result: BoundedPlannerCompilerResult, omitted: CompilerDiagnosticsOmittedCounts): CompilerDiagnostics['coverage'] {
  const coverage = derivePlanningAspectCoverage({
    graph: result.atomGraph,
    inventory: result.sourceInventory,
    updates: [...result.map.outputs.flatMap((output) => output.aspectUpdates), ...result.residue.coverageUpdates],
  });
  const criteria = coverage.criteria
    .map((criterion) => ({
      criterionId: bounded(criterion.criterionId, 80),
      complete: criterion.complete,
      requiredAspectIds: boundedIds(criterion.requiredAspectIds, 240, 128),
      resolvedAspectIds: boundedIds(criterion.resolvedAspectIds, 240, 128),
      skippedAspectIds: boundedIds(criterion.skippedAspectIds, 240, 128),
      representedAspectIds: boundedIds(criterion.representedAspectIds, 240, 128),
      pendingAspectIds: boundedIds(criterion.pendingAspectIds, 240, 128),
    }))
    .sort((a, b) => a.criterionId.localeCompare(b.criterionId));
  const aspects = coverage.aspects
    .map((aspect) => ({
      aspectId: bounded(aspect.aspectId, 240),
      criterionId: bounded(aspect.criterionId, 80),
      status: aspect.status,
      satisfied: aspect.satisfied,
      completedByAtomIds: boundedIds(aspect.completedByAtomIds, 160, 16),
      ...(aspect.reason ? { reason: bounded(aspect.reason, 500) } : {}),
      ...(aspect.representation ? { representedByModuleId: bounded(aspect.representation.moduleId, 160) } : {}),
    }))
    .sort((a, b) => a.aspectId.localeCompare(b.aspectId));
  return {
    completeCriteria: boundedIds(coverage.completeCriteria, 80, 256),
    incompleteCriteria: boundedIds(coverage.incompleteCriteria, 80, 256),
    criteria: cap(criteria, 256, omitted, 'coverageCriteria'),
    aspects: cap(aspects, 1_024, omitted, 'coverageAspects'),
  };
}

function gapEntries(outputs: PlanningReduceOutput[], representedBy: Map<string, string>, omitted: CompilerDiagnosticsOmittedCounts): CompilerDiagnosticsGap[] {
  const entries = new Map<string, CompilerDiagnosticsGap>();
  for (const output of outputs) {
    for (const gap of output.gaps ?? []) {
      if (entries.has(gap.gapId)) continue;
      entries.set(gap.gapId, gapEntry(gap, output.nodeId, representedBy, omitted));
    }
  }
  return [...entries.values()].sort((a, b) => a.gapId.localeCompare(b.gapId));
}

function gapEntry(gap: PlanningReduceGap, nodeId: string, representedBy: Map<string, string>, omitted: CompilerDiagnosticsOmittedCounts): CompilerDiagnosticsGap {
  const representedByCandidateId = representedBy.get(gap.gapId);
  return {
    gapId: bounded(gap.gapId, 160),
    title: bounded(gap.title, 240),
    reduceNodeId: bounded(nodeId, 160),
    issueKind: gap.issueKind ?? 'generic',
    sourceLocalizationSignal: gap.sourceLocalizationSignal === true,
    representationRequired: gap.representationRequired,
    criterionIds: boundedIds(gap.criterionIds, 80, 64),
    aspectIds: boundedIds(gap.aspectIds, 240, 128),
    sourceNeedIds: boundedIds(gap.sourceNeedIds ?? [], 160, 64),
    affectedAtomIds: boundedIds(gap.affectedAtomIds ?? [], 160, 64),
    ownerPaths: boundedIds(gap.ownerPaths ?? [], 300, 64),
    productScopedOutputRefs: boundedIds(gap.productScopedOutputRefs ?? [], 300, 32),
    productScopedValidationRefs: boundedIds(gap.productScopedValidationRefs ?? [], 300, 32),
    description: boundedDescription(gap.description, omitted),
    resolution: representedByCandidateId ? 'residue-represented' : 'unrepresented',
    ...(representedByCandidateId ? { representedByCandidateId: bounded(representedByCandidateId, 160) } : {}),
  };
}

function conflictEntries(outputs: PlanningReduceOutput[], representedBy: Map<string, string>, omitted: CompilerDiagnosticsOmittedCounts): CompilerDiagnosticsConflict[] {
  const entries = new Map<string, CompilerDiagnosticsConflict>();
  for (const output of outputs) {
    for (const conflict of output.conflicts ?? []) {
      if (entries.has(conflict.conflictId)) continue;
      entries.set(conflict.conflictId, conflictEntry(conflict, output.nodeId, representedBy, omitted));
    }
  }
  return [...entries.values()].sort((a, b) => a.conflictId.localeCompare(b.conflictId));
}

function conflictEntry(conflict: PlanningReduceConflict, nodeId: string, representedBy: Map<string, string>, omitted: CompilerDiagnosticsOmittedCounts): CompilerDiagnosticsConflict {
  const representedByCandidateId = representedBy.get(conflict.conflictId);
  return {
    conflictId: bounded(conflict.conflictId, 160),
    title: bounded(conflict.title, 240),
    reduceNodeId: bounded(nodeId, 160),
    criterionIds: boundedIds(conflict.criterionIds, 80, 64),
    aspectIds: boundedIds(conflict.aspectIds, 240, 128),
    description: boundedDescription(conflict.description, omitted),
    resolution: representedByCandidateId ? 'residue-represented' : 'unrepresented',
    ...(representedByCandidateId ? { representedByCandidateId: bounded(representedByCandidateId, 160) } : {}),
  };
}

function repairSection(diagnostics: SourceLocalizationRepairDiagnostic[], omitted: CompilerDiagnosticsOmittedCounts): CompilerDiagnostics['repair'] {
  const status = diagnostics[diagnostics.length - 1]?.status ?? 'not-needed';
  if (diagnostics.length > 8) omitted.repairAttempts += diagnostics.length - 8;
  return { status, attempts: diagnostics.slice(-8).map(repairAttemptEntry) };
}

function repairAttemptEntry(diagnostic: SourceLocalizationRepairDiagnostic): CompilerDiagnosticsRepairAttempt {
  return {
    attempt: diagnostic.attempt,
    maxAttempts: diagnostic.maxAttempts,
    status: diagnostic.status,
    gapIds: boundedIds(diagnostic.gapIds, 160, 64),
    gapClassifications: diagnostic.gapClassifications.slice(0, 64).map((entry) => ({ gapId: bounded(entry.gapId, 160), issueKind: entry.issueKind, sourceLocalizationSignal: entry.sourceLocalizationSignal })),
    sourceNeedIds: boundedIds(diagnostic.sourceNeedIds, 160, 64),
    affectedAtomIds: boundedIds(diagnostic.affectedAtomIds, 160, 64),
    criterionIds: boundedIds(diagnostic.criterionIds, 80, 64),
    aspectIds: boundedIds(diagnostic.aspectIds, 240, 128),
    localizedOwnerPaths: boundedIds(diagnostic.localizedOwnerPaths, 300, 64),
    localizedOwnerStatus: diagnostic.localizedOwnerStatus.slice(0, 64).map((entry) => ({ path: bounded(entry.path, 300), status: entry.status, needIds: boundedIds(entry.needIds, 160, 16) })),
    evidenceMaterializationStatus: diagnostic.evidenceMaterializationStatus.slice(0, 64).map((entry) => ({ path: bounded(entry.path, 300), status: entry.status, ...(entry.reason ? { reason: bounded(entry.reason, 500) } : {}) })),
    coverageStatus: {
      criteria: coverageEntries(diagnostic.coverageStatus.criteria, 80, 256),
      aspects: coverageEntries(diagnostic.coverageStatus.aspects, 240, 1_024),
      sourceNeeds: coverageEntries(diagnostic.coverageStatus.sourceNeeds, 160, 256),
    },
    ...(diagnostic.unresolvedReason ? { unresolvedReason: bounded(diagnostic.unresolvedReason, 1_000) } : {}),
    residueSynthesisBlocked: diagnostic.residueSynthesisBlocked,
  };
}

function residueSection(result: BoundedPlannerCompilerResult, omitted: CompilerDiagnosticsOmittedCounts): CompilerDiagnostics['residue'] {
  const exhausted = result.repairDiagnostics.filter((diagnostic) => diagnostic.status === 'exhausted' && diagnostic.residueSynthesisBlocked);
  const blockedReasons = [...new Set([
    ...result.residue.validationErrors,
    ...exhausted.map((diagnostic) => diagnostic.unresolvedReason ?? `source localization repair exhausted:${diagnostic.gapIds.join(',')}`),
  ])].sort().slice(0, 64).map((reason) => bounded(reason, 500));
  const candidates = [...result.residue.candidates]
    .sort((a, b) => a.candidateId.localeCompare(b.candidateId))
    .map(residueCandidateEntry);
  return {
    synthesisBlocked: result.residue.validationErrors.length > 0 || exhausted.length > 0,
    blockedReasons,
    candidates: cap(candidates, 80, omitted, 'residueCandidates'),
  };
}

function residueCandidateEntry(candidate: PlanningResidueCandidate): CompilerDiagnostics['residue']['candidates'][number] {
  return {
    candidateId: bounded(candidate.candidateId, 160),
    title: bounded(candidate.title, 240),
    kind: candidate.kind,
    reason: bounded(candidate.reason, 80),
    buildability: candidate.buildability ?? 'buildable',
    sourceLocalizationDerived: candidate.sourceLocalizationDerived === true,
    criterionIds: boundedIds(candidate.criterionIds, 80, 64),
    aspectIds: boundedIds(candidate.aspectIds, 240, 128),
    localizedOwnerPaths: boundedIds(candidate.localizedOwnerPaths ?? [], 300, 64),
    sourceRefs: boundedIds(candidate.sourceRefs ?? [], 300, 32),
  };
}

function evidenceFailureEntries(result: BoundedPlannerCompilerResult): CompilerDiagnostics['evidenceFailures'] {
  return result.sourceEvidenceBundle.records
    .filter((record) => record.status !== 'materialized')
    .map((record) => ({
      path: bounded(record.path, 500),
      status: record.status as Exclude<typeof record.status, 'materialized'>,
      ...(record.reason ? { reason: bounded(record.reason, 500) } : {}),
      ...(record.error ? { error: bounded(record.error, 500) } : {}),
      referencedByAtomIds: boundedIds(record.referencedByAtomIds, 160, 16),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function residueRepresentationIndex(candidates: PlanningResidueCandidate[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const candidate of [...candidates].sort((a, b) => a.candidateId.localeCompare(b.candidateId))) {
    for (const ref of candidate.sourceRefs ?? []) if (!index.has(ref)) index.set(ref, candidate.candidateId);
  }
  return index;
}

function coverageEntries(record: Record<string, SourceLocalizationRepairCoverageStatus>, idLength: number, maxItems: number): Array<{ id: string; status: SourceLocalizationRepairCoverageStatus }> {
  return Object.entries(record)
    .map(([id, status]) => ({ id: bounded(id, idLength), status }))
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, maxItems);
}

// --- eforge:endregion compiler-diagnostics-projections ---

// --- eforge:region compiler-diagnostics-compaction-helpers ---
function dropCoverageAspects(diagnostics: CompilerDiagnostics): CompilerDiagnostics {
  return {
    ...diagnostics,
    coverage: { ...diagnostics.coverage, aspects: [] },
    omitted: { ...diagnostics.omitted, coverageAspects: diagnostics.omitted.coverageAspects + diagnostics.coverage.aspects.length },
  };
}

function dropRepairCoverageAspects(diagnostics: CompilerDiagnostics): CompilerDiagnostics {
  return {
    ...diagnostics,
    repair: { ...diagnostics.repair, attempts: diagnostics.repair.attempts.map((attempt) => ({ ...attempt, coverageStatus: { ...attempt.coverageStatus, aspects: [] } })) },
  };
}

function truncateDescriptions(diagnostics: CompilerDiagnostics): CompilerDiagnostics {
  const omitted = { ...diagnostics.omitted };
  const shorten = <T extends { description: string }>(entry: T): T => {
    if (entry.description.length <= COMPACT_DESCRIPTION_LENGTH) return entry;
    omitted.descriptionBytes += utf8ByteLength(entry.description) - utf8ByteLength(entry.description.slice(0, COMPACT_DESCRIPTION_LENGTH));
    return { ...entry, description: entry.description.slice(0, COMPACT_DESCRIPTION_LENGTH) };
  };
  return {
    ...diagnostics,
    reduce: { gaps: diagnostics.reduce.gaps.map(shorten), conflicts: diagnostics.reduce.conflicts.map(shorten) },
    omitted,
  };
}

function dropCoverageCriteria(diagnostics: CompilerDiagnostics): CompilerDiagnostics {
  return {
    ...diagnostics,
    coverage: { ...diagnostics.coverage, criteria: [] },
    omitted: { ...diagnostics.omitted, coverageCriteria: diagnostics.omitted.coverageCriteria + diagnostics.coverage.criteria.length },
  };
}

function emptyOmittedCounts(): CompilerDiagnosticsOmittedCounts {
  return { gaps: 0, conflicts: 0, repairAttempts: 0, evidenceFailures: 0, coverageAspects: 0, coverageCriteria: 0, residueCandidates: 0, validationErrors: 0, descriptionBytes: 0, sharedBriefBudget: 0 };
}

function cap<T>(items: T[], maxItems: number, omitted: CompilerDiagnosticsOmittedCounts, key: Exclude<keyof CompilerDiagnosticsOmittedCounts, 'descriptionBytes'>): T[] {
  if (items.length > maxItems) omitted[key] += items.length - maxItems;
  return items.slice(0, maxItems);
}

function boundedDescription(description: string, omitted: CompilerDiagnosticsOmittedCounts): string {
  if (description.length > 2_000) omitted.descriptionBytes += utf8ByteLength(description) - utf8ByteLength(description.slice(0, 2_000));
  return bounded(description, 2_000);
}

function boundedIds(values: string[], maxLength: number, maxItems: number): string[] {
  return [...new Set(values.map((value) => bounded(value, maxLength)))].sort().slice(0, maxItems);
}

function bounded(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function safeRelativePathComponent(value: string, label: string): string {
  if (!value.trim()) throw new Error(`Compiler diagnostics ${label} must not be empty`);
  if (isAbsolute(value) || value.includes('/') || value.includes('\\') || value.split(/[\\/]+/).includes('..')) {
    throw new Error(`Compiler diagnostics ${label} must be a safe relative path component`);
  }
  return value;
}

function isInsideDirectory(child: string, parent: string): boolean {
  const relativePath = relative(parent, child);
  return relativePath.length > 0 && !relativePath.startsWith('..') && !isAbsolute(relativePath);
}
// --- eforge:endregion compiler-diagnostics-compaction-helpers ---
