/**
 * Unit tests for the deterministic recovery recommendation module:
 *   - determineRecoveryRecommendation: policy classification based on BuildFailureSummary
 *   - validateAnalystVerdict: invariant checks for analyst output
 *   - selectFinalVerdict: final verdict selection with source metadata
 *
 * These tests validate the acceptance criteria for plan-02-deterministic-recovery-verdicts.
 * They are in a separate file from recovery.test.ts so that a missing implementation
 * only causes these tests to fail, not the existing plan-01 tests.
 */

import { describe, it, expect } from 'vitest';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BuildFailureSummary } from '@eforge-build/engine/events';
// --- eforge:region plan-02-deterministic-recovery-verdicts ---
import {
  determineRecoveryRecommendation,
  validateAnalystVerdict,
  selectFinalVerdict,
} from '@eforge-build/engine/recovery/recommendation';
// --- eforge:endregion plan-02-deterministic-recovery-verdicts ---
import { synthesizeFromEvents } from '@eforge-build/engine/recovery/event-history';
import { openDatabase } from '@eforge-build/monitor/db';

// ---------------------------------------------------------------------------
// Deterministic recovery recommendation policy
// ---------------------------------------------------------------------------

// --- eforge:region plan-02-deterministic-recovery-verdicts ---
describe('determineRecoveryRecommendation — transient retry policy', () => {
  /**
   * All failed plans have terminalSubtype: error_transient_transport, zero tool use counts,
   * and no completed/merged plans exist → deterministic retry recommendation.
   *
   * Verification criterion: "All failed plans with terminalSubtype: 'error_transient_transport',
   * API 529 error text, and zero recorded tool-use counts produce a deterministic retry verdict
   * when no completed or merged work exists."
   */
  it('returns retry when all failed plans are transient-transport and no plans completed', () => {
    const summary: BuildFailureSummary = {
      prdId: 'test-prd',
      setName: 'test-set',
      featureBranch: 'eforge/test-set',
      baseBranch: 'main',
      plans: [
        { planId: 'plan-01', status: 'failed', error: 'API error 529: overloaded_error', terminalSubtype: 'error_transient_transport' },
        { planId: 'plan-02', status: 'failed', error: 'API error 529: overloaded_error', terminalSubtype: 'error_transient_transport' },
      ],
      failingPlan: { planId: 'plan-02', errorMessage: 'API error 529: overloaded_error', terminalSubtype: 'error_transient_transport' },
      failingPlans: [
        { planId: 'plan-01', errorMessage: 'API error 529: overloaded_error', terminalSubtype: 'error_transient_transport', toolUseCount: 0 },
        { planId: 'plan-02', errorMessage: 'API error 529: overloaded_error', terminalSubtype: 'error_transient_transport', toolUseCount: 0 },
      ],
      landedCommits: [],
      diffStat: '',
      modelsUsed: [],
      failedAt: '2026-05-26T06:15:10.000Z',
    };

    const recommendation = determineRecoveryRecommendation(summary);
    expect(recommendation.verdict).toBe('retry');
    expect(recommendation.rationale).toBeTruthy();
  });

  it('includes evidence of transient transport classification in retry rationale', () => {
    const summary: BuildFailureSummary = {
      prdId: 'test-prd',
      setName: 'test-set',
      featureBranch: 'eforge/test-set',
      baseBranch: 'main',
      plans: [
        { planId: 'plan-01', status: 'failed', error: 'API error 529', terminalSubtype: 'error_transient_transport' },
      ],
      failingPlan: { planId: 'plan-01', errorMessage: 'API error 529', terminalSubtype: 'error_transient_transport' },
      failingPlans: [
        { planId: 'plan-01', errorMessage: 'API error 529', terminalSubtype: 'error_transient_transport', toolUseCount: 0 },
      ],
      landedCommits: [],
      diffStat: '',
      modelsUsed: [],
      failedAt: '2026-05-26T06:15:10.000Z',
    };

    const recommendation = determineRecoveryRecommendation(summary);
    expect(recommendation.verdict).toBe('retry');
    // Rationale should mention transient or transport to explain the classification
    expect(recommendation.rationale.toLowerCase()).toMatch(/transient|transport|529/i);
  });

  it('[regression] API 529 terminalSubtype is passed through by synthesizeFromEvents and produces retry recommendation', () => {
    // Criterion: "API 529 failures are classified as transient transport failures in recovery
    // summary or recovery decision data when the error message matches the existing transport classifier."
    //
    // The build engine writes terminalSubtype: 'error_transient_transport' into plan:build:failed
    // events when a 529 occurs. synthesizeFromEvents must pass this through to failingPlans so
    // determineRecoveryRecommendation can produce a retry verdict.
    const dirPath = join(tmpdir(), `eforge-529-test-${Date.now()}`);
    mkdirSync(dirPath, { recursive: true });
    const dbPath = join(dirPath, 'monitor.db');
    const db = openDatabase(dbPath);
    db.insertRun({
      id: 'run-529-regression',
      sessionId: 'session-529',
      planSet: 'prd-529-set',
      command: 'build',
      status: 'failed',
      startedAt: new Date('2026-05-26T06:00:00.000Z').toISOString(),
      cwd: dirPath,
      pid: 12345,
    });
    // plan:build:failed event has error text AND terminalSubtype (as the engine writes it)
    // — terminalSubtype is NOT derived from text by the synthesizer; it is read from the event data
    db.insertEvent({
      runId: 'run-529-regression',
      type: 'plan:status:change',
      planId: 'plan-01',
      data: JSON.stringify({ type: 'plan:status:change', planId: 'plan-01', status: 'failed' }),
      timestamp: new Date('2026-05-26T06:15:00.000Z').toISOString(),
    });
    db.insertEvent({
      runId: 'run-529-regression',
      type: 'plan:build:failed',
      planId: 'plan-01',
      data: JSON.stringify({
        type: 'plan:build:failed',
        planId: 'plan-01',
        error: 'API error 529: overloaded_error',
        terminalSubtype: 'error_transient_transport',
      }),
      timestamp: new Date('2026-05-26T06:15:10.000Z').toISOString(),
    });
    db.close();

    // synthesizeFromEvents must pass terminalSubtype through from the DB event data
    const fragment = synthesizeFromEvents({ setName: 'prd-529-set', prdId: 'prd-529', dbPath });
    expect(fragment).not.toBeNull();
    expect(fragment!.failingPlans).toBeDefined();
    expect(fragment!.failingPlans![0]?.terminalSubtype).toBe('error_transient_transport');

    // Construct a non-partial summary (as buildFailureSummary would produce when events are found)
    // to verify determineRecoveryRecommendation produces retry for all-transient zero-tool-use failures.
    const summary: BuildFailureSummary = {
      prdId: 'prd-529',
      setName: 'prd-529-set',
      featureBranch: 'eforge/prd-529-set',
      baseBranch: 'main',
      plans: fragment!.plans ?? [],
      failingPlan: fragment!.failingPlan ?? { planId: 'unknown' },
      failingPlans: fragment!.failingPlans,
      landedCommits: [],
      diffStat: '',
      modelsUsed: [],
      failedAt: fragment!.failedAt ?? new Date().toISOString(),
      // partial is omitted (falsy) — event fragment was found, so this is a full summary
    };
    const recommendation = determineRecoveryRecommendation(summary);
    expect(recommendation.verdict).toBe('retry');
  });
});

