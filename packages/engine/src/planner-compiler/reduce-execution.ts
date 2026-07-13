import type { EforgeEvent } from '../events.js';
import type { PlanningAtomGraph } from './atom-graph.js';
import type { PlanningAtomOutput } from './atom-planning-contracts.js';
import { formatPlanningReducerPrompt, runPlanningReducer } from './reducer-agent.js';
import { buildPlanningReduceTask, normalizePlanningReduceOutput, validatePlanningReduceOutput, type PlanningReduceOutput, type PlanningReduceTask, type PlanningReduceTree } from './reduce-contracts.js';
import type { RunPlanningReduceInput } from './reduce-runner.js';
import type { SourceLocalizationBundle } from './source-localization-contracts.js';
import { utf8ByteLength } from './source-analysis.js';
import { isAbortError } from './abort-utils.js';

export interface ReduceRunResult { output: PlanningReduceOutput; events: EforgeEvent[]; validationErrors: string[] }

export async function executePlanningReduceNode(input: Pick<RunPlanningReduceInput, 'graph' | 'cwd' | 'harness' | 'agentOptions' | 'abortSignal' | 'onEvent' | 'sourceLocalizationBundle'>, tree: PlanningReduceTree, nodeId: string, atomOutputs: PlanningAtomOutput[], reduceOutputs: PlanningReduceOutput[]): Promise<ReduceRunResult> {
  const node = requireReduceNode(tree, nodeId);
  const task = buildTaskForReduceNode(input.graph, tree, nodeId, atomOutputs, reduceOutputs, input.sourceLocalizationBundle);
  const promptErrors = validateReduceTaskPromptBudget(task);
  if (promptErrors.length > 0) return { output: failedReduceOutput(node.nodeId, `invalid reduce prompt:${promptErrors.join('; ')}`), events: [], validationErrors: promptErrors };
  try {
    const result = await runPlanningReducer({ task, cwd: input.cwd, harness: input.harness, agentOptions: input.agentOptions, abortSignal: input.abortSignal, onEvent: input.onEvent });
    const normalized = normalizePlanningReduceOutput(result.output);
    const { output, diagnostics } = quarantineGapCatalogIds(normalized, task);
    const validation = validatePlanningReduceOutput({ graph: input.graph as PlanningAtomGraph, tree, task, output });
    if (!validation.ok) return { output: failedReduceOutput(node.nodeId, `invalid reduce output:${validation.errors.join('; ')}`), events: result.events, validationErrors: validation.errors };
    return { output, events: result.events, validationErrors: diagnostics };
  } catch (err) {
    if (isAbortError(err)) throw err;
    return { output: failedReduceOutput(node.nodeId, err instanceof Error ? err.message : String(err)), events: [], validationErrors: [`reduce failed:${node.nodeId}:${err instanceof Error ? err.message : String(err)}`] };
  }
}

function buildTaskForReduceNode(graph: PlanningAtomGraph, tree: PlanningReduceTree, nodeId: string, atomOutputs: PlanningAtomOutput[], reduceOutputs: PlanningReduceOutput[], bundle?: SourceLocalizationBundle): PlanningReduceTask {
  const node = requireReduceNode(tree, nodeId);
  const descendantAtomIds = nodeAtomIds(tree, node);
  const validSourceNeedIds = bundle && bundle.records.filter((record) => record.assignedAtomIds.some((atomId) => descendantAtomIds.includes(atomId))).map((record) => record.needId);
  return buildPlanningReduceTask(
    tree,
    node,
    atomOutputs.filter((output) => node.inputAtomIds.includes(output.atomId)).sort((a, b) => a.atomId.localeCompare(b.atomId)),
    reduceOutputs.filter((output) => node.inputNodeIds.includes(output.nodeId)).sort((a, b) => a.nodeId.localeCompare(b.nodeId)),
    graph,
    validSourceNeedIds,
  );
}

function nodeAtomIds(tree: PlanningReduceTree, node: PlanningReduceTree['nodes'][number]): string[] {
  const nodes = new Map(tree.nodes.map((item) => [item.nodeId, item]));
  const visit = (item: PlanningReduceTree['nodes'][number]): string[] => [...item.inputAtomIds, ...item.inputNodeIds.flatMap((id) => {
    const child = nodes.get(id);
    return child ? visit(child) : [];
  })];
  return [...new Set(visit(node))].sort();
}

function quarantineGapCatalogIds(output: PlanningReduceOutput, task: PlanningReduceTask): { output: PlanningReduceOutput; diagnostics: string[] } {
  const diagnostics: string[] = [];
  const gaps = output.gaps?.map((gap) => {
    const sourceNeedIds = gap.sourceNeedIds?.filter((id) => {
      const valid = !task.sourceNeedCatalogAvailable || task.validSourceNeedIds.includes(id);
      if (!valid) diagnostics.push(`dropped unknown source need for reduce gap:${gap.gapId}:${id}`);
      return valid;
    });
    const affectedAtomIds = gap.affectedAtomIds?.filter((id) => {
      const valid = task.validAffectedAtomIds.includes(id);
      if (!valid) diagnostics.push(`dropped unknown affected atom for reduce gap:${gap.gapId}:${id}`);
      return valid;
    });
    return { ...gap, ...(gap.sourceNeedIds ? { sourceNeedIds } : {}), ...(gap.affectedAtomIds ? { affectedAtomIds } : {}) };
  });
  return { output: gaps ? { ...output, gaps } : output, diagnostics: diagnostics.slice(0, 128) };
}

export function validateReduceTaskPromptBudget(task: PlanningReduceTask): string[] {
  return utf8ByteLength(formatPlanningReducerPrompt(task)) > task.budget.maxReducePromptBytes ? [`reduce prompt budget exceeded:${task.node.nodeId}`] : [];
}

export function failedReduceRun(nodeId: string, err: unknown): ReduceRunResult {
  const message = err instanceof Error ? err.message : String(err);
  return { output: failedReduceOutput(nodeId, message), events: [], validationErrors: [`reduce failed:${nodeId}:${message}`] };
}

export function failedReduceOutput(nodeId: string, error: string): PlanningReduceOutput {
  return { nodeId, status: 'failed', compactSummary: '', error };
}

export function incompleteReduceOutput(nodeId: string, error: string): PlanningReduceOutput {
  return { nodeId, status: 'incomplete', compactSummary: error, error };
}

function requireReduceNode(tree: PlanningReduceTree, nodeId: string) {
  const node = tree.nodes.find((candidate) => candidate.nodeId === nodeId);
  if (!node) throw new Error(`missing reduce node:${nodeId}`);
  return node;
}
