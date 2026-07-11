import { Type } from '@sinclair/typebox';
import type { PlanningObservedBudgetPressure, PlanningUnitBudget } from '@eforge-build/client';
import type { PlanningAtom, PlanningAtomBudgetEstimate, PlanningAtomGraph, PlanningAtomReason, PlanningAtomSourceSlice } from './atom-graph.js';
import { derivePlanningAspectCoverage, derivePlanningCriterionAspects, type PlanningAspectCoverageSummary, type PlanningAspectCoverageUpdate, type PlanningCriterionAspect } from './coverage-accounting.js';
import { utf8ByteLength } from './source-analysis.js';
import { validatePlanningSharedFindings, type PlanningAtomBrief, type PlanningSharedFinding, type SharedPlanningBrief } from './shared-brief-contracts.js';
import { PlanningModuleDocsWorkSchema, PlanningModuleReviewDepthSchema, PlanningModuleTestOwnershipSchema, PlanningModuleTestWorkSchema, PlanningReduceDigestSchema, validatePlanningReduceDigest, type PlanningModuleDocsWork, type PlanningModuleReviewDepth, type PlanningModuleTestOwnership, type PlanningModuleTestWork, type PlanningReduceDigest } from './reduce-digest-contracts.js';
import { sourceEvidenceRecordsForAtom, type PlanningSourceEvidenceBundle, type PlanningSourceEvidenceRecord, type PlanningSourceEvidenceStatus } from './source-evidence-contracts.js';
import type { SourceLocalizationConfidence, SourceLocalizationStatus } from './source-localization-contracts.js';
import type { SourceInventory } from './source-inventory.js';

export type PlanningAtomOutputStatus = 'completed' | 'skipped' | 'failed';

const boundedString = (maxLength: number): ReturnType<typeof Type.String> => Type.String({ maxLength });
export const PlanningAspectRepresentationSchema = Type.Object({ kind: Type.Union([Type.Literal('residue'), Type.Literal('follow-up')]), moduleId: boundedString(160), reason: boundedString(1_000), validationExpectation: boundedString(1_000) }, { additionalProperties: false });
export const PlanningAspectCoverageUpdateSchema = Type.Object({ aspectId: boundedString(240), status: Type.Union([Type.Literal('pending'), Type.Literal('resolved'), Type.Literal('skipped'), Type.Literal('represented')]), completedByAtomIds: Type.Optional(Type.Array(boundedString(160), { maxItems: 8 })), reason: Type.Optional(boundedString(1_000)), representation: Type.Optional(PlanningAspectRepresentationSchema) }, { additionalProperties: false });
export const PlanningAtomPlanFragmentSchema = Type.Object({ fragmentId: boundedString(160), title: boundedString(240), criterionIds: Type.Array(boundedString(80), { maxItems: 32 }), aspectIds: Type.Array(boundedString(240), { maxItems: 64 }), markdown: boundedString(8_000), dependsOnFragmentIds: Type.Optional(Type.Array(boundedString(160), { maxItems: 16 })) }, { additionalProperties: false });
export const PlanningAtomModuleCandidateSchema = Type.Object({ moduleId: boundedString(160), title: boundedString(240), criterionIds: Type.Array(boundedString(80), { maxItems: 32 }), aspectIds: Type.Array(boundedString(240), { maxItems: 64 }), description: boundedString(8_000), validationExpectation: boundedString(2_000), docsWork: Type.Optional(PlanningModuleDocsWorkSchema), testWork: Type.Optional(PlanningModuleTestWorkSchema), testOwnership: Type.Optional(PlanningModuleTestOwnershipSchema), reviewDepth: Type.Optional(PlanningModuleReviewDepthSchema), reviewRationale: Type.Optional(boundedString(1_000)), dependsOnModuleIds: Type.Optional(Type.Array(boundedString(160), { maxItems: 16 })) }, { additionalProperties: false });
export const PlanningSharedFindingSchema = Type.Object({ findingId: boundedString(160), sourceAtomId: boundedString(160), evidencePath: Type.Optional(boundedString(500)), interfaceKey: Type.Optional(boundedString(160)), aspectIds: Type.Array(boundedString(240), { maxItems: 64 }), summary: boundedString(1_500), validationExpectation: Type.Optional(boundedString(1_000)), byteLength: Type.Integer({ minimum: 0, maximum: 2_000 }) }, { additionalProperties: false });
export const PlanningAtomOutputSchema = Type.Object({ atomId: boundedString(160), status: Type.Union([Type.Literal('completed'), Type.Literal('skipped'), Type.Literal('failed')]), aspectUpdates: Type.Array(PlanningAspectCoverageUpdateSchema, { maxItems: 128 }), reduceDigest: Type.Optional(PlanningReduceDigestSchema), planFragments: Type.Optional(Type.Array(PlanningAtomPlanFragmentSchema, { maxItems: 32 })), moduleCandidates: Type.Optional(Type.Array(PlanningAtomModuleCandidateSchema, { maxItems: 32 })), sharedFindings: Type.Optional(Type.Array(PlanningSharedFindingSchema, { maxItems: 8 })), discoveredEvidencePaths: Type.Optional(Type.Array(boundedString(500), { maxItems: 64 })), compactHandoff: Type.Optional(boundedString(8_000)), error: Type.Optional(boundedString(2_000)) }, { additionalProperties: false });

