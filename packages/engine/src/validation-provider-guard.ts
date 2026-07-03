/**
 * Validation-provider runtime guard — injects the extension-gated `validate` build
 * stage when validation providers are loaded.
 *
 * The compiler's pipeline derivation is pure and has no knowledge of runtime
 * extension config, so provider-backed quality gates are wired at plan-build
 * resolution instead, mirroring the sharded-plan guard pattern. The stage runs
 * providers as gates before review, so it is inserted immediately before
 * review-cycle (appended when no review stage is present).
 */

import type { BuildStageSpec } from './config.js';
import type { ValidationProviderRegistration } from './extensions/types.js';

export interface ValidationProviderGuardResult {
  planBuild: BuildStageSpec[];
  /** True when the validate stage was injected (false when nothing changed). */
  injected: boolean;
}

export function applyValidationProviderGuard(
  planBuild: BuildStageSpec[],
  providers: readonly ValidationProviderRegistration[] | undefined,
): ValidationProviderGuardResult {
  if (!providers || providers.length === 0) return { planBuild, injected: false };
  if (planBuild.flat().includes('validate')) return { planBuild, injected: false };
  const reviewCycleIndex = planBuild.findIndex((stage) => (Array.isArray(stage) ? stage.includes('review-cycle') : stage === 'review-cycle'));
  const insertAt = reviewCycleIndex === -1 ? planBuild.length : reviewCycleIndex;
  return { planBuild: [...planBuild.slice(0, insertAt), 'validate', ...planBuild.slice(insertAt)], injected: true };
}