describe('determineRecoveryRecommendation — transient split policy', () => {
  /**
   * All failed plans are transient-transport, but some plans have already completed or merged.
   * Retrying the full PRD would redo completed work → split recommendation instead.
   *
   * Verification criterion: "The same transient failure facts produce a deterministic split verdict
   * when at least one plan completed or merged before the failed plans."
   */
  it('returns split when all failed plans are transient but at least one plan merged', () => {
    const summary: BuildFailureSummary = {
      prdId: 'test-prd',
      setName: 'test-set',
      featureBranch: 'eforge/test-set',
      baseBranch: 'main',
      plans: [
        { planId: 'plan-01', status: 'merged' },
        { planId: 'plan-02', status: 'merged' },
        { planId: 'plan-04', status: 'failed', error: 'API error 529: overloaded_error', terminalSubtype: 'error_transient_transport' },
        { planId: 'plan-06', status: 'failed', error: 'API error 529: overloaded_error', terminalSubtype: 'error_transient_transport' },
      ],
      failingPlan: { planId: 'plan-06', errorMessage: 'API error 529: overloaded_error', terminalSubtype: 'error_transient_transport' },
      failingPlans: [
        { planId: 'plan-04', errorMessage: 'API error 529: overloaded_error', terminalSubtype: 'error_transient_transport', toolUseCount: 0 },
        { planId: 'plan-06', errorMessage: 'API error 529: overloaded_error', terminalSubtype: 'error_transient_transport', toolUseCount: 0 },
      ],
      landedCommits: [
        { sha: 'abc1234', subject: 'feat: plan-01', author: 'Test', date: '2026-05-26T05:30:00.000Z' },
      ],
      diffStat: '5 files changed',
      modelsUsed: [],
      failedAt: '2026-05-26T06:15:10.000Z',
    };

    const recommendation = determineRecoveryRecommendation(summary);
    expect(recommendation.verdict).toBe('split');
    expect(recommendation.rationale).toBeTruthy();
  });

  it('returns split when all failed plans are transient but at least one plan is completed (not merged)', () => {
    // Criterion: partial completion (completed but not merged) still triggers split
    const summary: BuildFailureSummary = {
      prdId: 'test-prd',
      setName: 'test-set',
      featureBranch: 'eforge/test-set',
      baseBranch: 'main',
      plans: [
        { planId: 'plan-01', status: 'completed' },
        { planId: 'plan-02', status: 'failed', error: 'API error 529', terminalSubtype: 'error_transient_transport' },
      ],
      failingPlan: { planId: 'plan-02', errorMessage: 'API error 529', terminalSubtype: 'error_transient_transport' },
      failingPlans: [
        { planId: 'plan-02', errorMessage: 'API error 529', terminalSubtype: 'error_transient_transport', toolUseCount: 0 },
      ],
      landedCommits: [],
      diffStat: '',
      modelsUsed: [],
      failedAt: '2026-05-26T06:15:10.000Z',
    };

    const recommendation = determineRecoveryRecommendation(summary);
    expect(recommendation.verdict).toBe('split');
  });
});

