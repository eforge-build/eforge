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

  function makeVerdict(verdict: string = 'split'): ReturnType<typeof parseRecoveryVerdictBlock> {
    return {
      verdict: verdict as 'retry' | 'split' | 'abandon' | 'manual',
      confidence: 'medium',
      rationale: 'Foundation work preserved; API work remains.',
      completedWork: ['Foundation merged'],
      remainingWork: ['API endpoints'],
      risks: ['Type error unresolved'],
      suggestedSuccessorPrd: verdict === 'split' ? '# Successor PRD' : undefined,
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

  it('JSON includes schemaVersion: 2, summary, verdict, generatedAt', async () => {
    const dir = makeTempDir();
    const { jsonPath } = await writeRecoverySidecar({
      failedPrdDir: dir,
      prdId: 'test-prd',
      summary: makeSummary(),
      verdict: makeVerdict()!,
    });

    const raw = await readFile(jsonPath, 'utf-8');
    const parsed = JSON.parse(raw);

    expect(parsed.schemaVersion).toBe(2);
    expect(parsed.summary).toBeDefined();
    expect(parsed.summary.prdId).toBe('test-prd');
    expect(parsed.verdict).toBeDefined();
    expect(parsed.verdict.verdict).toBe('split');
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
    expect(md).toContain('SPLIT');
    expect(md).toContain('plan-01');
    expect(md).toContain('plan-02');
    expect(md).toContain('feat: foundation');
    expect(md).toContain('abc123de');
  });

  it('markdown includes suggestedSuccessorPrd for split verdict', async () => {
    const dir = makeTempDir();
    const { mdPath } = await writeRecoverySidecar({
      failedPrdDir: dir,
      prdId: 'test-prd',
      summary: makeSummary(),
      verdict: makeVerdict('split')!,
    });

    const md = await readFile(mdPath, 'utf-8');
    expect(md).toContain('Successor PRD');
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
    expect(JSON.parse(raw).schemaVersion).toBe(2);
  });

  it('produces valid JSON for each verdict type', async () => {
    const dir = makeTempDir();
    for (const verdict of ['retry', 'split', 'abandon', 'manual'] as const) {
      const subDir = join(dir, verdict);
      const { jsonPath } = await writeRecoverySidecar({
        failedPrdDir: subDir,
        prdId: `prd-${verdict}`,
        summary: makeSummary(),
        verdict: makeVerdict(verdict)!,
      });
      const parsed = JSON.parse(await readFile(jsonPath, 'utf-8'));
      expect(parsed.verdict.verdict).toBe(verdict);
      expect(parsed.schemaVersion).toBe(2);
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
    expect(md).toContain('## Acceptance Validation');
    expect(md).toContain('| Criterion | Verdict | Evidence | Next Step |');
    expect(md).toContain('Must reject invalid tokens');
    expect(md).toContain('fail');
    expect(md).toContain('Invalid token request succeeded in acceptance trace');
    expect(md).toContain('Update the implementation or tests cited by the evidence, then rerun acceptance validation for this criterion.');
    expect(md).toContain('Must expose audit trail');
    expect(md).toContain('unknown');
    expect(md).toContain('No deterministic audit trail proof found');
    expect(md).toContain('Inspect the cited evidence manually; add deterministic proof or clarify/split the criterion before retrying.');
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
    expect(md).toContain('**Total:** 2 | **Pass:** 0 | **Fail:** 0 | **Unknown (inconclusive):** 2');

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

  it('JSON sidecar serializes all new optional summary fields', async () => {
    const dir = makeTempDir();
    const { jsonPath } = await writeRecoverySidecar({
      failedPrdDir: dir,
      prdId: 'test-prd',
      summary: makeSummaryWithAcceptanceFailure(),
      verdict: makeVerdict('manual')!,
    });

    const parsed = JSON.parse(await readFile(jsonPath, 'utf-8'));
    expect(parsed.summary.terminalFailure).toBeDefined();
    expect(parsed.summary.terminalFailure.stage).toBe('acceptance-validation');
    expect(parsed.summary.acceptanceValidation).toBeDefined();
    expect(parsed.summary.acceptanceValidation.unknown).toBe(2);
    expect(parsed.summary.validationCommands).toBeDefined();
    expect(parsed.summary.validationCommands).toHaveLength(1);
    expect(parsed.summary.landing).toBeDefined();
    expect(parsed.summary.landing.status).toBe('skipped');
  });
});
