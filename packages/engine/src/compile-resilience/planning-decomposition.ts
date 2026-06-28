import type { CompilePreflightRisk, DecompositionFailureEvidence, PlanningDecompositionLimits, PlanningDecompositionUnitStatus, PlanningObservedBudgetPressure, PlanningScheduleDecision, PlanningSplitAttemptEvidence, PlanningUnitBudget } from '@eforge-build/client';
import type { PipelineComposition } from '../schemas.js';
import { deriveGraph, recomputeCoverage, validateGraph } from './planning-decomposition/graph-builders.js';
import { selectBatch } from './planning-decomposition/scheduler.js';
import { splitUnit } from './planning-decomposition/splitting.js';

export type PlanningSourceSliceKind = 'prd' | 'artifact' | 'file' | 'criteria' | 'other';
export interface PlanningSourceSlice { kind: PlanningSourceSliceKind; sourceHash: string; path?: string; headingPath?: string[]; startLine?: number; endLine?: number; criteriaIds: string[]; byteLength: number }
export interface PlanningCriterionCoverage { criterionId: string; sourceHash?: string; coveredByUnitIds: string[] }
export interface PlanningUnresolvedCriterion { criterionId: string; reason: string; evidence?: string }
export interface PlanningCoverageSummary { totalCriteria: number; coverageByUnit: Record<string, string[]>; coveredCriteria: PlanningCriterionCoverage[]; unresolvedCriteria: PlanningUnresolvedCriterion[] }
export interface PlanningUnitOutput { unitId: string; artifactPath?: string; byteLength?: number; contentHash?: string }
export interface PlanningDecompositionEdge { fromUnitId: string; toUnitId: string; reason: string }
export interface PlanningDecompositionUnit {
  unitId: string;
  parentId?: string;
  depth: number;
  title: string;
  sourceSlices: PlanningSourceSlice[];
  criteriaIds: string[];
  subsystemHints: string[];
  dependsOn: string[];
  interfaceConstraints: string[];
  sharedFileConstraints: string[];
  budgets: PlanningUnitBudget;
  status: PlanningDecompositionUnitStatus;
}
export interface PlanningDecompositionGraph {
  graphId: string;
  rootUnitId: string;
  units: PlanningDecompositionUnit[];
  edges: PlanningDecompositionEdge[];
  coverage: PlanningCoverageSummary;
  parallelism: number;
  limits: PlanningDecompositionLimits;
  sourceHash: string;
  splitAttempts: PlanningSplitAttemptEvidence[];
}
export interface DecompositionPlanningError { kind: 'decomposition-exhausted'; stage: 'planning-decomposition'; source: 'decomposition'; message: string; evidence: DecompositionFailureEvidence }

export interface DerivePlanningDecompositionGraphInput { source: { content: string; hash: string; path?: string }; preflightRisk?: CompilePreflightRisk; pipelineComposition?: PipelineComposition; limits: PlanningDecompositionLimits }
export interface SelectReadyPlanningBatchInput { graph: PlanningDecompositionGraph; completedUnitIds?: Iterable<string>; failedUnitIds?: Iterable<string>; runningUnitIds?: Iterable<string>; skippedUnitIds?: Iterable<string>; parallelism?: number }
export interface SplitOverBudgetPlanningUnitInput { graph: PlanningDecompositionGraph; unit: PlanningDecompositionUnit; observedPressure: PlanningObservedBudgetPressure; limits?: PlanningDecompositionLimits }
export interface EvaluatePlanningUnitBudgetPressureInput { unit: PlanningDecompositionUnit; observed?: Partial<Omit<PlanningObservedBudgetPressure, 'triggeredLimitKeys'>> }

export function derivePlanningDecompositionGraph(input: DerivePlanningDecompositionGraphInput): PlanningDecompositionGraph { return deriveGraph(input); }
export function selectReadyPlanningBatch(input: SelectReadyPlanningBatchInput): PlanningScheduleDecision { return selectBatch(input); }
export function splitOverBudgetPlanningUnit(input: SplitOverBudgetPlanningUnitInput): { graph: PlanningDecompositionGraph; childUnitIds: string[] } | DecompositionPlanningError { return splitUnit(input); }
export function summarizePlanningCoverage(graph: PlanningDecompositionGraph): PlanningCoverageSummary { return recomputeCoverage(graph.units, graph.sourceHash, graph.coverage); }
export function validatePlanningDecompositionGraph(graph: PlanningDecompositionGraph): { ok: true; errors: [] } | { ok: false; errors: string[] } { return validateGraph(graph); }

export function evaluatePlanningUnitBudgetPressure(input: EvaluatePlanningUnitBudgetPressureInput): PlanningObservedBudgetPressure {
  const { unit, observed = {} } = input;
  const pressure: PlanningObservedBudgetPressure = {
    promptSourceBytes: observed.promptSourceBytes ?? unit.sourceSlices.reduce((sum, slice) => sum + slice.byteLength, 0),
    promptBytes: observed.promptBytes,
    observedInputTokens: observed.observedInputTokens,
    observedTurns: observed.observedTurns,
    compactHandoffBytes: observed.compactHandoffBytes,
    localExplorationToolUses: observed.localExplorationToolUses,
    criteriaCount: observed.criteriaCount ?? unit.criteriaIds.length,
    subsystemCount: observed.subsystemCount ?? unit.subsystemHints.length,
    splitAttempts: observed.splitAttempts,
    triggeredLimitKeys: [],
  };
  const checks: Array<[keyof PlanningObservedBudgetPressure, keyof PlanningUnitBudget]> = [
    ['promptSourceBytes', 'maxPromptSourceBytes'], ['promptBytes', 'maxPromptBytes'], ['observedInputTokens', 'maxObservedInputTokens'], ['observedTurns', 'maxObservedTurns'], ['compactHandoffBytes', 'maxCompactHandoffBytes'], ['localExplorationToolUses', 'maxLocalExplorationToolUses'], ['criteriaCount', 'maxCriteriaPerUnit'], ['subsystemCount', 'maxSubsystemsPerUnit'], ['splitAttempts', 'maxSplitAttemptsPerUnit'],
  ];
  pressure.triggeredLimitKeys = checks.filter(([field, limit]) => typeof pressure[field] === 'number' && typeof unit.budgets[limit] === 'number' && (pressure[field] as number) > (unit.budgets[limit] as number)).map(([, limit]) => limit);
  return pressure;
}
