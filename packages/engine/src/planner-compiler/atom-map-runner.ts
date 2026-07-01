import type { EforgeEvent } from '../events.js';
import type { AgentHarness, SdkPassthroughConfig } from '../harness.js';
import type { PlanningAtomGraph } from './atom-graph.js';
import { buildPlanningAtomTasks, summarizePlanningAtomOutputs, type PlanningAtomOutput, type PlanningAtomTask } from './atom-planning-contracts.js';
import { selectReadyPlanningAtoms, type BlockedPlanningAtom } from './atom-scheduler.js';
import type { PlanningAspectCoverageSummary, PlanningCriterionAspect } from './coverage-accounting.js';
import { validateSharedPlanningBrief, type PlanningSharedFinding, type SharedPlanningBrief } from './shared-brief-contracts.js';
import { validatePlanningSourceEvidenceBundle, type PlanningSourceEvidenceBundle } from './source-evidence-contracts.js';
import type { SourceInventory } from './source-inventory.js';
import type { PlannerCompilerEventSink } from './event-sink.js';
import { buildMapReduceAtomsEvent, buildMapReduceAtomStatusEvent } from './orchestration-events.js';
import { atomStatusReason, atomTerminalStatus, executePlanningAtom, failedAtomOutput, type AtomRunResult } from './atom-execution.js';
import { composeAbortSignal, isAbortError } from './abort-utils.js';

export interface RunPlanningAtomMapInput { graph: PlanningAtomGraph; inventory?: SourceInventory; sourceContent: string; cwd: string; harness: AgentHarness; agentOptions?: SdkPassthroughConfig & { maxTurns?: number }; aspects?: PlanningCriterionAspect[]; reduceDigestPromptBudgetBytes?: number; parallelism?: number; abortSignal?: AbortSignal; sharedBrief?: SharedPlanningBrief; sourceEvidenceBundle?: PlanningSourceEvidenceBundle; onEvent?: PlannerCompilerEventSink; affectedAtomIds?: string[]; priorOutputs?: PlanningAtomOutput[] }
export interface PlanningAtomMapResult { graphId: string; outputs: PlanningAtomOutput[]; coverage: PlanningAspectCoverageSummary; completedAtomIds: string[]; failedAtomIds: string[]; skippedAtomIds: string[]; blockedAtoms: BlockedPlanningAtom[]; readyAtomIds: string[]; mapComplete: boolean; validationErrors: string[]; events: EforgeEvent[]; iterations: number; sharedFindings: PlanningSharedFinding[] }

interface AtomSettled { atomId: string; result?: AtomRunResult; error?: unknown }

