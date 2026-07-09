import { mkdir, rm, writeFile } from 'node:fs/promises';
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
export interface WriteRescopeFailClosedArtifactInput { cwd: string; outputDir: string; planSetName: string; reason: string; rescope: NonNullable<BoundedPlannerCompilerResult['rescopeDiagnostics']> }

export const RESCOPE_FAIL_CLOSED_ARTIFACT = 'rescope-fail-closed.json';

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
    exploration: explorationSection(result),
    ...(result.rescopeDiagnostics ? { rescope: rescopeSection(result.rescopeDiagnostics) } : {}),
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
  for (const compact of [dropCoverageAspects, dropRepairCoverageAspects, truncateDescriptions, compactExploration, compactRescope, dropCoverageCriteria]) {
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
  // A fresh compiler run supersedes any fail-closed rescope artifact left by a
  // prior run in the same plan-set dir; both never describe the same run.
  if (fileName === COMPILER_DIAGNOSTICS_ARTIFACT) await rm(resolve(dir, RESCOPE_FAIL_CLOSED_ARTIFACT), { force: true });
  return artifactPath;
}

/**
 * Persist adaptive-rescope state when the compile fails closed before the
 * compiler runs. The main diagnostics artifact is never written on that path,
 * and the rescope ledger/split history is exactly what a debugger needs.
 */
