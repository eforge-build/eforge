import type { PlanningDecompositionLimits, PlanningUnitBudget } from '@eforge-build/client';

export function derivePlanningAtomBudget(limits: PlanningDecompositionLimits, depth = 0): PlanningUnitBudget {
  const budget: PlanningUnitBudget = {
    maxRecursiveDepth: Math.max(0, limits.maxDepth - depth),
    maxPromptSourceBytes: limits.maxPromptSourceBytes,
    maxPromptBytes: limits.maxPromptBytes,
    maxObservedInputTokens: limits.maxObservedInputTokens,
    maxCompactHandoffBytes: limits.maxCompactHandoffBytes,
    maxLocalExplorationToolUses: limits.maxLocalExplorationToolUses,
    maxCriteriaPerUnit: limits.maxCriteriaPerUnit,
    maxSubsystemsPerUnit: limits.maxSubsystemsPerUnit,
    maxSplitAttemptsPerUnit: limits.maxSplitAttemptsPerUnit,
  };
  if (limits.maxObservedTurns !== undefined) budget.maxObservedTurns = limits.maxObservedTurns;
  return budget;
}
