// Split from recovery.test.ts.
import { describe, it, expect } from 'vitest';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import type { EforgeEvent, BuildFailureSummary } from '@eforge-build/engine/events';
import { parseRecoveryVerdictBlock } from '@eforge-build/engine/agents/common';
import { recoveryVerdictSchema, getRecoveryVerdictSchemaYaml } from '@eforge-build/engine/schemas';
import { safeParseWithSchema, safeParseEforgeEvent } from '@eforge-build/client';
import { runRecoveryAnalyst } from '@eforge-build/engine/agents/recovery-analyst';
import { writeRecoverySidecar } from '@eforge-build/engine/recovery/sidecar';
import { buildFailureSummary } from '@eforge-build/engine/recovery/failure-summary';
import { EforgeEngine } from '@eforge-build/engine/eforge';
import { openDatabase } from '@eforge-build/monitor/db';
import { StubHarness } from './stub-harness.js';
import { collectEvents, findEvent, filterEvents } from './test-events.js';
import { useTempDir } from './test-tmpdir.js';

describe('writeRecoverySidecar', () => {
  const makeTempDir = useTempDir('eforge-recovery-sidecar-test-');

  function makeSummary(): BuildFailureSummary {
    return {
      prdId: 'test-prd',
      setName: 'test-set',
      featureBranch: 'eforge/test-set',
      baseBranch: 'main',
      plans: [
        { planId: 'plan-01', status: 'merged' },
        { planId: 'plan-02', status: 'failed', error: 'Type error' },
      ],
      failingPlan: { planId: 'plan-02', errorMessage: 'Type error' },
      landedCommits: [
        { sha: 'abc123def456', subject: 'feat: foundation', author: 'Dev', date: '2024-01-15' },
      ],
      diffStat: '3 files changed, 42 insertions(+)',
      modelsUsed: ['claude-sonnet-4-6'],
      failedAt: '2024-01-15T10:45:00.000Z',
    };
  }

  function makeVerdict(verdict: string = 'continue-repair'): ReturnType<typeof parseRecoveryVerdictBlock> {
    return {
      verdict: verdict as 'retry' | 'continue-repair' | 'abandon' | 'manual',
      confidence: 'medium',
      rationale: 'Foundation work preserved; API work remains.',
      completedWork: ['Foundation merged'],
      remainingWork: ['API endpoints'],
      risks: ['Type error unresolved'],
    };
  }

  it('produces both .recovery.md and .recovery.json files', async () => {
    const dir = makeTempDir();
    const { mdPath, jsonPath } = await writeRecoverySidecar({
      failedPrdDir: dir,
      prdId: 'test-prd',
      summary: makeSummary(),
      verdict: makeVerdict()!,
    });

    const md = await readFile(mdPath, 'utf-8');
    const json = await readFile(jsonPath, 'utf-8');

    expect(md.length).toBeGreaterThan(0);
    expect(json.length).toBeGreaterThan(0);
  });

  it('JSON includes schemaVersion: 3, identity, verdict, report, boundedEvidence, generatedAt', async () => {
    const dir = makeTempDir();
    const { jsonPath } = await writeRecoverySidecar({
      failedPrdDir: dir,
      prdId: 'test-prd',
      summary: makeSummary(),
      verdict: makeVerdict()!,
    });

    const raw = await readFile(jsonPath, 'utf-8');
    const parsed = JSON.parse(raw);

    expect(parsed.schemaVersion).toBe(3);
    expect(parsed.prdId).toBe('test-prd');
    expect(parsed.setName).toBe('test-set');
    expect(parsed.report).toBeDefined();
    expect(parsed.boundedEvidence).toBeDefined();
    expect(parsed.verdict).toBeDefined();
    expect(parsed.verdict.verdict).toBe('continue-repair');
    expect(JSON.stringify(parsed)).not.toContain(['suggested', 'Successor', 'Prd'].join(''));
    expect(parsed.generatedAt).toBeDefined();
    expect(typeof parsed.generatedAt).toBe('string');
  });

  it('markdown includes verdict, plan table, and landed commits', async () => {
    const dir = makeTempDir();
    const { mdPath } = await writeRecoverySidecar({
      failedPrdDir: dir,
      prdId: 'test-prd',
      summary: makeSummary(),
      verdict: makeVerdict()!,
    });

    const md = await readFile(mdPath, 'utf-8');
    expect(md).toContain('CONTINUE-REPAIR');
    expect(md).toContain('plan-01');
    expect(md).toContain('plan-02');
    expect(md).toContain('feat: foundation');
    expect(md).toContain('abc123de');
  });

  it('markdown omits generated successor PRD guidance', async () => {
    const dir = makeTempDir();
    const { mdPath } = await writeRecoverySidecar({
      failedPrdDir: dir,
      prdId: 'test-prd',
      summary: makeSummary(),
      verdict: makeVerdict('continue-repair')!,
    });

    const md = await readFile(mdPath, 'utf-8');
    expect(md).not.toContain(['Suggested', 'Successor', 'PRD'].join(' '));
    expect(md).not.toContain(['suggested', 'Successor', 'Prd'].join(''));
    expect(md).toContain('do not use generated successor content');
  });

  it('creates the target directory if it does not exist', async () => {
    const baseDir = makeTempDir();
    const nestedDir = join(baseDir, 'deep', 'nested', 'dir');

    const { jsonPath } = await writeRecoverySidecar({
      failedPrdDir: nestedDir,
      prdId: 'nested-prd',
      summary: makeSummary(),
      verdict: makeVerdict('manual')!,
    });

    const raw = await readFile(jsonPath, 'utf-8');
    expect(JSON.parse(raw).schemaVersion).toBe(3);
  });

  it('produces valid JSON for each verdict type', async () => {
    const dir = makeTempDir();
    for (const verdict of ['retry', 'continue-repair', 'abandon', 'manual'] as const) {
      const subDir = join(dir, verdict);
      const { jsonPath } = await writeRecoverySidecar({
        failedPrdDir: subDir,
        prdId: `prd-${verdict}`,
        summary: makeSummary(),
        verdict: makeVerdict(verdict)!,
      });
      const parsed = JSON.parse(await readFile(jsonPath, 'utf-8'));
      expect(parsed.verdict.verdict).toBe(verdict);
      expect(parsed.schemaVersion).toBe(3);
    }
  });

  function makeSummaryWithAcceptanceFailure(): BuildFailureSummary {
    return {
      ...makeSummary(),
      terminalFailure: {
        stage: 'acceptance-validation',
        phaseStatus: 'failed',
        phaseSummary: 'Acceptance criteria validation failed: 2 unknown',
        eventType: 'acceptance_validation:complete',
      },
      acceptanceValidation: {
        passed: false,
        total: 2,
        pass: 0,
        fail: 0,
        unknown: 2,
        verdicts: [
          { criterion: 'Must support OAuth login', verdict: 'unknown', evidence: 'Cannot verify OAuth from diff alone' },
          { criterion: 'Must handle rate limiting', verdict: 'unknown', evidence: 'No rate-limiting code visible in diff' },
        ],
      },
      validationCommands: [
        { command: 'pnpm type-check', exitCode: 0, output: 'No errors found' },
      ],
      landing: {
        status: 'skipped',
        action: 'pr',
        reason: 'Acceptance criteria validation failed — landing skipped',
      },
    };
  }

  it('Markdown includes terminal failure stage when terminalFailure is present', async () => {
    const dir = makeTempDir();
    const { mdPath } = await writeRecoverySidecar({
      failedPrdDir: dir,
      prdId: 'test-prd',
      summary: makeSummaryWithAcceptanceFailure(),
      verdict: makeVerdict('manual')!,
    });

    const md = await readFile(mdPath, 'utf-8');
    expect(md).toContain('Terminal Failure');
    expect(md).toContain('acceptance-validation');
    expect(md).toContain('acceptance_validation:complete');
  });

  it('Markdown includes acceptance verdict evidence and deterministic next-step guidance', async () => {
    const dir = makeTempDir();
    const summary = makeSummaryWithAcceptanceFailure();
    summary.acceptanceValidation = {
      passed: false,
      total: 2,
      pass: 0,
      fail: 1,
      unknown: 1,
      verdicts: [
        { criterion: 'Must reject invalid tokens', verdict: 'fail', evidence: 'Invalid token request succeeded in acceptance trace' },
        { criterion: 'Must expose audit trail', verdict: 'unknown', evidence: 'No deterministic audit trail proof found' },
      ],
    };
    const { mdPath } = await writeRecoverySidecar({
      failedPrdDir: dir,
      prdId: 'test-prd',
      summary,
      verdict: makeVerdict('manual')!,
    });

    const md = await readFile(mdPath, 'utf-8');
    expect(md).toContain('### Acceptance Validation');
    expect(md).toContain('| Criterion | Verdict | Evidence | Next Step |');
    expect(md).toContain('Must reject invalid tokens');
    expect(md).toContain('fail');
    expect(md).toContain('Invalid token request succeeded in acceptance trace');
    expect(md).toContain('Update implementation/tests or waive the criterion with explicit human justification.');
    expect(md).toContain('Must expose audit trail');
    expect(md).toContain('unknown');
    expect(md).toContain('No deterministic audit trail proof found');
    expect(md).toContain('Inspect manually and add deterministic proof or clarify the criterion.');
  });

  it('Markdown includes unknown acceptance verdict count when acceptanceValidation is present', async () => {
    const dir = makeTempDir();
    const { mdPath } = await writeRecoverySidecar({
      failedPrdDir: dir,
      prdId: 'test-prd',
      summary: makeSummaryWithAcceptanceFailure(),
      verdict: makeVerdict('manual')!,
    });

    const md = await readFile(mdPath, 'utf-8');
    expect(md).toContain('Acceptance Validation');
    expect(md).toContain('**Total:** 2 | **Pass:** 0 | **Fail:** 0 | **Unknown:** 2');

    expect(md).toContain('Must support OAuth login');
    expect(md).toContain('Must handle rate limiting');
  });

  it('Markdown includes validation commands section when validationCommands is present', async () => {
    const dir = makeTempDir();
    const { mdPath } = await writeRecoverySidecar({
      failedPrdDir: dir,
      prdId: 'test-prd',
      summary: makeSummaryWithAcceptanceFailure(),
      verdict: makeVerdict('manual')!,
    });

    const md = await readFile(mdPath, 'utf-8');
    expect(md).toContain('Validation Commands');
    expect(md).toContain('| pnpm type-check | 0 |');
  });

  it('Markdown includes landing status and reason when landing is present', async () => {
    const dir = makeTempDir();
    const { mdPath } = await writeRecoverySidecar({
      failedPrdDir: dir,
      prdId: 'test-prd',
      summary: makeSummaryWithAcceptanceFailure(),
      verdict: makeVerdict('manual')!,
    });

    const md = await readFile(mdPath, 'utf-8');
    expect(md).toContain('Landing Status');
    expect(md).toContain('skipped');
    expect(md).toContain('Acceptance criteria');
  });

  it('JSON sidecar report keyEvidence includes all-unknown acceptance validation diagnostics', async () => {
    const dir = makeTempDir();
    const { jsonPath } = await writeRecoverySidecar({
      failedPrdDir: dir,
      prdId: 'test-prd',
      summary: makeSummaryWithAcceptanceFailure(),
      verdict: makeVerdict('manual')!,
    });

    const parsed = JSON.parse(await readFile(jsonPath, 'utf-8'));
    const keyEvidence = parsed.report.keyEvidence.join('\n');
    expect(keyEvidence).toContain('Acceptance validation is inconclusive');
    expect(keyEvidence).toContain('no concrete failed criteria were produced');
  });

  it('JSON sidecar serializes all new optional bounded evidence fields', async () => {
    const dir = makeTempDir();
    const { jsonPath } = await writeRecoverySidecar({
      failedPrdDir: dir,
      prdId: 'test-prd',
      summary: makeSummaryWithAcceptanceFailure(),
      verdict: makeVerdict('manual')!,
    });

    const parsed = JSON.parse(await readFile(jsonPath, 'utf-8'));
    expect(parsed.boundedEvidence.terminalFailure).toBeDefined();
    expect(parsed.boundedEvidence.terminalFailure.stage).toBe('acceptance-validation');
    expect(parsed.boundedEvidence.acceptanceValidation).toBeDefined();
    expect(parsed.boundedEvidence.acceptanceValidation.unknown).toBe(2);
    expect(parsed.boundedEvidence.validationCommands).toBeDefined();
    expect(parsed.boundedEvidence.validationCommands).toHaveLength(1);
    expect(parsed.boundedEvidence.landing).toBeDefined();
    expect(parsed.boundedEvidence.landing.status).toBe('skipped');
  });

  it('bounds oversized validation command output in JSON and Markdown sidecars', async () => {
    const dir = makeTempDir();
    const summary = makeSummaryWithAcceptanceFailure();
    summary.validationCommands = [
      {
        command: 'pnpm test -- --large-output',
        exitCode: 1,
        output: `BEGIN_OVERSIZED_VALIDATION_OUTPUT ${'x'.repeat(5_000)} END_UNBOUNDED_VALIDATION_SENTINEL`,
      },
    ];

    const { jsonPath, mdPath } = await writeRecoverySidecar({
      failedPrdDir: dir,
      prdId: 'test-prd',
      summary,
      verdict: makeVerdict('manual')!,
    });

    const jsonRaw = await readFile(jsonPath, 'utf-8');
    const md = await readFile(mdPath, 'utf-8');
    const parsed = JSON.parse(jsonRaw);

    expect(jsonRaw).not.toContain('END_UNBOUNDED_VALIDATION_SENTINEL');
    expect(md).not.toContain('END_UNBOUNDED_VALIDATION_SENTINEL');
    expect(parsed.boundedEvidence.validationCommands[0].truncated).toBe(true);
    expect(parsed.boundedEvidence.validationCommands[0].outputPreview).toContain('[truncated from');
    expect(parsed.boundedEvidence.evidenceOmissions).toContain('Validation command output was truncated for: pnpm test -- --large-output');
    expect(md).toContain('[truncated]');
    expect(md).toContain('Validation command output was truncated for: pnpm test -- --large-output');
  });

  it('JSON and Markdown include eligible continue-and-repair recommendation as the primary action', async () => {
    const dir = makeTempDir();
    const { jsonPath, mdPath } = await writeRecoverySidecar({
      failedPrdDir: dir,
      prdId: 'test-prd',
      summary: makeSummary(),
      verdict: makeVerdict('manual')!,
      continueRepairEvidence: {
        continueRepairEligibility: {
          source: 'continueRepairEligibility',
          eligible: true,
          featureBranch: 'eforge/test-set',
          artifactAvailability: 'feature-branch',
          landedCommitCount: 1,
          diffStat: '3 files changed',
          failingPlanId: 'plan-02',
        },
      },
    });

    const parsed = JSON.parse(await readFile(jsonPath, 'utf-8'));
    const md = await readFile(mdPath, 'utf-8');

    expect(parsed.continueRepairEligibility.eligible).toBe(true);
    expect(parsed.recoveryOptions).toContainEqual(expect.objectContaining({ kind: 'continue-repair', action: 'continue-repair', recommended: true }));
    expect(['retry', 'continue-repair', 'abandon', 'manual']).toContain(parsed.verdict.verdict);
    expect(parsed.verdict.verdict).toBe('manual');
    expect(parsed.report.recommendedAction).toContain('eforge continue-repair');
    expect(md).toContain('Continue-and-repair eligibility');
    expect(md).toContain('eforge continue-repair');
    expect(md).toContain('Recommended operator action');
    expect(md).not.toContain(['eforge', 'resume', 'build'].join('_'));
  });

  it('JSON and Markdown include ineligible continue-repair evidence without a recommended option', async () => {
    const dir = makeTempDir();
    const { jsonPath, mdPath } = await writeRecoverySidecar({
      failedPrdDir: dir,
      prdId: 'test-prd',
      summary: makeSummary(),
      verdict: makeVerdict('retry')!,
      continueRepairEvidence: {
        continueRepairEligibility: {
          source: 'continueRepairEligibility',
          eligible: false,
          featureBranch: 'eforge/test-set',
          reason: 'feature branch eforge/test-set not found',
        },
      },
    });

    const parsed = JSON.parse(await readFile(jsonPath, 'utf-8'));
    const md = await readFile(mdPath, 'utf-8');
    expect(parsed.continueRepairEligibility.eligible).toBe(false);
    expect(parsed.continueRepairEligibility.reason).toContain('feature branch');
    expect(parsed.recoveryOptions?.some((option: { kind: string; recommended: boolean }) => option.kind === 'continue-repair' && option.recommended)).not.toBe(true);
    expect(md).toContain('Continue-and-repair eligibility');
    expect(md).toContain('ineligible');
  });

  it('JSON sidecar records bounded inspection failure evidence', async () => {
    const dir = makeTempDir();
    const { projectRecoverySidecarResumeEvidence } = await import('@eforge-build/engine/recovery/resume-sidecar');
    const resumeEvidence = await projectRecoverySidecarResumeEvidence({
      cwd: '/definitely/missing/eforge/project',
      setName: 'test-set',
      prdId: 'test-prd',
      outputDir: 'eforge/plans',
    });
    const { jsonPath, mdPath } = await writeRecoverySidecar({
      failedPrdDir: dir,
      prdId: 'test-prd',
      summary: makeSummary(),
      verdict: makeVerdict('manual')!,
      continueRepairEvidence: resumeEvidence,
    });

    const parsed = JSON.parse(await readFile(jsonPath, 'utf-8'));
    const md = await readFile(mdPath, 'utf-8');
    expect(parsed.continueRepairEligibility.eligible).toBe(false);
    expect(parsed.continueRepairEligibility.reason.length).toBeGreaterThan(0);
    expect(parsed.continueRepairEligibility.reason.length).toBeLessThanOrEqual(1100);
    expect(md).toContain('Continue-and-repair eligibility');
  });

  it('places operator guidance before detailed evidence in Markdown sidecars', async () => {
    const dir = makeTempDir();
    const summary = makeSummaryWithAcceptanceFailure();
    summary.terminalFailure = {
      stage: 'acceptance-validation',
      scope: 'acceptance-validation',
      message: 'Acceptance validation failed before landing.',
    };
    const verdict = {
      ...makeVerdict('manual')!,
      recommendationSource: 'deterministic' as const,
    };

    const { mdPath } = await writeRecoverySidecar({
      failedPrdDir: dir,
      prdId: 'test-prd',
      summary,
      verdict,
    });

    const md = await readFile(mdPath, 'utf-8');
    const nonEmptyLines = md.split('\n').filter((line) => line.trim() !== '');
    const first80 = nonEmptyLines.slice(0, 80).join('\n');
    const detailedIndex = md.indexOf('## Detailed Evidence');

    expect(first80).toContain('**Verdict:** MANUAL (confidence: medium)');
    expect(first80).toContain('**Verdict Source:** deterministic');
    expect(first80).toContain('**Root Failure Scope:** acceptance-validation');
    expect(first80).toContain('**Root Failure Stage:** acceptance-validation');
    expect(first80).toContain('### Recommended Action');
    expect(first80).toContain('Manual review / manual replanning required.');
    expect(first80).toContain('Review bounded evidence and create a focused follow-up PRD only after human inspection.');
    expect(md.indexOf('### Plans')).toBeGreaterThan(detailedIndex);
    expect(md.indexOf('### Acceptance Validation')).toBeGreaterThan(detailedIndex);
    expect(md.indexOf('### Validation Commands')).toBeGreaterThan(detailedIndex);
  });
});
