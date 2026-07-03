import type { PlanningAtomGraph } from './atom-graph.js';
import type { PlanningAtomMapResult } from './atom-map-runner.js';
import type { PlanningAtomOutput, PlanningAtomTask } from './atom-planning-contracts.js';
import { buildPlanningReduceTask, buildPlanningReduceTree, buildPlanningReduceTreeFromAtomTasks, normalizePlanningReduceBudget, type PlanningReduceBudget, type PlanningReduceLimits, type PlanningReduceNode, type PlanningReduceOutput, type PlanningReduceTree } from './reduce-contracts.js';
import { reduceDigestPromptByteLength, REDUCE_DIGEST_LIMITS, REDUCE_DIGEST_PROMPT_BUDGETING, type PlanningReduceDigest, type PlanningReduceDigestSourceKind } from './reduce-digest-contracts.js';
import { formatPlanningReducerPrompt } from './reducer-agent.js';
import { utf8ByteLength } from './source-analysis.js';

const MIN_REDUCE_FAN_IN = REDUCE_DIGEST_PROMPT_BUDGETING.minReduceFanIn;
const SYNTHETIC_DIGEST_MAX_FRAGMENTS = 16;
const SYNTHETIC_DIGEST_FRAGMENT_CRITERION_LIMIT = 32;
const SYNTHETIC_DIGEST_FRAGMENT_ASPECT_LIMIT = 64;

export interface PlanPromptSafeReduceTreeInput { graph: PlanningAtomGraph; mapResult: Pick<PlanningAtomMapResult, 'outputs' | 'coverage'>; limits: PlanningReduceLimits }
export interface PlanPromptSafeReduceTreeFromTasksInput { graph: PlanningAtomGraph; tasks: PlanningAtomTask[]; limits: PlanningReduceLimits }
export interface PromptSafeReduceTreePlan { ok: boolean; tree: PlanningReduceTree; validationErrors: string[]; maxReduceDigestPromptBytes: number }
export interface DeriveInitialReduceDigestPromptBudgetInput { graph: PlanningAtomGraph; limits: PlanningReduceLimits }

export function deriveInitialReduceDigestPromptBudget(input: DeriveInitialReduceDigestPromptBudgetInput): number {
  const acceptedCount = input.graph.atoms.length;
  const minFanIn = acceptedCount > 1 ? MIN_REDUCE_FAN_IN : 1;
  const limits = normalizePlanningReduceBudget({ ...input.limits, maxInputsPerReduce: minFanIn });
  const pseudoMap = { outputs: input.graph.atoms.map((atom) => atomPlaceholderOutput(atom.atomId, atom.criterionIds)), coverage: emptyCoverage() };
  const tree = buildPlanningReduceTree({ graph: input.graph, mapResult: pseudoMap, limits });
  const levelZeroNodes = tree.nodes.filter((node) => node.depth === 0);
  if (levelZeroNodes.length === 0) return limits.maxReduceDigestPromptBytes;
  // Only the minimum slot across nodes matters, so thread it through as the
  // search cap: structurally similar nodes confirm the cap with a single probe
  // instead of re-running the full binary search per node.
  let cap = Math.max(1, tree.limits.maxReducePromptBytes);
  for (const node of levelZeroNodes) {
    cap = maxDigestSlotForNode(tree, node, { atomOutputs: pseudoMap.outputs.filter((output) => node.inputAtomIds.includes(output.atomId)), childOutputs: [] }, cap);
  }
  return Math.max(1, cap);
}

export function planPromptSafeReduceTree(input: PlanPromptSafeReduceTreeInput): PromptSafeReduceTreePlan {
  return planPromptSafeReduceTreeCore({
    graph: input.graph,
    limits: input.limits,
    acceptedCount: input.mapResult.outputs.filter((output) => output.status !== 'failed').length,
    atomOutputs: input.mapResult.outputs,
    buildTree: (limits) => buildPlanningReduceTree({ graph: input.graph, mapResult: input.mapResult, limits }),
  });
}

export function planPromptSafeReduceTreeFromTasks(input: PlanPromptSafeReduceTreeFromTasksInput): PromptSafeReduceTreePlan {
  const atomOutputs = input.tasks.map((task) => atomTaskPlaceholderOutput(task));
  return planPromptSafeReduceTreeCore({
    graph: input.graph,
    limits: input.limits,
    acceptedCount: input.tasks.length,
    atomOutputs,
    buildTree: (limits) => buildPlanningReduceTreeFromAtomTasks({ graph: input.graph, tasks: input.tasks, limits }),
  });
}