export async function writeRescopeFailClosedArtifact(input: WriteRescopeFailClosedArtifactInput): Promise<string> {
  const planSetName = safeRelativePathComponent(input.planSetName, 'planSetName');
  const dir = resolve(input.cwd, input.outputDir, planSetName);
  await mkdir(dir, { recursive: true });
  const artifactPath = resolve(dir, RESCOPE_FAIL_CLOSED_ARTIFACT);
  await writeFile(artifactPath, `${JSON.stringify({ reason: bounded(input.reason, 2_000), rescope: rescopeSection(input.rescope) }, null, 2)}\n`, 'utf8');
  // Fail-closed aborts before the main diagnostics artifact is written; a
  // stale compiler-diagnostics.json from a prior run would misdirect the
  // post-mortem toward the wrong failure.
  await rm(resolve(dir, COMPILER_DIAGNOSTICS_ARTIFACT), { force: true });
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
    resolution: representedByCandidateId ? 'residue-represented' : gap.representationRequired ? 'unrepresented' : 'informational',
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

function explorationSection(result: BoundedPlannerCompilerResult): CompilerDiagnostics['exploration'] {
  const outcome = result.explorationOutcome;
  return {
    outcomeStatus: outcome?.status ?? 'not-run',
    unresolvedNeedIds: boundedIds(outcome?.unresolvedNeedIds ?? [], 160, 100),
    reasons: [...new Set(outcome?.reasons ?? [])].sort().slice(0, 32),
    attemptedQueries: (outcome?.attemptedQueries ?? []).slice(0, 100).map((entry) => ({
      ...(entry.needId ? { needId: bounded(entry.needId, 160) } : {}),
      query: bounded(entry.query, 1_000),
      ...(entry.tool ? { tool: bounded(entry.tool, 120) } : {}),
      ...(entry.result ? { result: bounded(entry.result, 1_000) } : {}),
    })),
    candidatePaths: boundedIds(outcome?.candidatePaths ?? [], 300, 100),
    rescopeHints: (outcome?.rescopeHints ?? []).map((hint) => bounded(hint, 1_000)).slice(0, 32),
    ...(outcome?.notes ? { notes: bounded(outcome.notes, 2_000) } : {}),
    unknownIdDrops: (result.explorationUnknownIdDrops ?? []).slice(0, 100).map((drop) => ({ field: bounded(drop.field, 80), id: bounded(drop.id, 240), ...(drop.index === undefined ? {} : { index: drop.index }) })),
    toolUseCount: outcome?.toolUseCount ?? 0,
  };
}

function rescopeSection(rescope: NonNullable<BoundedPlannerCompilerResult['rescopeDiagnostics']>): NonNullable<CompilerDiagnostics['rescope']> {
  return {
    status: rescope.status,
    attempts: Math.min(rescope.attempts, 100),
    maxAttempts: Math.min(rescope.maxAttempts, 100),
    originalAtomCount: rescope.originalAtomCount,
    revisedAtomCount: rescope.revisedAtomCount,
    ledger: { totalToolUseBudget: rescope.ledger.totalToolUseBudget, usedToolUses: rescope.ledger.usedToolUses },
    riskReasons: rescope.riskReasons.slice(0, 16).map((reason) => bounded(reason, 240)),
    splitGroups: rescope.splitGroups.slice(0, 64).map((group) => ({
      directiveId: bounded(group.directiveId, 160),
      groupKey: bounded(group.groupKey, 160),
      criterionIds: boundedIds(group.criterionIds, 80, 64),
      rationale: bounded(group.rationale, 500),
    })),
    rerunScopeKeys: boundedIds(rescope.rerunScopeKeys, 160, 64),
    preservedScopeKeys: boundedIds(rescope.preservedScopeKeys, 160, 64),
    unresolvedCriticalNeedIds: boundedIds(rescope.unresolvedCriticalNeedIds, 160, 100),
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
    evidenceMaterializationStatus: diagnostic.evidenceMaterializationStatus.slice(0, 64).map((entry) => ({ path: bounded(entry.path, 300), status: entry.status, ...(entry.reason ? { reason: bounded(entry.reason, 500) } : {}), ...(entry.budgetAtomIds && entry.budgetAtomIds.length > 0 ? { budgetAtomIds: boundedIds(entry.budgetAtomIds, 160, 16) } : {}), ...(entry.priority ? { priority: true } : {}) })),
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
      ...(record.budgetAtomIds && record.budgetAtomIds.length > 0 ? { budgetAtomIds: boundedIds(record.budgetAtomIds, 160, 16) } : {}),
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

function compactExploration(diagnostics: CompilerDiagnostics): CompilerDiagnostics {
  return {
    ...diagnostics,
    exploration: {
      ...diagnostics.exploration,
      attemptedQueries: diagnostics.exploration.attemptedQueries.slice(0, 16).map((entry) => ({
        ...(entry.needId ? { needId: entry.needId } : {}),
        query: bounded(entry.query, 240),
        ...(entry.tool ? { tool: entry.tool } : {}),
        ...(entry.result ? { result: bounded(entry.result, 240) } : {}),
      })),
      candidatePaths: diagnostics.exploration.candidatePaths.slice(0, 32),
      rescopeHints: diagnostics.exploration.rescopeHints.slice(0, 8).map((hint) => bounded(hint, 240)),
      ...(diagnostics.exploration.notes ? { notes: bounded(diagnostics.exploration.notes, 500) } : {}),
      unknownIdDrops: diagnostics.exploration.unknownIdDrops.slice(0, 32),
    },
  };
}

/** Compaction for the rescope section: split-group detail goes first so rescope history cannot crowd out coverage/repair data. */
function compactRescope(diagnostics: CompilerDiagnostics): CompilerDiagnostics {
  if (!diagnostics.rescope) return diagnostics;
  return {
    ...diagnostics,
    rescope: {
      ...diagnostics.rescope,
      splitGroups: diagnostics.rescope.splitGroups.slice(0, 8).map((group) => ({ ...group, criterionIds: group.criterionIds.slice(0, 16), rationale: bounded(group.rationale, 160) })),
      rerunScopeKeys: diagnostics.rescope.rerunScopeKeys.slice(0, 16),
      preservedScopeKeys: diagnostics.rescope.preservedScopeKeys.slice(0, 16),
      unresolvedCriticalNeedIds: diagnostics.rescope.unresolvedCriticalNeedIds.slice(0, 32),
    },
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
