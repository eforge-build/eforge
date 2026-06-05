import { describe, expect, it } from 'vitest';
import type { BuildFailureSummary } from '@eforge-build/engine/events';
import {
  DEFAULT_RECOVERY_ANALYST_PROMPT_CONTEXT_LIMITS,
  prepareRecoveryAnalystPromptContext,
} from '@eforge-build/engine/recovery/analyst-context';
import { boundList, omissionMarker, truncateMiddleText, truncateText, truncationMarker } from '@eforge-build/engine/recovery/text-bounds';

function makeSummary(overrides: Partial<BuildFailureSummary> = {}): BuildFailureSummary {
  return {
    prdId: 'prd-recovery-context',
    setName: 'recovery-context-set',
    featureBranch: 'eforge/recovery-context-set',
    baseBranch: 'main',
    failedAt: '2026-06-01T12:00:00.000Z',
    plans: [
      { planId: 'plan-01-foundation', status: 'merged', completedAt: '2026-06-01T11:00:00.000Z' },
      { planId: 'plan-02-api', status: 'failed', error: 'Type error in API handler' },
    ],
    failingPlan: { planId: 'plan-02-api', errorMessage: 'Type error in API handler' },
    failingPlans: [{ planId: 'plan-02-api', errorMessage: 'Type error in API handler' }],
    terminalFailure: { scope: 'post-merge-validation', stage: 'validation', message: 'pnpm type-check failed', authoritative: true },
    acceptanceValidation: {
      passed: false,
      total: 3,
      pass: 1,
      fail: 1,
      unknown: 1,
      verdicts: [
        { criterion: 'API returns paginated users', verdict: 'pass', evidence: 'Route test passed' },
        { criterion: 'API validates writes', verdict: 'fail', evidence: 'Missing validation evidence' },
        { criterion: 'API documents OpenAPI schema', verdict: 'unknown', evidence: 'No schema evidence found' },
      ],
    },
    validationCommands: [{ command: 'pnpm type-check', exitCode: 1, output: 'src/api.ts:12: error TS2322' }],
    landing: { status: 'skipped', reason: 'validation failed' },
    landedCommits: [{ sha: 'abc123', subject: 'feat: foundation', author: 'Test Author', date: '2026-06-01T11:00:00.000Z' }],
    diffStat: '1 file changed, 2 insertions(+)',
    modelsUsed: ['claude-sonnet-4-6', 'gpt-5-codex'],
    ...overrides,
  };
}

