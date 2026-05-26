/**
 * Tests for the recovery-analyst engine core:
 *   - parseRecoveryVerdictBlock (parser round-trip, null on malformed)
 *   - recoveryVerdictSchema (Zod acceptance per verdict)
 *   - getRecoveryVerdictSchemaYaml (non-empty YAML with expected keys)
 *   - writeRecoverySidecar (.recovery.md + .recovery.json formatting)
 *   - buildFailureSummary (against fixture state + temp git repo)
 *   - runRecoveryAnalyst (agent wiring: events, tools:'none', parse/error paths)
 */

import { describe, it, expect } from 'vitest';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import type { EforgeEvent, BuildFailureSummary } from '@eforge-build/engine/events';
import { parseRecoveryVerdictBlock } from '@eforge-build/engine/agents/common';
import { recoveryVerdictSchema, getRecoveryVerdictSchemaYaml } from '@eforge-build/engine/schemas';
import { safeParseWithSchema } from '@eforge-build/client';
import { runRecoveryAnalyst } from '@eforge-build/engine/agents/recovery-analyst';
import { writeRecoverySidecar } from '@eforge-build/engine/recovery/sidecar';
import { buildFailureSummary } from '@eforge-build/engine/recovery/failure-summary';
import { EforgeEngine } from '@eforge-build/engine/eforge';
import { openDatabase } from '@eforge-build/monitor/db';
import { StubHarness } from './stub-harness.js';
import { collectEvents, findEvent, filterEvents } from './test-events.js';
import { useTempDir } from './test-tmpdir.js';

// ---------------------------------------------------------------------------
// parseRecoveryVerdictBlock
// ---------------------------------------------------------------------------

describe('parseRecoveryVerdictBlock', () => {
  it('returns null for empty text', () => {
    expect(parseRecoveryVerdictBlock('')).toBeNull();
  });

  it('returns null for plain text with no XML block', () => {
    expect(parseRecoveryVerdictBlock('I recommend manual review.')).toBeNull();
  });

  it('returns null when verdict attribute is invalid', () => {
    const text = `<recovery verdict="unknown" confidence="high">
  <rationale>Some reason</rationale>
  <completedWork></completedWork>
  <remainingWork></remainingWork>
  <risks></risks>
</recovery>`;
    expect(parseRecoveryVerdictBlock(text)).toBeNull();
  });

  it('returns null when confidence attribute is invalid', () => {
    const text = `<recovery verdict="retry" confidence="extreme">
  <rationale>Some reason</rationale>
  <completedWork></completedWork>
  <remainingWork></remainingWork>
  <risks></risks>
</recovery>`;
    expect(parseRecoveryVerdictBlock(text)).toBeNull();
  });

  it('returns null when rationale is missing', () => {
    const text = `<recovery verdict="manual" confidence="low">
  <completedWork></completedWork>
  <remainingWork></remainingWork>
  <risks></risks>
</recovery>`;
    expect(parseRecoveryVerdictBlock(text)).toBeNull();
  });

  it('parses retry verdict', () => {
    const text = `<recovery verdict="retry" confidence="high">
  <rationale>The failure was a transient network timeout — no code issues.</rationale>
  <completedWork>
    <item>plan-01: merged successfully</item>
  </completedWork>
  <remainingWork>
    <item>plan-02: timed out, retry should succeed</item>
  </remainingWork>
  <risks>
    <item>Network instability may persist</item>
  </risks>
</recovery>`;
    const result = parseRecoveryVerdictBlock(text);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('retry');
    expect(result!.confidence).toBe('high');
    expect(result!.rationale).toBe('The failure was a transient network timeout — no code issues.');
    expect(result!.completedWork).toEqual(['plan-01: merged successfully']);
    expect(result!.remainingWork).toEqual(['plan-02: timed out, retry should succeed']);
    expect(result!.risks).toEqual(['Network instability may persist']);
    expect(result!.suggestedSuccessorPrd).toBeUndefined();
  });

  it('parses split verdict with suggestedSuccessorPrd', () => {
    const text = `<recovery verdict="split" confidence="medium">
  <rationale>Foundation work is preserved; API work remains incomplete.</rationale>
  <completedWork>
    <item>Database schema merged</item>
    <item>Auth middleware merged</item>
  </completedWork>
  <remainingWork>
    <item>REST API endpoints</item>
    <item>Integration tests</item>
  </remainingWork>
  <risks>
    <item>Type error must be fixed</item>
  </risks>
  <suggestedSuccessorPrd># API Implementation\n\nBuild the REST layer.</suggestedSuccessorPrd>
</recovery>`;
    const result = parseRecoveryVerdictBlock(text);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('split');
    expect(result!.confidence).toBe('medium');
    expect(result!.completedWork).toHaveLength(2);
    expect(result!.remainingWork).toHaveLength(2);
    expect(result!.suggestedSuccessorPrd).toContain('API Implementation');
  });

  it('parses abandon verdict', () => {
    const text = `<recovery verdict="abandon" confidence="high">
  <rationale>The feature was shipped in a hotfix before this build ran.</rationale>
  <completedWork>
    <item>Feature already live via hotfix</item>
  </completedWork>
  <remainingWork></remainingWork>
  <risks></risks>
</recovery>`;
    const result = parseRecoveryVerdictBlock(text);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('abandon');
    expect(result!.completedWork).toHaveLength(1);
    expect(result!.remainingWork).toHaveLength(0);
  });

  it('parses manual verdict', () => {
    const text = `<recovery verdict="manual" confidence="low">
  <rationale>Insufficient evidence — ambiguous error with no clear transient indicator.</rationale>
  <completedWork></completedWork>
  <remainingWork>
    <item>All acceptance criteria remain</item>
  </remainingWork>
  <risks>
    <item>Unknown root cause</item>
  </risks>
</recovery>`;
    const result = parseRecoveryVerdictBlock(text);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('manual');
    expect(result!.confidence).toBe('low');
    expect(result!.remainingWork).toHaveLength(1);
  });

  it('extracts the block from surrounding text', () => {
    const text = `Analysis complete. Based on my review:

<recovery verdict="manual" confidence="low">
  <rationale>Evidence is unclear.</rationale>
  <completedWork></completedWork>
  <remainingWork></remainingWork>
  <risks></risks>
</recovery>

That concludes my assessment.`;
    const result = parseRecoveryVerdictBlock(text);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('manual');
  });
});

// ---------------------------------------------------------------------------
// recoveryVerdictSchema
// ---------------------------------------------------------------------------

