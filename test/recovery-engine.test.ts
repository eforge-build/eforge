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

    const failedDir = join(dir, '.eforge', 'queue', 'failed');
    await mkdir(failedDir, { recursive: true });
    await writeFile(join(failedDir, 'test-prd.md'), '# Test PRD\n\nBuild a thing.', 'utf-8');
  }

  const RETRY_OUTPUT = `Based on my analysis:

<recovery verdict="retry" confidence="medium">
  <rationale>Retry from scratch is safe; no preserved compiled artifacts are eligible.</rationale>
  <completedWork>
    <item>No durable work recorded</item>
  </completedWork>
  <remainingWork>
    <item>API endpoints not implemented</item>
  </remainingWork>
  <risks>
    <item>Timeout root cause unknown</item>
  </risks>
</recovery>`;

  it('writes degraded sidecar when PRD file does not exist (no throw)', async () => {
    const dir = makeTempDir();
    seedGitRepo(dir);


    const backend = new StubHarness([{ text: RETRY_OUTPUT }]);
    const engine = await EforgeEngine.create({ cwd: dir, agentRuntimes: backend });


    const events = await collectEvents(engine.recover('test-recovery-set', 'test-prd'));

    const complete = findEvent(events, 'recovery:complete');
    expect(complete).toBeDefined();
    expect(complete!.verdict.verdict).toBe('manual');
    expect(complete!.verdict.partial).toBe(true);
    expect(complete!.verdict.recoveryError).toContain('not found');
  });

  it('writes both sidecar files for a retry verdict', async () => {
    const dir = makeTempDir();
    seedGitRepo(dir);
    await seedFixtures(dir);

    const backend = new StubHarness([{ text: RETRY_OUTPUT }]);
    const engine = await EforgeEngine.create({ cwd: dir, agentRuntimes: backend });

    const events = await collectEvents(engine.recover('test-recovery-set', 'test-prd'));

    const complete = findEvent(events, 'recovery:complete');
    expect(complete).toBeDefined();
    expect(complete!.sidecarMdPath).toBeDefined();
    expect(complete!.sidecarJsonPath).toBeDefined();


    const mdContent = await readFile(complete!.sidecarMdPath!, 'utf-8');
    expect(mdContent.length).toBeGreaterThan(0);

    const parsed = JSON.parse(await readFile(complete!.sidecarJsonPath!, 'utf-8'));
    expect(parsed.schemaVersion).toBe(3);
    expect(parsed.verdict.verdict).toBe('retry');
  });

  it('produces a manual verdict sidecar on parse failure (no throw)', async () => {
    const dir = makeTempDir();
    seedGitRepo(dir);
    await seedFixtures(dir);

    const backend = new StubHarness([{ text: 'I cannot determine the recovery path.' }]);
    const engine = await EforgeEngine.create({ cwd: dir, agentRuntimes: backend });


    const events = await collectEvents(engine.recover('test-recovery-set', 'test-prd'));

    const complete = findEvent(events, 'recovery:complete');
    expect(complete).toBeDefined();
    expect(complete!.verdict.verdict).toBe('manual');
    expect(complete!.sidecarMdPath).toBeDefined();
    expect(complete!.sidecarJsonPath).toBeDefined();

    await expect(readFile(complete!.sidecarMdPath!, 'utf-8')).resolves.toBeTruthy();
    const json = JSON.parse(await readFile(complete!.sidecarJsonPath!, 'utf-8'));
    expect(json.verdict.verdict).toBe('manual');
    expect(json.schemaVersion).toBe(3);
  });

  it.each(['retry', 'abandon', 'manual'] as const)('writes sidecars for %s verdict', async (verdict) => {
    const dir = makeTempDir();
    seedGitRepo(dir);
    await seedFixtures(dir);

    let verdictOutput: string;
    if (verdict === 'retry') {
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
    expect(json.schemaVersion).toBe(3);
    expect(json.verdict.verdict).toBe(verdict);
  });

  it('emits recovery:start before recovery:complete', async () => {
    const dir = makeTempDir();
    seedGitRepo(dir);
    await seedFixtures(dir);

    const backend = new StubHarness([{ text: RETRY_OUTPUT }]);
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

    const backend = new StubHarness([{ text: RETRY_OUTPUT }]);
    const engine = await EforgeEngine.create({ cwd: dir, agentRuntimes: backend });


    const prdContentBefore = await readFile(prdPath, 'utf-8');

    await collectEvents(engine.recover('test-recovery-set', 'test-prd'));


    const prdContentAfter = await readFile(prdPath, 'utf-8');
    expect(prdContentAfter).toBe(prdContentBefore);
  });
});