describe('determineRecoveryRecommendation — manual policy', () => {
  /**
   * Verification criteria:
   * - "Mixed transient and non-transient failed plans produce a deterministic manual verdict."
   * - "Missing or corrupt monitor DB context represented by a partial summary with unknown
   *   failing plan produces a deterministic manual verdict."
   */
  it('returns manual when failed plans include mixed transient and non-transient subtypes', () => {
    const summary: BuildFailureSummary = {
      prdId: 'test-prd',
      setName: 'test-set',
      featureBranch: 'eforge/test-set',
      baseBranch: 'main',
      plans: [
        { planId: 'plan-01', status: 'failed', error: 'API error 529', terminalSubtype: 'error_transient_transport' },
        { planId: 'plan-02', status: 'failed', error: 'Context limit reached', terminalSubtype: 'error_context_limit' },
      ],
      failingPlan: { planId: 'plan-02', errorMessage: 'Context limit reached', terminalSubtype: 'error_context_limit' },
      failingPlans: [
        { planId: 'plan-01', errorMessage: 'API error 529', terminalSubtype: 'error_transient_transport', toolUseCount: 0 },
        { planId: 'plan-02', errorMessage: 'Context limit reached', terminalSubtype: 'error_context_limit', toolUseCount: 5 },
      ],
      landedCommits: [],
      diffStat: '',
      modelsUsed: [],
      failedAt: '2026-05-26T06:15:10.000Z',
    };

    const recommendation = determineRecoveryRecommendation(summary);
    expect(recommendation.verdict).toBe('manual');
  });

  it('returns manual when the summary is partial (missing/corrupt monitor DB context)', () => {
    const summary: BuildFailureSummary = {
      prdId: 'test-prd',
      setName: 'test-set',
      featureBranch: 'eforge/test-set',
      baseBranch: 'main',
      plans: [{ planId: 'unknown', status: 'failed' }],
      failingPlan: { planId: 'unknown' },
      landedCommits: [],
      diffStat: '',
      modelsUsed: [],
      failedAt: '2026-05-26T06:15:10.000Z',
      partial: true,
    };

    const recommendation = determineRecoveryRecommendation(summary);
    expect(recommendation.verdict).toBe('manual');
  });

  it('returns manual when failingPlans is absent (insufficient context to classify)', () => {
    const summary: BuildFailureSummary = {
      prdId: 'test-prd',
      setName: 'test-set',
      featureBranch: 'eforge/test-set',
      baseBranch: 'main',
      plans: [{ planId: 'plan-01', status: 'failed', error: 'Unknown error' }],
      failingPlan: { planId: 'plan-01', errorMessage: 'Unknown error' },
      // No failingPlans — cannot determine terminalSubtype
      landedCommits: [],
      diffStat: '',
      modelsUsed: [],
      failedAt: '2026-05-26T06:15:10.000Z',
    };

    const recommendation = determineRecoveryRecommendation(summary);
    // Without failingPlans terminalSubtype evidence, default to manual
    expect(recommendation.verdict).toBe('manual');
  });

  it('returns manual when a failed plan has non-zero tool use count (meaningful work started)', () => {
    // A plan that performed tool calls has meaningfully started; transient retry
    // policy should not apply when the plan may have partially mutated state.
    const summary: BuildFailureSummary = {
      prdId: 'test-prd',
      setName: 'test-set',
      featureBranch: 'eforge/test-set',
      baseBranch: 'main',
      plans: [
        { planId: 'plan-01', status: 'failed', error: 'API error 529', terminalSubtype: 'error_transient_transport' },
      ],
      failingPlan: { planId: 'plan-01', errorMessage: 'API error 529', terminalSubtype: 'error_transient_transport' },
      failingPlans: [
        // toolUseCount > 0 means the agent performed real work before the transport failure
        { planId: 'plan-01', errorMessage: 'API error 529', terminalSubtype: 'error_transient_transport', toolUseCount: 5 },
      ],
      landedCommits: [],
      diffStat: '',
      modelsUsed: [],
      failedAt: '2026-05-26T06:15:10.000Z',
    };

    const recommendation = determineRecoveryRecommendation(summary);
    // Transient but with tool use → conservative manual to avoid partial-state retry
    expect(recommendation.verdict).toBe('manual');
  });
});

