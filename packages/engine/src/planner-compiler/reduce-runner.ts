import type { EforgeEvent } from '../events.js';
import type { AgentHarness, SdkPassthroughConfig } from '../harness.js';
import type { PlanningAtomGraph } from './atom-graph.js';
import type { PlanningAtomMapResult } from './atom-map-runner.js';
import type { PlanningAtomOutput } from './atom-planning-contracts.js';
import { buildPlanningReduceTask, DEFAULT_PLANNING_REDUCE_LIMITS, normalizePlanningReduceOutput, validatePlanningReduceOutput, type PlanningReduceConflict, type PlanningReduceGap, type PlanningReduceLimits, type PlanningReduceOutput, type PlanningReduceTask, type PlanningReduceTree } from './reduce-contracts.js';
import { runPlanningReducer } from './reducer-agent.js';
import { planPromptSafeReduceTree } from './prompt-budget-planner.js';
import type { PlannerCompilerEventSink } from './event-sink.js';
import { buildMapReduceReduceTreeEvent, buildMapReduceReduceStatusEvent } from './orchestration-events.js';

export interface RunPlanningReduceInput { graph: PlanningAtomGraph; mapResult: PlanningAtomMapResult; cwd: string; harness: AgentHarness; agentOptions?: SdkPassthroughConfig & { maxTurns?: number }; limits?: Partial<PlanningReduceLimits>; abortSignal?: AbortSignal; onEvent?: PlannerCompilerEventSink }
export interface PlanningReduceResult { graphId: string; rootNodeId?: string; tree: PlanningReduceTree; outputs: PlanningReduceOutput[]; finalOutput?: PlanningReduceOutput; conflicts: PlanningReduceConflict[]; gaps: PlanningReduceGap[]; validationErrors: string[]; reduceComplete: boolean; events: EforgeEvent[]; iterations: number }

interface ReduceRunResult { output: PlanningReduceOutput; events: EforgeEvent[]; validationErrors: string[] }
interface ReduceSettled { nodeId: string; result?: ReduceRunResult; error?: unknown }

export async function runPlanningReduce(input: RunPlanningReduceInput): Promise<PlanningReduceResult> {
  const limits = { ...DEFAULT_PLANNING_REDUCE_LIMITS, ...(input.limits ?? {}) };
  const plannedTree = planPromptSafeReduceTree({ graph: input.graph, mapResult: input.mapResult, limits });
  if (!plannedTree.ok) throw new Error(`reduce prompt budget planning failed:${plannedTree.validationErrors.join('; ')}`);
  const tree = plannedTree.tree;
  const outputs: PlanningReduceOutput[] = [];
  const events: EforgeEvent[] = [];
  const validationErrors = [...tree.validationErrors];
  let iterations = 0;

  const emit = (event: EforgeEvent): void => { input.onEvent?.(event); events.push(event); };
  emit(buildMapReduceReduceTreeEvent(tree));

  const running = new Map<string, Promise<ReduceSettled>>();
  const failFastController = new AbortController();
  const runInput = { ...input, abortSignal: composeAbortSignal(input.abortSignal, failFastController.signal) };
  const parallelism = Math.max(1, input.graph.limits.parallelism);

  while (outputs.length + running.size < tree.nodes.length || running.size > 0) {
    const ready = readyReduceNodes(tree, outputs, running, parallelism);
    if (ready.length > 0) iterations += 1;
    for (const node of ready) {
      emit(buildMapReduceReduceStatusEvent(node.nodeId, 'running'));
      running.set(node.nodeId, runReduceNode(runInput, tree, node.nodeId, outputs).then((result) => ({ nodeId: node.nodeId, result }), (error) => ({ nodeId: node.nodeId, error })));
    }

    if (running.size === 0) {
      markBlockedReduceNodes(tree, outputs, emit);
      break;
    }

    const settled = await Promise.race(running.values());
    running.delete(settled.nodeId);
    if (settled.error) {
      if (isAbortError(settled.error) && !failFastController.signal.aborted) throw settled.error;
      applyReduceResult({ result: failedReduceRun(settled.nodeId, settled.error), outputs, events, validationErrors, emit });
    } else {
      applyReduceResult({ result: settled.result!, outputs, events, validationErrors, emit });
    }

    if (outputs.some((output) => output.status === 'failed')) {
      failFastController.abort();
      cancelRunningReducers({ running, outputs, emit, reason: 'cancelled after reduce failure' });
      break;
    }
  }

  return finish(input, tree, outputs, events, validationErrors, iterations);
}

