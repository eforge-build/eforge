import type { EforgeEvent } from '../events.js';
import type { AgentHarness, SdkPassthroughConfig } from '../harness.js';
import type { PlanningAtomGraph } from './atom-graph.js';
import { buildPlanningAtomTasks, summarizePlanningAtomOutputs, type PlanningAtomOutput, type PlanningAtomTask } from './atom-planning-contracts.js';
import { selectReadyPlanningAtoms, type BlockedPlanningAtom } from './atom-scheduler.js';
import { DEFAULT_PLANNING_REDUCE_LIMITS, type PlanningReduceConflict, type PlanningReduceGap, type PlanningReduceLimits, type PlanningReduceOutput, type PlanningReduceTree } from './reduce-contracts.js';
import { planPromptSafeReduceTreeFromTasks } from './prompt-budget-planner.js';
import { atomStatusReason, atomTerminalStatus, executePlanningAtom, failedAtomOutput, type AtomRunResult } from './atom-execution.js';
import { executePlanningReduceNode, failedReduceOutput, failedReduceRun, incompleteReduceOutput, type ReduceRunResult } from './reduce-execution.js';
import { singleAtomPassthroughOutput } from './reduce-passthrough.js';
import { buildMapReduceAtomsEvent, buildMapReduceAtomStatusEvent, buildMapReduceReduceStatusEvent, buildMapReduceReduceTreeEvent } from './orchestration-events.js';
import type { PlannerCompilerEventSink } from './event-sink.js';
import { validateSharedPlanningBrief, type PlanningSharedFinding, type SharedPlanningBrief } from './shared-brief-contracts.js';
import { validatePlanningSourceEvidenceBundle, type PlanningSourceEvidenceBundle } from './source-evidence-contracts.js';
import type { SourceLocalizationBundle } from './source-localization-contracts.js';
import type { SourceInventory } from './source-inventory.js';
import type { PlanningAspectCoverageSummary, PlanningCriterionAspect } from './coverage-accounting.js';
import { composeAbortSignal, isAbortError } from './abort-utils.js';

export interface RunPlanningMapReducePipelineInput { graph: PlanningAtomGraph; inventory?: SourceInventory; sourceContent: string; cwd: string; harness: AgentHarness; agentOptions?: SdkPassthroughConfig & { maxTurns?: number }; aspects?: PlanningCriterionAspect[]; reduceDigestPromptBudgetBytes?: number; parallelism?: number; abortSignal?: AbortSignal; sharedBrief?: SharedPlanningBrief; sourceLocalizationBundle?: SourceLocalizationBundle; sourceEvidenceBundle?: PlanningSourceEvidenceBundle; reduceLimits?: Partial<PlanningReduceLimits>; onEvent?: PlannerCompilerEventSink }
export interface PlanningMapReducePipelineResult { map: PlanningAtomMapResultLike; reduce: PlanningReduceResultLike; events: EforgeEvent[] }
interface PlanningAtomMapResultLike { graphId: string; outputs: PlanningAtomOutput[]; coverage: PlanningAspectCoverageSummary; completedAtomIds: string[]; failedAtomIds: string[]; skippedAtomIds: string[]; blockedAtoms: BlockedPlanningAtom[]; readyAtomIds: string[]; mapComplete: boolean; validationErrors: string[]; events: EforgeEvent[]; iterations: number; sharedFindings: PlanningSharedFinding[] }
interface PlanningReduceResultLike { graphId: string; rootNodeId?: string; tree: PlanningReduceTree; outputs: PlanningReduceOutput[]; finalOutput?: PlanningReduceOutput; conflicts: PlanningReduceConflict[]; gaps: PlanningReduceGap[]; validationErrors: string[]; reduceComplete: boolean; events: EforgeEvent[]; iterations: number }

