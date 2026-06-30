import { utf8ByteLength } from './source-analysis.js';
import type { PlanningAtomGraph } from './atom-graph.js';
import type { PlanningAtomMapResult } from './atom-map-runner.js';
import type { PlanningAtomModuleCandidate, PlanningAtomOutput, PlanningAtomPlanFragment } from './atom-planning-contracts.js';

export interface PlanningReduceLimits { maxInputsPerReduce: number; maxReduceDepth: number; maxReducePromptBytes: number; maxReduceSummaryBytes: number }
export interface PlanningReduceBudget extends PlanningReduceLimits {}
export type PlanningReduceOutputStatus = 'completed' | 'failed' | 'incomplete';
export interface PlanningReduceNode { nodeId: string; depth: number; inputAtomIds: string[]; inputNodeIds: string[]; criterionIds: string[]; aspectIds: string[] }
export interface PlanningReduceTree { graphId: string; nodes: PlanningReduceNode[]; rootNodeId?: string; limits: PlanningReduceLimits; validationErrors: string[] }
export interface PlanningReduceConflict { conflictId: string; title: string; criterionIds: string[]; aspectIds: string[]; description: string; sourceIds?: string[] }
export interface PlanningReduceGap { gapId: string; title: string; criterionIds: string[]; aspectIds: string[]; description: string; representationRequired: boolean; sourceIds?: string[] }
export interface PlanningReduceTask { graphId: string; node: PlanningReduceNode; atomOutputs: PlanningAtomOutput[]; childOutputs: PlanningReduceOutput[]; budget: PlanningReduceBudget }
export interface PlanningReduceOutput { nodeId: string; status: PlanningReduceOutputStatus; compactSummary: string; planFragments?: PlanningAtomPlanFragment[]; moduleCandidates?: PlanningAtomModuleCandidate[]; conflicts?: PlanningReduceConflict[]; gaps?: PlanningReduceGap[]; validationStrategy?: string; error?: string }
export interface BuildPlanningReduceTreeInput { graph: PlanningAtomGraph; mapResult: Pick<PlanningAtomMapResult, 'outputs' | 'coverage'>; limits: PlanningReduceLimits }
export interface ValidatePlanningReduceOutputInput { graph: PlanningAtomGraph; tree: PlanningReduceTree; task: PlanningReduceTask; output: PlanningReduceOutput }
export type PlanningReduceOutputValidation = { ok: true; errors: [] } | { ok: false; errors: string[] };

export const DEFAULT_PLANNING_REDUCE_LIMITS: PlanningReduceLimits = { maxInputsPerReduce: 4, maxReduceDepth: 6, maxReducePromptBytes: 24_000, maxReduceSummaryBytes: 8_000 };

export function buildPlanningReduceTree(input: BuildPlanningReduceTreeInput): PlanningReduceTree {
  const accepted = input.mapResult.outputs.filter((output) => output.status !== 'failed').sort((a, b) => a.atomId.localeCompare(b.atomId));
  const nodes: PlanningReduceNode[] = [];
  let level = chunks(accepted.map((output) => output.atomId), input.limits.maxInputsPerReduce).map((atomIds, index) => nodeForInputs(`reduce-000-${String(index + 1).padStart(3, '0')}`, 0, atomIds, [], input));
  nodes.push(...level);
  let depth = 1;
  while (level.length > 1) {
    level = chunks(level.map((node) => node.nodeId), input.limits.maxInputsPerReduce).map((nodeIds, index) => nodeForInputs(`reduce-${String(depth).padStart(3, '0')}-${String(index + 1).padStart(3, '0')}`, depth, [], nodeIds, input, nodes));
    nodes.push(...level);
    depth += 1;
  }
  const validationErrors = validateReduceTree(nodes, input.limits);
  return { graphId: input.graph.graphId, nodes, ...(level[0] ? { rootNodeId: level[0].nodeId } : {}), limits: input.limits, validationErrors };
}

export function buildPlanningReduceTask(tree: PlanningReduceTree, node: PlanningReduceNode, atomOutputs: PlanningAtomOutput[], childOutputs: PlanningReduceOutput[]): PlanningReduceTask {
  return { graphId: tree.graphId, node: cloneNode(node), atomOutputs: atomOutputs.map(cloneAtomOutput), childOutputs: childOutputs.map(cloneReduceOutput), budget: { ...tree.limits } };
}

export function validatePlanningReduceOutput(input: ValidatePlanningReduceOutputInput): PlanningReduceOutputValidation {
  const errors = validateReduceOutput(input);
  return errors.length === 0 ? { ok: true, errors: [] } : { ok: false, errors: errors.sort() };
}

