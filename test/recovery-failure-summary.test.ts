// --- eforge:region recovery-failure-summary-suite ---
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
describe('buildFailureSummary', () => {
  const makeTempDir = useTempDir('eforge-recovery-summary-test-');
  function seedGitRepo(dir: string): void {
    const gitOpts = { cwd: dir };
    execFileSync('git', ['init', '-b', 'main'], gitOpts);
    execFileSync('git', ['config', 'user.email', 'test@example.com'], gitOpts);
    execFileSync('git', ['config', 'user.name', 'Test'], gitOpts);
    execFileSync('git', ['commit', '--allow-empty', '-m', 'chore: initial commit'], gitOpts);
    execFileSync('git', ['checkout', '-b', 'eforge/test-recovery-set'], gitOpts);
    execFileSync('git', ['commit', '--allow-empty', '-m', 'feat: plan-01 foundation\n\nModels-Used: claude-sonnet-4-6\n\nCo-Authored-By: forged-by-eforge <noreply@eforge.build>'], gitOpts);
    execFileSync('git', ['commit', '--allow-empty', '-m', 'wip: plan-02 api partial'], gitOpts);
    execFileSync('git', ['checkout', 'main'], gitOpts);
  }
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
    expect(summary.modelsUsed).toContain('claude-sonnet-4-6');
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
    expect(summary.baseBranch).toBe('main');
    expect(summary.featureBranch).toBe('eforge/test-recovery-set');
    expect(summary.prdId).toBe('test-prd');
    expect(summary.partial).toBeUndefined();
  });
  it('returns partial summary when no monitor DB events exist', async () => {
    const dir = makeTempDir();
    const summary = await buildFailureSummary({ setName: 'x', prdId: 'y', cwd: dir });
    expect(summary.partial).toBe(true);
    expect(summary.prdId).toBe('y');
    expect(summary.setName).toBe('x');
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
    const summary = await buildFailureSummary({
      setName: 'test-recovery-set',
      prdId: 'test-prd',
      cwd: dir,
    });
    expect(summary.partial).toBe(true);
    expect(summary.landedCommits.length).toBeGreaterThan(0);
    expect(summary.failedAt).toBe(summary.landedCommits[0].date);
    expect(summary.failedAt.length).toBeGreaterThan(0);
  });
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
    db.insertEvent({
      runId: 'run-acc-fail-01',
      type: landingEventType,
      data: landingEventType === 'landing:skipped'
        ? JSON.stringify({ type: 'landing:skipped', action: 'pr', reason: 'Build failed before landing could be attempted' })
        : JSON.stringify({ type: 'stack:landing:update', status: 'skipped', action: 'pr', reason: 'Build failed before landing could be attempted' }),
      timestamp: new Date('2024-02-01T11:25:00.000Z').toISOString(),
    });
    db.insertEvent({
      runId: 'run-acc-fail-01',
      type: 'phase:end',
      data: JSON.stringify({ type: 'phase:end', result: { status: 'failed', summary: 'Acceptance criteria validation failed: 2 unknown' } }),
      timestamp: phaseTs,
    });
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
    expect(summary.failingPlan.planId).not.toBe('unknown');
    expect(summary.failingPlan.planId).toBe('acceptance-validation');
    expect(summary.failedAt).toBe(new Date('2024-02-01T11:30:00.000Z').toISOString());
    expect(summary.terminalFailure).toBeDefined();
    expect(summary.terminalFailure!.stage).toBe('acceptance-validation');
    expect(summary.terminalFailure!.eventType).toBe('acceptance_validation:complete');
    expect(summary.acceptanceValidation).toBeDefined();
    expect(summary.acceptanceValidation!.passed).toBe(false);
    expect(summary.acceptanceValidation!.unknown).toBe(2);
    expect(summary.acceptanceValidation!.fail).toBe(0);
    expect(summary.acceptanceValidation!.pass).toBe(0);
    expect(summary.acceptanceValidation!.total).toBe(2);
    expect(summary.acceptanceValidation!.verdicts).toHaveLength(2);
    expect(summary.acceptanceValidation!.verdicts.every((v) => v.verdict === 'unknown')).toBe(true);
    expect(summary.validationCommands).toBeDefined();
    expect(summary.validationCommands!).toHaveLength(2);
    expect(summary.validationCommands!.find((c) => c.command === 'pnpm type-check')).toBeDefined();
    expect(summary.validationCommands!.find((c) => c.command === 'pnpm test')).toBeDefined();
    expect(summary.validationCommands!.find((c) => c.exitCode === 0)).toBeDefined();
    expect(summary.validationCommands!.find((c) => c.exitCode === 1)).toBeUndefined();
    expect(summary.validationCommands!.some((c) => c.output?.includes('stale type error'))).toBe(false);
    expect(summary.landing).toBeDefined();
    expect(summary.landing!.status).toBe('skipped');
    expect(summary.landing!.reason).toContain('Build failed before landing');
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
});
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
    const failingPlans = (summary as unknown as {
      failingPlans?: Array<{ planId: string; errorMessage?: string; terminalSubtype?: string }>;
    }).failingPlans;
    expect(failingPlans).toBeDefined();
    expect(failingPlans).toHaveLength(2);
    const failingPlanIds = failingPlans!.map((p) => p.planId);
    expect(failingPlanIds).toContain('plan-04-queue-view');
    expect(failingPlanIds).toContain('plan-06-static-serving-package-integration');
    const plan04Entry = failingPlans!.find((p) => p.planId === 'plan-04-queue-view');
    expect(plan04Entry!.errorMessage).toBe('API error 529: overloaded_error');
    expect(plan04Entry!.terminalSubtype).toBe('error_transient_transport');
    const plan06Entry = failingPlans!.find((p) => p.planId === 'plan-06-static-serving-package-integration');
    expect(plan06Entry!.errorMessage).toBe('API error 529: overloaded_error');
    expect(plan06Entry!.terminalSubtype).toBe('error_transient_transport');
    const plan04PlanEntry = summary.plans.find((p) => p.planId === 'plan-04-queue-view');
    expect(plan04PlanEntry).toBeDefined();
    expect(plan04PlanEntry!.error).toBe('API error 529: overloaded_error');
    expect(plan04PlanEntry!.terminalSubtype).toBe('error_transient_transport');
    const plan06PlanEntry = summary.plans.find((p) => p.planId === 'plan-06-static-serving-package-integration');
    expect(plan06PlanEntry).toBeDefined();
    expect(plan06PlanEntry!.error).toBe('API error 529: overloaded_error');
    expect(plan06PlanEntry!.terminalSubtype).toBe('error_transient_transport');
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
    const commitSha = (plan01 as unknown as { commitSha?: string }).commitSha;
    expect(commitSha).toBe('abc1234def5678901234567890abcdef12345678');
    expect(plan01!.mergedAt).toBe(new Date(new Date('2026-05-26T05:00:00.000Z').getTime() + 65_000).toISOString());
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
    const plan04Failing = failingPlans!.find((p) => p.planId === 'plan-04-queue-view');
    expect(plan04Failing).toBeDefined();
    expect(plan04Failing!.toolUseCount).toBe(3);
    const plan06Failing = failingPlans!.find((p) => p.planId === 'plan-06-static-serving-package-integration');
    expect(plan06Failing).toBeDefined();
    expect(plan06Failing!.toolUseCount ?? 0).toBe(0);
  });
  it('summary.plans entry for plan-04-queue-view includes toolUseCount: 3; plans without tool use omit toolUseCount', async () => {
    const dir = makeTempDir();
    seedGitRepo(dir);
    const dbPath = seedMultiPlanDb(dir);
    const summary = await buildFailureSummary({
      setName: 'multi-plan-set',
      prdId: 'multi-plan-prd',
      cwd: dir,
      dbPath,
    });
    const plan04 = (summary.plans as unknown as Array<{ planId: string; toolUseCount?: number }>)
      .find((p) => p.planId === 'plan-04-queue-view');
    expect(plan04).toBeDefined();
    expect(plan04!.toolUseCount).toBe(3);
    const plan01 = (summary.plans as unknown as Array<{ planId: string; toolUseCount?: number }>)
      .find((p) => p.planId === 'plan-01-console-shell');
    expect(plan01).toBeDefined();
    expect(plan01!.toolUseCount).toBeUndefined();
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
  it('plan:error:set enriches summary.plans error when no plan:build:failed row exists for the plan', async () => {
    const dir = makeTempDir();
    seedGitRepo(dir);
    const dbDir = join(dir, '.eforge');
    mkdirSync(dbDir, { recursive: true });
    const dbPath = join(dbDir, 'error-set-test.db');
    const db = openDatabase(dbPath);
    const baseTs = new Date('2026-06-01T10:00:00.000Z').getTime();
    db.insertRun({
      id: 'run-error-set-01',
      sessionId: 'session-es-01',
      planSet: 'error-set-test',
      command: 'build',
      status: 'failed',
      startedAt: new Date(baseTs).toISOString(),
      cwd: dir,
      pid: 99999,
    });
    db.insertEvent({
      runId: 'run-error-set-01',
      type: 'plan:status:change',
      planId: 'plan-A',
      data: JSON.stringify({ type: 'plan:status:change', planId: 'plan-A', status: 'failed' }),
      timestamp: new Date(baseTs + 1_000).toISOString(),
    });
    db.insertEvent({
      runId: 'run-error-set-01',
      type: 'plan:error:set',
      planId: 'plan-A',
      data: JSON.stringify({
        type: 'plan:error:set',
        planId: 'plan-A',
        error: 'Context window exceeded',
        terminalSubtype: 'error_context_limit',
      }),
      timestamp: new Date(baseTs + 2_000).toISOString(),
    });
    db.insertEvent({
      runId: 'run-error-set-01',
      type: 'plan:status:change',
      planId: 'plan-B',
      data: JSON.stringify({ type: 'plan:status:change', planId: 'plan-B', status: 'failed' }),
      timestamp: new Date(baseTs + 3_000).toISOString(),
    });
    db.insertEvent({
      runId: 'run-error-set-01',
      type: 'plan:error:set',
      planId: 'plan-B',
      data: JSON.stringify({
        type: 'plan:error:set',
        planId: 'plan-B',
        error: 'Error from plan:error:set',
      }),
      timestamp: new Date(baseTs + 4_000).toISOString(),
    });
    db.insertEvent({
      runId: 'run-error-set-01',
      type: 'plan:build:failed',
      planId: 'plan-B',
      data: JSON.stringify({
        type: 'plan:build:failed',
        planId: 'plan-B',
        error: 'Error from plan:build:failed',
        terminalSubtype: 'error_transient_transport',
      }),
      timestamp: new Date(baseTs + 5_000).toISOString(),
    });
    db.close();
    const summary = await buildFailureSummary({
      setName: 'error-set-test',
      prdId: 'error-set-prd',
      cwd: dir,
      dbPath,
    });
    const planA = summary.plans.find((p) => p.planId === 'plan-A');
    expect(planA).toBeDefined();
    expect(planA!.error).toBe('Context window exceeded');
    expect(planA!.terminalSubtype).toBe('error_context_limit');
    const planB = summary.plans.find((p) => p.planId === 'plan-B');
    expect(planB).toBeDefined();
    expect(planB!.error).toBe('Error from plan:build:failed');
    expect(planB!.terminalSubtype).toBe('error_transient_transport');
  });
  it('events from unrelated runs do not bleed into summary, and latest status per plan wins', async () => {
    const dir = makeTempDir();
    seedGitRepo(dir);
    const dbDir = join(dir, '.eforge');
    mkdirSync(dbDir, { recursive: true });
    const dbPath = join(dbDir, 'run-scoping-test.db');
    const db = openDatabase(dbPath);
    const baseTs = new Date('2026-06-01T10:00:00.000Z').getTime();
    db.insertRun({
      id: 'run-scope-target',
      sessionId: 'session-scope-01',
      planSet: 'run-scope-set',
      command: 'build',
      status: 'failed',
      startedAt: new Date(baseTs).toISOString(),
      cwd: dir,
      pid: 11111,
    });
    db.insertRun({
      id: 'run-scope-other',
      sessionId: 'session-scope-02',
      planSet: 'other-plan-set',
      command: 'build',
      status: 'failed',
      startedAt: new Date(baseTs - 100_000).toISOString(),
      cwd: dir,
      pid: 22222,
    });
    db.insertEvent({
      runId: 'run-scope-other',
      type: 'plan:status:change',
      planId: 'plan-X-unrelated',
      data: JSON.stringify({ type: 'plan:status:change', planId: 'plan-X-unrelated', status: 'merged' }),
      timestamp: new Date(baseTs - 50_000).toISOString(),
    });
    for (const status of ['pending', 'building', 'completed'] as const) {
      db.insertEvent({
        runId: 'run-scope-target',
        type: 'plan:status:change',
        planId: 'plan-alpha',
        data: JSON.stringify({ type: 'plan:status:change', planId: 'plan-alpha', status }),
        timestamp: new Date(baseTs + 1_000 + ['pending', 'building', 'completed'].indexOf(status) * 1_000).toISOString(),
      });
    }
    db.insertEvent({
      runId: 'run-scope-target',
      type: 'plan:status:change',
      planId: 'plan-beta',
      data: JSON.stringify({ type: 'plan:status:change', planId: 'plan-beta', status: 'failed' }),
      timestamp: new Date(baseTs + 4_000).toISOString(),
    });
    db.insertEvent({
      runId: 'run-scope-target',
      type: 'plan:build:failed',
      planId: 'plan-beta',
      data: JSON.stringify({ type: 'plan:build:failed', planId: 'plan-beta', error: 'Timed out' }),
      timestamp: new Date(baseTs + 5_000).toISOString(),
    });
    db.close();
    const summary = await buildFailureSummary({
      setName: 'run-scope-set',
      prdId: 'run-scope-prd',
      cwd: dir,
      dbPath,
    });
    const planIds = summary.plans.map((p) => p.planId);
    expect(planIds).not.toContain('plan-X-unrelated');
    expect(planIds).toContain('plan-alpha');
    expect(planIds).toContain('plan-beta');
    const planAlpha = summary.plans.find((p) => p.planId === 'plan-alpha');
    expect(planAlpha).toBeDefined();
    expect(planAlpha!.status).toBe('completed');
    const planBeta = summary.plans.find((p) => p.planId === 'plan-beta');
    expect(planBeta).toBeDefined();
    expect(planBeta!.status).toBe('failed');
  });
});
// --- eforge:endregion recovery-failure-summary-suite ---