interface AtomSettled { kind: 'atom'; atomId: string; result?: AtomRunResult; error?: unknown }
interface ReduceSettled { kind: 'reduce'; nodeId: string; result?: ReduceRunResult; error?: unknown }
type Settled = AtomSettled | ReduceSettled;

export async function runPlanningMapReducePipeline(input: RunPlanningMapReducePipelineInput): Promise<PlanningMapReducePipelineResult> {
  const briefValidation = input.sharedBrief ? validateSharedPlanningBrief(input.sharedBrief, input.graph) : { ok: true as const, errors: [] };
  const sourceEvidenceValidation = input.sharedBrief && input.sourceEvidenceBundle ? validatePlanningSourceEvidenceBundle({ graph: input.graph, sharedBrief: input.sharedBrief, bundle: input.sourceEvidenceBundle }) : { ok: true as const, errors: [] };
  const initialTasks = buildPlanningAtomTasks(input);
  const reduceLimits = { ...DEFAULT_PLANNING_REDUCE_LIMITS, ...(input.reduceLimits ?? {}) };
  const plannedTree = planPromptSafeReduceTreeFromTasks({ graph: input.graph, tasks: initialTasks, limits: reduceLimits });
  if (!plannedTree.ok) throw new Error(`reduce prompt budget planning failed:${plannedTree.validationErrors.join('; ')}`);
  const schedulerInput = { ...input, reduceDigestPromptBudgetBytes: plannedTree.maxReduceDigestPromptBytes };
  const tasks = new Map(buildPlanningAtomTasks(schedulerInput).map((task) => [task.atomId, task]));

  const state = {
    atomOutputs: [] as PlanningAtomOutput[],
    reduceOutputs: [] as PlanningReduceOutput[],
    completedAtoms: new Set<string>(),
    failedAtoms: new Set<string>(),
    skippedAtoms: new Set<string>(),
    mapValidationErrors: [...(briefValidation.ok ? [] : briefValidation.errors), ...(sourceEvidenceValidation.ok ? [] : sourceEvidenceValidation.errors)],
    reduceValidationErrors: [...plannedTree.tree.validationErrors],
    mapEvents: [] as EforgeEvent[],
    reduceEvents: [] as EforgeEvent[],
    events: [] as EforgeEvent[],
    mapIterations: 0,
    reduceIterations: 0,
    collecting: true,
  };
  const failFastController = new AbortController();
  const runInput = { ...schedulerInput, abortSignal: composeAbortSignal(input.abortSignal, failFastController.signal) };
  const runningAtoms = new Map<string, Promise<AtomSettled>>();
  const runningReducers = new Map<string, Promise<ReduceSettled>>();
  const tree = plannedTree.tree;
  const parallelism = Math.max(1, input.parallelism ?? input.graph.limits.parallelism);

  emitAtomEvent(input, state, buildMapReduceAtomsEvent(input.graph));
  emitReduceEvent(input, state, buildMapReduceReduceTreeEvent(tree));

  while (!allTerminal(input.graph, tree, state, runningAtoms, runningReducers)) {
    const startedReducers = startReadyReducers(schedulerInput, runInput, tree, state, runningAtoms, runningReducers, parallelism);
    const startedAtoms = startReadyAtoms(schedulerInput, runInput, tasks, state, runningAtoms, runningReducers, parallelism);
    if (startedReducers > 0) state.reduceIterations += 1;
    if (startedAtoms > 0) state.mapIterations += 1;

    if (runningAtoms.size + runningReducers.size === 0) {
      markBlockedReduceNodes(input, tree, state, 'reduce node blocked by incomplete dependency');
      break;
    }

    const settled = await Promise.race<Settled>([...runningAtoms.values(), ...runningReducers.values()]);
    if (settled.kind === 'atom') {
      runningAtoms.delete(settled.atomId);
      if (settled.error) {
        if (isAbortError(settled.error) && !failFastController.signal.aborted) throw settled.error;
        applyAtomResult(schedulerInput, state, { output: failedAtomOutput(requireTask(tasks, settled.atomId), settled.error), events: [], validationErrors: [`atom planner failed:${settled.atomId}:${settled.error instanceof Error ? settled.error.message : String(settled.error)}`] });
      } else applyAtomResult(schedulerInput, state, settled.result!);
    } else {
      runningReducers.delete(settled.nodeId);
      if (settled.error) {
        if (isAbortError(settled.error) && !failFastController.signal.aborted) throw settled.error;
        applyReduceResult(schedulerInput, state, failedReduceRun(settled.nodeId, settled.error));
      } else applyReduceResult(schedulerInput, state, settled.result!);
    }

    const failureReason = firstFailureReason(state);
    if (failureReason) {
      failFastController.abort();
      cancelRunningAtoms(schedulerInput, tasks, state, runningAtoms, failureReason);
      cancelRunningReducers(schedulerInput, state, runningReducers, failureReason);
      markBlockedReduceNodes(schedulerInput, tree, state, failureReason);
      state.collecting = false;
      break;
    }
  }

  state.collecting = false;
  const map = finishMap(schedulerInput, state, tasks, runningAtoms);
  const reduce = finishReduce(schedulerInput, tree, state, map);
  return { map, reduce, events: [...state.events] };
}

