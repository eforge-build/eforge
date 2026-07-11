import type { PlanningAtomGraph } from './atom-graph.js';

export interface PlanningModuleBoundaryBudget {
  maxSourceContextBytes: number;
  maxCriteriaPerModule: number;
  maxSubsystemsPerModule: number;
  evidenceUnits: PlanningModuleBoundaryEvidenceUnit[];
}

export interface PlanningModuleBoundaryEvidenceUnit {
  atomId: string;
  criterionIds: string[];
  aspectIds: string[];
  subsystemHints: string[];
  sourceBytes: number;
}

export interface PlanningModuleBoundaryCandidate {
  moduleId: string;
  criterionIds: string[];
  aspectIds: string[];
}

export interface PlanningModuleBoundaryUsage {
  sourceContextBytes: number;
  criterionCount: number;
  subsystemCount: number;
}

export function derivePlanningModuleBoundaryBudget(
  graph: PlanningAtomGraph,
  scope?: { criterionIds: string[]; aspectIds: string[] },
): PlanningModuleBoundaryBudget {
  const atoms = graph.atoms.filter((atom) =>
    !scope || intersects(atom.criterionIds, scope.criterionIds) || intersects(atom.facetIds, scope.aspectIds));
  return {
    maxSourceContextBytes: graph.limits.maxPromptSourceBytes,
    maxCriteriaPerModule: graph.limits.maxCriteriaPerUnit,
    maxSubsystemsPerModule: graph.limits.maxSubsystemsPerUnit,
    evidenceUnits: atoms.map((atom) => ({
      atomId: atom.atomId,
      criterionIds: [...atom.criterionIds],
      aspectIds: [...atom.facetIds],
      subsystemHints: [...atom.subsystemHints],
      sourceBytes: atom.estimate.sourceBytes,
    })),
  };
}

export function planningModuleBoundaryUsage(
  budget: PlanningModuleBoundaryBudget,
  module: PlanningModuleBoundaryCandidate,
): PlanningModuleBoundaryUsage {
  const units = budget.evidenceUnits.filter((unit) =>
    intersects(module.criterionIds, unit.criterionIds) || intersects(module.aspectIds, unit.aspectIds));
  return {
    sourceContextBytes: units.reduce((total, unit) => total + unit.sourceBytes, 0),
    criterionCount: module.criterionIds.length,
    subsystemCount: new Set(units.flatMap((unit) => unit.subsystemHints)).size,
  };
}

export function planningModuleBoundaryErrors(
  budget: PlanningModuleBoundaryBudget,
  modules: PlanningModuleBoundaryCandidate[],
): string[] {
  const errors: string[] = [];
  for (const module of modules) {
    const usage = planningModuleBoundaryUsage(budget, module);
    if (usage.sourceContextBytes > budget.maxSourceContextBytes) {
      errors.push(`module source context budget exceeded:${module.moduleId}:${usage.sourceContextBytes}>${budget.maxSourceContextBytes}`);
    }
    if (usage.criterionCount > budget.maxCriteriaPerModule) {
      errors.push(`module criterion budget exceeded:${module.moduleId}:${usage.criterionCount}>${budget.maxCriteriaPerModule}`);
    }
    if (usage.subsystemCount > budget.maxSubsystemsPerModule) {
      errors.push(`module subsystem budget exceeded:${module.moduleId}:${usage.subsystemCount}>${budget.maxSubsystemsPerModule}`);
    }
  }
  return errors.sort();
}

export function intersects(a: string[], b: string[]): boolean {
  return a.some((value) => b.includes(value));
}