export async function runPlanningAtomMap(input: RunPlanningAtomMapInput): Promise<PlanningAtomMapResult> {
  const briefValidation = input.sharedBrief ? validateSharedPlanningBrief(input.sharedBrief, input.graph) : { ok: true as const, errors: [] };
  const sourceEvidenceValidation = input.sharedBrief && input.sourceEvidenceBundle ? validatePlanningSourceEvidenceBundle({ graph: input.graph, sharedBrief: input.sharedBrief, bundle: input.sourceEvidenceBundle }) : { ok: true as const, errors: [] };
  const tasks = new Map(buildPlanningAtomTasks(input).map((task) => [task.atomId, task]));
  const affectedAtomIds = input.affectedAtomIds ? new Set(input.affectedAtomIds) : undefined;
  const retainedOutputs = retainedPriorOutputs(input.priorOutputs ?? [], affectedAtomIds, new Set(input.graph.atoms.map((atom) => atom.atomId)));
  const completed = new Set<string>(retainedOutputs.filter((output) => output.status === 'completed').map((output) => output.atomId));
  const failed = new Set<string>(retainedOutputs.filter((output) => output.status === 'failed').map((output) => output.atomId));
  const skipped = new Set<string>(retainedOutputs.filter((output) => output.status === 'skipped').map((output) => output.atomId));
  const outputs: PlanningAtomOutput[] = [...retainedOutputs];
  const events: EforgeEvent[] = [];
  const validationErrors: string[] = [...(briefValidation.ok ? [] : briefValidation.errors), ...(sourceEvidenceValidation.ok ? [] : sourceEvidenceValidation.errors)];
  let iterations = 0;

  const emit = (event: EforgeEvent): void => { input.onEvent?.(event); events.push(event); };
  emit(buildMapReduceAtomsEvent(input.graph));

  const running = new Map<string, Promise<AtomSettled>>();
  const failFastController = new AbortController();
  const runInput = { ...input, abortSignal: composeAbortSignal(input.abortSignal, failFastController.signal) };

  while (true) {
    const decision = selectReadyAtoms(input, tasks, completed, failed, skipped, running);
    if (decision.readyAtomIds.length > 0) iterations += 1;
    for (const atomId of decision.readyAtomIds) {
      emit(buildMapReduceAtomStatusEvent(atomId, 'running'));
      const acceptedFindings = outputs.flatMap((output) => output.sharedFindings ?? []);
      running.set(atomId, executePlanningAtom(runInput, requireTask(tasks, atomId), acceptedFindings).then((result) => ({ atomId, result }), (error) => ({ atomId, error })));
    }

    if (running.size === 0) return finish(input, { outputs, events, completed, failed, skipped, validationErrors, iterations, blockedAtoms: decision.blockedAtoms, readyAtomIds: decision.readyAtomIds });

    const settled = await Promise.race(running.values());
    running.delete(settled.atomId);
    if (settled.error) {
      if (isAbortError(settled.error) && !failFastController.signal.aborted) throw settled.error;
      const task = requireTask(tasks, settled.atomId);
      applyAtomResult({ result: { output: failedAtomOutput(task, settled.error), events: [], validationErrors: [`atom planner failed:${settled.atomId}:${settled.error instanceof Error ? settled.error.message : String(settled.error)}`] }, outputs, events, validationErrors, completed, failed, skipped, emit });
    } else {
      applyAtomResult({ result: settled.result!, outputs, events, validationErrors, completed, failed, skipped, emit });
    }

    if (failed.size > 0) {
      failFastController.abort();
      cancelRunningAtoms({ running, tasks, outputs, completed, failed, skipped, emit, reason: 'cancelled after atom failure' });
      const terminalDecision = selectReadyAtoms(input, tasks, completed, failed, skipped, new Map());
      return finish(input, { outputs, events, completed, failed, skipped, validationErrors, iterations, blockedAtoms: terminalDecision.blockedAtoms, readyAtomIds: terminalDecision.readyAtomIds });
    }
  }
}

function applyAtomResult(input: { result: AtomRunResult; outputs: PlanningAtomOutput[]; events: EforgeEvent[]; validationErrors: string[]; completed: Set<string>; failed: Set<string>; skipped: Set<string>; emit: (event: EforgeEvent) => void }): void {
  input.outputs.push(input.result.output);
  input.events.push(...input.result.events);
  input.validationErrors.push(...input.result.validationErrors);
  const terminal = atomTerminalStatus(input.result.output.status, input.result.validationErrors.length);
  if (terminal === 'completed') input.completed.add(input.result.output.atomId);
  else if (terminal === 'skipped') input.skipped.add(input.result.output.atomId);
  else input.failed.add(input.result.output.atomId);
  input.emit(buildMapReduceAtomStatusEvent(input.result.output.atomId, terminal, atomStatusReason(input.result)));
}

function cancelRunningAtoms(input: { running: Map<string, Promise<AtomSettled>>; tasks: Map<string, PlanningAtomTask>; outputs: PlanningAtomOutput[]; completed: Set<string>; failed: Set<string>; skipped: Set<string>; emit: (event: EforgeEvent) => void; reason: string }): void {
  const atomIds = [...input.running.keys()].sort();
  void Promise.allSettled([...input.running.values()]);
  input.running.clear();
  for (const atomId of atomIds) {
    if (input.completed.has(atomId) || input.failed.has(atomId) || input.skipped.has(atomId)) continue;
    const output = failedAtomOutput(requireTask(input.tasks, atomId), new Error(input.reason));
    input.outputs.push(output);
    input.failed.add(atomId);
    input.emit(buildMapReduceAtomStatusEvent(atomId, 'failed', input.reason));
  }
}

