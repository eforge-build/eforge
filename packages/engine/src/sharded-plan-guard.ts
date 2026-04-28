/**
 * Sharded plan runtime guard — belt-and-suspenders injection of review-cycle
 * and verify perspective for plans that use sharded builders.
 *
 * Extracted as a pure, side-effect-free function so it can be unit-tested
 * independently of the full engine pipeline.
 */

import type { BuildStageSpec, ReviewProfileConfig } from './config.js';

export interface ShardedPlanGuardResult {
  planBuild: BuildStageSpec[];
  planReview: ReviewProfileConfig;
  /** Items that were injected (empty when nothing changed). */
  injected: ('review-cycle' | 'verify')[];
}

/**
 * Belt-and-suspenders guard: sharded plans must include review-cycle with the verify
 * perspective. Shards do not self-verify; the review-cycle's verify perspective is the
 * integration gate. Returns a description of what was injected (empty if nothing changed).
 */
export function applyShardedPlanGuard(
  planBuild: BuildStageSpec[],
  planReview: ReviewProfileConfig,
  shards: unknown[] | undefined,
): ShardedPlanGuardResult {
  const injected: ('review-cycle' | 'verify')[] = [];
  if (shards && shards.length > 0) {
    const flatStages = planBuild.flat();
    if (!flatStages.includes('review-cycle')) {
      planBuild = [...planBuild, 'review-cycle'];
      injected.push('review-cycle');
    }
    if (!planReview.perspectives.includes('verify')) {
      planReview = { ...planReview, perspectives: [...planReview.perspectives, 'verify'] };
      injected.push('verify');
    }
  }
  return { planBuild, planReview, injected };
}
