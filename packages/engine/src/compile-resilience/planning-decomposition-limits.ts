import type { PlanningDecompositionLimits } from '@eforge-build/client';
import type { EforgeConfig } from '../config.js';

export interface PlanningDecompositionConfig {
  planningUnitParallelism: number;
  planningUnitMaxDepth: number;
  planningUnitMaxPromptSourceBytes: number;
  planningUnitMaxPromptBytes: number;
  planningUnitMaxObservedInputTokens: number;
  planningUnitMaxObservedTurns?: number;
  planningUnitMaxCompactHandoffBytes: number;
  planningUnitMaxLocalExplorationToolUses: number;
  planningUnitMaxCriteriaPerUnit: number;
  planningUnitMaxSubsystemsPerUnit: number;
  planningUnitMaxSplitAttemptsPerUnit: number;
}

export const DEFAULT_PLANNING_DECOMPOSITION_CONFIG: Readonly<PlanningDecompositionConfig> = Object.freeze({
  planningUnitParallelism: 2,
  planningUnitMaxDepth: 3,
  planningUnitMaxPromptSourceBytes: 40_000,
  planningUnitMaxPromptBytes: 80_000,
  planningUnitMaxObservedInputTokens: 120_000,
  planningUnitMaxObservedTurns: undefined as number | undefined,
  planningUnitMaxCompactHandoffBytes: 12_000,
  planningUnitMaxLocalExplorationToolUses: 24,
  planningUnitMaxCriteriaPerUnit: 20,
  planningUnitMaxSubsystemsPerUnit: 2,
  planningUnitMaxSplitAttemptsPerUnit: 2,
});

export function resolvePlanningDecompositionLimits(config: Pick<EforgeConfig, 'compile'>): PlanningDecompositionLimits {
  const limits: PlanningDecompositionLimits = {
    parallelism: config.compile.planningUnitParallelism,
    maxDepth: config.compile.planningUnitMaxDepth,
    maxPromptSourceBytes: config.compile.planningUnitMaxPromptSourceBytes,
    maxPromptBytes: config.compile.planningUnitMaxPromptBytes,
    maxObservedInputTokens: config.compile.planningUnitMaxObservedInputTokens,
    maxCompactHandoffBytes: config.compile.planningUnitMaxCompactHandoffBytes,
    maxLocalExplorationToolUses: config.compile.planningUnitMaxLocalExplorationToolUses,
    maxCriteriaPerUnit: config.compile.planningUnitMaxCriteriaPerUnit,
    maxSubsystemsPerUnit: config.compile.planningUnitMaxSubsystemsPerUnit,
    maxSplitAttemptsPerUnit: config.compile.planningUnitMaxSplitAttemptsPerUnit,
  };
  if (config.compile.planningUnitMaxObservedTurns !== undefined) {
    limits.maxObservedTurns = config.compile.planningUnitMaxObservedTurns;
  }
  return Object.freeze(limits);
}