function startReadyAtoms(input: RunPlanningMapReducePipelineInput, runInput: RunPlanningMapReducePipelineInput, tasks: Map<string, PlanningAtomTask>, state: PipelineState, runningAtoms: Map<string, Promise<AtomSettled>>, runningReducers: Map<string, Promise<ReduceSettled>>, parallelism: number): number {
  const capacity = Math.max(0, parallelism - runningAtoms.size - runningReducers.size);
  if (capacity === 0) return 0;
  const decision = readyAtoms(input, tasks, state, runningAtoms, capacity);
  for (const atomId of decision.readyAtomIds) {
    emitAtomEvent(input, state, buildMapReduceAtomStatusEvent(atomId, 'running'));
    const acceptedFindings = state.atomOutputs.flatMap((output) => output.sharedFindings ?? []);
    const task = requireTask(tasks, atomId);
    runningAtoms.set(atomId, executePlanningAtom({ ...runInput, onEvent: (event) => emitAtomEvent(input, state, event) }, task, acceptedFindings).then((result) => ({ kind: 'atom' as const, atomId, result }), (error) => ({ kind: 'atom' as const, atomId, error })));
  }
  return decision.readyAtomIds.length;
}

function startReadyReducers(input: RunPlanningMapReducePipelineInput, runInput: RunPlanningMapReducePipelineInput, tree: PlanningReduceTree, state: PipelineState, runningAtoms: Map<string, Promise<AtomSettled>>, runningReducers: Map<string, Promise<ReduceSettled>>, parallelism: number): number {
  const capacity = Math.max(0, parallelism - runningAtoms.size - runningReducers.size);
  if (capacity === 0) return 0;
  const ready = readyReduceNodes(tree, state, runningReducers, capacity);
  let started = 0;
  for (const node of ready) {
    const soleAtomOutput = node.inputAtomIds.length === 1 && node.inputNodeIds.length === 0 ? acceptedAtomOutputs(state).find((output) => output.atomId === node.inputAtomIds[0]) : undefined;
    const passthrough = soleAtomOutput ? singleAtomPassthroughOutput(input.graph, tree, node, soleAtomOutput) : undefined;
    emitReduceEvent(input, state, buildMapReduceReduceStatusEvent(node.nodeId, 'running'));
    if (passthrough) {
      applyReduceResult(input, state, { output: passthrough, events: [], validationErrors: [] });
      started += 1;
      continue;
    }
    runningReducers.set(node.nodeId, executePlanningReduceNode({ ...runInput, onEvent: (event) => emitReduceEvent(input, state, event) }, tree, node.nodeId, acceptedAtomOutputs(state), state.reduceOutputs).then((result) => ({ kind: 'reduce' as const, nodeId: node.nodeId, result }), (error) => ({ kind: 'reduce' as const, nodeId: node.nodeId, error })));
    started += 1;
  }
  return started;
}