// ---------------------------------------------------------------------------
// Analyst verdict invariant validation
// ---------------------------------------------------------------------------

describe('validateAnalystVerdict — failed plan ID coverage', () => {
  /**
   * Build a minimal RecoveryVerdict for testing.
   */
  function makeAnalystVerdict(
    verdict: 'retry' | 'split' | 'abandon' | 'manual',
    rationale: string,
    suggestedSuccessorPrd?: string,
  ) {
    return {
      verdict,
      confidence: 'medium' as const,
      rationale,
      completedWork: [],
      remainingWork: [],
      risks: [],
      ...(suggestedSuccessorPrd !== undefined ? { suggestedSuccessorPrd } : {}),
    };
  }

  /** A summary with two known failed plans. */
  function makeMultiFailSummary() {
    return {
      prdId: 'test-prd',
      setName: 'test-set',
      featureBranch: 'eforge/test-set',
      baseBranch: 'main',
      plans: [
        { planId: 'plan-04-queue-view', status: 'failed', error: 'API error 529' },
        { planId: 'plan-06-static-serving', status: 'failed', error: 'API error 529' },
      ],
      failingPlan: { planId: 'plan-06-static-serving', errorMessage: 'API error 529' },
      failingPlans: [
        { planId: 'plan-04-queue-view', errorMessage: 'API error 529', terminalSubtype: 'error_transient_transport' },
        { planId: 'plan-06-static-serving', errorMessage: 'API error 529', terminalSubtype: 'error_transient_transport' },
      ],
      landedCommits: [],
      diffStat: '',
      modelsUsed: [],
      failedAt: '2026-05-26T06:15:10.000Z',
    } satisfies BuildFailureSummary;
  }

  it('returns valid for an analyst verdict whose rationale mentions all failed plan IDs', () => {
    // Verification criterion: "A valid analyst verdict is emitted with source metadata indicating analyst validation."
    const verdict = makeAnalystVerdict(
      'retry',
      'Both plan-04-queue-view and plan-06-static-serving failed due to API 529 transient transport errors. No tool calls were made.',
    );
    const result = validateAnalystVerdict(verdict, makeMultiFailSummary());
    expect(result.valid).toBe(true);
    expect(result.invalidationReason).toBeUndefined();
  });

  it('returns invalid when the analyst verdict rationale omits one failed plan ID', () => {
    // Verification criterion: "An analyst verdict that omits a failed plan ID from its rationale
    // is not emitted as the final analyst verdict."
    // Rationale only mentions plan-06, completely omitting plan-04
    const verdict = makeAnalystVerdict(
      'retry',
      'plan-06-static-serving failed due to an API 529 error. Recommend retry.',
    );
    const result = validateAnalystVerdict(verdict, makeMultiFailSummary());
    expect(result.valid).toBe(false);
    expect(result.invalidationReason).toMatch(/plan-04-queue-view/);
  });

  it('returns invalid when the analyst verdict rationale omits all failed plan IDs', () => {
    const verdict = makeAnalystVerdict(
      'manual',
      'The build failed due to infrastructure issues. Recommend manual review.',
    );
    const result = validateAnalystVerdict(verdict, makeMultiFailSummary());
    expect(result.valid).toBe(false);
    expect(result.invalidationReason).toBeTruthy();
  });

  it('falls back to failingPlan.planId when failingPlans is absent and planId is meaningful', () => {
    // When failingPlans is absent but failingPlan.planId is a real plan ID, use it as coverage set
    const summaryWithLegacyFailingPlan: BuildFailureSummary = {
      prdId: 'test-prd',
      setName: 'test-set',
      featureBranch: 'eforge/test-set',
      baseBranch: 'main',
      plans: [{ planId: 'plan-01', status: 'failed' }],
      failingPlan: { planId: 'plan-01' },
      landedCommits: [],
      diffStat: '',
      modelsUsed: [],
      failedAt: '2026-05-26T06:15:10.000Z',
    };
    // Rationale must mention plan-01 (derived via failingPlan fallback)
    const verdictWithPlanId = makeAnalystVerdict('manual', 'plan-01 failed; recommend manual review.');
    expect(validateAnalystVerdict(verdictWithPlanId, summaryWithLegacyFailingPlan).valid).toBe(true);
    // Rationale without plan-01 should be rejected via fallback coverage
    const verdictWithoutPlanId = makeAnalystVerdict('manual', 'The build failed; recommend manual review.');
    const rejectedResult = validateAnalystVerdict(verdictWithoutPlanId, summaryWithLegacyFailingPlan);
    expect(rejectedResult.valid).toBe(false);
    expect(rejectedResult.invalidationReason).toMatch(/plan-01/);
  });

  it('passes when both failingPlans and failingPlan are absent (no specific failed plans to cover)', () => {
    // When no failing plan IDs can be identified at all, no coverage is required
    const summaryWithNoPlanId: BuildFailureSummary = {
      prdId: 'test-prd',
      setName: 'test-set',
      featureBranch: 'eforge/test-set',
      baseBranch: 'main',
      plans: [{ planId: 'unknown', status: 'failed' }],
      failingPlan: { planId: 'unknown' },
      landedCommits: [],
      diffStat: '',
      modelsUsed: [],
      failedAt: '2026-05-26T06:15:10.000Z',
    };
    const verdict = makeAnalystVerdict('manual', 'The build failed; recommend manual review.');
    const result = validateAnalystVerdict(verdict, summaryWithNoPlanId);
    expect(result.valid).toBe(true);
  });
});

