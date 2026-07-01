import type { EforgeEvent } from '../events.js';
import type { AgentHarness, SdkPassthroughConfig } from '../harness.js';
import type { PlanningAtomGraph } from './atom-graph.js';
import { buildPlanningAtomTasks, summarizePlanningAtomOutputs, validatePlanningAtomOutput, type PlanningAtomOutput, type PlanningAtomTask } from './atom-planning-contracts.js';
import { runPlanningAtomPlanner } from './atom-planner-agent.js';
import { selectReadyPlanningAtoms, type BlockedPlanningAtom } from './atom-scheduler.js';
import type { PlanningAspectCoverageSummary, PlanningCriterionAspect } from './coverage-accounting.js';
import { validateSharedPlanningBrief, type PlanningSharedFinding, type SharedPlanningBrief } from './shared-brief-contracts.js';
import { validatePlanningSourceEvidenceBundle, type PlanningSourceEvidenceBundle } from './source-evidence-contracts.js';
import type { SourceInventory } from './source-inventory.js';
import type { PlannerCompilerEventSink } from './event-sink.js';
import { buildMapReduceAtomsEvent, buildMapReduceAtomStatusEvent } from './orchestration-events.js';
import type { PlanningMapReduceAtomStatus } from '@eforge-build/client';

export interface RunPlanningAtomMapInput { graph: PlanningAtomGraph; inventory?: SourceInventory; sourceContent: string; cwd: string; harness: AgentHarness; agentOptions?: SdkPassthroughConfig & { maxTurns?: number }; aspects?: PlanningCriterionAspect[]; reduceDigestPromptBudgetBytes?: number; parallelism?: number; abortSignal?: AbortSignal; sharedBrief?: SharedPlanningBrief; sourceEvidenceBundle?: PlanningSourceEvidenceBundle; onEvent?: PlannerCompilerEventSink }
export interface PlanningAtomMapResult { graphId: string; outputs: PlanningAtomOutput[]; coverage: PlanningAspectCoverageSummary; completedAtomIds: string[]; failedAtomIds: string[]; skippedAtomIds: string[]; blockedAtoms: BlockedPlanningAtom[]; readyAtomIds: string[]; mapComplete: boolean; validationErrors: string[]; events: EforgeEvent[]; iterations: number; sharedFindings: PlanningSharedFinding[] }

interface AtomRunResult { output: PlanningAtomOutput; events: EforgeEvent[]; validationErrors: string[] }
interface AtomSettled { atomId: string; result?: AtomRunResult; error?: unknown }

export async function runPlanningAtomMap(input: RunPlanningAtomMapInput): Promise<PlanningAtomMapResult> {
  const briefValidation = input.sharedBrief ? validateSharedPlanningBrief(input.sharedBrief, input.graph) : { ok: true as const, errors: [] };
  const sourceEvidenceValidation = input.sharedBrief && input.sourceEvidenceBundle ? validatePlanningSourceEvidenceBundle({ graph: input.graph, sharedBrief: input.sharedBrief, bundle: input.sourceEvidenceBundle }) : { ok: true as const, errors: [] };
  const tasks = new Map(buildPlanningAtomTasks(input).map((task) => [task.atomId, task]));
  const completed = new Set<string>();
  const failed = new Set<string>();
  const skipped = new Set<string>();
  const outputs: PlanningAtomOutput[] = [];
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
      running.set(atomId, runAtom(runInput, requireTask(tasks, atomId), acceptedFindings).then((result) => ({ atomId, result }), (error) => ({ atomId, error })));
    }

    if (running.size === 0) return finish(input, { outputs, events, completed, failed, skipped, validationErrors, iterations, blockedAtoms: decision.blockedAtoms, readyAtomIds: decision.readyAtomIds });

    const settled = await Promise.race(running.values());
    running.delete(settled.atomId);
    if (settled.error) {
      if (isAbortError(settled.error) && !failFastController.signal.aborted) throw settled.error;
      const task = requireTask(tasks, settled.atomId);
      applyAtomResult({ result: { output: failedOutput(task, settled.error), events: [], validationErrors: [`atom planner failed:${settled.atomId}:${settled.error instanceof Error ? settled.error.message : String(settled.error)}`] }, outputs, events, validationErrors, completed, failed, skipped, emit });
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
    const output = failedOutput(requireTask(input.tasks, atomId), new Error(input.reason));
    input.outputs.push(output);
    input.failed.add(atomId);
    input.emit(buildMapReduceAtomStatusEvent(atomId, 'failed', input.reason));
  }
}