describe('BuildFailureSummary schema: count fields reject negative and fractional values', () => {
  const validBaseSummary = {
    prdId: 'test-prd',
    setName: 'test-set',
    featureBranch: 'eforge/test-set',
    baseBranch: 'main',
    plans: [{ planId: 'plan-01', status: 'failed' }],
    failingPlan: { planId: 'plan-01' },
    landedCommits: [],
    diffStat: '',
    modelsUsed: [],
    failedAt: '2026-01-01T00:00:00.000Z',
  };

  function makeRecoverySummaryEvent(overridePlans: unknown[], overrideFailingPlan?: unknown) {
    return {
      type: 'recovery:summary' as const,
      timestamp: new Date().toISOString(),
      prdId: 'test-prd',
      summary: {
        ...validBaseSummary,
        plans: overridePlans,
        failingPlan: overrideFailingPlan ?? validBaseSummary.failingPlan,
      },
    };
  }

  it('accepts PlanSummaryEntry with valid zero testPassed and testFailed', () => {
    const event = makeRecoverySummaryEvent([
      { planId: 'plan-01', status: 'failed', testPassed: 0, testFailed: 0 },
    ]);
    expect(safeParseEforgeEvent(event).success).toBe(true);
  });

  it('accepts PlanSummaryEntry with valid positive testPassed and testFailed', () => {
    const event = makeRecoverySummaryEvent([
      { planId: 'plan-01', status: 'merged', testPassed: 42, testFailed: 3 },
    ]);
    expect(safeParseEforgeEvent(event).success).toBe(true);
  });

  it('rejects PlanSummaryEntry with negative testPassed', () => {
    const event = makeRecoverySummaryEvent([
      { planId: 'plan-01', status: 'merged', testPassed: -1, testFailed: 0 },
    ]);
    expect(safeParseEforgeEvent(event).success).toBe(false);
  });

  it('rejects PlanSummaryEntry with negative testFailed', () => {
    const event = makeRecoverySummaryEvent([
      { planId: 'plan-01', status: 'merged', testPassed: 5, testFailed: -2 },
    ]);
    expect(safeParseEforgeEvent(event).success).toBe(false);
  });

  it('rejects PlanSummaryEntry with fractional testPassed', () => {
    const event = makeRecoverySummaryEvent([
      { planId: 'plan-01', status: 'merged', testPassed: 1.5, testFailed: 0 },
    ]);
    expect(safeParseEforgeEvent(event).success).toBe(false);
  });

  it('rejects PlanSummaryEntry with fractional testFailed', () => {
    const event = makeRecoverySummaryEvent([
      { planId: 'plan-01', status: 'merged', testPassed: 10, testFailed: 0.7 },
    ]);
    expect(safeParseEforgeEvent(event).success).toBe(false);
  });

  it('accepts PlanSummaryEntry with valid zero toolUseCount', () => {
    const event = makeRecoverySummaryEvent([
      { planId: 'plan-01', status: 'failed', toolUseCount: 0 },
    ]);
    expect(safeParseEforgeEvent(event).success).toBe(true);
  });

  it('rejects PlanSummaryEntry with negative toolUseCount', () => {
    const event = makeRecoverySummaryEvent([
      { planId: 'plan-01', status: 'failed', toolUseCount: -5 },
    ]);
    expect(safeParseEforgeEvent(event).success).toBe(false);
  });

  it('rejects PlanSummaryEntry with fractional toolUseCount', () => {
    const event = makeRecoverySummaryEvent([
      { planId: 'plan-01', status: 'failed', toolUseCount: 2.5 },
    ]);
    expect(safeParseEforgeEvent(event).success).toBe(false);
  });

  it('accepts FailingPlanEntry with valid toolUseCount', () => {
    const event = makeRecoverySummaryEvent(
      [{ planId: 'plan-01', status: 'failed' }],
      { planId: 'plan-01', toolUseCount: 7 },
    );
    expect(safeParseEforgeEvent(event).success).toBe(true);
  });

  it('rejects FailingPlanEntry with negative toolUseCount', () => {
    const event = makeRecoverySummaryEvent(
      [{ planId: 'plan-01', status: 'failed' }],
      { planId: 'plan-01', toolUseCount: -1 },
    );
    expect(safeParseEforgeEvent(event).success).toBe(false);
  });

  it('rejects FailingPlanEntry with fractional toolUseCount', () => {
    const event = makeRecoverySummaryEvent(
      [{ planId: 'plan-01', status: 'failed' }],
      { planId: 'plan-01', toolUseCount: 0.5 },
    );
    expect(safeParseEforgeEvent(event).success).toBe(false);
  });
});