interface PipelineState { atomOutputs: PlanningAtomOutput[]; reduceOutputs: PlanningReduceOutput[]; completedAtoms: Set<string>; failedAtoms: Set<string>; skippedAtoms: Set<string>; mapValidationErrors: string[]; reduceValidationErrors: string[]; mapEvents: EforgeEvent[]; reduceEvents: EforgeEvent[]; events: EforgeEvent[]; mapIterations: number; reduceIterations: number; collecting: boolean }

function emitAtomEvent(input: RunPlanningMapReducePipelineInput, state: PipelineState, event: EforgeEvent): void {
  if (!state.collecting) return;
  input.onEvent?.(event);
  state.events.push(event);
  state.mapEvents.push(event);
}
function emitReduceEvent(input: RunPlanningMapReducePipelineInput, state: PipelineState, event: EforgeEvent): void {
  if (!state.collecting) return;
  input.onEvent?.(event);
  state.events.push(event);
  state.reduceEvents.push(event);
}

function applyAtomResult(input: RunPlanningMapReducePipelineInput, state: PipelineState, result: AtomRunResult): void {
  state.atomOutputs.push(result.output);
  state.mapValidationErrors.push(...result.validationErrors);
  const terminal = atomTerminalStatus(result.output.status, result.validationErrors.length);
  if (terminal === 'completed') state.completedAtoms.add(result.output.atomId);
  else if (terminal === 'skipped') state.skippedAtoms.add(result.output.atomId);
  else state.failedAtoms.add(result.output.atomId);
  emitAtomEvent(input, state, buildMapReduceAtomStatusEvent(result.output.atomId, terminal, atomStatusReason(result)));
}

function applyReduceResult(input: RunPlanningMapReducePipelineInput, state: PipelineState, result: ReduceRunResult): void {
  state.reduceOutputs.push(result.output);
  state.reduceValidationErrors.push(...result.validationErrors);
  emitReduceEvent(input, state, buildMapReduceReduceStatusEvent(result.output.nodeId, result.output.status, result.output.error));
}

function readyAtoms(input: RunPlanningMapReducePipelineInput, tasks: Map<string, PlanningAtomTask>, state: PipelineState, runningAtoms: Map<string, Promise<AtomSettled>>, capacity: number): { readyAtomIds: string[]; blockedAtoms: BlockedPlanningAtom[] } {
  const base = selectReadyPlanningAtoms({ graph: input.graph, completedAtomIds: state.completedAtoms, failedAtomIds: state.failedAtoms, runningAtomIds: runningAtoms.keys(), skippedAtomIds: state.skippedAtoms, parallelism: input.graph.atoms.length });
  const sharedBlocked: BlockedPlanningAtom[] = [];
  const candidates: string[] = [];
  for (const atomId of base.readyAtomIds) {
    const missingPrerequisites = (tasks.get(atomId)?.sharedBrief?.prerequisiteAtomIds ?? []).filter((dependencyId) => !state.completedAtoms.has(dependencyId));
    if (missingPrerequisites.length > 0) sharedBlocked.push({ atomId, blockedByAtomIds: missingPrerequisites });
    else candidates.push(atomId);
  }
  return { readyAtomIds: candidates.slice(0, capacity), blockedAtoms: [...base.blockedAtoms, ...sharedBlocked].sort((a, b) => a.atomId.localeCompare(b.atomId)) };
}

