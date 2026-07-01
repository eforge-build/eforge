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
import { deriveSourceLocalization } from './source-localization.js';
import type { SourceLocalizationBundle, SourceLocalizationInputHints, SourceLocalizationLimits } from './source-localization-contracts.js';
import { runPlanningReduce, type PlanningReduceResult } from './reduce-runner.js';
import { deriveInitialReduceDigestPromptBudget } from './prompt-budget-planner.js';
import { DEFAULT_PLANNING_REDUCE_LIMITS, type PlanningReduceLimits } from './reduce-contracts.js';
import { synthesizePlanningResidue } from './residue-synthesis.js';
import type { PlanningResidueLimits, PlanningResidueSynthesis } from './residue-contracts.js';
import type { PlannerCompilerEventSink } from './event-sink.js';
import { DEFAULT_SOURCE_LOCALIZATION_REPAIR_ATTEMPTS, runSourceLocalizationRepairLoop, type SourceLocalizationRepairDiagnostic } from './source-localization-repair.js';

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
  sourceLocalizationHints?: SourceLocalizationInputHints;
  sourceLocalizationLimits?: Partial<SourceLocalizationLimits>;
  sourceEvidenceLimits?: Partial<PlanningSourceEvidenceLimits>;
  reduceLimits?: Partial<PlanningReduceLimits>;
  residueLimits?: Partial<PlanningResidueLimits>;
  maxRepairAttempts?: number;
  parallelism?: number;
  abortSignal?: AbortSignal;
  onEvent?: PlannerCompilerEventSink;
}

export interface BoundedPlannerCompilerResult {
  sourceInventory: SourceInventory;
  atomGraph: PlanningAtomGraph;
  sourceLocalizationBundle: SourceLocalizationBundle;
  sharedBrief: SharedPlanningBrief;
  sourceEvidenceBundle: PlanningSourceEvidenceBundle;
  map: PlanningAtomMapResult;
  reduce: PlanningReduceResult;
  residue: PlanningResidueSynthesis;
  repairDiagnostics: SourceLocalizationRepairDiagnostic[];
  status: BoundedPlannerCompilerStatus;
  validationErrors: string[];
  events: EforgeEvent[];
}

export async function runBoundedPlannerCompiler(input: RunBoundedPlannerCompilerInput): Promise<BoundedPlannerCompilerResult> {
  const sourceInventory = deriveSourceInventory({ content: input.sourceContent, hash: input.sourceHash, path: input.sourcePath });
  const atomGraph = derivePlanningAtomGraph({ content: input.sourceContent, hash: sourceInventory.sourceHash, path: input.sourcePath, limits: input.limits, inventory: sourceInventory });
  const sourceLocalizationBundle = await deriveSourceLocalization({ cwd: input.cwd, inventory: sourceInventory, graph: atomGraph, hints: input.sourceLocalizationHints, limits: input.sourceLocalizationLimits });
  const sharedBrief = deriveSharedPlanningBrief({ graph: atomGraph, sourceLocalizationBundle, limits: input.sharedBriefLimits });
  const sourceEvidenceBundle = await materializePlanningSourceEvidence({ cwd: input.cwd, graph: atomGraph, sharedBrief, limits: input.sourceEvidenceLimits });
  const reduceLimits = { ...DEFAULT_PLANNING_REDUCE_LIMITS, ...(input.reduceLimits ?? {}) };
  const reduceDigestPromptBudgetBytes = deriveInitialReduceDigestPromptBudget({ graph: atomGraph, limits: reduceLimits });
  const map = await runPlanningAtomMap({ graph: atomGraph, inventory: sourceInventory, sharedBrief, sourceEvidenceBundle, sourceContent: input.sourceContent, cwd: input.cwd, harness: input.harness, agentOptions: input.agentOptions, reduceDigestPromptBudgetBytes, parallelism: input.parallelism, abortSignal: input.abortSignal, onEvent: input.onEvent });
  const reduce = await runPlanningReduce({ graph: atomGraph, mapResult: map, cwd: input.cwd, harness: input.harness, agentOptions: input.agentOptions, limits: reduceLimits, abortSignal: input.abortSignal, onEvent: input.onEvent });
  const repair = await runSourceLocalizationRepairLoop({ cwd: input.cwd, sourceContent: input.sourceContent, sourceInventory, graph: atomGraph, harness: input.harness, agentOptions: input.agentOptions, sourceLocalizationBundle, sharedBrief, sourceEvidenceBundle, map, reduce, sourceLocalizationHints: input.sourceLocalizationHints, sourceLocalizationLimits: input.sourceLocalizationLimits, sharedBriefLimits: input.sharedBriefLimits, sourceEvidenceLimits: input.sourceEvidenceLimits, reduceLimits, reduceDigestPromptBudgetBytes, maxAttempts: input.maxRepairAttempts ?? DEFAULT_SOURCE_LOCALIZATION_REPAIR_ATTEMPTS, parallelism: input.parallelism, abortSignal: input.abortSignal, onEvent: input.onEvent });
  const residue = synthesizePlanningResidue({ graph: atomGraph, coverage: repair.map.coverage, atomOutputs: repair.map.outputs, sourceEvidenceBundle: repair.sourceEvidenceBundle, reduceOutputs: repair.reduce.outputs, limits: input.residueLimits });
  const validationErrors = compilerValidationErrors(repair.sourceLocalizationBundle, repair.sourceEvidenceBundle, repair.map, repair.reduce, residue, repair.diagnostics);
  return { sourceInventory, atomGraph, sourceLocalizationBundle: repair.sourceLocalizationBundle, sharedBrief: repair.sharedBrief, sourceEvidenceBundle: repair.sourceEvidenceBundle, map: repair.map, reduce: repair.reduce, residue, repairDiagnostics: repair.diagnostics, status: compilerStatus(repair.map, repair.reduce, residue, validationErrors), validationErrors, events: [...repair.map.events, ...repair.reduce.events] };
}

function compilerValidationErrors(sourceLocalizationBundle: SourceLocalizationBundle, sourceEvidenceBundle: PlanningSourceEvidenceBundle, map: PlanningAtomMapResult, reduce: PlanningReduceResult, residue: PlanningResidueSynthesis, repairDiagnostics: SourceLocalizationRepairDiagnostic[]): string[] {
  const reduceErrors = residue.candidates.length > 0 ? reduce.validationErrors.filter((error) => error !== 'map result incomplete') : reduce.validationErrors;
  const localizationErrors = sourceLocalizationBundle.diagnostics.filter((diagnostic) => diagnostic.severity === 'error').map((diagnostic) => `source localization ${diagnostic.code}${diagnostic.path ? `:${diagnostic.path}` : ''}:${diagnostic.message}`);
  const repairErrors = repairDiagnostics.filter((diagnostic) => diagnostic.status === 'exhausted').map((diagnostic) => `source localization repair exhausted:${diagnostic.gapIds.join(',')}:${diagnostic.unresolvedReason ?? 'unresolved source/localization gaps'}`);
  return [...new Set([...localizationErrors, ...sourceEvidenceBundle.validationErrors, ...map.validationErrors, ...reduceErrors, ...residue.validationErrors, ...repairErrors])].sort();
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