describe('validateAnalystVerdict — split successor PRD coverage', () => {
  /** Summary with two failed plans and one merged plan. */
  function makeMultiFailSummary() {
    return {
      prdId: 'test-prd',
      setName: 'test-set',
      featureBranch: 'eforge/test-set',
      baseBranch: 'main',
      plans: [
        { planId: 'plan-01', status: 'merged' },
        { planId: 'plan-04-queue-view', status: 'failed', error: 'API error 529' },
        { planId: 'plan-06-static-serving', status: 'failed', error: 'API error 529' },
      ],
      failingPlan: { planId: 'plan-06-static-serving', errorMessage: 'API error 529' },
      failingPlans: [
        { planId: 'plan-04-queue-view', errorMessage: 'API error 529', terminalSubtype: 'error_transient_transport' },
        { planId: 'plan-06-static-serving', errorMessage: 'API error 529', terminalSubtype: 'error_transient_transport' },
      ],
      landedCommits: [],
      diffStat: '',
      modelsUsed: [],
      failedAt: '2026-05-26T06:15:10.000Z',
    } satisfies BuildFailureSummary;
  }

  it('passes split verdict when successor PRD mentions all failed plan IDs', () => {
    // Verification criterion: "A split analyst verdict without a successor PRD mentioning
    // every failed and remaining plan is not emitted as the final split verdict."
    // (inverse: when it DOES mention them, it passes)
    const verdict = {
      verdict: 'split' as const,
      confidence: 'medium' as const,
      rationale: 'plan-04-queue-view and plan-06-static-serving failed due to transient API errors.',
      completedWork: ['plan-01 merged'],
      remainingWork: [],
      risks: [],
      suggestedSuccessorPrd: [
        '# Successor PRD',
        '',
        'Continue work on plan-04-queue-view and plan-06-static-serving.',
        'Both plans failed due to 529 API errors.',
      ].join('\n'),
    };
    const result = validateAnalystVerdict(verdict, makeMultiFailSummary());
    expect(result.valid).toBe(true);
  });

  it('rejects split verdict when successor PRD omits one failed plan ID', () => {
    const verdict = {
      verdict: 'split' as const,
      confidence: 'medium' as const,
      rationale: 'plan-04-queue-view and plan-06-static-serving failed due to transient API errors.',
      completedWork: [],
      remainingWork: [],
      risks: [],
      // Successor PRD only covers plan-06, completely ignoring plan-04
      suggestedSuccessorPrd: [
        '# Successor PRD',
        '',
        'Continue work on plan-06-static-serving only.',
      ].join('\n'),
    };
    const result = validateAnalystVerdict(verdict, makeMultiFailSummary());
    expect(result.valid).toBe(false);
    expect(result.invalidationReason).toMatch(/plan-04-queue-view/);
  });

  it('rejects split verdict that has no suggestedSuccessorPrd', () => {
    const verdict = {
      verdict: 'split' as const,
      confidence: 'medium' as const,
      rationale: 'plan-04-queue-view and plan-06-static-serving failed. Split recommended.',
      completedWork: [],
      remainingWork: [],
      risks: [],
      // No suggestedSuccessorPrd
    };
    const result = validateAnalystVerdict(verdict, makeMultiFailSummary());
    expect(result.valid).toBe(false);
    expect(result.invalidationReason).toBeTruthy();
  });

  it('rejects split verdict when successor PRD omits a remaining non-completed/non-merged plan', () => {
    // Summary with one failed plan AND one remaining pending plan (not yet started)
    const summaryWithRemaining: BuildFailureSummary = {
      prdId: 'test-prd',
      setName: 'test-set',
      featureBranch: 'eforge/test-set',
      baseBranch: 'main',
      plans: [
        { planId: 'plan-01', status: 'merged' },
        { planId: 'plan-02', status: 'failed', error: 'API error 529' },
        { planId: 'plan-03', status: 'pending' }, // remaining — not yet started
      ],
      failingPlan: { planId: 'plan-02', errorMessage: 'API error 529' },
      failingPlans: [
        { planId: 'plan-02', errorMessage: 'API error 529', terminalSubtype: 'error_transient_transport' },
      ],
      landedCommits: [],
      diffStat: '',
      modelsUsed: [],
      failedAt: '2026-05-26T06:15:10.000Z',
    };

    // Successor PRD covers the failed plan (plan-02) but omits plan-03 (remaining pending)
    const verdict = {
      verdict: 'split' as const,
      confidence: 'medium' as const,
      rationale: 'plan-02 failed with API 529 transient error. plan-01 was merged.',
      completedWork: ['plan-01 merged'],
      remainingWork: ['plan-02 needs retry'],
      risks: [],
      suggestedSuccessorPrd: '# Successor PRD\n\nRetry plan-02 as a standalone PRD.',
    };

    const result = validateAnalystVerdict(verdict, summaryWithRemaining);
    expect(result.valid).toBe(false);
    // Invalidation reason must mention the omitted remaining plan
    expect(result.invalidationReason).toMatch(/plan-03/);
  });
});

