import type { PlanningDecompositionLimits } from '@eforge-build/client';
import type { EforgeConfig } from '../config.js';
import type { SharedPlanningBriefLimits } from '../planner-compiler/shared-brief-contracts.js';
import {
  DEFAULT_DIRECT_PR_REBASE_CONFLICT_ATTEMPTS,
  MAX_DIRECT_PR_REBASE_CONFLICT_ATTEMPTS,
} from '../direct-pr-base-sync.js';

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
  planningSharedBriefMaxTotalBytes: number;
  planningSharedBriefMaxSectionBytes: number;
  planningSharedBriefMaxSectionsPerAtom: number;
  directPrBaseSyncConflictAttempts: number;
}

export const PLANNING_DECOMPOSITION_CONFIG_MAXIMA: Readonly<PlanningDecompositionConfig> = Object.freeze({
  planningUnitParallelism: 16,
  planningUnitMaxDepth: 8,
  planningUnitMaxPromptSourceBytes: 250_000,
  planningUnitMaxPromptBytes: 500_000,
  planningUnitMaxObservedInputTokens: 1_000_000,
  planningUnitMaxObservedTurns: 200,
  planningUnitMaxCompactHandoffBytes: 100_000,
  planningUnitMaxLocalExplorationToolUses: 256,
  planningUnitMaxCriteriaPerUnit: 64,
  planningUnitMaxSubsystemsPerUnit: 32,
  planningUnitMaxSplitAttemptsPerUnit: 8,
  planningSharedBriefMaxTotalBytes: 200_000,
  planningSharedBriefMaxSectionBytes: 50_000,
  planningSharedBriefMaxSectionsPerAtom: 64,
  directPrBaseSyncConflictAttempts: MAX_DIRECT_PR_REBASE_CONFLICT_ATTEMPTS,
});

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
  planningSharedBriefMaxTotalBytes: 12_000,
  planningSharedBriefMaxSectionBytes: 1_500,
  planningSharedBriefMaxSectionsPerAtom: 8,
  directPrBaseSyncConflictAttempts: DEFAULT_DIRECT_PR_REBASE_CONFLICT_ATTEMPTS,
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

/**
 * Adaptive rescope limits are engine-internal for now: `config.ts` sits at its
 * no-growth ceiling, so these gain config.yaml keys only once that file has
 * headroom. `planningUnitMaxLocalExplorationToolUses` remains the per-scope
 * clamp on the derived exploration budget.
 */
export interface AdaptiveRescopeLimits {
  maxRescopeAttempts: number;
  explorationBudgetBaseToolUses: number;
  explorationBudgetToolUsesPerNeed: number;
  explorationTotalBudgetMultiplier: number;
}

export const ADAPTIVE_RESCOPE_LIMITS_MAXIMA: Readonly<AdaptiveRescopeLimits> = Object.freeze({
  maxRescopeAttempts: 4,
  explorationBudgetBaseToolUses: 64,
  explorationBudgetToolUsesPerNeed: 16,
  explorationTotalBudgetMultiplier: 8,
});

export const DEFAULT_ADAPTIVE_RESCOPE_LIMITS: Readonly<AdaptiveRescopeLimits> = Object.freeze({
  maxRescopeAttempts: 1,
  explorationBudgetBaseToolUses: 8,
  explorationBudgetToolUsesPerNeed: 2,
  explorationTotalBudgetMultiplier: 3,
});

export function resolveAdaptiveRescopeLimits(overrides?: Partial<AdaptiveRescopeLimits>): AdaptiveRescopeLimits {
  const clamp = (key: keyof AdaptiveRescopeLimits): number => {
    const value = overrides?.[key] ?? DEFAULT_ADAPTIVE_RESCOPE_LIMITS[key];
    return Math.max(0, Math.min(value, ADAPTIVE_RESCOPE_LIMITS_MAXIMA[key]));
  };
  return Object.freeze({
    maxRescopeAttempts: clamp('maxRescopeAttempts'),
    explorationBudgetBaseToolUses: Math.max(1, clamp('explorationBudgetBaseToolUses')),
    explorationBudgetToolUsesPerNeed: clamp('explorationBudgetToolUsesPerNeed'),
    explorationTotalBudgetMultiplier: Math.max(1, clamp('explorationTotalBudgetMultiplier')),
  });
}

export function resolveSharedPlanningBriefLimits(config: Pick<EforgeConfig, 'compile'>): Partial<SharedPlanningBriefLimits> {
  return Object.freeze({
    maxTotalBriefBytes: config.compile.planningSharedBriefMaxTotalBytes,
    maxSectionBytes: config.compile.planningSharedBriefMaxSectionBytes,
    maxSectionsPerAtom: config.compile.planningSharedBriefMaxSectionsPerAtom,
  });
}