describe('prepareRecoveryAnalystPromptContext', () => {
  it('keeps full PRD content and summary evidence when both fit within default limits', () => {
    const summary = makeSummary();
    const prdContent = '# Small PRD\n\n## Acceptance Criteria\n\n- Ship the API.';

    const context = prepareRecoveryAnalystPromptContext({ prdContent, summary });
    const parsed = JSON.parse(context.summaryJson) as BuildFailureSummary;

    expect(context.prdContent).toBe(prdContent);
    expect(context.truncated).toBe(false);
    expect(context.notes).toEqual([]);
    expect(parsed.prdId).toBe(summary.prdId);
    expect(parsed.validationCommands?.[0]?.output).toBe('src/api.ts:12: error TS2322');
  });

  it('bounds oversized PRD content while preserving acceptance-criteria-like sections and truncation markers', () => {
    const oversizedIntro = 'intro filler '.repeat(3_000);
    const oversizedTail = 'tail filler '.repeat(3_000);
    const prdContent = [
      '# Oversized PRD',
      oversizedIntro,
      '## Acceptance Criteria',
      '- Preserve the acceptance criterion sentinel in the bounded prompt.',
      '- Keep remaining implementation requirements visible.',
      oversizedTail,
    ].join('\n\n');

    const context = prepareRecoveryAnalystPromptContext({
      prdContent,
      summary: makeSummary(),
      limits: { prdBudgetChars: 2_000 },
    });

    expect(context.prdContent.length).toBeLessThanOrEqual(2_000);
    expect(context.prdContent).toContain('[truncated from');
    expect(context.prdContent).toContain('## Acceptance Criteria');
    expect(context.prdContent).toContain('acceptance criterion sentinel');
    expect(context.notes.join('\n')).toContain('PRD content truncated');
  });

  it('bounds oversized validation command output with visible truncation metadata', () => {
    const fullRawOutputSentinel = 'RAW_OUTPUT_SENTINEL '.repeat(1_000);
    const context = prepareRecoveryAnalystPromptContext({
      prdContent: '# PRD',
      summary: makeSummary({
        validationCommands: [{ command: 'pnpm test', exitCode: 1, output: fullRawOutputSentinel }],
      }),
    });

    const parsed = JSON.parse(context.summaryJson) as BuildFailureSummary;

    expect(context.summaryJson).not.toContain(fullRawOutputSentinel);
    expect(parsed.validationCommands?.[0]?.command).toBe('pnpm test');
    expect(parsed.validationCommands?.[0]?.exitCode).toBe(1);
    expect(parsed.validationCommands?.[0]?.output).toContain('[truncated from');
    expect(context.notes.join('\n')).toContain('validationCommands[].output truncated');
  });

  it('keeps bounded PRD content plus bounded summary JSON within the advertised input budget', () => {
    const context = prepareRecoveryAnalystPromptContext({
      prdContent: '# PRD\n\n' + 'prd body '.repeat(500),
      summary: makeSummary({
        diffStat: 'diff stat '.repeat(1_000),
        validationCommands: [{ command: 'pnpm test', exitCode: 1, output: 'test output '.repeat(1_000) }],
      }),
      limits: {
        inputBudgetChars: 1_200,
        prdBudgetChars: 900,
        summaryBudgetChars: 900,
      },
    });

    expect(context.prdContent.length + context.summaryJson.length).toBeLessThanOrEqual(context.inputBudgetChars);
  });

  it('omits duplicate summary.prdContent from bounded summary JSON with omission notes', () => {
    const prdSentinel = 'SUMMARY_PRD_CONTENT_SENTINEL_DO_NOT_DUPLICATE';
    const context = prepareRecoveryAnalystPromptContext({
      prdContent: '# PRD\n\nBounded prompt PRD content.',
      summary: makeSummary({ prdContent: `${prdSentinel} raw PRD copy` }),
    });

    const parsed = JSON.parse(context.summaryJson) as { omittedEvidence?: string[]; contextNotes?: string[] };

    expect(context.summaryJson).not.toContain(prdSentinel);
    expect([...(parsed.omittedEvidence ?? []), ...(parsed.contextNotes ?? [])].join('\n')).toContain('summary.prdContent');
    expect(context.notes.join('\n')).toContain('omitted evidence is not proof of absence');
  });

  it('preserves recovery-critical identifiers and lifecycle facts in bounded summary JSON', () => {
    const context = prepareRecoveryAnalystPromptContext({
      prdContent: '# PRD',
      summary: makeSummary({
        diffStat: 'diff --stat sentinel\n'.repeat(500),
        validationCommands: [{ command: 'pnpm build', exitCode: 1, output: 'build failure '.repeat(500) }],
        acceptanceValidation: {
          passed: false,
          total: 2,
          pass: 1,
          fail: 0,
          unknown: 1,
          verdicts: [
            { criterion: 'Criterion A', verdict: 'pass', evidence: 'pass evidence '.repeat(500) },
            { criterion: 'Criterion B', verdict: 'unknown', evidence: 'unknown evidence '.repeat(500) },
          ],
        },
      }),
      limits: {
        ...DEFAULT_RECOVERY_ANALYST_PROMPT_CONTEXT_LIMITS,
        summaryBudgetChars: 8_000,
        diffStatChars: 200,
        commandOutputChars: 120,
        acceptanceEvidenceChars: 120,
      },
    });

    const parsed = JSON.parse(context.summaryJson) as BuildFailureSummary;

    expect(parsed.prdId).toBe('prd-recovery-context');
    expect(parsed.setName).toBe('recovery-context-set');
    expect(parsed.featureBranch).toBe('eforge/recovery-context-set');
    expect(parsed.baseBranch).toBe('main');
    expect(parsed.failedAt).toBe('2026-06-01T12:00:00.000Z');
    expect(parsed.plans.map(plan => [plan.planId, plan.status])).toEqual([
      ['plan-01-foundation', 'merged'],
      ['plan-02-api', 'failed'],
    ]);
    expect(parsed.failingPlan.planId).toBe('plan-02-api');
    expect(parsed.failingPlans?.[0]?.planId).toBe('plan-02-api');
    expect(parsed.terminalFailure?.scope).toBe('post-merge-validation');
    expect(parsed.terminalFailure?.stage).toBe('validation');
    expect(parsed.acceptanceValidation?.total).toBe(2);
    expect(parsed.acceptanceValidation?.pass).toBe(1);
    expect(parsed.acceptanceValidation?.fail).toBe(0);
    expect(parsed.acceptanceValidation?.unknown).toBe(1);
    expect(parsed.landing?.status).toBe('skipped');
    expect(parsed.modelsUsed).toEqual(['claude-sonnet-4-6', 'gpt-5-codex']);
    expect(context.summaryJson).toContain('[truncated from');
  });

  it('reduces optional previews under tight summary budgets while preserving all required plan identifiers', () => {
    const plans = Array.from({ length: 5 }, (_, index) => ({
      planId: `plan-0${index + 1}-required-id`,
      status: index < 2 ? 'merged' : 'failed',
      error: `plan error ${index} `.repeat(300),
    }));
    const failingPlans = plans.slice(2).map(plan => ({
      planId: plan.planId,
      errorMessage: `failure detail for ${plan.planId} `.repeat(300),
      terminalSubtype: 'error_transient_transport',
    }));

    const context = prepareRecoveryAnalystPromptContext({
      prdContent: '# PRD',
      summary: makeSummary({
        plans,
        failingPlan: failingPlans[0],
        failingPlans,
        diffStat: 'VERY LARGE DIFF STAT PREVIEW '.repeat(2_000),
        validationCommands: [{ command: 'pnpm build', exitCode: 1, output: 'VERY LARGE VALIDATION OUTPUT '.repeat(2_000) }],
        acceptanceValidation: {
          passed: false,
          total: 3,
          pass: 0,
          fail: 3,
          unknown: 0,
          verdicts: [
            { criterion: 'Criterion A', verdict: 'fail', evidence: 'VERY LARGE ACCEPTANCE EVIDENCE '.repeat(1_000) },
            { criterion: 'Criterion B', verdict: 'fail', evidence: 'MORE LARGE ACCEPTANCE EVIDENCE '.repeat(1_000) },
          ],
        },
        reviewFailure: {
          planId: 'plan-03-required-id',
          issues: [
            {
              severity: 'warning',
              category: 'coverage-gaps',
              file: 'src/example.ts',
              line: 12,
              description: 'VERY LARGE REVIEW FAILURE TEXT '.repeat(1_000),
              fix: 'VERY LARGE REVIEW FIX TEXT '.repeat(1_000),
            },
          ],
        },
      }),
      limits: {
        ...DEFAULT_RECOVERY_ANALYST_PROMPT_CONTEXT_LIMITS,
        summaryBudgetChars: 4_000,
      },
    });

    const parsed = JSON.parse(context.summaryJson) as BuildFailureSummary & { omittedEvidence?: string[]; contextNotes?: string[] };

    expect(context.summaryJson.length).toBeLessThanOrEqual(4_000);
    expect(parsed.plans.map(plan => [plan.planId, plan.status])).toEqual(plans.map(plan => [plan.planId, plan.status]));
    expect(parsed.failingPlans?.map(plan => plan.planId)).toEqual(failingPlans.map(plan => plan.planId));
    expect(context.summaryJson).not.toContain('VERY LARGE VALIDATION OUTPUT VERY LARGE VALIDATION OUTPUT');
    expect(context.summaryJson).not.toContain('VERY LARGE REVIEW FAILURE TEXT VERY LARGE REVIEW FAILURE TEXT');
    expect([parsed.diffStat, ...(parsed.omittedEvidence ?? []), ...(parsed.contextNotes ?? [])].join('\n')).toMatch(/truncated|omitted/);
  });
});

describe('text bounds helpers', () => {
  it('handles zero budgets and markers longer than the budget', () => {
    expect(truncateText('abcdef', 0, 'zero').text).toBe(omissionMarker(6, 'zero'));
    expect(truncateText('abcdef', 5, 'long marker').text).toHaveLength(5);
    expect(truncateText('abcdef', 5, 'long marker').truncated).toBe(true);
  });

  it('uses visible truncation markers and preserves head and tail for middle truncation', () => {
    const result = truncateMiddleText('HEAD-' + 'x'.repeat(80) + '-TAIL', 80, 'middle');

    expect(truncationMarker(90, 80, 'middle')).toContain('middle');
    expect(result.text).toContain('HEAD-');
    expect(result.text).toContain('-TAIL');
    expect(result.text).toContain('[truncated from 90 chars to 80 chars: middle]');
  });

  it('bounds lists and reports omitted counts at boundaries', () => {
    expect(boundList([1, 2, 3], 0)).toEqual({ items: [], omittedCount: 3 });
    expect(boundList([1, 2, 3], 2)).toEqual({ items: [1, 2], omittedCount: 1 });
    expect(boundList([1, 2], 2)).toEqual({ items: [1, 2], omittedCount: 0 });
  });
});