describe('recoveryVerdictSchema', () => {
  function makeVerdict(overrides: Record<string, unknown> = {}) {
    return {
      verdict: 'manual',
      confidence: 'low',
      rationale: 'Insufficient evidence',
      completedWork: [],
      remainingWork: [],
      risks: [],
      ...overrides,
    };
  }

  it('accepts retry verdict', () => {
    expect(safeParseWithSchema(recoveryVerdictSchema, makeVerdict({ verdict: 'retry', confidence: 'high' })).success).toBe(true);
  });

  it('accepts split verdict with suggestedSuccessorPrd', () => {
    const result = safeParseWithSchema(recoveryVerdictSchema, makeVerdict({
      verdict: 'split',
      confidence: 'medium',
      suggestedSuccessorPrd: '# Successor PRD\n\nContent here.',
    }));
    expect(result.success).toBe(true);
  });

  it('accepts abandon verdict', () => {
    expect(safeParseWithSchema(recoveryVerdictSchema, makeVerdict({ verdict: 'abandon' })).success).toBe(true);
  });

  it('accepts manual verdict (no suggestedSuccessorPrd)', () => {
    expect(safeParseWithSchema(recoveryVerdictSchema, makeVerdict()).success).toBe(true);
  });

  it('rejects unknown verdict', () => {
    expect(safeParseWithSchema(recoveryVerdictSchema, makeVerdict({ verdict: 'unknown' })).success).toBe(false);
  });

  it('rejects unknown confidence', () => {
    expect(safeParseWithSchema(recoveryVerdictSchema, makeVerdict({ confidence: 'extreme' })).success).toBe(false);
  });

  it('rejects empty rationale', () => {
    expect(safeParseWithSchema(recoveryVerdictSchema, makeVerdict({ rationale: '' })).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getRecoveryVerdictSchemaYaml
// ---------------------------------------------------------------------------

describe('getRecoveryVerdictSchemaYaml', () => {
  it('returns non-empty YAML', () => {
    const yaml = getRecoveryVerdictSchemaYaml();
    expect(yaml.length).toBeGreaterThan(0);
  });

  it('contains the literal string "verdict"', () => {
    expect(getRecoveryVerdictSchemaYaml()).toContain('verdict');
  });

  it('contains "manual" in an enum array', () => {
    expect(getRecoveryVerdictSchemaYaml()).toContain('manual');
  });

  it('contains all four verdict values', () => {
    const yaml = getRecoveryVerdictSchemaYaml();
    expect(yaml).toContain('retry');
    expect(yaml).toContain('split');
    expect(yaml).toContain('abandon');
    expect(yaml).toContain('manual');
  });

  it('is cached — returns the same string on repeated calls', () => {
    expect(getRecoveryVerdictSchemaYaml()).toBe(getRecoveryVerdictSchemaYaml());
  });
});

// ---------------------------------------------------------------------------
// writeRecoverySidecar
// ---------------------------------------------------------------------------

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
    expect(md).toContain('abc123de'); // short SHA
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

  // --- eforge:region plan-01-recovery-and-acceptance-reporting ---
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
    // At least one unknown criterion appears in the table
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
  // --- eforge:endregion plan-01-recovery-and-acceptance-reporting ---
});

// ---------------------------------------------------------------------------
// buildFailureSummary
// ---------------------------------------------------------------------------

describe('buildFailureSummary', () => {
  const makeTempDir = useTempDir('eforge-recovery-summary-test-');

  /**
   * Set up a temp git repository with:
   * - 1 commit on `main`
   * - 2 commits on `eforge/test-recovery-set` with a Models-Used: trailer
   */
  function seedGitRepo(dir: string): void {
    const gitOpts = { cwd: dir };
    execFileSync('git', ['init', '-b', 'main'], gitOpts);
    execFileSync('git', ['config', 'user.email', 'test@example.com'], gitOpts);
    execFileSync('git', ['config', 'user.name', 'Test'], gitOpts);

    // Initial commit on main
    execFileSync('git', ['commit', '--allow-empty', '-m', 'chore: initial commit'], gitOpts);

    // Feature branch with 2 commits
    execFileSync('git', ['checkout', '-b', 'eforge/test-recovery-set'], gitOpts);
    execFileSync('git', ['commit', '--allow-empty', '-m', 'feat: plan-01 foundation\n\nModels-Used: claude-sonnet-4-6\n\nCo-Authored-By: forged-by-eforge <noreply@eforge.build>'], gitOpts);
    execFileSync('git', ['commit', '--allow-empty', '-m', 'wip: plan-02 api partial'], gitOpts);

    // Return to main (repo stays at main HEAD)
    execFileSync('git', ['checkout', 'main'], gitOpts);
  }

  /**
   * Seed a monitor DB with a build run for test-recovery-set that has a
   * plan:build:failed event for plan-02-api.
   */
  function seedMonitorDb(dir: string): string {
    const dbDir = join(dir, '.eforge');
    mkdirSync(dbDir, { recursive: true });
    const dbPath = join(dbDir, 'monitor.db');
    const db = openDatabase(dbPath);
    db.insertRun({
      id: 'run-recovery-01',
      sessionId: 'session-recovery-01',
      planSet: 'test-recovery-set',
      command: 'build',
      status: 'failed',
      startedAt: new Date('2024-01-15T10:00:00.000Z').toISOString(),
      cwd: dir,
      pid: 99999,
    });
    db.insertEvent({
      runId: 'run-recovery-01',
      type: 'plan:build:failed',
      planId: 'plan-02-api',
      data: JSON.stringify({ type: 'plan:build:failed', planId: 'plan-02-api', error: 'Build failed: type error in src/api.ts line 42' }),
      timestamp: new Date('2024-01-15T10:45:00.000Z').toISOString(),
    });
    db.insertEvent({
      runId: 'run-recovery-01',
      type: 'agent:start',
      data: JSON.stringify({ type: 'agent:start', model: 'claude-sonnet-4-6', agent: 'builder' }),
      timestamp: new Date('2024-01-15T10:10:00.000Z').toISOString(),
    });
    // A second agent:start with a model that does NOT appear in any commit
    // trailer — used to verify modelsUsed merges DB-only models with git-only
    // models rather than relying on a single source.
    db.insertEvent({
      runId: 'run-recovery-01',
      type: 'agent:start',
      data: JSON.stringify({ type: 'agent:start', model: 'claude-opus-db-only', agent: 'reviewer' }),
      timestamp: new Date('2024-01-15T10:20:00.000Z').toISOString(),
    });
    db.close();
    return dbPath;
  }

  it('returns correct failingPlan.planId from monitor DB events', async () => {
    const dir = makeTempDir();
    seedGitRepo(dir);
    const dbPath = seedMonitorDb(dir);

    const summary = await buildFailureSummary({
      setName: 'test-recovery-set',
      prdId: 'test-prd',
      cwd: dir,
      dbPath,
    });

    expect(summary.failingPlan.planId).toBe('plan-02-api');
    expect(summary.failingPlan.errorMessage).toContain('type error');
  });

  it('returns landedCommits with length matching commits on feature branch', async () => {
    const dir = makeTempDir();
    seedGitRepo(dir);
    const dbPath = seedMonitorDb(dir);

    const summary = await buildFailureSummary({
      setName: 'test-recovery-set',
      prdId: 'test-prd',
      cwd: dir,
      dbPath,
    });

    // The feature branch has 2 commits beyond main
    expect(summary.landedCommits).toHaveLength(2);
    expect(summary.landedCommits[0].sha.length).toBe(40);
    expect(summary.landedCommits[0].subject.length).toBeGreaterThan(0);
  });

  it('parses modelsUsed from commit trailers and merges with monitor DB models', async () => {
    const dir = makeTempDir();
    seedGitRepo(dir);
    const dbPath = seedMonitorDb(dir);

    const summary = await buildFailureSummary({
      setName: 'test-recovery-set',
      prdId: 'test-prd',
      cwd: dir,
      dbPath,
    });

    // 'claude-sonnet-4-6' is the model from the git commit trailer
    expect(summary.modelsUsed).toContain('claude-sonnet-4-6');
    // 'claude-opus-db-only' appears only in the monitor DB, never in commit
    // trailers — proves the two sources are actually merged
    expect(summary.modelsUsed).toContain('claude-opus-db-only');
  });

  it('returns setName, baseBranch (git-derived), featureBranch, prdId from params + git', async () => {
    const dir = makeTempDir();
    seedGitRepo(dir);
    const dbPath = seedMonitorDb(dir);

    const summary = await buildFailureSummary({
      setName: 'test-recovery-set',
      prdId: 'test-prd',
      cwd: dir,
      dbPath,
    });

    expect(summary.setName).toBe('test-recovery-set');
    expect(summary.baseBranch).toBe('main'); // falls back to main (no remote tracking)
    expect(summary.featureBranch).toBe('eforge/test-recovery-set');
    expect(summary.prdId).toBe('test-prd');
    // Monitor DB had events, so partial should not be true
    expect(summary.partial).toBeUndefined();
  });

  it('returns partial summary when no monitor DB events exist', async () => {
    const dir = makeTempDir();
    const summary = await buildFailureSummary({ setName: 'x', prdId: 'y', cwd: dir });
    expect(summary.partial).toBe(true);
    expect(summary.prdId).toBe('y');
    expect(summary.setName).toBe('x');
    // Documented partial-fallback shape (Decision #10): unknown failingPlan,
    // empty plans/landedCommits/modelsUsed, baseBranch falls back to main,
    // failedAt is a non-empty ISO string (current time per Decision #11).
    expect(summary.failingPlan.planId).toBe('unknown');
    expect(summary.plans).toEqual([]);
    expect(summary.landedCommits).toEqual([]);
    expect(summary.modelsUsed).toEqual([]);
    expect(summary.featureBranch).toBe('eforge/x');
    expect(summary.baseBranch).toBe('main');
    expect(typeof summary.failedAt).toBe('string');
    expect(summary.failedAt.length).toBeGreaterThan(0);
  });

  it('derives failedAt from latest commit date when no monitor DB exists but feature branch has commits', async () => {
    const dir = makeTempDir();
    seedGitRepo(dir);

    // No dbPath supplied — eventFragment is null, partial path used
    const summary = await buildFailureSummary({
      setName: 'test-recovery-set',
      prdId: 'test-prd',
      cwd: dir,
    });

    expect(summary.partial).toBe(true);
    // Decision #11 middle case: failedAt comes from the most recent landed
    // commit's date, not from `new Date().toISOString()`.
    expect(summary.landedCommits.length).toBeGreaterThan(0);
    expect(summary.failedAt).toBe(summary.landedCommits[0].date);
    expect(summary.failedAt.length).toBeGreaterThan(0);
  });

  // --- eforge:region plan-01-recovery-and-acceptance-reporting ---
  /**
   * Seed a monitor DB with a build run that failed at acceptance validation:
   * - Passing validation commands (pnpm type-check, pnpm test)
   * - Passing PRD validation (prd_validation:complete with passed: true)
   * - acceptance_validation:complete with unknown verdicts
   * - landing:skipped event
   * - phase:end with status: failed
   */
  function seedAcceptanceFailureDb(
    dir: string,
    options: { prdValidationPassed?: boolean; landingEventType?: 'landing:skipped' | 'stack:landing:update' } = {},
  ): string {
    const dbDir = join(dir, '.eforge');
    mkdirSync(dbDir, { recursive: true });
    const dbPath = join(dbDir, 'monitor.db');
    const db = openDatabase(dbPath);
    const phaseTs = new Date('2024-02-01T11:30:00.000Z').toISOString();
    const prdValidationPassed = options.prdValidationPassed ?? true;
    const landingEventType = options.landingEventType ?? 'stack:landing:update';
    db.insertRun({
      id: 'run-acc-fail-01',
      sessionId: 'session-acc-01',
      planSet: 'acceptance-fail-set',
      command: 'build',
      status: 'failed',
      startedAt: new Date('2024-02-01T11:00:00.000Z').toISOString(),
      cwd: dir,
      pid: 11111,
    });
    // Earlier failed validation attempt that must not leak into recovered evidence.
    db.insertEvent({
      runId: 'run-acc-fail-01',
      type: 'validation:start',
      data: JSON.stringify({ type: 'validation:start', commands: ['pnpm type-check'] }),
      timestamp: new Date('2024-02-01T11:07:00.000Z').toISOString(),
    });
    db.insertEvent({
      runId: 'run-acc-fail-01',
      type: 'validation:command:complete',
      data: JSON.stringify({ type: 'validation:command:complete', command: 'pnpm type-check', exitCode: 1, output: 'stale type error' }),
      timestamp: new Date('2024-02-01T11:08:00.000Z').toISOString(),
    });
    db.insertEvent({
      runId: 'run-acc-fail-01',
      type: 'validation:complete',
      data: JSON.stringify({ type: 'validation:complete', passed: false }),
      timestamp: new Date('2024-02-01T11:09:00.000Z').toISOString(),
    });
    // Final passing validation command events.
    db.insertEvent({
      runId: 'run-acc-fail-01',
      type: 'validation:start',
      data: JSON.stringify({ type: 'validation:start', commands: ['pnpm type-check', 'pnpm test'] }),
      timestamp: new Date('2024-02-01T11:10:00.000Z').toISOString(),
    });
    db.insertEvent({
      runId: 'run-acc-fail-01',
      type: 'validation:command:complete',
      data: JSON.stringify({ type: 'validation:command:complete', command: 'pnpm type-check', exitCode: 0, output: 'No errors found' }),
      timestamp: new Date('2024-02-01T11:10:10.000Z').toISOString(),
    });
    db.insertEvent({
      runId: 'run-acc-fail-01',
      type: 'validation:command:complete',
      data: JSON.stringify({ type: 'validation:command:complete', command: 'pnpm test', exitCode: 0, output: '42 tests passed' }),
      timestamp: new Date('2024-02-01T11:11:00.000Z').toISOString(),
    });
    db.insertEvent({
      runId: 'run-acc-fail-01',
      type: 'validation:complete',
      data: JSON.stringify({ type: 'validation:complete', passed: true }),
      timestamp: new Date('2024-02-01T11:12:00.000Z').toISOString(),
    });
    // PRD validation result. When this fails, later acceptance_validation evidence must not
    // be treated as the terminal acceptance failure.
    db.insertEvent({
      runId: 'run-acc-fail-01',
      type: 'prd_validation:complete',
      data: JSON.stringify({
        type: 'prd_validation:complete',
        passed: prdValidationPassed,
        gaps: prdValidationPassed ? [] : [{ requirement: 'Document recovery fallback', explanation: 'Missing fallback test' }],
        completionPercent: prdValidationPassed ? 100 : 80,
      }),
      timestamp: new Date('2024-02-01T11:15:00.000Z').toISOString(),
    });
    // Acceptance validation failure with unknown verdicts
    db.insertEvent({
      runId: 'run-acc-fail-01',
      type: 'acceptance_validation:complete',
      data: JSON.stringify({
        type: 'acceptance_validation:complete',
        passed: false,
        verdicts: [
          { criterion: 'Must support OAuth login', verdict: 'unknown', evidence: 'Cannot verify OAuth from diff alone' },
          { criterion: 'Must handle rate limiting', verdict: 'unknown', evidence: 'No rate-limiting code visible in diff' },
        ],
        source: 'prd',
      }),
      timestamp: new Date('2024-02-01T11:20:00.000Z').toISOString(),
    });
    // Landing skipped because acceptance failed. Exercise both stack and ordinary skipped events.
    db.insertEvent({
      runId: 'run-acc-fail-01',
      type: landingEventType,
      data: landingEventType === 'landing:skipped'
        ? JSON.stringify({ type: 'landing:skipped', action: 'pr', reason: 'Build failed before landing could be attempted' })
        : JSON.stringify({ type: 'stack:landing:update', status: 'skipped', action: 'pr', reason: 'Build failed before landing could be attempted' }),
      timestamp: new Date('2024-02-01T11:25:00.000Z').toISOString(),
    });
    // Failed phase:end (no plan:build:failed — acceptance validation is the terminal failure)
    db.insertEvent({
      runId: 'run-acc-fail-01',
      type: 'phase:end',
      data: JSON.stringify({ type: 'phase:end', result: { status: 'failed', summary: 'Acceptance criteria validation failed: 2 unknown' } }),
      timestamp: phaseTs,
    });
    // Agent model evidence
    db.insertEvent({
      runId: 'run-acc-fail-01',
      type: 'agent:start',
      data: JSON.stringify({ type: 'agent:start', model: 'claude-sonnet-4-5', agent: 'prd-validator' }),
      timestamp: new Date('2024-02-01T11:05:00.000Z').toISOString(),
    });
    db.close();
    return dbPath;
  }

  it('synthesizes acceptance-validation terminal failure when phase:end failed and acceptance_validation:complete exists', async () => {
    const dir = makeTempDir();
    seedGitRepo(dir);
    const dbPath = seedAcceptanceFailureDb(dir);

    // Verify the seeded DB contains a passing prd_validation:complete event
    {
      const db = openDatabase(dbPath);
      const prdValidationEvents = db.getEventsByType('run-acc-fail-01', 'prd_validation:complete');
      db.close();
      expect(prdValidationEvents.length).toBeGreaterThanOrEqual(1);
      const payload = JSON.parse(prdValidationEvents[0].data);
      expect(payload.passed).toBe(true);
      expect(payload.gaps).toEqual([]);
    }

    const summary = await buildFailureSummary({
      setName: 'acceptance-fail-set',
      prdId: 'acceptance-prd',
      cwd: dir,
      dbPath,
    });

    // failingPlan.planId must NOT be 'unknown' — it is 'acceptance-validation'
    expect(summary.failingPlan.planId).not.toBe('unknown');
    expect(summary.failingPlan.planId).toBe('acceptance-validation');

    // failedAt must be derived from the phase:end event timestamp
    expect(summary.failedAt).toBe(new Date('2024-02-01T11:30:00.000Z').toISOString());

    // terminalFailure must describe the acceptance-validation stage
    expect(summary.terminalFailure).toBeDefined();
    expect(summary.terminalFailure!.stage).toBe('acceptance-validation');
    expect(summary.terminalFailure!.eventType).toBe('acceptance_validation:complete');

    // acceptanceValidation counts must reflect the unknown verdicts
    expect(summary.acceptanceValidation).toBeDefined();
    expect(summary.acceptanceValidation!.passed).toBe(false);
    expect(summary.acceptanceValidation!.unknown).toBe(2);
    expect(summary.acceptanceValidation!.fail).toBe(0);
    expect(summary.acceptanceValidation!.pass).toBe(0);
    expect(summary.acceptanceValidation!.total).toBe(2);
    expect(summary.acceptanceValidation!.verdicts).toHaveLength(2);
    expect(summary.acceptanceValidation!.verdicts.every((v) => v.verdict === 'unknown')).toBe(true);

    // Validation commands must be included
    expect(summary.validationCommands).toBeDefined();
    expect(summary.validationCommands!).toHaveLength(2);
    expect(summary.validationCommands!.find((c) => c.command === 'pnpm type-check')).toBeDefined();
    expect(summary.validationCommands!.find((c) => c.command === 'pnpm test')).toBeDefined();
    expect(summary.validationCommands!.find((c) => c.exitCode === 0)).toBeDefined();
    expect(summary.validationCommands!.find((c) => c.exitCode === 1)).toBeUndefined();
    expect(summary.validationCommands!.some((c) => c.output?.includes('stale type error'))).toBe(false);

    // Landing evidence should reflect skipped stack landing, not PR creation
    expect(summary.landing).toBeDefined();
    expect(summary.landing!.status).toBe('skipped');
    expect(summary.landing!.reason).toContain('Build failed before landing');
    // The landing reason must NOT imply PR was successfully created
    expect(summary.landing!.reason).not.toContain('PR created');
    expect(summary.landing!.reason).not.toContain('created successfully');
  });

  it('infers skipped landing status for landing:skipped events without a status field', async () => {
    const dir = makeTempDir();
    seedGitRepo(dir);
    const dbPath = seedAcceptanceFailureDb(dir, { landingEventType: 'landing:skipped' });

    const summary = await buildFailureSummary({
      setName: 'acceptance-fail-set',
      prdId: 'acceptance-prd',
      cwd: dir,
      dbPath,
    });

    expect(summary.landing).toMatchObject({
      status: 'skipped',
      action: 'pr',
      reason: 'Build failed before landing could be attempted',
    });
  });

  it('reports PRD validation, not acceptance validation, when the latest PRD validation failed', async () => {
    const dir = makeTempDir();
    seedGitRepo(dir);
    const dbPath = seedAcceptanceFailureDb(dir, { prdValidationPassed: false });

    const summary = await buildFailureSummary({
      setName: 'acceptance-fail-set',
      prdId: 'acceptance-prd',
      cwd: dir,
      dbPath,
    });

    expect(summary.failingPlan.planId).toBe('prd-validation');
    expect(summary.terminalFailure).toMatchObject({
      stage: 'prd-validation',
      eventType: 'prd_validation:complete',
    });
    expect(summary.acceptanceValidation).toBeUndefined();
  });

  it('does not label build-run agent stop fallback as compile when the failing agent has no planId', async () => {
    const dir = makeTempDir();
    seedGitRepo(dir);
    const dbDir = join(dir, '.eforge');
    mkdirSync(dbDir, { recursive: true });
    const dbPath = join(dbDir, 'monitor.db');
    const db = openDatabase(dbPath);
    db.insertRun({
      id: 'run-build-agent-stop',
      sessionId: 'session-build-agent-stop',
      planSet: 'build-agent-stop-set',
      command: 'build',
      status: 'failed',
      startedAt: new Date('2024-02-01T12:00:00.000Z').toISOString(),
      cwd: dir,
      pid: 22222,
    });
    db.insertEvent({
      runId: 'run-build-agent-stop',
      type: 'agent:stop',
      agent: 'prd-validator',
      data: JSON.stringify({ type: 'agent:stop', agent: 'prd-validator', agentId: 'agent-1', error: 'validator crashed' }),
      timestamp: new Date('2024-02-01T12:10:00.000Z').toISOString(),
    });
    db.insertEvent({
      runId: 'run-build-agent-stop',
      type: 'phase:end',
      data: JSON.stringify({ type: 'phase:end', result: { status: 'failed', summary: 'PRD validator crashed' } }),
      timestamp: new Date('2024-02-01T12:11:00.000Z').toISOString(),
    });
    db.close();

    const summary = await buildFailureSummary({
      setName: 'build-agent-stop-set',
      prdId: 'build-agent-stop-prd',
      cwd: dir,
      dbPath,
    });

    expect(summary.failingPlan.planId).toBe('prd-validator');
    expect(summary.failingPlan.planId).not.toBe('compile');
    expect(summary.plans[0].planId).toBe('prd-validator');
  });
  // --- eforge:endregion plan-01-recovery-and-acceptance-reporting ---
});

// ---------------------------------------------------------------------------
// buildFailureSummary multi-plan reconstruction
// ---------------------------------------------------------------------------

// --- eforge:region plan-01-recovery-summary-reconstruction ---
describe('buildFailureSummary multi-plan reconstruction', () => {
  const makeTempDir = useTempDir('eforge-recovery-multi-plan-test-');

  function seedGitRepo(dir: string): void {
    const gitOpts = { cwd: dir };
    execFileSync('git', ['init', '-b', 'main'], gitOpts);
    execFileSync('git', ['config', 'user.email', 'test@example.com'], gitOpts);
    execFileSync('git', ['config', 'user.name', 'Test'], gitOpts);
    execFileSync('git', ['commit', '--allow-empty', '-m', 'chore: initial commit'], gitOpts);
    execFileSync('git', ['checkout', '-b', 'eforge/multi-plan-set'], gitOpts);
    for (let i = 1; i <= 5; i++) {
      execFileSync('git', ['commit', '--allow-empty', '-m', `feat: plan-0${i} merged`], gitOpts);
    }
    execFileSync('git', ['checkout', 'main'], gitOpts);
  }

  /**
   * Seed a monitor DB for multi-plan-set with:
   *  - plan:status:change → merged for five plans
   *  - plan:merge:complete for plan-01-console-shell (commitSha)
   *  - plan:build:test:complete for plan-02-activity-audit-view (42 passed, 0 failed)
   *  - 3 agent:tool_use events for plan-04-queue-view
   *  - plan:status:change → failed + plan:build:failed for plan-04 (T1) and plan-06 (T2, later)
   *
   * This mirrors the real failed run from `03ea77d4` that proved the bug:
   * old code returns only plan-06 in plans[], new code must return all 7.
   */
  function seedMultiPlanDb(dir: string): string {
    const dbDir = join(dir, '.eforge');
    mkdirSync(dbDir, { recursive: true });
    const dbPath = join(dbDir, 'monitor.db');
    const db = openDatabase(dbPath);
    const baseTs = new Date('2026-05-26T05:00:00.000Z').getTime();

    db.insertRun({
      id: 'run-multi-plan-01',
      sessionId: 'session-multi-01',
      planSet: 'multi-plan-set',
      command: 'build',
      status: 'failed',
      startedAt: new Date(baseTs).toISOString(),
      cwd: dir,
      pid: 12345,
    });

    // 5 merged plans — each gets a plan:status:change event
    const mergedPlanIds = [
      'plan-01-console-shell',
      'plan-02-activity-audit-view',
      'plan-03-now-dashboard',
      'plan-05-runs-build-entrypoints',
      'plan-07-system-configuration-view',
    ];
    for (let i = 0; i < mergedPlanIds.length; i++) {
      const planId = mergedPlanIds[i];
      const ts = new Date(baseTs + (i + 1) * 60_000).toISOString();
      db.insertEvent({
        runId: 'run-multi-plan-01',
        type: 'plan:status:change',
        planId,
        data: JSON.stringify({ type: 'plan:status:change', planId, status: 'merged' }),
        timestamp: ts,
      });
    }

    // plan:merge:complete for plan-01-console-shell with commitSha (for enrichment test)
    db.insertEvent({
      runId: 'run-multi-plan-01',
      type: 'plan:merge:complete',
      planId: 'plan-01-console-shell',
      data: JSON.stringify({
        type: 'plan:merge:complete',
        planId: 'plan-01-console-shell',
        commitSha: 'abc1234def5678901234567890abcdef12345678',
      }),
      timestamp: new Date(baseTs + 65_000).toISOString(),
    });

    // plan:build:test:complete for plan-02-activity-audit-view (for test count enrichment)
    db.insertEvent({
      runId: 'run-multi-plan-01',
      type: 'plan:build:test:complete',
      planId: 'plan-02-activity-audit-view',
      data: JSON.stringify({
        type: 'plan:build:test:complete',
        planId: 'plan-02-activity-audit-view',
        passed: 42,
        failed: 0,
        testBugsFixed: 0,
        productionIssues: [],
      }),
      timestamp: new Date(baseTs + 125_000).toISOString(),
    });

    // 3 agent:tool_use events for plan-04-queue-view (for toolUseCount enrichment)
    for (let i = 0; i < 3; i++) {
      db.insertEvent({
        runId: 'run-multi-plan-01',
        type: 'agent:tool_use',
        planId: 'plan-04-queue-view',
        data: JSON.stringify({
          type: 'agent:tool_use',
          planId: 'plan-04-queue-view',
          agentId: 'agent-builder-04',
          agent: 'builder',
          tool: 'Read',
          toolUseId: `tu-04-${i}`,
          input: {},
        }),
        timestamp: new Date(baseTs + 300_000 + i * 1000).toISOString(),
      });
    }

    // plan-04 fails at T1 (06:15:04)
    db.insertEvent({
      runId: 'run-multi-plan-01',
      type: 'plan:status:change',
      planId: 'plan-04-queue-view',
      data: JSON.stringify({ type: 'plan:status:change', planId: 'plan-04-queue-view', status: 'failed' }),
      timestamp: new Date('2026-05-26T06:15:04.000Z').toISOString(),
    });
    db.insertEvent({
      runId: 'run-multi-plan-01',
      type: 'plan:build:failed',
      planId: 'plan-04-queue-view',
      data: JSON.stringify({
        type: 'plan:build:failed',
        planId: 'plan-04-queue-view',
        error: 'API error 529: overloaded_error',
        terminalSubtype: 'error_transient_transport',
      }),
      timestamp: new Date('2026-05-26T06:15:04.000Z').toISOString(),
    });

    // plan-06 fails at T2 (06:15:10) — later than plan-04; plan-06 is the latest failure
    db.insertEvent({
      runId: 'run-multi-plan-01',
      type: 'plan:status:change',
      planId: 'plan-06-static-serving-package-integration',
      data: JSON.stringify({
        type: 'plan:status:change',
        planId: 'plan-06-static-serving-package-integration',
        status: 'failed',
      }),
      timestamp: new Date('2026-05-26T06:15:10.000Z').toISOString(),
    });
    db.insertEvent({
      runId: 'run-multi-plan-01',
      type: 'plan:build:failed',
      planId: 'plan-06-static-serving-package-integration',
      data: JSON.stringify({
        type: 'plan:build:failed',
        planId: 'plan-06-static-serving-package-integration',
        error: 'API error 529: overloaded_error',
        terminalSubtype: 'error_transient_transport',
      }),
      timestamp: new Date('2026-05-26T06:15:10.000Z').toISOString(),
    });

    db.close();
    return dbPath;
  }

  it('[regression] summary.plans includes all 7 plans — not just the latest failure', async () => {
    const dir = makeTempDir();
    seedGitRepo(dir);
    const dbPath = seedMultiPlanDb(dir);

    const summary = await buildFailureSummary({
      setName: 'multi-plan-set',
      prdId: 'multi-plan-prd',
      cwd: dir,
      dbPath,
    });

    // Old code: returns only 1 plan (the latest plan:build:failed row).
    // After fix: returns all 7 plans via plan:status:change reconstruction.
    expect(summary.plans).toHaveLength(7);

    const planIds = summary.plans.map((p) => p.planId);
    expect(planIds).toContain('plan-01-console-shell');
    expect(planIds).toContain('plan-02-activity-audit-view');
    expect(planIds).toContain('plan-03-now-dashboard');
    expect(planIds).toContain('plan-05-runs-build-entrypoints');
    expect(planIds).toContain('plan-07-system-configuration-view');
    expect(planIds).toContain('plan-04-queue-view');
    expect(planIds).toContain('plan-06-static-serving-package-integration');
  });

  it('[regression] summary.failingPlans contains both plan-04-queue-view and plan-06-static-serving-package-integration', async () => {
    const dir = makeTempDir();
    seedGitRepo(dir);
    const dbPath = seedMultiPlanDb(dir);

    const summary = await buildFailureSummary({
      setName: 'multi-plan-set',
      prdId: 'multi-plan-prd',
      cwd: dir,
      dbPath,
    });

    // failingPlans is a new optional field listing all failed plans in the run.
    // Old code: does not populate this field. After fix: populated from all plan:build:failed rows.
    const failingPlans = (summary as unknown as { failingPlans?: Array<{ planId: string }> }).failingPlans;
    expect(failingPlans).toBeDefined();
    expect(failingPlans).toHaveLength(2);

    const failingPlanIds = failingPlans!.map((p) => p.planId);
    expect(failingPlanIds).toContain('plan-04-queue-view');
    expect(failingPlanIds).toContain('plan-06-static-serving-package-integration');
  });

  it('summary.failingPlan.planId is the latest failed plan (plan-06) for backward compatibility', async () => {
    const dir = makeTempDir();
    seedGitRepo(dir);
    const dbPath = seedMultiPlanDb(dir);

    const summary = await buildFailureSummary({
      setName: 'multi-plan-set',
      prdId: 'multi-plan-prd',
      cwd: dir,
      dbPath,
    });

    // plan-06 failed at 06:15:10; plan-04 at 06:15:04 — plan-06 has higher event id and is latest.
    // summary.failingPlan must remain the latest failure for existing consumers.
    expect(summary.failingPlan.planId).toBe('plan-06-static-serving-package-integration');
  });

  it('completed and failed plans have the correct status in summary.plans', async () => {
    const dir = makeTempDir();
    seedGitRepo(dir);
    const dbPath = seedMultiPlanDb(dir);

    const summary = await buildFailureSummary({
      setName: 'multi-plan-set',
      prdId: 'multi-plan-prd',
      cwd: dir,
      dbPath,
    });

    const plan01 = summary.plans.find((p) => p.planId === 'plan-01-console-shell');
    expect(plan01).toBeDefined();
    expect(plan01!.status).toBe('merged');

    const plan04 = summary.plans.find((p) => p.planId === 'plan-04-queue-view');
    expect(plan04).toBeDefined();
    expect(plan04!.status).toBe('failed');

    const plan06 = summary.plans.find((p) => p.planId === 'plan-06-static-serving-package-integration');
    expect(plan06).toBeDefined();
    expect(plan06!.status).toBe('failed');
  });

  it('plan entry includes commitSha when plan:merge:complete event exists', async () => {
    const dir = makeTempDir();
    seedGitRepo(dir);
    const dbPath = seedMultiPlanDb(dir);

    const summary = await buildFailureSummary({
      setName: 'multi-plan-set',
      prdId: 'multi-plan-prd',
      cwd: dir,
      dbPath,
    });

    const plan01 = summary.plans.find((p) => p.planId === 'plan-01-console-shell');
    expect(plan01).toBeDefined();
    // commitSha is a new optional field enriched from plan:merge:complete events
    const commitSha = (plan01 as unknown as { commitSha?: string }).commitSha;
    expect(commitSha).toBe('abc1234def5678901234567890abcdef12345678');
  });

  it('plan entry includes testPassed and testFailed when plan:build:test:complete event exists', async () => {
    const dir = makeTempDir();
    seedGitRepo(dir);
    const dbPath = seedMultiPlanDb(dir);

    const summary = await buildFailureSummary({
      setName: 'multi-plan-set',
      prdId: 'multi-plan-prd',
      cwd: dir,
      dbPath,
    });

    const plan02 = summary.plans.find((p) => p.planId === 'plan-02-activity-audit-view');
    expect(plan02).toBeDefined();
    // testPassed and testFailed are new optional fields enriched from plan:build:test:complete events
    const enriched = plan02 as unknown as { testPassed?: number; testFailed?: number };
    expect(enriched.testPassed).toBe(42);
    expect(enriched.testFailed).toBe(0);
  });

  it('failed plan entry in failingPlans includes toolUseCount from agent:tool_use events', async () => {
    const dir = makeTempDir();
    seedGitRepo(dir);
    const dbPath = seedMultiPlanDb(dir);

    const summary = await buildFailureSummary({
      setName: 'multi-plan-set',
      prdId: 'multi-plan-prd',
      cwd: dir,
      dbPath,
    });

    const failingPlans = (summary as unknown as {
      failingPlans?: Array<{ planId: string; toolUseCount?: number }>;
    }).failingPlans;
    expect(failingPlans).toBeDefined();

    // plan-04 had 3 agent:tool_use events in the fixture
    const plan04Failing = failingPlans!.find((p) => p.planId === 'plan-04-queue-view');
    expect(plan04Failing).toBeDefined();
    expect(plan04Failing!.toolUseCount).toBe(3);

    // plan-06 had no agent:tool_use events — count should be 0 or absent
    const plan06Failing = failingPlans!.find((p) => p.planId === 'plan-06-static-serving-package-integration');
    expect(plan06Failing).toBeDefined();
    expect(plan06Failing!.toolUseCount ?? 0).toBe(0);
  });

  it('does not set partial:true when multi-plan DB events exist', async () => {
    const dir = makeTempDir();
    seedGitRepo(dir);
    const dbPath = seedMultiPlanDb(dir);

    const summary = await buildFailureSummary({
      setName: 'multi-plan-set',
      prdId: 'multi-plan-prd',
      cwd: dir,
      dbPath,
    });

    expect(summary.partial).toBeUndefined();
  });
});
// --- eforge:endregion plan-01-recovery-summary-reconstruction ---

// ---------------------------------------------------------------------------
// runRecoveryAnalyst (agent wiring)
// ---------------------------------------------------------------------------

describe('runRecoveryAnalyst wiring', () => {
  const makeTempDir = useTempDir('eforge-recovery-analyst-test-');

  function makeSummary(): BuildFailureSummary {
    return {
      prdId: 'test-prd',
      setName: 'test-set',
      featureBranch: 'eforge/test-set',
      baseBranch: 'main',
      plans: [{ planId: 'plan-01', status: 'failed', error: 'Timeout' }],
      failingPlan: { planId: 'plan-01', errorMessage: 'Timeout' },
      landedCommits: [],
      diffStat: '',
      modelsUsed: [],
      failedAt: '2024-01-15T10:00:00.000Z',
    };
  }

  const SPLIT_OUTPUT = `Based on my analysis of the failure:

<recovery verdict="split" confidence="medium">
  <rationale>Foundation work is preserved; API work remains incomplete due to the timeout.</rationale>
  <completedWork>
    <item>Database schema merged</item>
  </completedWork>
  <remainingWork>
    <item>API endpoints not implemented</item>
  </remainingWork>
  <risks>
    <item>Timeout root cause unknown</item>
  </risks>
  <suggestedSuccessorPrd># Successor PRD\n\nContinue the API work.</suggestedSuccessorPrd>
</recovery>`;

  it('emits recovery:summary then recovery:complete for valid agent output', async () => {
    const backend = new StubHarness([{ text: SPLIT_OUTPUT }]);
    const cwd = makeTempDir();

    const events = await collectEvents(runRecoveryAnalyst({
      harness: backend,
      prdId: 'test-prd',
      prdContent: '# PRD\n\nBuild a thing.',
      summary: makeSummary(),
      cwd,
    }));

    const summary = findEvent(events, 'recovery:summary');
    expect(summary).toBeDefined();
    expect(summary!.prdId).toBe('test-prd');
    expect(summary!.summary.setName).toBe('test-set');

    const complete = findEvent(events, 'recovery:complete');
    expect(complete).toBeDefined();
    expect(complete!.verdict.verdict).toBe('split');
    expect(complete!.verdict.confidence).toBe('medium');
    expect(complete!.prdId).toBe('test-prd');

    // No error event
    expect(findEvent(events, 'recovery:error')).toBeUndefined();
  });

  it('emits recovery:error when agent output has no valid block', async () => {
    const backend = new StubHarness([{ text: 'I am unable to determine the recovery path.' }]);
    const cwd = makeTempDir();

    const events = await collectEvents(runRecoveryAnalyst({
      harness: backend,
      prdId: 'test-prd',
      prdContent: '# PRD',
      summary: makeSummary(),
      cwd,
    }));

    const error = findEvent(events, 'recovery:error');
    expect(error).toBeDefined();
    expect(error!.prdId).toBe('test-prd');
    expect(error!.error).toContain('parse');

    // No complete event
    expect(findEvent(events, 'recovery:complete')).toBeUndefined();
    expect(findEvent(events, 'recovery:summary')).toBeUndefined();
  });

  it('invokes harness with tools: "none"', async () => {
    const backend = new StubHarness([{ text: SPLIT_OUTPUT }]);
    const cwd = makeTempDir();

    await collectEvents(runRecoveryAnalyst({
      harness: backend,
      prdId: 'test-prd',
      prdContent: '# PRD',
      summary: makeSummary(),
      cwd,
    }));

    expect(backend.calls).toHaveLength(1);
    expect(backend.calls[0].tools).toBe('none');
  });

  it('suppresses agent:message when verbose is false (default)', async () => {
    const backend = new StubHarness([{ text: SPLIT_OUTPUT }]);
    const cwd = makeTempDir();

    const events = await collectEvents(runRecoveryAnalyst({
      harness: backend,
      prdId: 'test-prd',
      prdContent: '# PRD',
      summary: makeSummary(),
      cwd,
    }));

    expect(filterEvents(events, 'agent:message')).toHaveLength(0);
  });

  it('emits agent:message when verbose is true', async () => {
    const backend = new StubHarness([{ text: SPLIT_OUTPUT }]);
    const cwd = makeTempDir();

    const events = await collectEvents(runRecoveryAnalyst({
      harness: backend,
      prdId: 'test-prd',
      prdContent: '# PRD',
      summary: makeSummary(),
      cwd,
      verbose: true,
    }));

    expect(filterEvents(events, 'agent:message').length).toBeGreaterThan(0);
  });

  it('always emits agent:result', async () => {
    const backend = new StubHarness([{ text: SPLIT_OUTPUT }]);
    const cwd = makeTempDir();

    const events = await collectEvents(runRecoveryAnalyst({
      harness: backend,
      prdId: 'test-prd',
      prdContent: '# PRD',
      summary: makeSummary(),
      cwd,
    }));

    expect(findEvent(events, 'agent:result')).toBeDefined();
  });

  it('prompt includes prdContent, summary JSON, and schema YAML', async () => {
    const backend = new StubHarness([{ text: SPLIT_OUTPUT }]);
    const cwd = makeTempDir();

    await collectEvents(runRecoveryAnalyst({
      harness: backend,
      prdId: 'test-prd',
      prdContent: '# My PRD\n\nDo a thing.',
      summary: makeSummary(),
      cwd,
    }));

    const prompt = backend.prompts[0];
    expect(prompt).toContain('# My PRD');
    expect(prompt).toContain('test-set'); // from summary JSON
    expect(prompt).toContain('verdict'); // from schema YAML
    expect(prompt).toContain('unknown` verdicts dominate');
    expect(prompt).toContain('prefer `manual`');
  });

  it('parses retry verdict correctly', async () => {
    const retryOutput = `<recovery verdict="retry" confidence="high">
  <rationale>Network timeout — transient failure.</rationale>
  <completedWork></completedWork>
  <remainingWork><item>All work remains</item></remainingWork>
  <risks><item>Network may timeout again</item></risks>
</recovery>`;
    const backend = new StubHarness([{ text: retryOutput }]);
    const cwd = makeTempDir();

    const events = await collectEvents(runRecoveryAnalyst({
      harness: backend,
      prdId: 'test-prd',
      prdContent: '# PRD',
      summary: makeSummary(),
      cwd,
    }));

    const complete = findEvent(events, 'recovery:complete');
    expect(complete).toBeDefined();
    expect(complete!.verdict.verdict).toBe('retry');
  });

  it('parses abandon verdict correctly', async () => {
    const abandonOutput = `<recovery verdict="abandon" confidence="high">
  <rationale>Already shipped via hotfix.</rationale>
  <completedWork><item>Shipped via hotfix</item></completedWork>
  <remainingWork></remainingWork>
  <risks></risks>
</recovery>`;
    const backend = new StubHarness([{ text: abandonOutput }]);
    const cwd = makeTempDir();

    const events = await collectEvents(runRecoveryAnalyst({
      harness: backend,
      prdId: 'test-prd',
      prdContent: '# PRD',
      summary: makeSummary(),
      cwd,
    }));

    const complete = findEvent(events, 'recovery:complete');
    expect(complete!.verdict.verdict).toBe('abandon');
  });

  it('parses manual verdict correctly', async () => {
    const manualOutput = `<recovery verdict="manual" confidence="low">
  <rationale>Ambiguous error with no clear cause.</rationale>
  <completedWork></completedWork>
  <remainingWork><item>All work remains</item></remainingWork>
  <risks><item>Unknown root cause</item></risks>
</recovery>`;
    const backend = new StubHarness([{ text: manualOutput }]);
    const cwd = makeTempDir();

    const events = await collectEvents(runRecoveryAnalyst({
      harness: backend,
      prdId: 'test-prd',
      prdContent: '# PRD',
      summary: makeSummary(),
      cwd,
    }));

    const complete = findEvent(events, 'recovery:complete');
    expect(complete!.verdict.verdict).toBe('manual');
  });

  // --- eforge:region plan-01-recovery-summary-reconstruction ---
  it('parses recovery block from agent:result.resultText when no agent:message content is emitted', async () => {
    // StubHarness constructed with { resultText } only (no text field) emits agent:result
    // with resultText but does NOT emit any agent:message events.
    // The current implementation accumulates only agent:message content and will produce
    // a recovery:error. After the fix, resultText is used as a fallback parse buffer.
    const backend = new StubHarness([{ resultText: SPLIT_OUTPUT }]);
    const cwd = makeTempDir();

    const events = await collectEvents(runRecoveryAnalyst({
      harness: backend,
      prdId: 'test-prd',
      prdContent: '# PRD',
      summary: makeSummary(),
      cwd,
    }));

    // The stub emits no agent:message — verify the test isolation is correct
    expect(filterEvents(events, 'agent:message')).toHaveLength(0);

    // Should successfully parse the split verdict from resultText
    const complete = findEvent(events, 'recovery:complete');
    expect(complete).toBeDefined();
    expect(complete!.verdict.verdict).toBe('split');
    expect(complete!.prdId).toBe('test-prd');

    // No recovery:error should be emitted when resultText fallback succeeds
    expect(findEvent(events, 'recovery:error')).toBeUndefined();
  });
  // --- eforge:endregion plan-01-recovery-summary-reconstruction ---
});

// ---------------------------------------------------------------------------
// EforgeEngine.recover (integration)
// ---------------------------------------------------------------------------

describe('EforgeEngine.recover', () => {
  const makeTempDir = useTempDir('eforge-engine-recover-test-');

  function seedGitRepo(dir: string): void {
    const gitOpts = { cwd: dir };
    execFileSync('git', ['init', '-b', 'main'], gitOpts);
    execFileSync('git', ['config', 'user.email', 'test@example.com'], gitOpts);
    execFileSync('git', ['config', 'user.name', 'Test'], gitOpts);
    execFileSync('git', ['commit', '--allow-empty', '-m', 'chore: initial commit'], gitOpts);
    execFileSync('git', ['checkout', '-b', 'eforge/test-recovery-set'], gitOpts);
    execFileSync('git', ['commit', '--allow-empty', '-m', 'feat: plan-01 foundation'], gitOpts);
    execFileSync('git', ['checkout', 'main'], gitOpts);
  }

  async function seedFixtures(dir: string): Promise<void> {
    // Write PRD file in failed dir
    const failedDir = join(dir, '.eforge', 'queue', 'failed');
    await mkdir(failedDir, { recursive: true });
    await writeFile(join(failedDir, 'test-prd.md'), '# Test PRD\n\nBuild a thing.', 'utf-8');
  }

  const SPLIT_OUTPUT = `Based on my analysis:

<recovery verdict="split" confidence="medium">
  <rationale>Foundation work is preserved; API work remains incomplete.</rationale>
  <completedWork>
    <item>Foundation merged</item>
  </completedWork>
  <remainingWork>
    <item>API endpoints not implemented</item>
  </remainingWork>
  <risks>
    <item>Type error unresolved</item>
  </risks>
  <suggestedSuccessorPrd># Successor PRD\n\nContinue the API work.</suggestedSuccessorPrd>
</recovery>`;

  it('writes degraded sidecar when PRD file does not exist (no throw)', async () => {
    const dir = makeTempDir();
    seedGitRepo(dir);
    // PRD file intentionally absent

    const backend = new StubHarness([{ text: SPLIT_OUTPUT }]);
    const engine = await EforgeEngine.create({ cwd: dir, agentRuntimes: backend });

    // Should NOT throw — degraded sidecar with partial:true is written instead
    const events = await collectEvents(engine.recover('test-recovery-set', 'test-prd'));

    const complete = findEvent(events, 'recovery:complete');
    expect(complete).toBeDefined();
    expect(complete!.verdict.verdict).toBe('manual');
    expect(complete!.verdict.partial).toBe(true);
    expect(complete!.verdict.recoveryError).toContain('not found');
  });

  it('writes both sidecar files for a split verdict', async () => {
    const dir = makeTempDir();
    seedGitRepo(dir);
    await seedFixtures(dir);

    const backend = new StubHarness([{ text: SPLIT_OUTPUT }]);
    const engine = await EforgeEngine.create({ cwd: dir, agentRuntimes: backend });

    const events = await collectEvents(engine.recover('test-recovery-set', 'test-prd'));

    const complete = findEvent(events, 'recovery:complete');
    expect(complete).toBeDefined();
    expect(complete!.sidecarMdPath).toBeDefined();
    expect(complete!.sidecarJsonPath).toBeDefined();

    // Both files must exist and be well-formed
    const mdContent = await readFile(complete!.sidecarMdPath!, 'utf-8');
    expect(mdContent.length).toBeGreaterThan(0);

    const parsed = JSON.parse(await readFile(complete!.sidecarJsonPath!, 'utf-8'));
    expect(parsed.schemaVersion).toBe(2);
    expect(parsed.verdict.verdict).toBe('split');
  });

  it('produces a manual verdict sidecar on parse failure (no throw)', async () => {
    const dir = makeTempDir();
    seedGitRepo(dir);
    await seedFixtures(dir);

    const backend = new StubHarness([{ text: 'I cannot determine the recovery path.' }]);
    const engine = await EforgeEngine.create({ cwd: dir, agentRuntimes: backend });

    // Should NOT throw — parse failure yields a manual verdict sidecar
    const events = await collectEvents(engine.recover('test-recovery-set', 'test-prd'));

    const complete = findEvent(events, 'recovery:complete');
    expect(complete).toBeDefined();
    expect(complete!.verdict.verdict).toBe('manual');
    expect(complete!.sidecarMdPath).toBeDefined();
    expect(complete!.sidecarJsonPath).toBeDefined();

    await expect(readFile(complete!.sidecarMdPath!, 'utf-8')).resolves.toBeTruthy();
    const json = JSON.parse(await readFile(complete!.sidecarJsonPath!, 'utf-8'));
    expect(json.verdict.verdict).toBe('manual');
    expect(json.schemaVersion).toBe(2);
  });

  it.each(['retry', 'split', 'abandon', 'manual'] as const)('writes sidecars for %s verdict', async (verdict) => {
    const dir = makeTempDir();
    seedGitRepo(dir);
    await seedFixtures(dir);

    let verdictOutput: string;
    if (verdict === 'split') {
      verdictOutput = SPLIT_OUTPUT;
    } else if (verdict === 'retry') {
      verdictOutput = `<recovery verdict="retry" confidence="high">
  <rationale>Network timeout — transient failure.</rationale>
  <completedWork></completedWork>
  <remainingWork><item>All work remains</item></remainingWork>
  <risks><item>Network may timeout again</item></risks>
</recovery>`;
    } else if (verdict === 'abandon') {
      verdictOutput = `<recovery verdict="abandon" confidence="high">
  <rationale>Already shipped via hotfix.</rationale>
  <completedWork><item>Shipped via hotfix</item></completedWork>
  <remainingWork></remainingWork>
  <risks></risks>
</recovery>`;
    } else {
      verdictOutput = `<recovery verdict="manual" confidence="low">
  <rationale>Ambiguous error with no clear cause.</rationale>
  <completedWork></completedWork>
  <remainingWork><item>All work remains</item></remainingWork>
  <risks><item>Unknown root cause</item></risks>
</recovery>`;
    }

    const backend = new StubHarness([{ text: verdictOutput }]);
    const engine = await EforgeEngine.create({ cwd: dir, agentRuntimes: backend });

    const events = await collectEvents(engine.recover('test-recovery-set', 'test-prd'));

    const complete = findEvent(events, 'recovery:complete');
    expect(complete).toBeDefined();
    expect(complete!.verdict.verdict).toBe(verdict);
    expect(complete!.sidecarMdPath).toBeDefined();
    expect(complete!.sidecarJsonPath).toBeDefined();

    const json = JSON.parse(await readFile(complete!.sidecarJsonPath!, 'utf-8'));
    expect(json.schemaVersion).toBe(2);
    expect(json.verdict.verdict).toBe(verdict);
  });

  it('emits recovery:start before recovery:complete', async () => {
    const dir = makeTempDir();
    seedGitRepo(dir);
    await seedFixtures(dir);

    const backend = new StubHarness([{ text: SPLIT_OUTPUT }]);
    const engine = await EforgeEngine.create({ cwd: dir, agentRuntimes: backend });

    const events = await collectEvents(engine.recover('test-recovery-set', 'test-prd'));

    const start = findEvent(events, 'recovery:start');
    expect(start).toBeDefined();
    expect(start!.prdId).toBe('test-prd');
    expect(start!.setName).toBe('test-recovery-set');

    const complete = findEvent(events, 'recovery:complete');
    expect(complete).toBeDefined();

    const startIdx = events.indexOf(start!);
    const completeIdx = events.indexOf(complete!);
    expect(startIdx).toBeLessThan(completeIdx);
  });

  it('does not modify files outside the two sidecar paths', async () => {
    const dir = makeTempDir();
    seedGitRepo(dir);
    await seedFixtures(dir);

    const failedDir = join(dir, '.eforge', 'queue', 'failed');
    const prdPath = join(failedDir, 'test-prd.md');

    const backend = new StubHarness([{ text: SPLIT_OUTPUT }]);
    const engine = await EforgeEngine.create({ cwd: dir, agentRuntimes: backend });

    // Capture PRD file content before
    const prdContentBefore = await readFile(prdPath, 'utf-8');

    await collectEvents(engine.recover('test-recovery-set', 'test-prd'));

    // PRD file unchanged
    const prdContentAfter = await readFile(prdPath, 'utf-8');
    expect(prdContentAfter).toBe(prdContentBefore);
  });
});