function applyReduceResult(input: { result: ReduceRunResult; outputs: PlanningReduceOutput[]; events: EforgeEvent[]; validationErrors: string[]; emit: (event: EforgeEvent) => void }): void {
  input.outputs.push(input.result.output);
  input.events.push(...input.result.events);
  input.validationErrors.push(...input.result.validationErrors);
  input.emit(buildMapReduceReduceStatusEvent(input.result.output.nodeId, input.result.output.status, input.result.output.error));
}

function cancelRunningReducers(input: { running: Map<string, Promise<ReduceSettled>>; outputs: PlanningReduceOutput[]; emit: (event: EforgeEvent) => void; reason: string }): void {
  const nodeIds = [...input.running.keys()].sort();
  void Promise.allSettled([...input.running.values()]);
  input.running.clear();
  for (const nodeId of nodeIds) {
    if (input.outputs.some((output) => output.nodeId === nodeId)) continue;
    const output = failedOutput(nodeId, input.reason);
    input.outputs.push(output);
    input.emit(buildMapReduceReduceStatusEvent(nodeId, 'failed', input.reason));
  }
}

async function runReduceNode(input: RunPlanningReduceInput, tree: PlanningReduceTree, nodeId: string, outputs: PlanningReduceOutput[]): Promise<ReduceRunResult> {
  const node = requireNode(tree, nodeId);
  const task = buildTaskForNode(tree, nodeId, input.mapResult.outputs, outputs);
  try {
    const result = await runPlanningReducer({ task, cwd: input.cwd, harness: input.harness, agentOptions: input.agentOptions, abortSignal: input.abortSignal, onEvent: input.onEvent });
    const output = normalizePlanningReduceOutput(result.output);
    const validation = validatePlanningReduceOutput({ graph: input.graph, tree, task, output });
    if (!validation.ok) return { output: failedOutput(node.nodeId, `invalid reduce output:${validation.errors.join('; ')}`), events: result.events, validationErrors: validation.errors };
    return { output, events: result.events, validationErrors: [] };
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

function readyReduceNodes(tree: PlanningReduceTree, outputs: PlanningReduceOutput[], running: Map<string, Promise<ReduceSettled>>, parallelism: number): PlanningReduceTree['nodes'] {
  const terminal = new Set(outputs.map((output) => output.nodeId));
  const completed = completedNodeIds(outputs);
  const capacity = Math.max(0, parallelism - running.size);
  if (capacity === 0) return [];
  return tree.nodes
    .filter((node) => !terminal.has(node.nodeId) && !running.has(node.nodeId) && node.inputNodeIds.every((childId) => completed.has(childId)))
    .sort((a, b) => a.depth - b.depth || a.nodeId.localeCompare(b.nodeId))
    .slice(0, capacity);
}

function markBlockedReduceNodes(tree: PlanningReduceTree, outputs: PlanningReduceOutput[], emit: (event: EforgeEvent) => void): void {
  const terminal = new Set(outputs.map((output) => output.nodeId));
  for (const node of tree.nodes.filter((candidate) => !terminal.has(candidate.nodeId)).sort((a, b) => a.depth - b.depth || a.nodeId.localeCompare(b.nodeId))) {
    const error = `reduce node blocked by incomplete child:${node.inputNodeIds.join(',')}`;
    outputs.push(incompleteOutput(node.nodeId, error));
    emit(buildMapReduceReduceStatusEvent(node.nodeId, 'incomplete', error));
  }
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

function failedReduceRun(nodeId: string, err: unknown): ReduceRunResult {
  const message = err instanceof Error ? err.message : String(err);
  return { output: failedOutput(nodeId, message), events: [], validationErrors: [`reduce failed:${nodeId}:${message}`] };
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

function composeAbortSignal(parent: AbortSignal | undefined, child: AbortSignal): AbortSignal {
  if (!parent) return child;
  const anyAbortSignal = (AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
  if (anyAbortSignal) return anyAbortSignal([parent, child]);
  const controller = new AbortController();
  const abort = (): void => { controller.abort(); };
  if (parent.aborted || child.aborted) abort();
  else {
    parent.addEventListener('abort', abort, { once: true });
    child.addEventListener('abort', abort, { once: true });
  }
  return controller.signal;
}