export interface PlanningAtomLocalizedEvidenceSummary { path: string; status: PlanningSourceEvidenceStatus; localizationNeedIds?: string[]; localizationStatus?: SourceLocalizationStatus; localizationConfidence?: SourceLocalizationConfidence; candidateRank?: number; ownershipRationale?: string; excerptByteLength?: number; byteLength?: number; delivered: boolean; budgetNotes?: string[] }
export interface PlanningWorkProfile { shape: 'single-unit' | 'bounded-decomposition'; planningUnitCount: number; sourceBytes: number; criterionCount: number; withinSingleUnitBudget: boolean }
export interface PlanningAtomTask { graphId: string; atomId: string; title: string; reason: PlanningAtomReason; criterionIds: string[]; aspectIds: string[]; aspects: PlanningCriterionAspect[]; subsystemHints: string[]; evidencePaths: string[]; interfaceKeys: string[]; dependencyHints: string[]; sourceSlices: PlanningAtomSourceSlice[]; budget: PlanningUnitBudget; estimate: PlanningAtomBudgetEstimate; workProfile: PlanningWorkProfile; reduceDigestPromptBudgetBytes?: number; sharedBrief?: PlanningAtomBrief; localizedEvidence?: PlanningAtomLocalizedEvidenceSummary[] }
export interface PlanningAtomPlanFragment { fragmentId: string; title: string; criterionIds: string[]; aspectIds: string[]; markdown: string; dependsOnFragmentIds?: string[] }
export interface PlanningAtomModuleCandidate { moduleId: string; title: string; criterionIds: string[]; aspectIds: string[]; description: string; validationExpectation: string; docsWork?: PlanningModuleDocsWork; testWork?: PlanningModuleTestWork; testOwnership?: PlanningModuleTestOwnership; reviewDepth?: PlanningModuleReviewDepth; reviewRationale?: string; dependsOnModuleIds?: string[] }
export interface PlanningAtomOutput { atomId: string; status: PlanningAtomOutputStatus; aspectUpdates: PlanningAspectCoverageUpdate[]; reduceDigest?: PlanningReduceDigest; planFragments?: PlanningAtomPlanFragment[]; moduleCandidates?: PlanningAtomModuleCandidate[]; sharedFindings?: PlanningSharedFinding[]; discoveredEvidencePaths?: string[]; compactHandoff?: string; observedBudget?: PlanningObservedBudgetPressure; error?: string }
export interface BuildPlanningAtomTasksInput { graph: PlanningAtomGraph; inventory?: SourceInventory; aspects?: PlanningCriterionAspect[]; sharedBrief?: SharedPlanningBrief; sourceEvidenceBundle?: PlanningSourceEvidenceBundle; reduceDigestPromptBudgetBytes?: number }
export interface ValidatePlanningAtomOutputInput extends BuildPlanningAtomTasksInput { output: PlanningAtomOutput; task?: PlanningAtomTask }
export interface ValidatePlanningAtomOutputForTaskInput { output: PlanningAtomOutput; task: PlanningAtomTask }
export interface SummarizePlanningAtomOutputsInput extends BuildPlanningAtomTasksInput { outputs: PlanningAtomOutput[] }
export type PlanningAtomOutputValidation = { ok: true; errors: [] } | { ok: false; errors: string[] };
export interface PlanningAtomOutputCoverageSummary { coverage: PlanningAspectCoverageSummary; validationErrors: string[] }

