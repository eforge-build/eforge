import type { EforgeEvent } from '../events.js';
import type { AgentHarness, SdkPassthroughConfig } from '../harness.js';
import type { PlanningAtomGraph } from './atom-graph.js';
import { buildPlanningAtomTasks, summarizePlanningAtomOutputs, validatePlanningAtomOutput, type PlanningAtomOutput, type PlanningAtomTask } from './atom-planning-contracts.js';
import { runPlanningAtomPlanner } from './atom-planner-agent.js';
import { selectReadyPlanningAtoms, type BlockedPlanningAtom } from './atom-scheduler.js';
import type { PlanningAspectCoverageSummary, PlanningCriterionAspect } from './coverage-accounting.js';
import { validateSharedPlanningBrief, type PlanningSharedFinding, type SharedPlanningBrief } from './shared-brief-contracts.js';
import type { SourceInventory } from './source-inventory.js';

export interface RunPlanningAtomMapInput { graph: PlanningAtomGraph; inventory?: SourceInventory; sourceContent: string; cwd: string; harness: AgentHarness; agentOptions?: SdkPassthroughConfig & { maxTurns?: number }; aspects?: PlanningCriterionAspect[]; parallelism?: number; abortSignal?: AbortSignal; sharedBrief?: SharedPlanningBrief }
export interface PlanningAtomMapResult { graphId: string; outputs: PlanningAtomOutput[]; coverage: PlanningAspectCoverageSummary; completedAtomIds: string[]; failedAtomIds: string[]; skippedAtomIds: string[]; blockedAtoms: BlockedPlanningAtom[]; readyAtomIds: string[]; mapComplete: boolean; validationErrors: string[]; events: EforgeEvent[]; iterations: number; sharedFindings: PlanningSharedFinding[] }

interface AtomRunResult { output: PlanningAtomOutput; events: EforgeEvent[]; validationErrors: string[] }

export async function runPlanningAtomMap(input: RunPlanningAtomMapInput): Promise<PlanningAtomMapResult> {
  const briefValidation = input.sharedBrief ? validateSharedPlanningBrief(input.sharedBrief, input.graph) : { ok: true as const, errors: [] };
  const tasks = new Map(buildPlanningAtomTasks(input).map((task) => [task.atomId, task]));
  const completed = new Set<string>();
  const failed = new Set<string>();
  const skipped = new Set<string>();
  const outputs: PlanningAtomOutput[] = [];
  const events: EforgeEvent[] = [];
  const validationErrors: string[] = briefValidation.ok ? [] : briefValidation.errors;
  let iterations = 0;

  while (true) {
    const decision = selectReadyAtoms(input, tasks, completed, failed, skipped);
    if (decision.readyAtomIds.length === 0) return finish(input, { outputs, events, completed, failed, skipped, validationErrors, iterations, blockedAtoms: decision.blockedAtoms, readyAtomIds: decision.readyAtomIds });
    iterations += 1;
    const acceptedFindings = outputs.flatMap((output) => output.sharedFindings ?? []);
    const batchResults = await Promise.all(decision.readyAtomIds.map((atomId) => runAtom(input, requireTask(tasks, atomId), acceptedFindings)));
    for (const result of batchResults) {
      outputs.push(result.output);
      events.push(...result.events);
      validationErrors.push(...result.validationErrors);
      if (result.output.status === 'completed' && result.validationErrors.length === 0) completed.add(result.output.atomId);
      else if (result.output.status === 'skipped' && result.validationErrors.length === 0) skipped.add(result.output.atomId);
      else failed.add(result.output.atomId);
    }
  }
}

async function runAtom(input: RunPlanningAtomMapInput, task: PlanningAtomTask, acceptedSharedFindings: PlanningSharedFinding[]): Promise<AtomRunResult> {
  try {
    const result = await runPlanningAtomPlanner({ task, sourceContent: input.sourceContent, cwd: input.cwd, harness: input.harness, agentOptions: input.agentOptions, abortSignal: input.abortSignal, acceptedSharedFindings });
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

function selectReadyAtoms(input: RunPlanningAtomMapInput, tasks: Map<string, PlanningAtomTask>, completed: Set<string>, failed: Set<string>, skipped: Set<string>): { readyAtomIds: string[]; blockedAtoms: BlockedPlanningAtom[] } {
  const base = selectReadyPlanningAtoms({ graph: input.graph, completedAtomIds: completed, failedAtomIds: failed, skippedAtomIds: skipped, parallelism: input.graph.atoms.length });
  const sharedBlocked: BlockedPlanningAtom[] = [];
  const candidates: string[] = [];
  for (const atomId of base.readyAtomIds) {
    const missingPrerequisites = (tasks.get(atomId)?.sharedBrief?.prerequisiteAtomIds ?? []).filter((dependencyId) => !completed.has(dependencyId));
    if (missingPrerequisites.length > 0) sharedBlocked.push({ atomId, blockedByAtomIds: missingPrerequisites });
    else candidates.push(atomId);
  }
  const capacity = Math.max(0, input.parallelism ?? input.graph.limits.parallelism);
  return { readyAtomIds: candidates.slice(0, capacity), blockedAtoms: [...base.blockedAtoms, ...sharedBlocked].sort((a, b) => a.atomId.localeCompare(b.atomId)) };
}

function failedOutput(task: PlanningAtomTask, err: unknown): PlanningAtomOutput {
  return { atomId: task.atomId, status: 'failed', aspectUpdates: [], error: err instanceof Error ? err.message : String(err) };
}

function requireTask(tasks: Map<string, PlanningAtomTask>, atomId: string): PlanningAtomTask {
  const task = tasks.get(atomId);
  if (!task) throw new Error(`missing atom task:${atomId}`);
  return task;
}
