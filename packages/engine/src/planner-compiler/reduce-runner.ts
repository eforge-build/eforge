import type { EforgeEvent } from '../events.js';
import type { AgentHarness, SdkPassthroughConfig } from '../harness.js';
import type { PlanningAtomGraph } from './atom-graph.js';
import type { PlanningAtomMapResult } from './atom-map-runner.js';
import type { PlanningAtomOutput } from './atom-planning-contracts.js';
import { buildPlanningReduceTask, buildPlanningReduceTree, DEFAULT_PLANNING_REDUCE_LIMITS, validatePlanningReduceOutput, type PlanningReduceConflict, type PlanningReduceGap, type PlanningReduceLimits, type PlanningReduceOutput, type PlanningReduceTask, type PlanningReduceTree } from './reduce-contracts.js';
import { runPlanningReducer } from './reducer-agent.js';

export interface RunPlanningReduceInput { graph: PlanningAtomGraph; mapResult: PlanningAtomMapResult; cwd: string; harness: AgentHarness; agentOptions?: SdkPassthroughConfig & { maxTurns?: number }; limits?: Partial<PlanningReduceLimits>; abortSignal?: AbortSignal }
export interface PlanningReduceResult { graphId: string; rootNodeId?: string; tree: PlanningReduceTree; outputs: PlanningReduceOutput[]; finalOutput?: PlanningReduceOutput; conflicts: PlanningReduceConflict[]; gaps: PlanningReduceGap[]; validationErrors: string[]; reduceComplete: boolean; events: EforgeEvent[]; iterations: number }

interface ReduceRunResult { output: PlanningReduceOutput; events: EforgeEvent[]; validationErrors: string[] }

export async function runPlanningReduce(input: RunPlanningReduceInput): Promise<PlanningReduceResult> {
  const limits = { ...DEFAULT_PLANNING_REDUCE_LIMITS, ...(input.limits ?? {}) };
  const tree = buildPlanningReduceTree({ graph: input.graph, mapResult: input.mapResult, limits });
  const outputs: PlanningReduceOutput[] = [];
  const events: EforgeEvent[] = [];
  const validationErrors = [...tree.validationErrors];
  let iterations = 0;

  for (const depth of reduceDepths(tree)) {
    const runnable = tree.nodes.filter((node) => node.depth === depth && node.inputNodeIds.every((childId) => completedNodeIds(outputs).has(childId)));
    const blocked = tree.nodes.filter((node) => node.depth === depth && !runnable.includes(node));
    outputs.push(...blocked.map((node) => incompleteOutput(node.nodeId, `reduce node blocked by incomplete child:${node.inputNodeIds.join(',')}`)));
    if (runnable.length === 0) continue;
    iterations += 1;
    const results = await Promise.all(runnable.map((node) => runReduceNode(input, tree, node.nodeId, outputs)));
    for (const result of results) {
      outputs.push(result.output);
      events.push(...result.events);
      validationErrors.push(...result.validationErrors);
    }
  }

  return finish(input, tree, outputs, events, validationErrors, iterations);
}

async function runReduceNode(input: RunPlanningReduceInput, tree: PlanningReduceTree, nodeId: string, outputs: PlanningReduceOutput[]): Promise<ReduceRunResult> {
  const node = requireNode(tree, nodeId);
  const task = buildTaskForNode(tree, nodeId, input.mapResult.outputs, outputs);
  try {
    const result = await runPlanningReducer({ task, cwd: input.cwd, harness: input.harness, agentOptions: input.agentOptions, abortSignal: input.abortSignal });
    const validation = validatePlanningReduceOutput({ graph: input.graph, tree, task, output: result.output });
    if (!validation.ok) return { output: failedOutput(node.nodeId, `invalid reduce output:${validation.errors.join('; ')}`), events: result.events, validationErrors: validation.errors };
    return { output: result.output, events: result.events, validationErrors: [] };
  } catch (err) {
    if (isAbortError(err)) throw err;
    return { output: failedOutput(node.nodeId, err instanceof Error ? err.message : String(err)), events: [], validationErrors: [`reduce failed:${node.nodeId}:${err instanceof Error ? err.message : String(err)}`] };
  }
}

function finish(input: RunPlanningReduceInput, tree: PlanningReduceTree, outputs: PlanningReduceOutput[], events: EforgeEvent[], validationErrors: string[], iterations: number): PlanningReduceResult {
  const finalOutput = tree.rootNodeId ? outputs.find((output) => output.nodeId === tree.rootNodeId) : undefined;
  const allErrors = [...new Set([...validationErrors, ...(input.mapResult.mapComplete ? [] : ['map result incomplete'])])].sort();
  const sortedOutputs = outputs.sort((a, b) => a.nodeId.localeCompare(b.nodeId));
  const reduceComplete = Boolean(finalOutput && finalOutput.status === 'completed' && allErrors.length === 0 && input.mapResult.mapComplete && !hasRepresentationRequiredGaps(sortedOutputs));
  return {
    graphId: input.graph.graphId,
    ...(tree.rootNodeId ? { rootNodeId: tree.rootNodeId } : {}),
    tree,
    outputs: sortedOutputs,
    ...(finalOutput ? { finalOutput } : {}),
    conflicts: sortedOutputs.flatMap((output) => output.conflicts ?? []).sort((a, b) => a.conflictId.localeCompare(b.conflictId)),
    gaps: sortedOutputs.flatMap((output) => output.gaps ?? []).sort((a, b) => a.gapId.localeCompare(b.gapId)),
    validationErrors: allErrors,
    reduceComplete,
    events,
    iterations,
  };
}

function buildTaskForNode(tree: PlanningReduceTree, nodeId: string, atomOutputs: PlanningAtomOutput[], reduceOutputs: PlanningReduceOutput[]): PlanningReduceTask {
  const node = requireNode(tree, nodeId);
  return buildPlanningReduceTask(
    tree,
    node,
    atomOutputs.filter((output) => node.inputAtomIds.includes(output.atomId)).sort((a, b) => a.atomId.localeCompare(b.atomId)),
    reduceOutputs.filter((output) => node.inputNodeIds.includes(output.nodeId)).sort((a, b) => a.nodeId.localeCompare(b.nodeId)),
  );
}

function reduceDepths(tree: PlanningReduceTree): number[] {
  return [...new Set(tree.nodes.map((node) => node.depth))].sort((a, b) => a - b);
}

function completedNodeIds(outputs: PlanningReduceOutput[]): Set<string> {
  return new Set(outputs.filter((output) => output.status === 'completed').map((output) => output.nodeId));
}

function requireNode(tree: PlanningReduceTree, nodeId: string) {
  const node = tree.nodes.find((candidate) => candidate.nodeId === nodeId);
  if (!node) throw new Error(`missing reduce node:${nodeId}`);
  return node;
}

function hasRepresentationRequiredGaps(outputs: PlanningReduceOutput[]): boolean {
  return outputs.some((output) => output.gaps?.some((gap) => gap.representationRequired));
}

function failedOutput(nodeId: string, error: string): PlanningReduceOutput {
  return { nodeId, status: 'failed', compactSummary: '', error };
}

function incompleteOutput(nodeId: string, error: string): PlanningReduceOutput {
  return { nodeId, status: 'incomplete', compactSummary: error, error };
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}
