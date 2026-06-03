import type { EforgeState, OrchestrationConfig, PlanState } from '@eforge-build/engine/events';

export const TEST_REVIEW = { strategy: 'auto' as const, perspectives: ['code'], maxRounds: 1, evaluatorStrictness: 'standard' as const };
export const TEST_BUILD = ['implement', 'review-cycle'];

export function makeOrchestrationPlans(specs: Array<{ id: string; dependsOn?: string[] }>): OrchestrationConfig['plans'] {
  return specs.map((spec) => ({
    id: spec.id,
    name: spec.id,
    dependsOn: spec.dependsOn ?? [],
    branch: `feature/${spec.id}`,
    build: TEST_BUILD,
    review: TEST_REVIEW,
  }));
}

export function makeOrchestrationState(plans: Record<string, Partial<PlanState> & { status: PlanState['status'] }>): EforgeState {
  const fullPlans: Record<string, PlanState> = {};
  for (const [id, partial] of Object.entries(plans)) {
    fullPlans[id] = {
      status: partial.status,
      branch: partial.branch ?? `feature/${id}`,
      dependsOn: partial.dependsOn ?? [],
      merged: partial.merged ?? false,
      error: partial.error,
    };
  }
  return {
    setName: 'test-set',
    status: 'running',
    startedAt: '2026-01-01T00:00:00Z',
    baseBranch: 'main',
    featureBranch: 'eforge/test-set',
    worktreeBase: '/tmp/worktrees',
    plans: fullPlans,
    completedPlans: [],
  };
}
