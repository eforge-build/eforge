import type { BuildFailureSummary, PlanSummaryEntry } from '@eforge-build/engine/events';

export function makeResumePlanSummary(planId: string, overrides: Partial<PlanSummaryEntry> = {}): PlanSummaryEntry {
  return { planId, status: 'failed', ...overrides };
}

export function makeResumeFailureSummary(overrides: Partial<BuildFailureSummary> = {}): BuildFailureSummary {
  return {
    prdId: 'prd-feature-x',
    setName: 'feature-x',
    featureBranch: 'eforge/feature-x',
    baseBranch: 'main',
    plans: [],
    failingPlan: { planId: 'plan-02' },
    landedCommits: [],
    diffStat: '',
    modelsUsed: [],
    failedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}