function planPromptSafeReduceTreeCore(input: { graph: PlanningAtomGraph; limits: PlanningReduceLimits; acceptedCount: number; atomOutputs: PlanningAtomOutput[]; buildTree: (limits: PlanningReduceBudget) => PlanningReduceTree }): PromptSafeReduceTreePlan {
  const baseLimits = normalizePlanningReduceBudget(input.limits);
  const minFanIn = input.acceptedCount > 1 ? MIN_REDUCE_FAN_IN : 1;
  const maxFanIn = Math.max(baseLimits.maxInputsPerReduce, minFanIn);
  let fallbackTree = input.buildTree(normalizePlanningReduceBudget({ ...baseLimits, maxInputsPerReduce: minFanIn }));
  let lastErrors: string[] = [];

  for (let fanIn = maxFanIn; fanIn >= minFanIn; fanIn -= 1) {
    const candidateBase = normalizePlanningReduceBudget({ ...baseLimits, maxInputsPerReduce: fanIn });
    const initialTree = input.buildTree(candidateBase);
    fallbackTree = initialTree;
    const budget = deriveTreeDigestPromptBudget(initialTree, input.atomOutputs);
    const tree = withReduceBudget(initialTree, { ...candidateBase, maxReduceDigestPromptBytes: budget });
    const errors = validatePromptSafeTree(tree, input.atomOutputs);
    lastErrors = errors;
    if (errors.length === 0) return { ok: true, tree, validationErrors: [], maxReduceDigestPromptBytes: budget };
  }

  const budget = Math.max(1, fallbackTree.limits.maxReduceDigestPromptBytes);
  return { ok: false, tree: withReduceBudget(fallbackTree, { ...fallbackTree.limits, maxReduceDigestPromptBytes: budget }), validationErrors: lastErrors.length > 0 ? lastErrors : ['reduce prompt budget planning failed'], maxReduceDigestPromptBytes: budget };
}

export function validatePromptSafeTree(tree: PlanningReduceTree, atomOutputs: PlanningAtomOutput[]): string[] {
  const errors = [...tree.validationErrors];
  const syntheticOutputs = new Map<string, PlanningReduceOutput>();
  for (const depth of reduceDepths(tree)) {
    for (const node of tree.nodes.filter((candidate) => candidate.depth === depth)) {
      const childOutputs = node.inputNodeIds.map((nodeId) => syntheticOutputs.get(nodeId)).filter((output): output is PlanningReduceOutput => output !== undefined);
      const atomInputs = atomOutputs
        .filter((output) => node.inputAtomIds.includes(output.atomId))
        .map((output) => output.reduceDigest ? output : { ...output, reduceDigest: syntheticDigest(output.atomId, 'atom', tree.limits.maxReduceDigestPromptBytes, node.criterionIds, node.aspectIds) });
      const task = buildPlanningReduceTask(tree, node, atomInputs, childOutputs);
      const promptBytes = utf8ByteLength(formatPlanningReducerPrompt(task));
      if (promptBytes > task.budget.maxReducePromptBytes) errors.push(`reduce prompt budget exceeded:${node.nodeId}`);
      syntheticOutputs.set(node.nodeId, syntheticReduceOutput(node, task.budget.maxReduceDigestPromptBytes));
    }
  }
  return [...new Set(errors)].sort();
}

function deriveTreeDigestPromptBudget(tree: PlanningReduceTree, atomOutputs: PlanningAtomOutput[]): number {
  if (tree.nodes.length === 0) return tree.limits.maxReduceDigestPromptBytes;
  // Only the minimum slot across nodes matters, so thread it through as the
  // search cap: structurally similar nodes confirm the cap with a single probe
  // instead of re-running the full binary search per node.
  let cap = Math.max(1, Math.min(tree.limits.maxReducePromptBytes, tree.limits.maxReduceDigestPromptBytes));
  for (const node of tree.nodes) {
    const childOutputs = node.inputNodeIds.map((nodeId) => syntheticReduceOutput(requireNode(tree, nodeId), tree.limits.maxReduceDigestPromptBytes));
    cap = maxDigestSlotForNode(tree, node, { atomOutputs: atomOutputs.filter((output) => node.inputAtomIds.includes(output.atomId)), childOutputs }, cap);
  }
  return Math.max(1, cap);
}

function maxDigestSlotForNode(tree: PlanningReduceTree, node: PlanningReduceNode, inputs: { atomOutputs: PlanningAtomOutput[]; childOutputs: PlanningReduceOutput[] }, maxBudget: number): number {
  const fits = (digestBudget: number): boolean => {
    const task = buildPlanningReduceTask(
      withReduceBudget(tree, { ...tree.limits, maxReduceDigestPromptBytes: digestBudget }),
      node,
      inputs.atomOutputs.map((output) => output.reduceDigest ? output : { ...output, reduceDigest: syntheticDigest(output.atomId, 'atom', digestBudget, node.criterionIds, node.aspectIds) }),
      inputs.childOutputs.map((output) => ({ ...output, reduceDigest: syntheticDigest(output.nodeId, 'reduce', digestBudget, node.criterionIds, node.aspectIds) })),
    );
    return utf8ByteLength(formatPlanningReducerPrompt(task)) <= task.budget.maxReducePromptBytes;
  };
  const upper = Math.max(1, maxBudget);
  if (fits(upper)) return upper;
  let low = 1;
  let high = upper - 1;
  let best = 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (fits(mid)) { best = mid; low = mid + 1; }
    else high = mid - 1;
  }
  return best;
}