function nodeForInputs(nodeId: string, depth: number, inputAtomIds: string[], inputNodeIds: string[], input: BuildPlanningReduceTreeInput, priorNodes: PlanningReduceNode[] = []): PlanningReduceNode {
  const atomById = new Map(input.mapResult.outputs.map((output) => [output.atomId, output]));
  const nodeById = new Map(priorNodes.map((node) => [node.nodeId, node]));
  const atomCriteria = inputAtomIds.flatMap((atomId) => {
    const output = atomById.get(atomId);
    return [...(output?.planFragments?.flatMap((fragment) => fragment.criterionIds) ?? []), ...(output?.moduleCandidates?.flatMap((module) => module.criterionIds) ?? [])];
  });
  const atomAspects = inputAtomIds.flatMap((atomId) => atomById.get(atomId)?.aspectUpdates.map((update) => update.aspectId) ?? []);
  const childCriteria = inputNodeIds.flatMap((nodeId) => nodeById.get(nodeId)?.criterionIds ?? []);
  const childAspects = inputNodeIds.flatMap((nodeId) => nodeById.get(nodeId)?.aspectIds ?? []);
  return { nodeId, depth, inputAtomIds: [...inputAtomIds].sort(), inputNodeIds: [...inputNodeIds].sort(), criterionIds: uniq([...atomCriteria, ...childCriteria]), aspectIds: uniq([...atomAspects, ...childAspects]) };
}

function validateReduceTree(nodes: PlanningReduceNode[], limits: PlanningReduceLimits): string[] {
  const errors: string[] = [];
  const ids = nodes.map((node) => node.nodeId);
  const idSet = new Set(ids);
  if (idSet.size !== ids.length) errors.push('duplicate reduce node id');
  for (const node of nodes) {
    const inputCount = node.inputAtomIds.length + node.inputNodeIds.length;
    if (inputCount === 0) errors.push(`reduce node has no inputs:${node.nodeId}`);
    if (inputCount > limits.maxInputsPerReduce) errors.push(`reduce node fan-in exceeded:${node.nodeId}`);
    if (node.depth > limits.maxReduceDepth) errors.push(`reduce depth exceeded:${node.nodeId}`);
    for (const childId of node.inputNodeIds) if (!idSet.has(childId)) errors.push(`missing reduce child:${node.nodeId}:${childId}`);
  }
  return errors.sort();
}

function validateReduceOutput(input: ValidatePlanningReduceOutputInput): string[] {
  const errors: string[] = [];
  const { output, task } = input;
  if (output.nodeId !== task.node.nodeId) errors.push(`reduce output node mismatch:${output.nodeId}->${task.node.nodeId}`);
  if (output.status === 'failed' && ((output.planFragments?.length ?? 0) > 0 || (output.moduleCandidates?.length ?? 0) > 0)) errors.push(`failed reduce output must not produce planning artifacts:${output.nodeId}`);
  if (output.status === 'completed' && output.gaps?.some((gap) => gap.representationRequired)) errors.push(`completed reduce output has unrepresented gaps:${output.nodeId}`);
  if (output.status !== 'failed' && !nonEmpty(output.compactSummary)) errors.push(`reduce output requires compact summary:${output.nodeId}`);
  if (utf8ByteLength(output.compactSummary ?? '') > task.budget.maxReduceSummaryBytes) errors.push(`reduce summary budget exceeded:${output.nodeId}`);
  validateUniqueIds('plan fragment', output.planFragments?.map((fragment) => fragment.fragmentId) ?? [], errors);
  validateUniqueIds('module candidate', output.moduleCandidates?.map((module) => module.moduleId) ?? [], errors);
  validateUniqueIds('reduce conflict', output.conflicts?.map((conflict) => conflict.conflictId) ?? [], errors);
  validateUniqueIds('reduce gap', output.gaps?.map((gap) => gap.gapId) ?? [], errors);
  for (const fragment of output.planFragments ?? []) validateFragment(task, fragment, output.planFragments ?? [], errors);
  for (const module of output.moduleCandidates ?? []) validateModule(task, module, output.moduleCandidates ?? [], errors);
  for (const conflict of output.conflicts ?? []) validateIssue(task, 'conflict', conflict.conflictId, conflict.criterionIds, conflict.aspectIds, conflict.description, errors);
  for (const gap of output.gaps ?? []) validateIssue(task, 'gap', gap.gapId, gap.criterionIds, gap.aspectIds, gap.description, errors);
  return errors;
}

function validateFragment(task: PlanningReduceTask, fragment: PlanningAtomPlanFragment, siblings: PlanningAtomPlanFragment[], errors: string[]): void {
  if (!nonEmpty(fragment.fragmentId)) errors.push('plan fragment requires id');
  if (!nonEmpty(fragment.markdown)) errors.push(`plan fragment requires markdown:${fragment.fragmentId}`);
  if (utf8ByteLength(fragment.markdown) > task.budget.maxReduceSummaryBytes) errors.push(`plan fragment budget exceeded:${fragment.fragmentId}`);
  validateLinkedIds(task, fragment.fragmentId, fragment.criterionIds, fragment.aspectIds, errors);
  validateDependencyIds('plan fragment', fragment.fragmentId, fragment.dependsOnFragmentIds, availableFragmentIds(task, siblings), errors);
}