describe('EforgeEngine.recover() — deterministic verdict with all-transient failures', () => {
  const makeTempDir = useTempDir('eforge-deterministic-verdict-test-');

  function seedGitRepo(dir: string): void {
    const gitOpts = { cwd: dir };
    execFileSync('git', ['init', '-b', 'main'], gitOpts);
    execFileSync('git', ['config', 'user.email', 'test@example.com'], gitOpts);
    execFileSync('git', ['config', 'user.name', 'Test'], gitOpts);
    execFileSync('git', ['commit', '--allow-empty', '-m', 'chore: initial commit'], gitOpts);
  }





  function seedAllTransientNoCompletionDb(dir: string): string {
    const dbDir = join(dir, '.eforge');
    mkdirSync(dbDir, { recursive: true });
    const dbPath = join(dbDir, 'monitor.db');
    const db = openDatabase(dbPath);

    db.insertRun({
      id: 'run-deterministic-01',
      sessionId: 'session-det-01',
      planSet: 'deterministic-test-set',
      command: 'build',
      status: 'failed',
      startedAt: new Date('2026-05-26T05:00:00.000Z').toISOString(),
      cwd: dir,
      pid: 55555,
    });


    db.insertEvent({
      runId: 'run-deterministic-01',
      type: 'plan:status:change',
      planId: 'plan-01',
      data: JSON.stringify({ type: 'plan:status:change', planId: 'plan-01', status: 'failed' }),
      timestamp: new Date('2026-05-26T06:00:00.000Z').toISOString(),
    });
    db.insertEvent({
      runId: 'run-deterministic-01',
      type: 'plan:build:failed',
      planId: 'plan-01',
      data: JSON.stringify({
        type: 'plan:build:failed',
        planId: 'plan-01',
        error: 'API error 529: overloaded_error',
        terminalSubtype: 'error_transient_transport',
      }),
      timestamp: new Date('2026-05-26T06:00:00.000Z').toISOString(),
    });

    db.close();
    return dbPath;
  }





  function seedTransientWithCompletionDb(dir: string): string {
    const dbDir = join(dir, '.eforge');
    mkdirSync(dbDir, { recursive: true });
    const dbPath = join(dbDir, 'monitor.db');
    const db = openDatabase(dbPath);

    db.insertRun({
      id: 'run-det-preserved-01',
      sessionId: 'session-det-preserved-01',
      planSet: 'det-preserved-set',
      command: 'build',
      status: 'failed',
      startedAt: new Date('2026-05-26T05:00:00.000Z').toISOString(),
      cwd: dir,
      pid: 66666,
    });


    db.insertEvent({
      runId: 'run-det-preserved-01',
      type: 'plan:status:change',
      planId: 'plan-01',
      data: JSON.stringify({ type: 'plan:status:change', planId: 'plan-01', status: 'merged' }),
      timestamp: new Date('2026-05-26T05:30:00.000Z').toISOString(),
    });


    db.insertEvent({
      runId: 'run-det-preserved-01',
      type: 'plan:status:change',
      planId: 'plan-02',
      data: JSON.stringify({ type: 'plan:status:change', planId: 'plan-02', status: 'failed' }),
      timestamp: new Date('2026-05-26T06:15:00.000Z').toISOString(),
    });
    db.insertEvent({
      runId: 'run-det-preserved-01',
      type: 'plan:build:failed',
      planId: 'plan-02',
      data: JSON.stringify({
        type: 'plan:build:failed',
        planId: 'plan-02',
        error: 'API error 529: overloaded_error',
        terminalSubtype: 'error_transient_transport',
      }),
      timestamp: new Date('2026-05-26T06:15:00.000Z').toISOString(),
    });

    db.close();
    return dbPath;
  }

  it('produces retry verdict with recommendationSource=deterministic when analyst output is malformed and all failures are transient', async () => {
    const dir = makeTempDir();
    seedGitRepo(dir);


    const failedDir = join(dir, '.eforge', 'queue', 'failed');
    await mkdir(failedDir, { recursive: true });
    await writeFile(join(failedDir, 'deterministic-test-prd.md'), '# Test PRD\n\nBuild something.', 'utf-8');


    seedAllTransientNoCompletionDb(dir);


    const stub = new StubHarness([{ text: 'This cannot be parsed as a recovery verdict.' }]);
    const engine = await EforgeEngine.create({ cwd: dir, agentRuntimes: stub });

    const events: EforgeEvent[] = [];
    for await (const event of engine.recover('deterministic-test-set', 'deterministic-test-prd')) {
      events.push(event);
    }

    const complete = events.find(e => e.type === 'recovery:complete') as Extract<EforgeEvent, { type: 'recovery:complete' }> | undefined;
    expect(complete).toBeDefined();
    expect(complete!.sidecarJsonPath).toBeDefined();

    const sidecarContent = JSON.parse(await readFile(complete!.sidecarJsonPath!, 'utf-8'));

    expect(sidecarContent.verdict.verdict).toBe('retry');

    expect(sidecarContent.verdict.recommendationSource).toBe('deterministic');

    expect(typeof sidecarContent.verdict.rationale).toBe('string');
    expect(sidecarContent.verdict.rationale.length).toBeGreaterThan(0);
  });

  it('produces deterministic retry verdict with recoveryError when analyst throws during recovery', async () => {
    const dir = makeTempDir();
    seedGitRepo(dir);

    const failedDir = join(dir, '.eforge', 'queue', 'failed');
    await mkdir(failedDir, { recursive: true });
    await writeFile(join(failedDir, 'thrown-analyst-prd.md'), '# Test PRD\n\nBuild something.', 'utf-8');


    seedAllTransientNoCompletionDb(dir);


    const thrownError = new Error('Simulated analyst agent crash: connection reset');
    const stub = new StubHarness([{ error: thrownError }]);
    const engine = await EforgeEngine.create({ cwd: dir, agentRuntimes: stub });

    const events: EforgeEvent[] = [];
    for await (const event of engine.recover('deterministic-test-set', 'thrown-analyst-prd')) {
      events.push(event);
    }

    const complete = events.find(e => e.type === 'recovery:complete') as Extract<EforgeEvent, { type: 'recovery:complete' }> | undefined;
    expect(complete).toBeDefined();
    expect(complete!.sidecarJsonPath).toBeDefined();

    const sidecarContent = JSON.parse(await readFile(complete!.sidecarJsonPath!, 'utf-8'));

    expect(sidecarContent.verdict.verdict).toBe('retry');

    expect(sidecarContent.verdict.recommendationSource).toBe('deterministic');

    expect(typeof sidecarContent.verdict.recoveryError).toBe('string');
    expect(sidecarContent.verdict.recoveryError.length).toBeGreaterThan(0);
  });

  it('produces manual verdict with recommendationSource=manual-fallback when preserved work is not eligible for continue-repair', async () => {
    const dir = makeTempDir();
    seedGitRepo(dir);

    const failedDir = join(dir, '.eforge', 'queue', 'failed');
    await mkdir(failedDir, { recursive: true });
    await writeFile(join(failedDir, 'det-preserved-prd.md'), '# Test PRD\n\nBuild something.', 'utf-8');


    seedTransientWithCompletionDb(dir);


    const stub = new StubHarness([{ text: 'No recovery verdict here.' }]);
    const engine = await EforgeEngine.create({ cwd: dir, agentRuntimes: stub });

    const events: EforgeEvent[] = [];
    for await (const event of engine.recover('det-preserved-set', 'det-preserved-prd')) {
      events.push(event);
    }

    const complete = events.find(e => e.type === 'recovery:complete') as Extract<EforgeEvent, { type: 'recovery:complete' }> | undefined;
    expect(complete).toBeDefined();
    expect(complete!.sidecarJsonPath).toBeDefined();

    const sidecarContent = JSON.parse(await readFile(complete!.sidecarJsonPath!, 'utf-8'));

    expect(sidecarContent.verdict.verdict).toBe('manual');
    expect(sidecarContent.verdict.recommendationSource).toBe('manual-fallback');
    expect(sidecarContent.verdict.recommendationRationale).toMatch(/manual|continue-and-repair/i);
  });

  it('sidecar JSON records recommendationSource for analyst-validated path', async () => {
    const dir = makeTempDir();
    seedGitRepo(dir);

    const failedDir = join(dir, '.eforge', 'queue', 'failed');
    await mkdir(failedDir, { recursive: true });
    await writeFile(join(failedDir, 'analyst-validated-prd.md'), '# Test PRD\n\nBuild something.', 'utf-8');


    seedAllTransientNoCompletionDb(dir);


    const validAnalystOutput = `Based on my analysis:

<recovery verdict="retry" confidence="high">
  <rationale>plan-01 failed due to API error 529: overloaded_error — a transient transport failure. No tool calls were executed.</rationale>
  <completedWork></completedWork>
  <remainingWork><item>plan-01 needs retry</item></remainingWork>
  <risks><item>API may be temporarily overloaded</item></risks>
</recovery>`;

    const stub = new StubHarness([{ text: validAnalystOutput }]);
    const engine = await EforgeEngine.create({ cwd: dir, agentRuntimes: stub });

    const events: EforgeEvent[] = [];
    for await (const event of engine.recover('deterministic-test-set', 'analyst-validated-prd')) {
      events.push(event);
    }

    const complete = events.find(e => e.type === 'recovery:complete') as Extract<EforgeEvent, { type: 'recovery:complete' }> | undefined;
    expect(complete).toBeDefined();
    expect(complete!.sidecarJsonPath).toBeDefined();

    const sidecarContent = JSON.parse(await readFile(complete!.sidecarJsonPath!, 'utf-8'));
    expect(sidecarContent.verdict.verdict).toBe('retry');

    expect(sidecarContent.verdict.recommendationSource).toBe('analyst');

    expect(sidecarContent.verdict.verdictInvalidationReason).toBeUndefined();
  });

  it('sidecar Markdown displays verdict source when present', async () => {
    const dir = makeTempDir();
    seedGitRepo(dir);

    const failedDir = join(dir, '.eforge', 'queue', 'failed');
    await mkdir(failedDir, { recursive: true });
    await writeFile(join(failedDir, 'md-source-test-prd.md'), '# Test PRD\n\nBuild something.', 'utf-8');


    seedAllTransientNoCompletionDb(dir);


    const stub = new StubHarness([{ text: 'Not a valid verdict.' }]);
    const engine = await EforgeEngine.create({ cwd: dir, agentRuntimes: stub });

    const events: EforgeEvent[] = [];
    for await (const event of engine.recover('deterministic-test-set', 'md-source-test-prd')) {
      events.push(event);
    }

    const complete = events.find(e => e.type === 'recovery:complete') as Extract<EforgeEvent, { type: 'recovery:complete' }> | undefined;
    expect(complete).toBeDefined();
    expect(complete!.sidecarMdPath).toBeDefined();

    const md = await readFile(complete!.sidecarMdPath!, 'utf-8');

    expect(md).toContain('**Verdict Source:** deterministic');

    expect(md).toMatch(/All failed plans .*error_transient_transport.*zero tool use/i);
  });

  it('sidecar JSON records verdictInvalidationReason when analyst verdict fails invariant check', async () => {
    const dir = makeTempDir();
    seedGitRepo(dir);


    const dbDir = join(dir, '.eforge');
    mkdirSync(dbDir, { recursive: true });
    const dbPath = join(dbDir, 'monitor.db');
    const db = openDatabase(dbPath);

    db.insertRun({
      id: 'run-invalidation-01',
      sessionId: 'session-inv-01',
      planSet: 'invalidation-set',
      command: 'build',
      status: 'failed',
      startedAt: new Date('2026-05-26T05:00:00.000Z').toISOString(),
      cwd: dir,
      pid: 77777,
    });
    for (const planId of ['plan-01-alpha', 'plan-02-beta']) {
      db.insertEvent({
        runId: 'run-invalidation-01',
        type: 'plan:status:change',
        planId,
        data: JSON.stringify({ type: 'plan:status:change', planId, status: 'failed' }),
        timestamp: new Date('2026-05-26T06:15:00.000Z').toISOString(),
      });
      db.insertEvent({
        runId: 'run-invalidation-01',
        type: 'plan:build:failed',
        planId,
        data: JSON.stringify({
          type: 'plan:build:failed',
          planId,
          error: 'API error 529: overloaded_error',
          terminalSubtype: 'error_transient_transport',
        }),
        timestamp: new Date('2026-05-26T06:15:00.000Z').toISOString(),
      });
    }
    db.close();

    const failedDir = join(dir, '.eforge', 'queue', 'failed');
    await mkdir(failedDir, { recursive: true });
    await writeFile(join(failedDir, 'invalidation-prd.md'), '# Test PRD\n\nBuild something.', 'utf-8');


    const incompleteAnalystOutput = `<recovery verdict="retry" confidence="high">
  <rationale>plan-02-beta failed due to API error 529 transient error. No tool calls were made.</rationale>
  <completedWork></completedWork>
  <remainingWork><item>plan-02-beta needs retry</item></remainingWork>
  <risks></risks>
</recovery>`;

    const stub = new StubHarness([{ text: incompleteAnalystOutput }]);
    const engine = await EforgeEngine.create({ cwd: dir, agentRuntimes: stub });

    const events: EforgeEvent[] = [];
    for await (const event of engine.recover('invalidation-set', 'invalidation-prd')) {
      events.push(event);
    }

    const complete = events.find(e => e.type === 'recovery:complete') as Extract<EforgeEvent, { type: 'recovery:complete' }> | undefined;
    expect(complete).toBeDefined();
    expect(complete!.sidecarJsonPath).toBeDefined();

    const sidecarContent = JSON.parse(await readFile(complete!.sidecarJsonPath!, 'utf-8'));

    expect(sidecarContent.verdict.verdictInvalidationReason).toBeTruthy();
    expect(String(sidecarContent.verdict.verdictInvalidationReason)).toMatch(/plan-01-alpha/i);
  });
});
