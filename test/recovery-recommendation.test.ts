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
import {
  determineRecoveryRecommendation,
  validateAnalystVerdict,
  selectFinalVerdict,
} from '@eforge-build/engine/recovery/recommendation';
import { synthesizeFromEvents } from '@eforge-build/engine/recovery/event-history';
import { openDatabase } from '@eforge-build/monitor/db';

// ---------------------------------------------------------------------------
// Deterministic recovery recommendation policy
// ---------------------------------------------------------------------------

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

  it('[regression] Codex SSE timeout terminalSubtype is passed through by legacy synthesizeFromEvents', () => {
    const dirPath = join(tmpdir(), `eforge-codex-sse-test-${Date.now()}`);
    mkdirSync(dirPath, { recursive: true });
    const dbPath = join(dirPath, 'monitor.db');
    const db = openDatabase(dbPath);
    db.insertRun({
      id: 'run-codex-sse-regression',
      sessionId: 'session-codex-sse',
      planSet: 'prd-codex-sse-set',
      command: 'build',
      status: 'failed',
      startedAt: new Date('2026-05-26T06:00:00.000Z').toISOString(),
      cwd: dirPath,
      pid: 12345,
    });
    db.insertEvent({
      runId: 'run-codex-sse-regression',
      type: 'plan:status:change',
      planId: 'plan-01',
      data: JSON.stringify({ type: 'plan:status:change', planId: 'plan-01', status: 'failed' }),
      timestamp: new Date('2026-05-26T06:15:00.000Z').toISOString(),
    });
    db.insertEvent({
      runId: 'run-codex-sse-regression',
      type: 'plan:build:failed',
      planId: 'plan-01',
      data: JSON.stringify({
        type: 'plan:build:failed',
        planId: 'plan-01',
        error: 'Backend error: Codex SSE response headers timed out after 10000ms',
        terminalSubtype: 'error_transient_transport',
      }),
      timestamp: new Date('2026-05-26T06:15:10.000Z').toISOString(),
    });
    db.close();

    const fragment = synthesizeFromEvents({ setName: 'prd-codex-sse-set', prdId: 'prd-codex-sse', dbPath });

    expect(fragment).not.toBeNull();
    expect(fragment!.failingPlan?.terminalSubtype).toBe('error_transient_transport');
    expect(fragment!.failingPlans?.[0]?.terminalSubtype).toBe('error_transient_transport');
    expect(fragment!.plans?.find((plan) => plan.planId === 'plan-01')?.terminalSubtype).toBe('error_transient_transport');
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

describe('determineRecoveryRecommendation — continue-repair and preserved-work policy', () => {
  it('returns continue-repair when compiled artifacts are eligible', () => {
    const summary: BuildFailureSummary = {
      prdId: 'test-prd',
      setName: 'test-set',
      featureBranch: 'eforge/test-set',
      baseBranch: 'main',
      plans: [
        { planId: 'plan-01', status: 'merged' },
        { planId: 'plan-02', status: 'failed', error: 'API error 529', terminalSubtype: 'error_transient_transport' },
      ],
      failingPlan: { planId: 'plan-02', errorMessage: 'API error 529', terminalSubtype: 'error_transient_transport' },
      failingPlans: [
        { planId: 'plan-02', errorMessage: 'API error 529', terminalSubtype: 'error_transient_transport', toolUseCount: 0 },
      ],
      landedCommits: [{ sha: 'abc1234', subject: 'feat: plan-01', author: 'Test', date: '2026-05-26T05:30:00.000Z' }],
      diffStat: '3 files changed',
      modelsUsed: [],
      failedAt: '2026-05-26T06:15:10.000Z',
    };

    const recommendation = determineRecoveryRecommendation(summary, {
      eligible: true,
      featureBranch: 'eforge/test-set',
      artifactAvailability: 'feature-branch',
      landedCommitCount: 1,
      failingPlanId: 'plan-02',
    });
    expect(recommendation.verdict).toBe('continue-repair');
    expect(recommendation.rationale).toMatch(/continue-and-repair/i);
  });

  it('returns manual when preserved work exists but continue-repair is not eligible', () => {
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

    const recommendation = determineRecoveryRecommendation(summary, { eligible: false, reason: 'feature branch missing' });
    expect(recommendation.verdict).toBe('manual');
    expect(recommendation.rationale).toMatch(/manual|replanning/i);
    expect(recommendation.rationale).toMatch(/feature branch missing/);
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

  it('returns stack-base manual guidance when git-spice reports the base branch is missing from the remote', () => {
    const summary: BuildFailureSummary = {
      prdId: 'test-prd',
      setName: 'test-set',
      featureBranch: 'eforge/test-set',
      baseBranch: 'main',
      plans: [{ planId: 'plan-01', status: 'failed', error: 'Landing failed' }],
      failingPlan: { planId: 'plan-01', errorMessage: 'Landing failed' },
      landedCommits: [],
      diffStat: '',
      modelsUsed: [],
      failedAt: '2026-05-26T06:15:10.000Z',
      terminalFailure: {
        scope: 'landing',
        message: 'git-spice submit failed: base branch eforge/parent does not exist in the remote',
        authoritative: true,
      },
      landing: {
        status: 'failed',
        action: 'pr',
        reason: 'base branch eforge/parent does not exist in the remote',
      },
    };

    const recommendation = determineRecoveryRecommendation(summary);
    expect(recommendation.verdict).toBe('manual');
    expect(recommendation.rationale.toLowerCase()).toContain('stack base');
    expect(recommendation.rationale.toLowerCase()).toContain('ancestor of trunk');
    expect(recommendation.rationale.toLowerCase()).toContain('automatic');
    expect(recommendation.rationale.toLowerCase()).toMatch(/restore|submit|repair/);
    expect(recommendation.rationale).toContain('eforge stack sync');
  });

  it('returns stack-base manual guidance when git-spice reports the base branch has not been submitted yet', () => {
    const summary: BuildFailureSummary = {
      prdId: 'test-prd',
      setName: 'test-set',
      featureBranch: 'eforge/test-set',
      baseBranch: 'main',
      plans: [{ planId: 'plan-01', status: 'failed', error: 'Landing failed' }],
      failingPlan: { planId: 'plan-01', errorMessage: 'Landing failed' },
      landedCommits: [],
      diffStat: '',
      modelsUsed: [],
      failedAt: '2026-05-26T06:15:10.000Z',
      terminalFailure: {
        scope: 'landing',
        message: 'Stack landing failed',
        authoritative: true,
        landing: {
          status: 'failed',
          action: 'pr',
          reason: 'git-spice submit failed: base branch has not been submitted yet',
        },
      },
    };

    const recommendation = determineRecoveryRecommendation(summary);
    expect(recommendation.verdict).toBe('manual');
    expect(recommendation.rationale.toLowerCase()).toContain('stack base');
    expect(recommendation.rationale.toLowerCase()).toContain('ancestor of trunk');
    expect(recommendation.rationale.toLowerCase()).toContain('rerun');
    expect(recommendation.rationale.toLowerCase()).toMatch(/restore|submit|repair/);
    expect(recommendation.rationale).toContain('eforge stack sync');
  });

  it('keeps generic manual guidance for non-missing-base landing failures without failingPlans', () => {
    const summary: BuildFailureSummary = {
      prdId: 'test-prd',
      setName: 'test-set',
      featureBranch: 'eforge/test-set',
      baseBranch: 'main',
      plans: [{ planId: 'plan-01', status: 'failed', error: 'Landing failed' }],
      failingPlan: { planId: 'plan-01', errorMessage: 'Landing failed' },
      landedCommits: [],
      diffStat: '',
      modelsUsed: [],
      failedAt: '2026-05-26T06:15:10.000Z',
      landing: {
        status: 'failed',
        action: 'pr',
        reason: 'git-spice submit failed: provider returned an unexpected conflict',
      },
    };

    const recommendation = determineRecoveryRecommendation(summary);
    expect(recommendation.verdict).toBe('manual');
    expect(recommendation.rationale).toContain('No failingPlans data in summary');
    expect(recommendation.rationale.toLowerCase()).not.toContain('stack base');
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
    verdict: 'retry' | 'continue-repair' | 'abandon' | 'manual',
    rationale: string,
  ) {
    return {
      verdict,
      confidence: 'medium' as const,
      rationale,
      completedWork: [],
      remainingWork: [],
      risks: [],
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

describe('validateAnalystVerdict — removed split verdict', () => {
  it('rejects legacy split analyst verdicts even when the rationale names failed plans', () => {
    const summary: BuildFailureSummary = {
      prdId: 'test-prd',
      setName: 'test-set',
      featureBranch: 'eforge/test-set',
      baseBranch: 'main',
      plans: [{ planId: 'plan-04-queue-view', status: 'failed', error: 'API error 529' }],
      failingPlan: { planId: 'plan-04-queue-view', errorMessage: 'API error 529' },
      failingPlans: [{ planId: 'plan-04-queue-view', errorMessage: 'API error 529', terminalSubtype: 'error_transient_transport' }],
      landedCommits: [],
      diffStat: '',
      modelsUsed: [],
      failedAt: '2026-05-26T06:15:10.000Z',
    };
    const legacyVerdict = {
      verdict: 'split',
      confidence: 'medium',
      rationale: 'plan-04-queue-view failed due to a transient API error.',
      completedWork: [],
      remainingWork: [],
      risks: [],
    } as unknown as Parameters<typeof validateAnalystVerdict>[0];

    const result = validateAnalystVerdict(legacyVerdict, summary);
    expect(result.valid).toBe(false);
    expect(result.invalidationReason).toMatch(/no longer supported|continue-repair/i);
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
    // with deterministic source metadata when the deterministic recommendation is retry or continue-repair."
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
      verdict: 'retry' as const,
      confidence: 'high' as const,
      rationale: 'plan-04 failed with API 529 transient error. plan-01 was successfully merged; retry from scratch is acceptable after human review.',
      completedWork: ['plan-01 merged'],
      remainingWork: ['plan-04 needs retry'],
      risks: ['API instability may persist'],
    };

    const finalVerdict = selectFinalVerdict({
      deterministicRecommendation,
      analystVerdict,
      summary,
    });

    expect(finalVerdict.verdict).toBe('retry');
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

  it('forces deterministic manual for compile scope/context when analyst returns a mutating verdict', () => {
    const summary: BuildFailureSummary = {
      prdId: 'compile-prd',
      setName: 'compile-set',
      featureBranch: 'eforge/compile-set',
      baseBranch: 'main',
      plans: [],
      failingPlan: { planId: 'compile' },
      landedCommits: [],
      diffStat: '',
      modelsUsed: [],
      failedAt: '2026-05-26T06:15:10.000Z',
      terminalFailure: { scope: 'compile', terminalSubtype: 'error_context_window', stage: 'planner' },
    };
    const deterministicRecommendation = determineRecoveryRecommendation(summary);

    const finalVerdict = selectFinalVerdict({
      deterministicRecommendation,
      analystVerdict: {
        verdict: 'retry',
        confidence: 'medium',
        rationale: 'Compile context failure at planner; retry the PRD.',
        completedWork: [],
        remainingWork: [],
        risks: [],
      },
      summary,
    });

    expect(finalVerdict.verdict).toBe('manual');
    expect((finalVerdict as Record<string, unknown>).verdictInvalidationReason).toMatch(/read-only guidance/);
    expect((finalVerdict as Record<string, unknown>).recommendationSource).toBe('deterministic');
  });

  it('records verdictInvalidationReason when analyst returns the removed split verdict', () => {
    const summary = makeMultiFailSummary();
    const deterministicRecommendation = determineRecoveryRecommendation(summary);

    const invalidSplitVerdict = {
      verdict: 'split',
      confidence: 'medium',
      rationale: 'plan-04-queue-view and plan-06-static-serving both failed with 529 transient errors.',
      completedWork: [],
      remainingWork: [],
      risks: [],
    } as unknown as Parameters<typeof selectFinalVerdict>[0]['analystVerdict'];

    const finalVerdict = selectFinalVerdict({
      deterministicRecommendation,
      analystVerdict: invalidSplitVerdict,
      summary,
    });

    const verdictInvalidationReason = (finalVerdict as Record<string, unknown>).verdictInvalidationReason;
    expect(verdictInvalidationReason).toBeTruthy();
    expect(String(verdictInvalidationReason)).toMatch(/no longer supported|continue-repair/i);
    const source = (finalVerdict as Record<string, unknown>).recommendationSource;
    expect(source).not.toBe('analyst');
    expect(finalVerdict.verdict).not.toBe('split');
  });
});
