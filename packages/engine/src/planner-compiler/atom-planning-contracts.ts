import type { PlanningObservedBudgetPressure, PlanningUnitBudget } from '@eforge-build/client';
import type { PlanningAtom, PlanningAtomBudgetEstimate, PlanningAtomGraph, PlanningAtomReason, PlanningAtomSourceSlice } from './atom-graph.js';
import { derivePlanningAspectCoverage, derivePlanningCriterionAspects, type PlanningAspectCoverageSummary, type PlanningAspectCoverageUpdate, type PlanningCriterionAspect } from './coverage-accounting.js';
import { utf8ByteLength } from './source-analysis.js';
import type { SourceInventory } from './source-inventory.js';

export type PlanningAtomOutputStatus = 'completed' | 'skipped' | 'failed';

export interface PlanningAtomTask { graphId: string; atomId: string; title: string; reason: PlanningAtomReason; criterionIds: string[]; aspectIds: string[]; subsystemHints: string[]; evidencePaths: string[]; interfaceKeys: string[]; dependencyHints: string[]; sourceSlices: PlanningAtomSourceSlice[]; budget: PlanningUnitBudget; estimate: PlanningAtomBudgetEstimate }
export interface PlanningAtomPlanFragment { fragmentId: string; title: string; criterionIds: string[]; aspectIds: string[]; markdown: string; dependsOnFragmentIds?: string[] }
export interface PlanningAtomModuleCandidate { moduleId: string; title: string; criterionIds: string[]; aspectIds: string[]; description: string; validationExpectation: string; dependsOnModuleIds?: string[] }
export interface PlanningAtomOutput { atomId: string; status: PlanningAtomOutputStatus; aspectUpdates: PlanningAspectCoverageUpdate[]; planFragments?: PlanningAtomPlanFragment[]; moduleCandidates?: PlanningAtomModuleCandidate[]; discoveredEvidencePaths?: string[]; compactHandoff?: string; observedBudget?: PlanningObservedBudgetPressure; error?: string }
export interface BuildPlanningAtomTasksInput { graph: PlanningAtomGraph; inventory?: SourceInventory; aspects?: PlanningCriterionAspect[] }
export interface ValidatePlanningAtomOutputInput extends BuildPlanningAtomTasksInput { output: PlanningAtomOutput; task?: PlanningAtomTask }
export interface SummarizePlanningAtomOutputsInput extends BuildPlanningAtomTasksInput { outputs: PlanningAtomOutput[] }
export type PlanningAtomOutputValidation = { ok: true; errors: [] } | { ok: false; errors: string[] };
export interface PlanningAtomOutputCoverageSummary { coverage: PlanningAspectCoverageSummary; validationErrors: string[] }

export function buildPlanningAtomTasks(input: BuildPlanningAtomTasksInput): PlanningAtomTask[] {
  const aspects = input.aspects ?? derivePlanningCriterionAspects(input.graph, input.inventory);
  return input.graph.atoms.map((atom) => buildPlanningAtomTask(input.graph, atom, aspects)).sort((a, b) => a.atomId.localeCompare(b.atomId));
}

export function buildPlanningAtomTask(graph: PlanningAtomGraph, atom: PlanningAtom, aspects: PlanningCriterionAspect[]): PlanningAtomTask {
  return {
    graphId: graph.graphId,
    atomId: atom.atomId,
    title: atom.title,
    reason: atom.reason,
    criterionIds: [...atom.criterionIds],
    aspectIds: aspects.filter((aspect) => aspect.atomIds.includes(atom.atomId)).map((aspect) => aspect.aspectId).sort(),
    subsystemHints: [...atom.subsystemHints],
    evidencePaths: [...atom.evidencePaths],
    interfaceKeys: [...atom.interfaceKeys],
    dependencyHints: [...atom.dependencyHints],
    sourceSlices: atom.sourceSlices.map((slice) => ({ ...slice, criteriaIds: [...slice.criteriaIds], headingPath: [...slice.headingPath] })),
    budget: { ...atom.budget },
    estimate: { ...atom.estimate },
  };
}

export function validatePlanningAtomOutput(input: ValidatePlanningAtomOutputInput): PlanningAtomOutputValidation {
  const atom = input.graph.atoms.find((candidate) => candidate.atomId === input.output.atomId);
  if (!atom) return invalid([`unknown atom:${input.output.atomId}`]);
  const aspects = input.aspects ?? derivePlanningCriterionAspects(input.graph, input.inventory);
  const task = input.task ?? buildPlanningAtomTask(input.graph, atom, aspects);
  const errors = validateOutputForTask(input.output, task, aspects);
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
  validateUniqueIds('plan fragment', fragments.map((fragment) => fragment.fragmentId), errors);
  validateUniqueIds('module candidate', modules.map((module) => module.moduleId), errors);
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