function syntheticReduceOutput(node: PlanningReduceNode, digestBytes: number): PlanningReduceOutput {
  return { nodeId: node.nodeId, status: 'completed', compactSummary: `Synthetic budget placeholder for ${node.nodeId}.`, reduceDigest: syntheticDigest(node.nodeId, 'reduce', digestBytes, node.criterionIds, node.aspectIds) };
}

function atomPlaceholderOutput(atomId: string, criterionIds: string[]): PlanningAtomOutput {
  const aspectIds = criterionIds.map((criterionId) => `${criterionId}:general:general`);
  return { atomId, status: 'completed', aspectUpdates: aspectIds.map((aspectId) => ({ aspectId, status: 'resolved', completedByAtomIds: [atomId] })) };
}

function atomTaskPlaceholderOutput(task: PlanningAtomTask): PlanningAtomOutput {
  return {
    atomId: task.atomId,
    status: 'completed',
    aspectUpdates: task.aspectIds.map((aspectId) => ({ aspectId, status: 'resolved', completedByAtomIds: [task.atomId] })),
  };
}

function syntheticDigest(sourceId: string, sourceKind: PlanningReduceDigestSourceKind, targetPromptBytes: number, criterionIds: string[], aspectIds: string[]): PlanningReduceDigest {
  const digest: PlanningReduceDigest = {
    sourceId,
    sourceKind,
    status: 'completed',
    summary: 'Synthetic bounded digest for prompt budget planning.',
    criterionIds: nonEmptyOrFallback(criterionIds, 'ac-budget'),
    aspectIds: nonEmptyOrFallback(aspectIds, 'ac-budget:general:general'),
  };
  let remaining = Math.max(0, targetPromptBytes - reduceDigestPromptByteLength(digest));
  if (remaining === 0) return digest;
  digest.fragments = [];
  let index = 0;
  while (remaining > 0 && digest.fragments.length < SYNTHETIC_DIGEST_MAX_FRAGMENTS) {
    const intentLength = maxNextFragmentIntentLength(digest, targetPromptBytes, index);
    if (intentLength <= 0) break;
    digest.fragments.push({ fragmentId: `budget-fragment-${index}`, title: `Budget fragment ${index}`, intent: 'x'.repeat(intentLength), criterionIds: digest.criterionIds.slice(0, SYNTHETIC_DIGEST_FRAGMENT_CRITERION_LIMIT), aspectIds: digest.aspectIds.slice(0, SYNTHETIC_DIGEST_FRAGMENT_ASPECT_LIMIT) });
    const nextRemaining = targetPromptBytes - reduceDigestPromptByteLength(digest);
    if (nextRemaining >= remaining) break;
    remaining = Math.max(0, nextRemaining);
    index += 1;
  }
  return digest;
}

function maxNextFragmentIntentLength(digest: PlanningReduceDigest, targetPromptBytes: number, index: number): number {
  let low = 0;
  let high = REDUCE_DIGEST_LIMITS.fragmentIntentBytes;
  let best = 0;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate: PlanningReduceDigest = { ...digest, fragments: [...(digest.fragments ?? []), { fragmentId: `budget-fragment-${index}`, title: `Budget fragment ${index}`, intent: 'x'.repeat(mid), criterionIds: digest.criterionIds.slice(0, SYNTHETIC_DIGEST_FRAGMENT_CRITERION_LIMIT), aspectIds: digest.aspectIds.slice(0, SYNTHETIC_DIGEST_FRAGMENT_ASPECT_LIMIT) }] };
    if (reduceDigestPromptByteLength(candidate) <= targetPromptBytes) { best = mid; low = mid + 1; }
    else high = mid - 1;
  }
  return best;
}

function withReduceBudget(tree: PlanningReduceTree, budget: PlanningReduceBudget): PlanningReduceTree {
  return { ...tree, limits: budget };
}

function requireNode(tree: PlanningReduceTree, nodeId: string): PlanningReduceNode {
  const node = tree.nodes.find((candidate) => candidate.nodeId === nodeId);
  if (!node) throw new Error(`missing reduce node:${nodeId}`);
  return node;
}

function reduceDepths(tree: PlanningReduceTree): number[] {
  return [...new Set(tree.nodes.map((node) => node.depth))].sort((a, b) => a - b);
}

function emptyCoverage(): PlanningAtomMapResult['coverage'] {
  return { totalCriteria: 0, completeCriteria: [], incompleteCriteria: [], rawCriterionCoverage: [], aspects: [], criteria: [], coverageByAtom: {}, validationErrors: [] };
}

function nonEmptyOrFallback(values: string[], fallback: string): string[] {
  const filtered = values.filter((value) => value.trim().length > 0);
  return filtered.length > 0 ? filtered : [fallback];
}