export function buildPlanningAtomTasks(input: BuildPlanningAtomTasksInput): PlanningAtomTask[] {
  const aspects = input.aspects ?? derivePlanningCriterionAspects(input.graph, input.inventory);
  return input.graph.atoms.map((atom) => buildPlanningAtomTask(input.graph, atom, aspects, input.sharedBrief, input.reduceDigestPromptBudgetBytes, input.sourceEvidenceBundle)).sort((a, b) => a.atomId.localeCompare(b.atomId));
}

export function buildPlanningAtomTask(graph: PlanningAtomGraph, atom: PlanningAtom, aspects: PlanningCriterionAspect[], sharedBrief?: SharedPlanningBrief, reduceDigestPromptBudgetBytes?: number, sourceEvidenceBundle?: PlanningSourceEvidenceBundle): PlanningAtomTask {
  const atomAspects = aspects
    .filter((aspect) => aspect.atomIds.includes(atom.atomId))
    .sort((a, b) => a.aspectId.localeCompare(b.aspectId))
    .map((aspect) => ({ ...aspect, source: { ...aspect.source }, atomIds: [...aspect.atomIds] }));
  return {
    graphId: graph.graphId,
    atomId: atom.atomId,
    title: atom.title,
    reason: atom.reason,
    criterionIds: [...atom.criterionIds],
    aspectIds: atomAspects.map((aspect) => aspect.aspectId),
    aspects: atomAspects,
    subsystemHints: [...atom.subsystemHints],
    evidencePaths: [...atom.evidencePaths],
    interfaceKeys: [...atom.interfaceKeys],
    dependencyHints: [...atom.dependencyHints],
    sourceSlices: atom.sourceSlices.map((slice) => ({ ...slice, criteriaIds: [...slice.criteriaIds], headingPath: [...slice.headingPath] })),
    budget: { ...atom.budget },
    estimate: { ...atom.estimate },
    workProfile: {
      shape: graph.atoms.length === 1 ? 'single-unit' : 'bounded-decomposition',
      planningUnitCount: graph.atoms.length,
      sourceBytes: graph.atoms.reduce((total, candidate) => total + candidate.estimate.sourceBytes, 0),
      criterionCount: graph.inventory.criterionCount,
      withinSingleUnitBudget: graph.atoms.length === 1 && atom.estimate.sourceBytes <= graph.limits.maxPromptSourceBytes && atom.criterionIds.length <= graph.limits.maxCriteriaPerUnit,
    },
    ...(reduceDigestPromptBudgetBytes !== undefined ? { reduceDigestPromptBudgetBytes } : {}),
    ...(briefForAtom(sharedBrief, atom.atomId) ? { sharedBrief: briefForAtom(sharedBrief, atom.atomId)! } : {}),
    ...(localizedEvidenceForAtom(sourceEvidenceBundle, atom.atomId).length > 0 ? { localizedEvidence: localizedEvidenceForAtom(sourceEvidenceBundle, atom.atomId) } : {}),
  };
}

export function validatePlanningAtomOutput(input: ValidatePlanningAtomOutputInput): PlanningAtomOutputValidation {
  const atom = input.graph.atoms.find((candidate) => candidate.atomId === input.output.atomId);
  if (!atom) return invalid([`unknown atom:${input.output.atomId}`]);
  const aspects = input.aspects ?? derivePlanningCriterionAspects(input.graph, input.inventory);
  const task = input.task ?? buildPlanningAtomTask(input.graph, atom, aspects, input.sharedBrief, input.reduceDigestPromptBudgetBytes, input.sourceEvidenceBundle);
  const errors = validateOutputForTask(input.output, task, aspects);
  return errors.length === 0 ? { ok: true, errors: [] } : invalid(errors);
}