function readyReduceNodes(tree: PlanningReduceTree, state: PipelineState, runningReducers: Map<string, Promise<ReduceSettled>>, capacity: number): PlanningReduceTree['nodes'] {
  const terminal = new Set(state.reduceOutputs.map((output) => output.nodeId));
  const completedReducers = new Set(state.reduceOutputs.filter((output) => output.status === 'completed').map((output) => output.nodeId));
  return tree.nodes
    .filter((node) => !terminal.has(node.nodeId) && !runningReducers.has(node.nodeId) && node.inputAtomIds.every((atomId) => state.completedAtoms.has(atomId)) && node.inputNodeIds.every((nodeId) => completedReducers.has(nodeId)))
    .sort((a, b) => a.depth - b.depth || a.nodeId.localeCompare(b.nodeId))
    .slice(0, capacity);
}

function cancelRunningAtoms(input: RunPlanningMapReducePipelineInput, tasks: Map<string, PlanningAtomTask>, state: PipelineState, runningAtoms: Map<string, Promise<AtomSettled>>, reason: string): void {
  const atomIds = [...runningAtoms.keys()].sort();
  void Promise.allSettled([...runningAtoms.values()]);
  runningAtoms.clear();
  for (const atomId of atomIds) {
    if (state.completedAtoms.has(atomId) || state.failedAtoms.has(atomId) || state.skippedAtoms.has(atomId)) continue;
    state.atomOutputs.push(failedAtomOutput(requireTask(tasks, atomId), new Error(reason)));
    state.failedAtoms.add(atomId);
    emitAtomEvent(input, state, buildMapReduceAtomStatusEvent(atomId, 'failed', reason));
  }
}

function cancelRunningReducers(input: RunPlanningMapReducePipelineInput, state: PipelineState, runningReducers: Map<string, Promise<ReduceSettled>>, reason: string): void {
  const nodeIds = [...runningReducers.keys()].sort();
  void Promise.allSettled([...runningReducers.values()]);
  runningReducers.clear();
  for (const nodeId of nodeIds) {
    if (state.reduceOutputs.some((output) => output.nodeId === nodeId)) continue;
    state.reduceOutputs.push(failedReduceOutput(nodeId, reason));
    emitReduceEvent(input, state, buildMapReduceReduceStatusEvent(nodeId, 'failed', reason));
  }
}

function markBlockedReduceNodes(input: RunPlanningMapReducePipelineInput, tree: PlanningReduceTree, state: PipelineState, reason: string): void {
  const terminal = new Set(state.reduceOutputs.map((output) => output.nodeId));
  for (const node of tree.nodes.filter((candidate) => !terminal.has(candidate.nodeId)).sort((a, b) => a.depth - b.depth || a.nodeId.localeCompare(b.nodeId))) {
    const missingAtoms = node.inputAtomIds.filter((atomId) => !state.completedAtoms.has(atomId));
    const incompleteChildren = node.inputNodeIds.filter((nodeId) => state.reduceOutputs.find((output) => output.nodeId === nodeId)?.status !== 'completed');
    const blockedReason = missingAtoms.length > 0 ? `reduce node blocked by incomplete atom:${missingAtoms.join(',')}` : incompleteChildren.length > 0 ? `reduce node blocked by incomplete child:${incompleteChildren.join(',')}` : reason;
    state.reduceOutputs.push(incompleteReduceOutput(node.nodeId, blockedReason));
    emitReduceEvent(input, state, buildMapReduceReduceStatusEvent(node.nodeId, 'incomplete', blockedReason));
  }
}

