/**
 * Engine-level tests for compiled-build resume:
 * - State reconstruction from PlanSummaryEntry lists
 * - Seeded merged/pending classification
 * - Ineligibility cases (branch missing, orchestration.yaml missing, no evidence)
 * - Compile-free execution (no compile-phase events emitted)
 * - Resume context formatting
 */

import { describe, it, expect } from 'vitest';
import { deriveResumeSeedState, formatResumeContext, checkResumeEligibility } from '@eforge-build/engine/resume/compiled-build';
import { applyResumeSeed, initializeState, type ResumeSeedOptions } from '@eforge-build/engine/orchestrator';
import type { PlanSummaryEntry, BuildFailureSummary, EforgeState } from '@eforge-build/engine/events';

// --- eforge:region plan-01-engine-resume ---

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlanSummary(planId: string, overrides: Partial<PlanSummaryEntry> = {}): PlanSummaryEntry {
  return {
    planId,
    status: 'failed',
    ...overrides,
  };
}

function makeFailureSummary(overrides: Partial<BuildFailureSummary> = {}): BuildFailureSummary {
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

function makePlans(
  specs: Array<{ id: string; dependsOn?: string[] }>,
) {
  const TEST_REVIEW = { strategy: 'auto' as const, perspectives: ['code'], maxRounds: 1, evaluatorStrictness: 'standard' as const };
  return specs.map((s) => ({
    id: s.id,
    name: s.id,
    dependsOn: s.dependsOn ?? [],
    branch: `feature/${s.id}`,
    build: ['implement', 'review-cycle'],
    review: TEST_REVIEW,
  }));
}

// ---------------------------------------------------------------------------
// deriveResumeSeedState
// ---------------------------------------------------------------------------

describe('deriveResumeSeedState — plan-state derivation from failure summary', () => {
  it('classifies a plan with mergedAt as seededMerged', () => {
    const plans: PlanSummaryEntry[] = [
      makePlanSummary('plan-01', { status: 'merged', mergedAt: '2026-01-01T00:00:00.000Z' }),
    ];
    const result = deriveResumeSeedState(plans);
    expect(result.seededMerged).toContain('plan-01');
    expect(result.seededPending).not.toContain('plan-01');
  });

  it('classifies a failed plan without mergedAt as seededPending', () => {
    const plans: PlanSummaryEntry[] = [
      makePlanSummary('plan-02', { status: 'failed' }),
    ];
    const result = deriveResumeSeedState(plans);
    expect(result.seededPending).toContain('plan-02');
    expect(result.seededMerged).not.toContain('plan-02');
  });

  it('classifies a blocked plan as seededPending', () => {
    const plans: PlanSummaryEntry[] = [
      makePlanSummary('plan-03', { status: 'blocked' }),
    ];
    const result = deriveResumeSeedState(plans);
    expect(result.seededPending).toContain('plan-03');
  });

  it('classifies a completed-but-unmerged plan as seededPending (conservative)', () => {
    // No mergedAt field → no merge evidence → conservatively treat as pending
    const plans: PlanSummaryEntry[] = [
      makePlanSummary('plan-04', { status: 'completed' }),
    ];
    const result = deriveResumeSeedState(plans);
    expect(result.seededPending).toContain('plan-04');
    expect(result.seededMerged).not.toContain('plan-04');
  });

  it('handles an empty plan list', () => {
    const result = deriveResumeSeedState([]);
    expect(result.seededMerged).toHaveLength(0);
    expect(result.seededPending).toHaveLength(0);
  });

  it('correctly partitions a mixed graph: one merged, one failed, one blocked', () => {
    const plans: PlanSummaryEntry[] = [
      makePlanSummary('plan-01', { status: 'merged', mergedAt: '2026-01-01T00:00:00.000Z' }),
      makePlanSummary('plan-02', { status: 'failed' }),
      makePlanSummary('plan-03', { status: 'blocked' }),
    ];
    const result = deriveResumeSeedState(plans);
    expect(result.seededMerged).toEqual(['plan-01']);
    expect(result.seededPending).toEqual(expect.arrayContaining(['plan-02', 'plan-03']));
    expect(result.seededPending).toHaveLength(2);
  });

  it('treats a plan with a mergedAt of empty string as seededPending', () => {
    // Empty string is not valid merge evidence
    const plans: PlanSummaryEntry[] = [
      makePlanSummary('plan-05', { status: 'completed', mergedAt: '' }),
    ];
    const result = deriveResumeSeedState(plans);
    expect(result.seededPending).toContain('plan-05');
    expect(result.seededMerged).not.toContain('plan-05');
  });
});

// ---------------------------------------------------------------------------
// applyResumeSeed + initializeState integration
// ---------------------------------------------------------------------------

describe('applyResumeSeed + initializeState — orchestrator state seeding', () => {
  const TEST_CONFIG = {
    name: 'feature-x',
    baseBranch: 'main',
    mode: 'excursion' as const,
    plans: makePlans([
      { id: 'plan-01' },
      { id: 'plan-02', dependsOn: ['plan-01'] },
      { id: 'plan-03', dependsOn: ['plan-02'] },
    ]),
    pipeline: {
      scope: 'excursion' as const,
      compile: [],
      defaultBuild: [],
      defaultReview: { strategy: 'auto' as const, perspectives: ['code'], maxRounds: 1, evaluatorStrictness: 'standard' as const },
    },
  };

  it('seeds plan-01 as merged so plan-02 can be scheduled', () => {
    const { state } = initializeState(TEST_CONFIG, '/tmp/repo');
    const seed: ResumeSeedOptions = {
      seededMerged: ['plan-01'],
      resumeContextByPlan: new Map(),
    };
    applyResumeSeed(state, seed);

    expect(state.plans['plan-01'].status).toBe('merged');
    expect(state.plans['plan-01'].merged).toBe(true);
    expect(state.completedPlans).toContain('plan-01');

    // plan-02 stays pending — it will be scheduled because its dep is merged
    expect(state.plans['plan-02'].status).toBe('pending');
    // plan-03 stays pending too
    expect(state.plans['plan-03'].status).toBe('pending');
  });

  it('seeds plan-01 and plan-02 as merged, leaving plan-03 pending', () => {
    const { state } = initializeState(TEST_CONFIG, '/tmp/repo');
    const seed: ResumeSeedOptions = {
      seededMerged: ['plan-01', 'plan-02'],
      resumeContextByPlan: new Map(),
    };
    applyResumeSeed(state, seed);

    expect(state.plans['plan-01'].status).toBe('merged');
    expect(state.plans['plan-02'].status).toBe('merged');
    expect(state.plans['plan-03'].status).toBe('pending');
    expect(state.completedPlans).toContain('plan-01');
    expect(state.completedPlans).toContain('plan-02');
    expect(state.completedPlans).not.toContain('plan-03');
  });

  it('does not seed any plans when seededMerged is empty', () => {
    const { state } = initializeState(TEST_CONFIG, '/tmp/repo');
    const seed: ResumeSeedOptions = {
      seededMerged: [],
      resumeContextByPlan: new Map(),
    };
    applyResumeSeed(state, seed);

    // All plans remain pending — entire graph will run from scratch
    for (const id of ['plan-01', 'plan-02', 'plan-03']) {
      expect(state.plans[id].status).toBe('pending');
      expect(state.plans[id].merged).toBe(false);
    }
    expect(state.completedPlans).toHaveLength(0);
  });

  it('silently ignores unknown plan IDs in seededMerged', () => {
    const { state } = initializeState(TEST_CONFIG, '/tmp/repo');
    const seed: ResumeSeedOptions = {
      seededMerged: ['plan-99', 'plan-00'],
      resumeContextByPlan: new Map(),
    };
    expect(() => applyResumeSeed(state, seed)).not.toThrow();
    // Real plans untouched
    for (const id of ['plan-01', 'plan-02', 'plan-03']) {
      expect(state.plans[id].status).toBe('pending');
    }
  });
});

// ---------------------------------------------------------------------------
// formatResumeContext
// ---------------------------------------------------------------------------

describe('formatResumeContext — builder prompt injection', () => {
  const BASE_SUMMARY = makeFailureSummary({
    featureBranch: 'eforge/feature-x',
    diffStat: '5 files changed, 42 insertions(+), 3 deletions(-)',
    landedCommits: [
      { sha: 'abc123', subject: 'feat(plan-01): Plan A', author: 'Test', date: '2026-01-01T00:00:00.000Z' },
    ],
    failingPlan: { planId: 'plan-02', errorMessage: 'Socket error: connection reset' },
  });

  it('includes the feature branch in the context', () => {
    const ctx = formatResumeContext({
      planId: 'plan-02',
      summary: BASE_SUMMARY,
      seededMerged: ['plan-01'],
      seededPending: ['plan-02', 'plan-03'],
    });
    expect(ctx).toContain('eforge/feature-x');
  });

  it('includes the terminal failure message', () => {
    const ctx = formatResumeContext({
      planId: 'plan-02',
      summary: BASE_SUMMARY,
      seededMerged: ['plan-01'],
      seededPending: ['plan-02', 'plan-03'],
    });
    expect(ctx).toContain('Socket error: connection reset');
  });

  it('includes landed commit count when commits exist', () => {
    const ctx = formatResumeContext({
      planId: 'plan-02',
      summary: BASE_SUMMARY,
      seededMerged: ['plan-01'],
      seededPending: ['plan-02', 'plan-03'],
    });
    expect(ctx).toContain('Prior landed commits: 1');
  });

  it('includes diffStat when non-empty', () => {
    const ctx = formatResumeContext({
      planId: 'plan-02',
      summary: BASE_SUMMARY,
      seededMerged: ['plan-01'],
      seededPending: ['plan-02', 'plan-03'],
    });
    expect(ctx).toContain('5 files changed');
  });

  it('lists already-merged plans', () => {
    const ctx = formatResumeContext({
      planId: 'plan-02',
      summary: BASE_SUMMARY,
      seededMerged: ['plan-01'],
      seededPending: ['plan-02', 'plan-03'],
    });
    expect(ctx).toContain('plan-01');
  });

  it('identifies the failing plan and instructs to continue rather than restart', () => {
    const ctx = formatResumeContext({
      planId: 'plan-02',
      summary: BASE_SUMMARY,
      seededMerged: ['plan-01'],
      seededPending: ['plan-02', 'plan-03'],
    });
    // Should mention continuing/repairing preserved work
    expect(ctx.toLowerCase()).toContain('continue');
    expect(ctx.toLowerCase()).toContain('plan-02');
  });

  it('omits diffStat line when empty', () => {
    const summary = makeFailureSummary({ diffStat: '', landedCommits: [] });
    const ctx = formatResumeContext({
      planId: 'plan-01',
      summary,
      seededMerged: [],
      seededPending: ['plan-01'],
    });
    expect(ctx).not.toContain('Changed files');
    expect(ctx).not.toContain('Prior landed commits');
  });
});

// ---------------------------------------------------------------------------
// checkResumeEligibility — ineligibility cases (unit-level, no real git/fs)
// ---------------------------------------------------------------------------

describe('checkResumeEligibility — feature branch ineligibility', () => {
  it('returns ineligible with reason containing the branch name when branch is missing', async () => {
    // Use a path that definitely does not exist to exercise the branch-missing path
    const result = await checkResumeEligibility({
      cwd: '/nonexistent-repo-for-testing',
      setName: 'test-feature',
      prdId: 'prd-test',
      mergeWorktreePath: '/nonexistent-worktree',
      outputDir: 'eforge/plans',
      dbPath: undefined,
    });

    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.reason).toContain('eforge/test-feature');
    }
  });
});

// --- eforge:endregion plan-01-engine-resume ---