export function validatePlanningAtomOutputForTask(input: ValidatePlanningAtomOutputForTaskInput): PlanningAtomOutputValidation {
  const errors = validateOutputForTask(input.output, input.task, input.task.aspects);
  return errors.length === 0 ? { ok: true, errors: [] } : invalid(errors);
}

export function summarizePlanningAtomOutputs(input: SummarizePlanningAtomOutputsInput): PlanningAtomOutputCoverageSummary {
  const validationErrors = input.outputs.flatMap((output) => {
    const result = validatePlanningAtomOutput({ ...input, output });
    return result.ok ? [] : result.errors;
  });
  validationErrors.push(...duplicateAspectUpdateErrors(input.outputs));
  const coverage = derivePlanningAspectCoverage({ graph: input.graph, inventory: input.inventory, aspects: input.aspects, updates: input.outputs.flatMap((output) => output.aspectUpdates) });
  validationErrors.push(...coverage.validationErrors);
  return { coverage, validationErrors: [...new Set(validationErrors)].sort() };
}

function validateOutputForTask(output: PlanningAtomOutput, task: PlanningAtomTask, aspects: PlanningCriterionAspect[]): string[] {
  const errors: string[] = [];
  if (output.atomId !== task.atomId) errors.push(`output atom mismatch:${output.atomId}->${task.atomId}`);
  if (output.status === 'failed' && output.aspectUpdates.length > 0) errors.push(`failed atom output must not update aspects:${output.atomId}`);
  const fragments = output.planFragments ?? [];
  const modules = output.moduleCandidates ?? [];
  for (const update of output.aspectUpdates) validateAspectUpdate(output, task, aspects, update, errors);
  validateTerminalAspectAccounting(output, task, errors);
  validateCompactHandoff(output, task, errors);
  if (output.reduceDigest) errors.push(...validatePlanningReduceDigest({ digest: output.reduceDigest, expectedSourceId: output.atomId, expectedSourceKind: 'atom', allowedCriterionIds: task.criterionIds, allowedAspectIds: task.aspectIds, ...(task.reduceDigestPromptBudgetBytes !== undefined ? { maxPromptBytes: task.reduceDigestPromptBudgetBytes } : {}) }));
  validateUniqueIds('plan fragment', fragments.map((fragment) => fragment.fragmentId), errors);
  validateUniqueIds('module candidate', modules.map((module) => module.moduleId), errors);
  errors.push(...validatePlanningSharedFindings({ atomId: output.atomId, aspectIds: task.aspectIds, interfaceKeys: task.interfaceKeys, ownedEvidencePaths: task.sharedBrief?.ownedEvidencePaths ?? [], ownedInterfaceKeys: task.sharedBrief?.ownedInterfaceKeys ?? task.interfaceKeys, findings: output.sharedFindings ?? [] }));
  for (const fragment of fragments) validateFragment(task, fragment, fragments, errors);
  for (const module of modules) validateModule(task, module, modules, errors);
  return errors.sort();
}

function validateAspectUpdate(output: PlanningAtomOutput, task: PlanningAtomTask, aspects: PlanningCriterionAspect[], update: PlanningAspectCoverageUpdate, errors: string[]): void {
  const aspect = aspects.find((candidate) => candidate.aspectId === update.aspectId);
  if (!aspect) { errors.push(`unknown aspect:${update.aspectId}`); return; }
  if (!task.aspectIds.includes(update.aspectId) || !aspect.atomIds.includes(output.atomId)) errors.push(`aspect not owned by atom:${output.atomId}:${update.aspectId}`);
  if (output.status === 'skipped' && update.status === 'resolved') errors.push(`skipped atom output cannot resolve aspects:${output.atomId}:${update.aspectId}`);
  if (update.status === 'resolved') validateResolvedAspectAtomIds(output, aspect, update, errors);
  if (update.status === 'skipped' && !nonEmpty(update.reason)) errors.push(`skipped aspect requires reason:${update.aspectId}`);
  if (update.status === 'represented' && !validRepresentation(update.representation)) errors.push(`represented aspect requires kind, module, reason, and validation expectation:${update.aspectId}`);
}

