import type { PlanningDecompositionUnitStatus, PlanningObservedBudgetPressure, PlanningUnitBudget } from '@eforge-build/client';

/**
 * Legacy bounded planning-unit data shapes.
 *
 * Runtime overflow planning now uses the canonical planner compiler in
 * `packages/engine/src/planner-compiler/`. These interfaces remain only for
 * bounded prompt-context compatibility in direct planner/module-planner APIs.
 */
export type PlanningSourceSliceKind = 'prd' | 'artifact' | 'file' | 'criteria' | 'other';
export interface PlanningSourceSlice { kind: PlanningSourceSliceKind; sourceHash: string; path?: string; headingPath?: string[]; startLine?: number; endLine?: number; byteStart?: number; byteEnd?: number; criteriaIds: string[]; byteLength: number }
export interface PlanningUnresolvedCriterion { criterionId: string; reason: string; evidence?: string }
export interface PlanningUnitOutput {
  unitId: string;
  artifactPath?: string;
  byteLength?: number;
  contentHash?: string;
  status?: 'completed' | 'failed' | 'skipped';
  coveredCriteria?: string[];
  discoveredFiles?: string[];
  sharedContractNotes?: string[];
  moduleSuggestions?: Array<{ id: string; description: string; dependsOn: string[]; architecture?: string }>;
  planSuggestions?: Array<{ id: string; name?: string; markdown: string; dependsOn?: string[]; buildConfigBlock?: string }>;
  unresolvedRequirements?: PlanningUnresolvedCriterion[];
  compactHandoffRef?: string;
  synthesisNotes?: string[];
  observedBudget?: PlanningObservedBudgetPressure;
}
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
