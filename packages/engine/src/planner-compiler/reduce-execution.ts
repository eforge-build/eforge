import type { EforgeEvent } from '../events.js';
import type { PlanningAtomGraph } from './atom-graph.js';
import type { PlanningAtomOutput } from './atom-planning-contracts.js';
import { formatPlanningReducerPrompt, runPlanningReducer } from './reducer-agent.js';
import { buildPlanningReduceTask, normalizePlanningReduceOutput, validatePlanningReduceOutput, type PlanningReduceOutput, type PlanningReduceTask, type PlanningReduceTree } from './reduce-contracts.js';
import type { RunPlanningReduceInput } from './reduce-runner.js';
import { utf8ByteLength } from './source-analysis.js';
import { isAbortError } from './abort-utils.js';

export interface ReduceRunResult { output: PlanningReduceOutput; events: EforgeEvent[]; validationErrors: string[] }

export async function executePlanningReduceNode(input: Pick<RunPlanningReduceInput, 'graph' | 'cwd' | 'harness' | 'agentOptions' | 'abortSignal' | 'onEvent'>, tree: PlanningReduceTree, nodeId: string, atomOutputs: PlanningAtomOutput[], reduceOutputs: PlanningReduceOutput[]): Promise<ReduceRunResult> {
  const node = requireReduceNode(tree, nodeId);
  const task = buildTaskForReduceNode(input.graph, tree, nodeId, atomOutputs, reduceOutputs);
  const promptErrors = validateReduceTaskPromptBudget(task);
  if (promptErrors.length > 0) return { output: failedReduceOutput(node.nodeId, `invalid reduce prompt:${promptErrors.join('; ')}`), events: [], validationErrors: promptErrors };
  try {
    const result = await runPlanningReducer({ task, cwd: input.cwd, harness: input.harness, agentOptions: input.agentOptions, abortSignal: input.abortSignal, onEvent: input.onEvent });
    const output = normalizePlanningReduceOutput(result.output);
    const validation = validatePlanningReduceOutput({ graph: input.graph as PlanningAtomGraph, tree, task, output });
    if (!validation.ok) return { output: failedReduceOutput(node.nodeId, `invalid reduce output:${validation.errors.join('; ')}`), events: result.events, validationErrors: validation.errors };
    return { output, events: result.events, validationErrors: [] };
  } catch (err) {
    if (isAbortError(err)) throw err;
    return { output: failedReduceOutput(node.nodeId, err instanceof Error ? err.message : String(err)), events: [], validationErrors: [`reduce failed:${node.nodeId}:${err instanceof Error ? err.message : String(err)}`] };
  }
}

function buildTaskForReduceNode(graph: PlanningAtomGraph, tree: PlanningReduceTree, nodeId: string, atomOutputs: PlanningAtomOutput[], reduceOutputs: PlanningReduceOutput[]): PlanningReduceTask {
  const node = requireReduceNode(tree, nodeId);
  return buildPlanningReduceTask(
    tree,
    node,
    atomOutputs.filter((output) => node.inputAtomIds.includes(output.atomId)).sort((a, b) => a.atomId.localeCompare(b.atomId)),
    reduceOutputs.filter((output) => node.inputNodeIds.includes(output.nodeId)).sort((a, b) => a.nodeId.localeCompare(b.nodeId)),
    graph,
  );
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