function validateTerminalAspectAccounting(output: PlanningAtomOutput, task: PlanningAtomTask, errors: string[]): void {
  if (output.status === 'failed') return;
  const updated = new Set(output.aspectUpdates.map((update) => update.aspectId));
  for (const aspectId of task.aspectIds) if (!updated.has(aspectId)) errors.push(`atom output missing aspect update:${output.atomId}:${aspectId}`);
}

function validateCompactHandoff(output: PlanningAtomOutput, task: PlanningAtomTask, errors: string[]): void {
  if (output.compactHandoff !== undefined && utf8ByteLength(output.compactHandoff) > task.budget.maxCompactHandoffBytes) errors.push(`compact handoff budget exceeded:${output.atomId}`);
}

function validateFragment(task: PlanningAtomTask, fragment: PlanningAtomPlanFragment, fragments: PlanningAtomPlanFragment[], errors: string[]): void {
  if (!nonEmpty(fragment.fragmentId)) errors.push('plan fragment requires id');
  if (!nonEmpty(fragment.markdown)) errors.push(`plan fragment requires markdown:${fragment.fragmentId}`);
  if (utf8ByteLength(fragment.markdown) > task.budget.maxCompactHandoffBytes) errors.push(`plan fragment budget exceeded:${fragment.fragmentId}`);
  validateLinkedIds(task, fragment.fragmentId, fragment.criterionIds, fragment.aspectIds, errors);
  validateDependencyIds('plan fragment', fragment.fragmentId, fragment.dependsOnFragmentIds, fragments.map((candidate) => candidate.fragmentId), errors);
}

function validateModule(task: PlanningAtomTask, module: PlanningAtomModuleCandidate, modules: PlanningAtomModuleCandidate[], errors: string[]): void {
  if (!nonEmpty(module.moduleId)) errors.push('module candidate requires id');
  if (!nonEmpty(module.description)) errors.push(`module candidate requires description:${module.moduleId}`);
  if (!nonEmpty(module.validationExpectation)) errors.push(`module candidate requires validation expectation:${module.moduleId}`);
  if (module.reviewDepth !== undefined && !nonEmpty(module.reviewRationale)) errors.push(`module candidate review depth requires rationale:${module.moduleId}`);
  validateLinkedIds(task, module.moduleId, module.criterionIds, module.aspectIds, errors);
  validateDependencyIds('module candidate', module.moduleId, module.dependsOnModuleIds, modules.map((candidate) => candidate.moduleId), errors);
}

function validateLinkedIds(task: PlanningAtomTask, id: string, criterionIds: string[], aspectIds: string[], errors: string[]): void {
  if (criterionIds.length === 0 || aspectIds.length === 0) errors.push(`planning output must link criteria and aspects:${id}`);
  for (const criterionId of criterionIds) if (!task.criterionIds.includes(criterionId)) errors.push(`unknown criterion for atom output:${id}:${criterionId}`);
  for (const aspectId of aspectIds) if (!task.aspectIds.includes(aspectId)) errors.push(`unknown aspect for atom output:${id}:${aspectId}`);
}

function validateResolvedAspectAtomIds(output: PlanningAtomOutput, aspect: PlanningCriterionAspect, update: PlanningAspectCoverageUpdate, errors: string[]): void {
  const completedByAtomIds = update.completedByAtomIds ?? [];
  if (!completedByAtomIds.includes(output.atomId)) errors.push(`resolved aspect must cite producing atom:${output.atomId}:${update.aspectId}`);
  for (const atomId of completedByAtomIds) if (!aspect.atomIds.includes(atomId)) errors.push(`resolved aspect cites non-owner atom:${output.atomId}:${update.aspectId}:${atomId}`);
}

function validateUniqueIds(kind: string, ids: string[], errors: string[]): void {
  const seen = new Set<string>();
  for (const id of ids.filter(nonEmpty)) {
    if (seen.has(id)) errors.push(`${kind} id duplicated:${id}`);
    seen.add(id);
  }
}

