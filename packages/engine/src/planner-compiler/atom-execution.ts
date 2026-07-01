import type { PlanningMapReduceAtomStatus } from '@eforge-build/client';
import type { EforgeEvent } from '../events.js';
import { runPlanningAtomPlanner } from './atom-planner-agent.js';
import { validatePlanningAtomOutput, type PlanningAtomOutput, type PlanningAtomTask } from './atom-planning-contracts.js';
import type { RunPlanningAtomMapInput } from './atom-map-runner.js';
import type { PlanningSharedFinding } from './shared-brief-contracts.js';
import { isAbortError } from './abort-utils.js';

export interface AtomRunResult { output: PlanningAtomOutput; events: EforgeEvent[]; validationErrors: string[] }

export async function executePlanningAtom(input: RunPlanningAtomMapInput, task: PlanningAtomTask, acceptedSharedFindings: PlanningSharedFinding[]): Promise<AtomRunResult> {
  try {
    const result = await runPlanningAtomPlanner({ task, sourceContent: input.sourceContent, cwd: input.cwd, harness: input.harness, agentOptions: input.agentOptions, abortSignal: input.abortSignal, acceptedSharedFindings, sourceEvidenceBundle: input.sourceEvidenceBundle, onEvent: input.onEvent });
    const validation = validatePlanningAtomOutput({ graph: input.graph, inventory: input.inventory, aspects: input.aspects, sharedBrief: input.sharedBrief, sourceEvidenceBundle: input.sourceEvidenceBundle, reduceDigestPromptBudgetBytes: input.reduceDigestPromptBudgetBytes, task, output: result.output });
    if (!validation.ok) return { output: failedAtomOutput(task, new Error(`invalid atom output:${validation.errors.join('; ')}`)), events: result.events, validationErrors: validation.errors };
    return { output: result.output, events: result.events, validationErrors: [] };
  } catch (err) {
    if (isAbortError(err)) throw err;
    return { output: failedAtomOutput(task, err), events: [], validationErrors: [`atom planner failed:${task.atomId}:${err instanceof Error ? err.message : String(err)}`] };
  }
}

export function atomTerminalStatus(outputStatus: PlanningAtomOutput['status'], validationErrorCount: number): PlanningMapReduceAtomStatus {
  if (outputStatus === 'completed' && validationErrorCount === 0) return 'completed';
  if (outputStatus === 'skipped' && validationErrorCount === 0) return 'skipped';
  return 'failed';
}

export function atomStatusReason(result: AtomRunResult): string | undefined {
  if (result.output.error) return result.output.error;
  if (result.validationErrors.length > 0) return result.validationErrors.join('; ');
  return undefined;
}

export function failedAtomOutput(task: PlanningAtomTask, err: unknown): PlanningAtomOutput {
  return { atomId: task.atomId, status: 'failed', aspectUpdates: [], error: err instanceof Error ? err.message : String(err) };
}