function validateModule(task: PlanningReduceTask, module: PlanningAtomModuleCandidate, siblings: PlanningAtomModuleCandidate[], errors: string[]): void {
  if (!nonEmpty(module.moduleId)) errors.push('module candidate requires id');
  if (!nonEmpty(module.description)) errors.push(`module candidate requires description:${module.moduleId}`);
  if (!nonEmpty(module.validationExpectation)) errors.push(`module candidate requires validation expectation:${module.moduleId}`);
  validateLinkedIds(task, module.moduleId, module.criterionIds, module.aspectIds, errors);
  validateDependencyIds('module candidate', module.moduleId, module.dependsOnModuleIds, availableModuleIds(task, siblings), errors);
}

function validateIssue(task: PlanningReduceTask, kind: string, id: string, criterionIds: string[], aspectIds: string[], description: string, errors: string[]): void {
  if (!nonEmpty(id)) errors.push(`reduce ${kind} requires id`);
  if (!nonEmpty(description)) errors.push(`reduce ${kind} requires description:${id}`);
  validateLinkedIds(task, id, criterionIds, aspectIds, errors);
}

function validateLinkedIds(task: PlanningReduceTask, id: string, criterionIds: string[], aspectIds: string[], errors: string[]): void {
  if (criterionIds.length === 0 || aspectIds.length === 0) errors.push(`reduce output must link criteria and aspects:${id}`);
  for (const criterionId of criterionIds) if (!task.node.criterionIds.includes(criterionId)) errors.push(`unknown criterion for reduce output:${id}:${criterionId}`);
  for (const aspectId of aspectIds) if (!task.node.aspectIds.includes(aspectId)) errors.push(`unknown aspect for reduce output:${id}:${aspectId}`);
}

function availableFragmentIds(task: PlanningReduceTask, siblings: PlanningAtomPlanFragment[]): string[] {
  return [...siblings.flatMap((fragment) => fragment.fragmentId), ...task.atomOutputs.flatMap((output) => output.planFragments?.map((fragment) => fragment.fragmentId) ?? []), ...task.childOutputs.flatMap((output) => output.planFragments?.map((fragment) => fragment.fragmentId) ?? [])];
}

function availableModuleIds(task: PlanningReduceTask, siblings: PlanningAtomModuleCandidate[]): string[] {
  return [...siblings.flatMap((module) => module.moduleId), ...task.atomOutputs.flatMap((output) => output.moduleCandidates?.map((module) => module.moduleId) ?? []), ...task.childOutputs.flatMap((output) => output.moduleCandidates?.map((module) => module.moduleId) ?? [])];
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

function chunks<T>(values: T[], size: number): T[][] {
  const safeSize = Math.max(1, size);
  return Array.from({ length: Math.ceil(values.length / safeSize) }, (_, index) => values.slice(index * safeSize, (index + 1) * safeSize));
}

function cloneNode(node: PlanningReduceNode): PlanningReduceNode { return { ...node, inputAtomIds: [...node.inputAtomIds], inputNodeIds: [...node.inputNodeIds], criterionIds: [...node.criterionIds], aspectIds: [...node.aspectIds] }; }
function cloneAtomOutput(output: PlanningAtomOutput): PlanningAtomOutput { return { ...output, aspectUpdates: output.aspectUpdates.map((update) => ({ ...update, completedByAtomIds: update.completedByAtomIds ? [...update.completedByAtomIds] : undefined })), planFragments: output.planFragments?.map((fragment) => ({ ...fragment, criterionIds: [...fragment.criterionIds], aspectIds: [...fragment.aspectIds], dependsOnFragmentIds: fragment.dependsOnFragmentIds ? [...fragment.dependsOnFragmentIds] : undefined })), moduleCandidates: output.moduleCandidates?.map((module) => ({ ...module, criterionIds: [...module.criterionIds], aspectIds: [...module.aspectIds], dependsOnModuleIds: module.dependsOnModuleIds ? [...module.dependsOnModuleIds] : undefined })) }; }
function cloneReduceOutput(output: PlanningReduceOutput): PlanningReduceOutput { return { ...output, planFragments: output.planFragments?.map((fragment) => ({ ...fragment, criterionIds: [...fragment.criterionIds], aspectIds: [...fragment.aspectIds], dependsOnFragmentIds: fragment.dependsOnFragmentIds ? [...fragment.dependsOnFragmentIds] : undefined })), moduleCandidates: output.moduleCandidates?.map((module) => ({ ...module, criterionIds: [...module.criterionIds], aspectIds: [...module.aspectIds], dependsOnModuleIds: module.dependsOnModuleIds ? [...module.dependsOnModuleIds] : undefined })), conflicts: output.conflicts?.map((conflict) => ({ ...conflict, criterionIds: [...conflict.criterionIds], aspectIds: [...conflict.aspectIds], sourceIds: conflict.sourceIds ? [...conflict.sourceIds] : undefined })), gaps: output.gaps?.map((gap) => ({ ...gap, criterionIds: [...gap.criterionIds], aspectIds: [...gap.aspectIds], sourceIds: gap.sourceIds ? [...gap.sourceIds] : undefined })) }; }
function uniq(values: string[]): string[] { return [...new Set(values)].filter(nonEmpty).sort(); }
function nonEmpty(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