function validateDependencyIds(kind: string, id: string, dependsOnIds: string[] | undefined, availableIds: string[], errors: string[]): void {
  const available = new Set(availableIds.filter(nonEmpty));
  for (const dependencyId of dependsOnIds ?? []) {
    if (!nonEmpty(dependencyId)) errors.push(`${kind} dependency requires id:${id}`);
    else if (dependencyId === id) errors.push(`${kind} dependency self-reference:${id}`);
    else if (!available.has(dependencyId)) errors.push(`${kind} dependency missing:${id}:${dependencyId}`);
  }
}

function briefForAtom(sharedBrief: SharedPlanningBrief | undefined, atomId: string): PlanningAtomBrief | undefined {
  const atomBrief = sharedBrief?.atomBriefs.find((brief) => brief.atomId === atomId);
  return atomBrief ? { ...atomBrief, ownedEvidencePaths: [...atomBrief.ownedEvidencePaths], localEvidencePaths: [...atomBrief.localEvidencePaths], ownedInterfaceKeys: [...atomBrief.ownedInterfaceKeys], sharedEvidenceRefs: atomBrief.sharedEvidenceRefs.map((ref) => ({ ...ref, ...(ref.localizationNeedIds ? { localizationNeedIds: [...ref.localizationNeedIds] } : {}) })), sharedInterfaceRefs: atomBrief.sharedInterfaceRefs.map((ref) => ({ ...ref })), prerequisiteAtomIds: [...atomBrief.prerequisiteAtomIds], sectionIds: [...atomBrief.sectionIds], sections: atomBrief.sections.map((section) => ({ ...section })), ...(atomBrief.evidenceSummaries ? { evidenceSummaries: atomBrief.evidenceSummaries.map((summary) => ({ ...summary, consumerAtomIds: [...summary.consumerAtomIds], ...(summary.localizationNeedIds ? { localizationNeedIds: [...summary.localizationNeedIds] } : {}) })) } : {}) } : undefined;
}

function localizedEvidenceForAtom(bundle: PlanningSourceEvidenceBundle | undefined, atomId: string): PlanningAtomLocalizedEvidenceSummary[] {
  return sourceEvidenceRecordsForAtom(bundle, atomId).map((record) => localizedEvidenceSummary(record, atomId)).sort((a, b) => a.path.localeCompare(b.path));
}

function localizedEvidenceSummary(record: PlanningSourceEvidenceRecord, atomId: string): PlanningAtomLocalizedEvidenceSummary {
  return {
    path: record.path,
    status: record.status,
    ...(record.localizationNeedIds ? { localizationNeedIds: [...record.localizationNeedIds] } : {}),
    ...(record.localizationStatus ? { localizationStatus: record.localizationStatus } : {}),
    ...(record.localizationConfidence ? { localizationConfidence: record.localizationConfidence } : {}),
    ...(record.candidateRank !== undefined ? { candidateRank: record.candidateRank } : {}),
    ...(record.ownershipRationale ? { ownershipRationale: record.ownershipRationale } : {}),
    ...(record.excerptByteLength !== undefined ? { excerptByteLength: record.excerptByteLength } : {}),
    ...(record.byteLength !== undefined ? { byteLength: record.byteLength } : {}),
    delivered: record.deliveredToAtomIds.includes(atomId),
    ...(record.budgetNotes ? { budgetNotes: [...record.budgetNotes] } : {}),
  };
}

function duplicateAspectUpdateErrors(outputs: PlanningAtomOutput[]): string[] {
  const byAspect = new Map<string, string[]>();
  for (const output of outputs) for (const update of output.aspectUpdates) byAspect.set(update.aspectId, [...(byAspect.get(update.aspectId) ?? []), output.atomId]);
  return [...byAspect.entries()].filter(([, atomIds]) => atomIds.length > 1).map(([aspectId, atomIds]) => `duplicate aspect update:${aspectId}:${[...new Set(atomIds)].sort().join(',')}`);
}

function validRepresentation(representation: PlanningAspectCoverageUpdate['representation']): boolean {
  return Boolean(representation && (representation.kind === 'residue' || representation.kind === 'follow-up') && nonEmpty(representation.moduleId) && nonEmpty(representation.reason) && nonEmpty(representation.validationExpectation));
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function invalid(errors: string[]): PlanningAtomOutputValidation {
  return { ok: false, errors: errors.sort() };
}