describe('selectFinalVerdict — remaining plans required in split successor', () => {
  it('does not accept an analyst split as final when successor PRD omits a remaining pending plan', () => {
    // Summary with one failed plan and one pending plan that has not yet started
    const summaryWithRemaining: BuildFailureSummary = {
      prdId: 'test-prd',
      setName: 'test-set',
      featureBranch: 'eforge/test-set',
      baseBranch: 'main',
      plans: [
        { planId: 'plan-01', status: 'merged' },
        { planId: 'plan-02', status: 'failed', error: 'API 529', terminalSubtype: 'error_transient_transport' },
        { planId: 'plan-03', status: 'pending' }, // remaining — not yet started
      ],
      failingPlan: { planId: 'plan-02', errorMessage: 'API 529', terminalSubtype: 'error_transient_transport' },
      failingPlans: [
        { planId: 'plan-02', errorMessage: 'API 529', terminalSubtype: 'error_transient_transport', toolUseCount: 0 },
      ],
      landedCommits: [],
      diffStat: '',
      modelsUsed: [],
      failedAt: '2026-05-26T06:15:10.000Z',
    };

    const deterministicRec = determineRecoveryRecommendation(summaryWithRemaining);

    // Analyst produces split with successor PRD that covers plan-02 but omits plan-03 (remaining)
    const invalidSplitVerdict = {
      verdict: 'split' as const,
      confidence: 'high' as const,
      rationale: 'plan-02 failed with API 529 transient error.',
      completedWork: ['plan-01 merged'],
      remainingWork: [],
      risks: [],
      suggestedSuccessorPrd: '# Successor PRD\n\nRetry plan-02 only.',
    };

    const finalVerdict = selectFinalVerdict({
      deterministicRecommendation: deterministicRec,
      analystVerdict: invalidSplitVerdict,
      summary: summaryWithRemaining,
    });

    // The invalid analyst split should not be accepted as analyst verdict
    const source = (finalVerdict as Record<string, unknown>).recommendationSource;
    expect(source).not.toBe('analyst');
    // Invalidation reason must mention the omitted remaining plan
    const invalidationReason = (finalVerdict as Record<string, unknown>).verdictInvalidationReason;
    expect(invalidationReason).toBeTruthy();
    expect(String(invalidationReason)).toMatch(/plan-03/);
  });
});

// ---------------------------------------------------------------------------
// selectFinalVerdict — verdict source selection
// ---------------------------------------------------------------------------

