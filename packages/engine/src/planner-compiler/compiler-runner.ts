import type { PlanningDecompositionLimits } from '@eforge-build/client';
import type { EforgeEvent } from '../events.js';
import type { AgentHarness, SdkPassthroughConfig } from '../harness.js';
import { derivePlanningAtomGraph, type PlanningAtomGraph } from './atom-graph.js';
import { runPlanningAtomMap, type PlanningAtomMapResult } from './atom-map-runner.js';
import { deriveSharedPlanningBrief } from './shared-brief.js';
import type { SharedPlanningBrief, SharedPlanningBriefLimits } from './shared-brief-contracts.js';
import { materializePlanningSourceEvidence } from './source-evidence-materialization.js';
import type { PlanningSourceEvidenceBundle, PlanningSourceEvidenceLimits } from './source-evidence-contracts.js';
import { deriveSourceInventory, type SourceInventory } from './source-inventory.js';
import { runPlanningReduce, type PlanningReduceResult } from './reduce-runner.js';
import { deriveInitialReduceDigestPromptBudget } from './prompt-budget-planner.js';
import { DEFAULT_PLANNING_REDUCE_LIMITS, type PlanningReduceLimits } from './reduce-contracts.js';
import { synthesizePlanningResidue } from './residue-synthesis.js';
import type { PlanningResidueLimits, PlanningResidueSynthesis } from './residue-contracts.js';
import type { PlannerCompilerEventSink } from './event-sink.js';

export type BoundedPlannerCompilerStatus = 'complete' | 'complete-with-residue' | 'incomplete' | 'failed';

export interface RunBoundedPlannerCompilerInput {
  sourceContent: string;
  sourcePath?: string;
  sourceHash?: string;
  cwd: string;
  harness: AgentHarness;
  limits: PlanningDecompositionLimits;
  agentOptions?: SdkPassthroughConfig & { maxTurns?: number };
  sharedBriefLimits?: Partial<SharedPlanningBriefLimits>;
  sourceEvidenceLimits?: Partial<PlanningSourceEvidenceLimits>;
  reduceLimits?: Partial<PlanningReduceLimits>;
  residueLimits?: Partial<PlanningResidueLimits>;
  parallelism?: number;
  abortSignal?: AbortSignal;
  onEvent?: PlannerCompilerEventSink;
}

export interface BoundedPlannerCompilerResult {
  sourceInventory: SourceInventory;
  atomGraph: PlanningAtomGraph;
  sharedBrief: SharedPlanningBrief;
  sourceEvidenceBundle: PlanningSourceEvidenceBundle;
  map: PlanningAtomMapResult;
  reduce: PlanningReduceResult;
  residue: PlanningResidueSynthesis;
  status: BoundedPlannerCompilerStatus;
  validationErrors: string[];
  events: EforgeEvent[];
}

export async function runBoundedPlannerCompiler(input: RunBoundedPlannerCompilerInput): Promise<BoundedPlannerCompilerResult> {
  const sourceInventory = deriveSourceInventory({ content: input.sourceContent, hash: input.sourceHash, path: input.sourcePath });
  const atomGraph = derivePlanningAtomGraph({ content: input.sourceContent, hash: sourceInventory.sourceHash, path: input.sourcePath, limits: input.limits, inventory: sourceInventory });
  const sharedBrief = deriveSharedPlanningBrief({ graph: atomGraph, limits: input.sharedBriefLimits });
  const sourceEvidenceBundle = await materializePlanningSourceEvidence({ cwd: input.cwd, graph: atomGraph, sharedBrief, limits: input.sourceEvidenceLimits });
  const reduceLimits = { ...DEFAULT_PLANNING_REDUCE_LIMITS, ...(input.reduceLimits ?? {}) };
  const reduceDigestPromptBudgetBytes = deriveInitialReduceDigestPromptBudget({ graph: atomGraph, limits: reduceLimits });
  const map = await runPlanningAtomMap({ graph: atomGraph, inventory: sourceInventory, sharedBrief, sourceEvidenceBundle, sourceContent: input.sourceContent, cwd: input.cwd, harness: input.harness, agentOptions: input.agentOptions, reduceDigestPromptBudgetBytes, parallelism: input.parallelism, abortSignal: input.abortSignal, onEvent: input.onEvent });
  const reduce = await runPlanningReduce({ graph: atomGraph, mapResult: map, cwd: input.cwd, harness: input.harness, agentOptions: input.agentOptions, limits: reduceLimits, abortSignal: input.abortSignal, onEvent: input.onEvent });
  const residue = synthesizePlanningResidue({ graph: atomGraph, coverage: map.coverage, atomOutputs: map.outputs, sourceEvidenceBundle, reduceOutputs: reduce.outputs, limits: input.residueLimits });
  const validationErrors = compilerValidationErrors(sourceEvidenceBundle, map, reduce, residue);
  return { sourceInventory, atomGraph, sharedBrief, sourceEvidenceBundle, map, reduce, residue, status: compilerStatus(map, reduce, residue, validationErrors), validationErrors, events: [...map.events, ...reduce.events] };
}

function compilerValidationErrors(sourceEvidenceBundle: PlanningSourceEvidenceBundle, map: PlanningAtomMapResult, reduce: PlanningReduceResult, residue: PlanningResidueSynthesis): string[] {
  const reduceErrors = residue.candidates.length > 0 ? reduce.validationErrors.filter((error) => error !== 'map result incomplete') : reduce.validationErrors;
  return [...new Set([...sourceEvidenceBundle.validationErrors, ...map.validationErrors, ...reduceErrors, ...residue.validationErrors])].sort();
}

function compilerStatus(map: PlanningAtomMapResult, reduce: PlanningReduceResult, residue: PlanningResidueSynthesis, validationErrors: string[]): BoundedPlannerCompilerStatus {
  if (residue.validationErrors.length > 0) return 'failed';
  if (map.failedAtomIds.length > 0 && !hasSourceEvidenceResidue(residue)) return 'failed';
  if (residue.candidates.length > 0) return 'complete-with-residue';
  if (validationErrors.length > 0) return 'incomplete';
  return map.mapComplete && reduce.reduceComplete ? 'complete' : 'incomplete';
}

function hasSourceEvidenceResidue(residue: PlanningResidueSynthesis): boolean {
  return residue.candidates.some((candidate) => candidate.reason === 'source-evidence-missing' || candidate.reason === 'source-evidence-too-large' || candidate.reason === 'source-evidence-read-error' || candidate.reason === 'source-evidence-budget-exceeded');
}