function finishMap(input: RunPlanningMapReducePipelineInput, state: PipelineState, tasks: Map<string, PlanningAtomTask>, runningAtoms: Map<string, Promise<AtomSettled>>): PlanningAtomMapResultLike {
  const decision = readyAtoms(input, tasks, state, runningAtoms, input.graph.atoms.length);
  const summary = summarizePlanningAtomOutputs({ graph: input.graph, inventory: input.inventory, aspects: input.aspects, sharedBrief: input.sharedBrief, sourceEvidenceBundle: input.sourceEvidenceBundle, reduceDigestPromptBudgetBytes: input.reduceDigestPromptBudgetBytes, outputs: state.atomOutputs });
  const validationErrors = [...new Set([...state.mapValidationErrors, ...summary.validationErrors])].sort();
  const mapComplete = state.failedAtoms.size === 0 && decision.blockedAtoms.length === 0 && validationErrors.length === 0 && summary.coverage.incompleteCriteria.length === 0;
  return { graphId: input.graph.graphId, outputs: [...state.atomOutputs].sort((a, b) => a.atomId.localeCompare(b.atomId)), coverage: summary.coverage, completedAtomIds: [...state.completedAtoms].sort(), failedAtomIds: [...state.failedAtoms].sort(), skippedAtomIds: [...state.skippedAtoms].sort(), blockedAtoms: decision.blockedAtoms, readyAtomIds: decision.readyAtomIds, mapComplete, validationErrors, events: [...state.mapEvents], iterations: state.mapIterations, sharedFindings: state.atomOutputs.flatMap((output) => output.sharedFindings ?? []).sort((a, b) => a.findingId.localeCompare(b.findingId)) };
}

function finishReduce(input: RunPlanningMapReducePipelineInput, tree: PlanningReduceTree, state: PipelineState, map: PlanningAtomMapResultLike): PlanningReduceResultLike {
  const finalOutput = tree.rootNodeId ? state.reduceOutputs.find((output) => output.nodeId === tree.rootNodeId) : undefined;
  const allErrors = [...new Set([...state.reduceValidationErrors, ...(map.mapComplete ? [] : ['map result incomplete'])])].sort();
  const sortedOutputs = [...state.reduceOutputs].sort((a, b) => a.nodeId.localeCompare(b.nodeId));
  const reduceComplete = Boolean(finalOutput && finalOutput.status === 'completed' && allErrors.length === 0 && map.mapComplete && !sortedOutputs.some((output) => output.gaps?.some((gap) => gap.representationRequired)));
  return { graphId: input.graph.graphId, ...(tree.rootNodeId ? { rootNodeId: tree.rootNodeId } : {}), tree, outputs: sortedOutputs, ...(finalOutput ? { finalOutput } : {}), conflicts: sortedOutputs.flatMap((output) => output.conflicts ?? []).sort((a, b) => a.conflictId.localeCompare(b.conflictId)), gaps: sortedOutputs.flatMap((output) => output.gaps ?? []).sort((a, b) => a.gapId.localeCompare(b.gapId)), validationErrors: allErrors, reduceComplete, events: [...state.reduceEvents], iterations: state.reduceIterations };
}

function allTerminal(graph: PlanningAtomGraph, tree: PlanningReduceTree, state: PipelineState, runningAtoms: Map<string, Promise<AtomSettled>>, runningReducers: Map<string, Promise<ReduceSettled>>): boolean {
  return state.atomOutputs.length >= graph.atoms.length && state.reduceOutputs.length >= tree.nodes.length && runningAtoms.size === 0 && runningReducers.size === 0;
}

function firstFailureReason(state: PipelineState): string | undefined {
  if (state.failedAtoms.size > 0) return `cancelled after atom failure:${[...state.failedAtoms].sort()[0]}`;
  const failedReduce = state.reduceOutputs.find((output) => output.status === 'failed');
  if (failedReduce) return `cancelled after reduce failure:${failedReduce.nodeId}`;
  const skippedAtom = [...state.skippedAtoms].sort()[0];
  if (skippedAtom) return `cancelled after skipped atom:${skippedAtom}`;
  return undefined;
}

function acceptedAtomOutputs(state: PipelineState): PlanningAtomOutput[] {
  return state.atomOutputs.filter((output) => state.completedAtoms.has(output.atomId)).sort((a, b) => a.atomId.localeCompare(b.atomId));
}

function requireTask(tasks: Map<string, PlanningAtomTask>, atomId: string): PlanningAtomTask {
  const task = tasks.get(atomId);
  if (!task) throw new Error(`missing atom task:${atomId}`);
  return task;
}