function finish(input: RunPlanningAtomMapInput, state: { outputs: PlanningAtomOutput[]; events: EforgeEvent[]; completed: Set<string>; failed: Set<string>; skipped: Set<string>; validationErrors: string[]; iterations: number; blockedAtoms: BlockedPlanningAtom[]; readyAtomIds: string[] }): PlanningAtomMapResult {
  const summary = summarizePlanningAtomOutputs({ graph: input.graph, inventory: input.inventory, aspects: input.aspects, sharedBrief: input.sharedBrief, sourceEvidenceBundle: input.sourceEvidenceBundle, reduceDigestPromptBudgetBytes: input.reduceDigestPromptBudgetBytes, outputs: state.outputs });
  const validationErrors = [...new Set([...state.validationErrors, ...summary.validationErrors])].sort();
  const mapComplete = state.failed.size === 0 && state.blockedAtoms.length === 0 && validationErrors.length === 0 && summary.coverage.incompleteCriteria.length === 0;
  return {
    graphId: input.graph.graphId,
    outputs: state.outputs.sort((a, b) => a.atomId.localeCompare(b.atomId)),
    coverage: summary.coverage,
    completedAtomIds: [...state.completed].sort(),
    failedAtomIds: [...state.failed].sort(),
    skippedAtomIds: [...state.skipped].sort(),
    blockedAtoms: state.blockedAtoms,
    readyAtomIds: state.readyAtomIds,
    mapComplete,
    validationErrors,
    events: state.events,
    iterations: state.iterations,
    sharedFindings: state.outputs.flatMap((output) => output.sharedFindings ?? []).sort((a, b) => a.findingId.localeCompare(b.findingId)),
  };
}

function selectReadyAtoms(input: RunPlanningAtomMapInput, tasks: Map<string, PlanningAtomTask>, completed: Set<string>, failed: Set<string>, skipped: Set<string>, running: Map<string, Promise<AtomSettled>>): { readyAtomIds: string[]; blockedAtoms: BlockedPlanningAtom[] } {
  const parallelism = input.parallelism ?? input.graph.limits.parallelism;
  const affected = input.affectedAtomIds ? new Set(input.affectedAtomIds) : undefined;
  const base = selectReadyPlanningAtoms({ graph: input.graph, completedAtomIds: completed, failedAtomIds: failed, runningAtomIds: running.keys(), skippedAtomIds: skipped, parallelism: input.graph.atoms.length });
  const sharedBlocked: BlockedPlanningAtom[] = [];
  const candidates: string[] = [];
  for (const atomId of base.readyAtomIds.filter((id) => !affected || affected.has(id))) {
    const missingPrerequisites = (tasks.get(atomId)?.sharedBrief?.prerequisiteAtomIds ?? []).filter((dependencyId) => !completed.has(dependencyId));
    if (missingPrerequisites.length > 0) sharedBlocked.push({ atomId, blockedByAtomIds: missingPrerequisites });
    else candidates.push(atomId);
  }
  const affectedBlocked = affected ? base.blockedAtoms.filter((atom) => affected.has(atom.atomId)) : base.blockedAtoms;
  const capacity = Math.max(0, parallelism - running.size);
  return { readyAtomIds: candidates.slice(0, capacity), blockedAtoms: [...affectedBlocked, ...sharedBlocked].sort((a, b) => a.atomId.localeCompare(b.atomId)) };
}

function retainedPriorOutputs(outputs: PlanningAtomOutput[], affectedAtomIds: Set<string> | undefined, graphAtomIds: Set<string>): PlanningAtomOutput[] {
  return outputs
    .filter((output) => graphAtomIds.has(output.atomId) && (!affectedAtomIds || !affectedAtomIds.has(output.atomId)))
    .map(cloneAtomOutput)
    .sort((a, b) => a.atomId.localeCompare(b.atomId));
}

function cloneAtomOutput(output: PlanningAtomOutput): PlanningAtomOutput {
  return {
    ...output,
    aspectUpdates: output.aspectUpdates.map((update) => ({ ...update, completedByAtomIds: update.completedByAtomIds ? [...update.completedByAtomIds] : undefined })),
    planFragments: output.planFragments?.map((fragment) => ({ ...fragment, criterionIds: [...fragment.criterionIds], aspectIds: [...fragment.aspectIds], dependsOnFragmentIds: fragment.dependsOnFragmentIds ? [...fragment.dependsOnFragmentIds] : undefined })),
    moduleCandidates: output.moduleCandidates?.map((module) => ({ ...module, criterionIds: [...module.criterionIds], aspectIds: [...module.aspectIds], dependsOnModuleIds: module.dependsOnModuleIds ? [...module.dependsOnModuleIds] : undefined })),
    sharedFindings: output.sharedFindings?.map((finding) => ({ ...finding, aspectIds: [...finding.aspectIds] })),
    discoveredEvidencePaths: output.discoveredEvidencePaths ? [...output.discoveredEvidencePaths] : undefined,
  };
}

function requireTask(tasks: Map<string, PlanningAtomTask>, atomId: string): PlanningAtomTask {
  const task = tasks.get(atomId);
  if (!task) throw new Error(`missing atom task:${atomId}`);
  return task;
}