describe('selectFinalVerdict — deterministic fallback when analyst unavailable', () => {
  function makeTransientSummary(): BuildFailureSummary {
    return {
      prdId: 'test-prd',
      setName: 'test-set',
      featureBranch: 'eforge/test-set',
      baseBranch: 'main',
      plans: [
        { planId: 'plan-01', status: 'failed', error: 'API error 529', terminalSubtype: 'error_transient_transport' },
      ],
      failingPlan: { planId: 'plan-01', errorMessage: 'API error 529', terminalSubtype: 'error_transient_transport' },
      failingPlans: [
        { planId: 'plan-01', errorMessage: 'API error 529', terminalSubtype: 'error_transient_transport', toolUseCount: 0 },
      ],
      landedCommits: [],
      diffStat: '',
      modelsUsed: [],
      failedAt: '2026-05-26T06:15:10.000Z',
    };
  }

  it('returns retry with recommendationSource=deterministic when analyst null and recommendation is retry', () => {
    // Verification criterion: "A malformed analyst response produces a final verdict with
    // recommendationSource set to deterministic policy when the deterministic recommendation is retry."
    const summary = makeTransientSummary();
    const deterministicRecommendation = determineRecoveryRecommendation(summary);
    expect(deterministicRecommendation.verdict).toBe('retry'); // precondition

    const finalVerdict = selectFinalVerdict({
      deterministicRecommendation,
      analystVerdict: null,
      analystError: 'Recovery analyst timed out after 90000ms',
      summary,
    });

    expect(finalVerdict.verdict).toBe('retry');
    // recommendationSource must identify this as deterministic, not analyst
    const source = (finalVerdict as Record<string, unknown>).recommendationSource;
    expect(source).toBe('deterministic');
  });

  it('returns deterministic recommendation with recoveryError preserved when analyst fails', () => {
    // Verification criterion: "A timed-out or thrown analyst run produces a final verdict
    // with deterministic source metadata when the deterministic recommendation is retry or split."
    const summary = makeTransientSummary();
    const deterministicRecommendation = determineRecoveryRecommendation(summary);

    const finalVerdict = selectFinalVerdict({
      deterministicRecommendation,
      analystVerdict: null,
      analystError: 'Agent threw: network error',
      summary,
    });

    expect(finalVerdict.verdict).toBe('retry');
    // The agent error must be preserved so humans can understand why analyst was skipped
    expect((finalVerdict as Record<string, unknown>).recoveryError ?? finalVerdict.rationale).toMatch(/network error|analyst|deterministic/i);
  });

  it('returns manual-fallback when analyst is null and deterministic recommendation is also manual', () => {
    // Partial summary → deterministic → manual → final verdict should be manual
    const partialSummary: BuildFailureSummary = {
      prdId: 'test-prd',
      setName: 'test-set',
      featureBranch: 'eforge/test-set',
      baseBranch: 'main',
      plans: [{ planId: 'unknown', status: 'failed' }],
      failingPlan: { planId: 'unknown' },
      landedCommits: [],
      diffStat: '',
      modelsUsed: [],
      failedAt: '2026-05-26T06:15:10.000Z',
      partial: true,
    };
    const deterministicRecommendation = determineRecoveryRecommendation(partialSummary);
    expect(deterministicRecommendation.verdict).toBe('manual'); // precondition

    const finalVerdict = selectFinalVerdict({
      deterministicRecommendation,
      analystVerdict: null,
      parseError: 'Failed to parse recovery verdict',
      summary: partialSummary,
    });

    expect(finalVerdict.verdict).toBe('manual');
    const source = (finalVerdict as Record<string, unknown>).recommendationSource;
    // Source must be manual-fallback (deterministic also says manual, so fallback applies)
    expect(source).toBe('manual-fallback');
  });
});

describe('selectFinalVerdict — analyst verdict accepted with source metadata', () => {
  function makeTransientSummaryWithCompletion(): BuildFailureSummary {
    return {
      prdId: 'test-prd',
      setName: 'test-set',
      featureBranch: 'eforge/test-set',
      baseBranch: 'main',
      plans: [
        { planId: 'plan-01', status: 'merged' },
        { planId: 'plan-04', status: 'failed', error: 'API error 529', terminalSubtype: 'error_transient_transport' },
      ],
      failingPlan: { planId: 'plan-04', errorMessage: 'API error 529', terminalSubtype: 'error_transient_transport' },
      failingPlans: [
        { planId: 'plan-04', errorMessage: 'API error 529', terminalSubtype: 'error_transient_transport', toolUseCount: 0 },
      ],
      landedCommits: [{ sha: 'abc1234', subject: 'feat: plan-01', author: 'Test', date: '2026-05-26T05:30:00.000Z' }],
      diffStat: '5 files changed',
      modelsUsed: [],
      failedAt: '2026-05-26T06:15:10.000Z',
    };
  }

  it('returns analyst verdict with recommendationSource=analyst when analyst passes invariant validation', () => {
    // Verification criterion: "A valid analyst verdict is emitted with source metadata indicating analyst validation."
    const summary = makeTransientSummaryWithCompletion();
    const deterministicRecommendation = determineRecoveryRecommendation(summary);

    const analystVerdict = {
      verdict: 'split' as const,
      confidence: 'high' as const,
      rationale: 'plan-04 failed with API 529 transient error. plan-01 was successfully merged.',
      completedWork: ['plan-01 merged'],
      remainingWork: ['plan-04 needs retry'],
      risks: ['API instability may persist'],
      suggestedSuccessorPrd: '# Successor\n\nRetry plan-04 as a standalone PRD.',
    };

    const finalVerdict = selectFinalVerdict({
      deterministicRecommendation,
      analystVerdict,
      summary,
    });

    expect(finalVerdict.verdict).toBe('split');
    const source = (finalVerdict as Record<string, unknown>).recommendationSource;
    expect(source).toBe('analyst');
  });
});