function atomTerminalStatus(outputStatus: PlanningAtomOutput['status'], validationErrorCount: number): PlanningMapReduceAtomStatus {
  if (outputStatus === 'completed' && validationErrorCount === 0) return 'completed';
  if (outputStatus === 'skipped' && validationErrorCount === 0) return 'skipped';
  return 'failed';
}

function atomStatusReason(result: AtomRunResult): string | undefined {
  if (result.output.error) return result.output.error;
  if (result.validationErrors.length > 0) return result.validationErrors.join('; ');
  return undefined;
}

async function runAtom(input: RunPlanningAtomMapInput, task: PlanningAtomTask, acceptedSharedFindings: PlanningSharedFinding[]): Promise<AtomRunResult> {
  try {
    const result = await runPlanningAtomPlanner({ task, sourceContent: input.sourceContent, cwd: input.cwd, harness: input.harness, agentOptions: input.agentOptions, abortSignal: input.abortSignal, acceptedSharedFindings, sourceEvidenceBundle: input.sourceEvidenceBundle, onEvent: input.onEvent });
    const validation = validatePlanningAtomOutput({ graph: input.graph, inventory: input.inventory, aspects: input.aspects, task, output: result.output });
    if (!validation.ok) return { output: failedOutput(task, new Error(`invalid atom output:${validation.errors.join('; ')}`)), events: result.events, validationErrors: validation.errors };
    return { output: result.output, events: result.events, validationErrors: [] };
  } catch (err) {
    if (isAbortError(err)) throw err;
    return { output: failedOutput(task, err), events: [], validationErrors: [`atom planner failed:${task.atomId}:${err instanceof Error ? err.message : String(err)}`] };
  }
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

function finish(input: RunPlanningAtomMapInput, state: { outputs: PlanningAtomOutput[]; events: EforgeEvent[]; completed: Set<string>; failed: Set<string>; skipped: Set<string>; validationErrors: string[]; iterations: number; blockedAtoms: BlockedPlanningAtom[]; readyAtomIds: string[] }): PlanningAtomMapResult {
  const summary = summarizePlanningAtomOutputs({ graph: input.graph, inventory: input.inventory, aspects: input.aspects, sharedBrief: input.sharedBrief, outputs: state.outputs });
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
  const base = selectReadyPlanningAtoms({ graph: input.graph, completedAtomIds: completed, failedAtomIds: failed, runningAtomIds: running.keys(), skippedAtomIds: skipped, parallelism: input.graph.atoms.length });
  const sharedBlocked: BlockedPlanningAtom[] = [];
  const candidates: string[] = [];
  for (const atomId of base.readyAtomIds) {
    const missingPrerequisites = (tasks.get(atomId)?.sharedBrief?.prerequisiteAtomIds ?? []).filter((dependencyId) => !completed.has(dependencyId));
    if (missingPrerequisites.length > 0) sharedBlocked.push({ atomId, blockedByAtomIds: missingPrerequisites });
    else candidates.push(atomId);
  }
  const capacity = Math.max(0, parallelism - running.size);
  return { readyAtomIds: candidates.slice(0, capacity), blockedAtoms: [...base.blockedAtoms, ...sharedBlocked].sort((a, b) => a.atomId.localeCompare(b.atomId)) };
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

function failedOutput(task: PlanningAtomTask, err: unknown): PlanningAtomOutput {
  return { atomId: task.atomId, status: 'failed', aspectUpdates: [], error: err instanceof Error ? err.message : String(err) };
}

function requireTask(tasks: Map<string, PlanningAtomTask>, atomId: string): PlanningAtomTask {
  const task = tasks.get(atomId);
  if (!task) throw new Error(`missing atom task:${atomId}`);
  return task;
}