describe('selectFinalVerdict — analyst verdict invalidated', () => {
  function makeMultiFailSummary(): BuildFailureSummary {
    return {
      prdId: 'test-prd',
      setName: 'test-set',
      featureBranch: 'eforge/test-set',
      baseBranch: 'main',
      plans: [
        { planId: 'plan-04-queue-view', status: 'failed', error: 'API error 529' },
        { planId: 'plan-06-static-serving', status: 'failed', error: 'API error 529' },
      ],
      failingPlan: { planId: 'plan-06-static-serving', errorMessage: 'API error 529' },
      failingPlans: [
        { planId: 'plan-04-queue-view', errorMessage: 'API error 529', terminalSubtype: 'error_transient_transport', toolUseCount: 0 },
        { planId: 'plan-06-static-serving', errorMessage: 'API error 529', terminalSubtype: 'error_transient_transport', toolUseCount: 0 },
      ],
      landedCommits: [],
      diffStat: '',
      modelsUsed: [],
      failedAt: '2026-05-26T06:15:10.000Z',
    };
  }

  it('records verdictInvalidationReason when analyst omits a failed plan ID', () => {
    // Verification criterion: "An analyst verdict that omits a failed plan ID from its rationale
    // is not emitted as the final analyst verdict."
    const summary = makeMultiFailSummary();
    const deterministicRecommendation = determineRecoveryRecommendation(summary);

    // Analyst only mentions plan-06, omitting plan-04
    const invalidAnalystVerdict = {
      verdict: 'retry' as const,
      confidence: 'high' as const,
      rationale: 'plan-06-static-serving failed due to 529. Retry the whole PRD.',
      completedWork: [],
      remainingWork: ['plan-06-static-serving needs retry'],
      risks: [],
    };

    const finalVerdict = selectFinalVerdict({
      deterministicRecommendation,
      analystVerdict: invalidAnalystVerdict,
      summary,
    });

    // Invalidated analyst verdict must NOT produce the analyst's recommended action without metadata
    // verdictInvalidationReason must be set
    const verdictInvalidationReason = (finalVerdict as Record<string, unknown>).verdictInvalidationReason;
    expect(verdictInvalidationReason).toBeTruthy();
    expect(String(verdictInvalidationReason)).toMatch(/plan-04-queue-view/);
    // recommendationSource must NOT be 'analyst' — the analyst verdict was rejected
    const source = (finalVerdict as Record<string, unknown>).recommendationSource;
    expect(source).not.toBe('analyst');
    // The final verdict/action should match the deterministic or manual-fallback selection
    expect(['retry', 'manual']).toContain(finalVerdict.verdict);
  });

  it('records verdictInvalidationReason when analyst split omits a failed plan from successor PRD', () => {
    // Verification criterion: "A split analyst verdict without a successor PRD mentioning
    // every failed and remaining plan is not emitted as the final split verdict."
    const summary = makeMultiFailSummary();
    const deterministicRecommendation = determineRecoveryRecommendation(summary);

    // Analyst mentions both plan IDs in rationale but successor PRD omits plan-04
    const invalidSplitVerdict = {
      verdict: 'split' as const,
      confidence: 'medium' as const,
      rationale: 'plan-04-queue-view and plan-06-static-serving both failed with 529 transient errors.',
      completedWork: [],
      remainingWork: [],
      risks: [],
      suggestedSuccessorPrd: '# Successor\n\nRetry plan-06-static-serving only.',
    };

    const finalVerdict = selectFinalVerdict({
      deterministicRecommendation,
      analystVerdict: invalidSplitVerdict,
      summary,
    });

    const verdictInvalidationReason = (finalVerdict as Record<string, unknown>).verdictInvalidationReason;
    expect(verdictInvalidationReason).toBeTruthy();
    expect(String(verdictInvalidationReason)).toMatch(/plan-04-queue-view/);
    // recommendationSource must NOT be 'analyst' — the analyst split verdict was rejected
    const source = (finalVerdict as Record<string, unknown>).recommendationSource;
    expect(source).not.toBe('analyst');
    // The final verdict is not the analyst's split (deterministic policy would choose retry here)
    expect(finalVerdict.verdict).not.toBe('split');
  });
});
// --- eforge:endregion plan-02-deterministic-recovery-verdicts ---
