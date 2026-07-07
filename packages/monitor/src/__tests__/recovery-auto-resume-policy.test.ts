import { describe, expect, it, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { DEFAULT_CONFIG, type EforgeConfig } from '@eforge-build/engine/config';
import { computeWorktreeBase } from '@eforge-build/engine/worktree-ops';
import { safeParseEforgeEvent, type EforgeEvent } from '@eforge-build/client';
import { openDatabase, type MonitorDB } from '../db.js';
import { evaluateGuardedRecoveryAutoResume } from '../recovery-auto-resume.js';
import type { MonitorContext } from '../context.js';

const tempDirs: string[] = [];
const openDbs: MonitorDB[] = [];

afterEach(async () => {
  while (openDbs.length > 0) openDbs.pop()?.close();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function initGitRepo(cwd: string): void {
  execFileSync('git', ['init', '-b', 'main'], { cwd });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd });
  execFileSync('git', ['commit', '--allow-empty', '-m', 'initial'], { cwd });
  execFileSync('git', ['status', '--porcelain'], { cwd });
}

function makeConfig(autoResume: Partial<EforgeConfig['recovery']['autoResume']>): EforgeConfig {
  return {
    ...DEFAULT_CONFIG,
    recovery: {
      autoResume: {
        ...DEFAULT_CONFIG.recovery.autoResume,
        ...autoResume,
      },
    },
  };
}

async function seedFailedRecoveryFixture(
  cwd: string,
  prdId: string,
  options: {
    verdict?: 'continue-repair' | 'manual' | 'retry' | 'abandon';
    confidence?: 'high' | 'medium' | 'low';
    partial?: boolean;
    eligible?: boolean;
    held?: boolean;
    appliedAction?: string;
    autoResume?: Record<string, unknown>;
    errorMessage?: string;
    diffStat?: string;
    landedCommitSha?: string;
  } = {},
): Promise<void> {
  const failedDir = join(cwd, '.eforge', 'queue', 'failed');
  await mkdir(failedDir, { recursive: true });
  await writeFile(join(cwd, '.gitignore'), '.eforge/\n', 'utf-8');
  const holdFrontmatter = options.held === true ? 'held: true\nhold_reason: Awaiting approval\n' : '';
  await writeFile(
    join(failedDir, `${prdId}.md`),
    `---\ntitle: ${prdId}\ncreated: 2026-01-01\n${holdFrontmatter}---\n\n# ${prdId}\n`,
    'utf-8',
  );

  const setName = `${prdId}-set`;
  const verdict = options.verdict ?? 'continue-repair';
  const confidence = options.confidence ?? 'high';
  const failedAt = '2026-01-01T00:00:00.000Z';
  const sidecar: Record<string, unknown> = {
    schemaVersion: 3,
    generatedAt: failedAt,
    prdId,
    setName,
    verdict: {
      verdict,
      confidence,
      rationale: 'Test recovery verdict.',
      completedWork: [],
      remainingWork: [],
      risks: [],
    },
    report: {
      operatorSummary: 'Test recovery report.',
      recommendedAction: 'Use the test recommendation.',
      keyEvidence: [],
      completedWork: [],
      remainingWork: [],
      risks: [],
    },
    boundedEvidence: {
      identity: {
        prdId,
        setName,
        featureBranch: `eforge/${setName}`,
        baseBranch: 'main',
        failedAt,
        ...(options.partial === true ? { partial: true } : {}),
      },
      plans: [{ planId: 'plan-01', status: 'failed', error: options.errorMessage ?? 'Type error' }],
      failingPlan: { planId: 'plan-01', errorMessage: options.errorMessage ?? 'Type error', terminalSubtype: 'validation' },
      landedCommits: options.landedCommitSha
        ? [{ sha: options.landedCommitSha, subject: 'progress', author: 'Test', date: failedAt }]
        : [],
      modelsUsed: [],
      diffStat: options.diffStat ?? '',
      terminalFailure: { stage: 'validation', message: options.errorMessage ?? 'Type error' },
    },
    continueRepairEligibility: options.eligible === false
      ? {
          source: 'continueRepairEligibility',
          eligible: false,
          featureBranch: `eforge/${setName}`,
          reason: 'No compiled artifacts are available.',
        }
      : {
          source: 'continueRepairEligibility',
          eligible: true,
          featureBranch: `eforge/${setName}`,
          artifactAvailability: 'feature-branch',
          landedCommitCount: options.landedCommitSha ? 1 : 0,
          diffStat: options.diffStat ?? '',
        },
    ...(options.appliedAction !== undefined ? { applied: { action: options.appliedAction, appliedAt: failedAt } } : {}),
    ...(options.autoResume !== undefined ? { autoResume: options.autoResume } : {}),
  };
  await writeFile(join(failedDir, `${prdId}.recovery.json`), `${JSON.stringify(sidecar, null, 2)}\n`, 'utf-8');
  await writeFile(join(failedDir, `${prdId}.recovery.md`), '## Recovery Report\n', 'utf-8');
  execFileSync('git', ['add', '.gitignore'], { cwd });
  execFileSync('git', ['commit', '-m', 'ignore eforge runtime state'], { cwd });
}

async function makeHarness(options: { config?: EforgeConfig; prdId?: string } = {}): Promise<{ cwd: string; db: MonitorDB; context: MonitorContext; wakeReasons: string[]; mutationReasons: string[] }> {
  const root = await makeTempDir('eforge-auto-resume-policy-');
  const cwd = join(root, 'repo');
  await mkdir(cwd, { recursive: true });
  initGitRepo(cwd);
  const db = openDatabase(join(root, 'monitor.db'));
  openDbs.push(db);
  const config = options.config ?? makeConfig({ enabled: true, maxAttempts: 1 });
  const wakeReasons: string[] = [];
  const mutationReasons: string[] = [];
  const context = {
    db,
    preferredPort: 0,
    cwd,
    options: {
      cwd,
      config,
      daemonSessionId: 'daemon-test',
      daemonState: { autoBuildController: { resumeScheduler(reason: string) { wakeReasons.push(reason); }, notifyQueueMutation(reason: string) { mutationReasons.push(reason); } } },
    },
    queuePaths: {
      relativeQueueDir: '.eforge/queue',
      queueDir: resolve(cwd, '.eforge/queue'),
      lockDir: resolve(cwd, '.eforge/queue-locks'),
      failedDir: resolve(cwd, '.eforge/queue/failed'),
      skippedDir: resolve(cwd, '.eforge/queue/skipped'),
      waitingDir: resolve(cwd, '.eforge/queue/waiting'),
    },
    notifyQueueMutation(reason: string) { mutationReasons.push(reason); },
  } as unknown as MonitorContext;
  return { cwd, db, context, wakeReasons, mutationReasons };
}

function daemonEvents(db: MonitorDB): EforgeEvent[] {
  return db.getDaemonEventsAfter(0).map((row) => JSON.parse(row.data) as EforgeEvent);
}

async function expectStoppedWithoutMutation(args: { cwd: string; db: MonitorDB; mutationReasons: string[]; wakeReasons: string[]; prdId: string; before: string; reason: string; attempt: number; maxAttempts: number }): Promise<void> {
  await expect(readFile(join(args.cwd, '.eforge/queue', `${args.prdId}.md`), 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await readFile(join(args.cwd, '.eforge/queue/failed', `${args.prdId}.recovery.json`), 'utf-8')).toBe(args.before);
  expect(args.mutationReasons).toEqual([]);
  expect(args.wakeReasons).toEqual([]);
  const stopped = daemonEvents(args.db).at(-1);
  expect(stopped).toMatchObject({ type: 'recovery:auto-resume:stopped', reason: args.reason, attempt: args.attempt, maxAttempts: args.maxAttempts, prdId: args.prdId });
  expect(safeParseEforgeEvent(stopped).success).toBe(true);
}

async function writeCompiledArtifactsOnFeatureBranch(cwd: string, setName: string): Promise<void> {
  execFileSync('git', ['switch', '-c', `eforge/${setName}`], { cwd });
  await mkdir(join(cwd, 'eforge', 'plans', setName), { recursive: true });
  await writeFile(join(cwd, 'eforge', 'plans', setName, 'orchestration.yaml'), `name: ${setName}
description: Auto-resume policy fixture
base_branch: main
mode: excursion
validate: []
plans:
  - id: plan-01
    name: Plan 01
    depends_on: []
    branch: ${setName}/plan-01
    build:
      - implement
    review:
      strategy: auto
      perspectives:
        - code
      maxRounds: 1
      evaluatorStrictness: standard
pipeline:
  scope: excursion
  compile: []
  defaultBuild: []
  defaultReview:
    strategy: auto
    perspectives:
      - code
    maxRounds: 1
    evaluatorStrictness: standard
  rationale: auto-resume test
`, 'utf-8');
  await writeFile(join(cwd, 'eforge', 'plans', setName, 'plan-01.md'), `---
id: plan-01
name: Plan 01
---

# Plan 01
`, 'utf-8');
  execFileSync('git', ['add', 'eforge'], { cwd });
  execFileSync('git', ['commit', '-m', 'plan: compiled artifacts'], { cwd });
  execFileSync('git', ['switch', 'main'], { cwd });
}

async function writeCompiledArtifactsOnlyInBranchHistory(cwd: string, setName: string): Promise<void> {
  await writeCompiledArtifactsOnFeatureBranch(cwd, setName);
  execFileSync('git', ['switch', `eforge/${setName}`], { cwd });
  await rm(join(cwd, 'eforge', 'plans', setName), { recursive: true, force: true });
  execFileSync('git', ['add', '-A', 'eforge'], { cwd });
  execFileSync('git', ['commit', '-m', 'plan: clean compiled artifacts at tip'], { cwd });
  execFileSync('git', ['switch', 'main'], { cwd });
}

async function writeCompiledArtifactsOnlyInMergeWorktree(cwd: string, setName: string): Promise<void> {
  execFileSync('git', ['switch', '-c', `eforge/${setName}`], { cwd });
  await writeFile(join(cwd, `${setName}-progress.txt`), 'progress\n', 'utf-8');
  execFileSync('git', ['add', `${setName}-progress.txt`], { cwd });
  execFileSync('git', ['commit', '-m', 'progress without compiled artifacts'], { cwd });
  execFileSync('git', ['switch', 'main'], { cwd });
  const mergeWorktreePath = join(computeWorktreeBase(cwd, setName), '__merge__');
  execFileSync('git', ['worktree', 'add', mergeWorktreePath, `eforge/${setName}`], { cwd });
  const artifactDir = join(mergeWorktreePath, 'eforge', 'plans', setName);
  await mkdir(artifactDir, { recursive: true });
  await writeFile(join(artifactDir, 'orchestration.yaml'), `name: ${setName}
description: Merge worktree auto-resume fixture
base_branch: main
mode: excursion
validate: []
plans:
  - id: plan-01
    name: Plan 01
    depends_on: []
    branch: ${setName}/plan-01
    build:
      - implement
    review:
      strategy: auto
      perspectives:
        - code
      maxRounds: 1
      evaluatorStrictness: standard
pipeline:
  scope: excursion
  compile: []
  defaultBuild: []
  defaultReview:
    strategy: auto
    perspectives:
      - code
    maxRounds: 1
    evaluatorStrictness: standard
  rationale: auto-resume merge worktree test
`, 'utf-8');
  await writeFile(join(artifactDir, 'plan-01.md'), `---
id: plan-01
name: Plan 01
---

# Plan 01
`, 'utf-8');
  execFileSync('git', ['add', 'eforge'], { cwd: mergeWorktreePath });
  execFileSync('git', ['commit', '-m', 'merge worktree compiled artifacts'], { cwd: mergeWorktreePath });
}

describe('evaluateGuardedRecoveryAutoResume', () => {
  it('keeps default-off failures non-mutating and does not emit auto-resume audit events', async () => {
    const { cwd, db, context } = await makeHarness({ config: makeConfig({ enabled: false, maxAttempts: 1 }) });
    await seedFailedRecoveryFixture(cwd, 'default-off');

    const before = await readFile(join(cwd, '.eforge/queue/failed/default-off.recovery.json'), 'utf-8');
    const outcome = await evaluateGuardedRecoveryAutoResume(context, 'default-off');
    const after = await readFile(join(cwd, '.eforge/queue/failed/default-off.recovery.json'), 'utf-8');

    expect(outcome).toEqual({ status: 'skipped-default-off' });
    expect(after).toBe(before);
    expect(daemonEvents(db)).toEqual([]);
  });

  it('stops without mutation when enabled policy has no remaining budget', async () => {
    const { cwd, db, context, mutationReasons, wakeReasons } = await makeHarness({ config: makeConfig({ enabled: true, maxAttempts: 0 }) });
    await seedFailedRecoveryFixture(cwd, 'audit-only');
    const before = await readFile(join(cwd, '.eforge/queue/failed/audit-only.recovery.json'), 'utf-8');

    const outcome = await evaluateGuardedRecoveryAutoResume(context, 'audit-only');

    expect(outcome).toMatchObject({ status: 'stopped', reason: 'attempt-budget-exhausted', attempt: 0 });
    const events = daemonEvents(db);
    expect(events.map((event) => event.type)).toEqual(['recovery:auto-resume:evaluate', 'recovery:auto-resume:stopped']);
    for (const event of events) expect(safeParseEforgeEvent(event).success).toBe(true);
    await expectStoppedWithoutMutation({ cwd, db, mutationReasons, wakeReasons, prdId: 'audit-only', before, reason: 'attempt-budget-exhausted', attempt: 0, maxAttempts: 0 });
  });

  it('stops without mutation when persisted attempts already exhaust a positive budget', async () => {
    const { cwd, db, context, mutationReasons, wakeReasons } = await makeHarness({ config: makeConfig({ enabled: true, maxAttempts: 1 }) });
    await seedFailedRecoveryFixture(cwd, 'prior-budget', { autoResume: { attempts: 1, lastProgressMarker: 'p', lastFailureSignature: 'f' } });
    const before = await readFile(join(cwd, '.eforge/queue/failed/prior-budget.recovery.json'), 'utf-8');

    const outcome = await evaluateGuardedRecoveryAutoResume(context, 'prior-budget');

    expect(outcome).toMatchObject({ status: 'stopped', reason: 'attempt-budget-exhausted', attempt: 1 });
    await expectStoppedWithoutMutation({ cwd, db, mutationReasons, wakeReasons, prdId: 'prior-budget', before, reason: 'attempt-budget-exhausted', attempt: 1, maxAttempts: 1 });
  });

  it('maps manual, retry, and abandon verdicts to a manual-confirmation-required stop', async () => {
    for (const verdict of ['manual', 'retry', 'abandon'] as const) {
      const { cwd, db, context } = await makeHarness();
      const prdId = `stop-${verdict}`;
      await seedFailedRecoveryFixture(cwd, prdId, { verdict });

      const outcome = await evaluateGuardedRecoveryAutoResume(context, prdId);

      expect(outcome).toMatchObject({ status: 'stopped', reason: 'manual-confirmation-required', attempt: 0 });
      expect(daemonEvents(db).at(-1)).toMatchObject({ type: 'recovery:auto-resume:stopped', reason: 'manual-confirmation-required' });
    }
  });

  it('stops low or medium confidence recommendations before queue mutation', async () => {
    for (const confidence of ['low', 'medium'] as const) {
      const { cwd, db, context } = await makeHarness();
      const prdId = `confidence-${confidence}`;
      await seedFailedRecoveryFixture(cwd, prdId, { confidence });

      const outcome = await evaluateGuardedRecoveryAutoResume(context, prdId);

      expect(outcome).toMatchObject({ status: 'stopped', reason: 'not-high-confidence', attempt: 0 });
      expect(daemonEvents(db).at(-1)).toMatchObject({ reason: 'not-high-confidence' });
    }
  });

  it('stops partial sidecars and ineligible compiled artifacts with visible reasons', async () => {
    const partial = await makeHarness();
    await seedFailedRecoveryFixture(partial.cwd, 'partial-sidecar', { partial: true });
    expect(await evaluateGuardedRecoveryAutoResume(partial.context, 'partial-sidecar')).toMatchObject({ status: 'stopped', reason: 'partial-sidecar' });

    const partialVerdict = await makeHarness();
    await seedFailedRecoveryFixture(partialVerdict.cwd, 'partial-verdict');
    const partialVerdictPath = join(partialVerdict.cwd, '.eforge/queue/failed/partial-verdict.recovery.json');
    const partialVerdictSidecar = JSON.parse(await readFile(partialVerdictPath, 'utf-8')) as { verdict: { partial?: boolean } };
    partialVerdictSidecar.verdict.partial = true;
    await writeFile(partialVerdictPath, `${JSON.stringify(partialVerdictSidecar, null, 2)}\n`, 'utf-8');
    expect(await evaluateGuardedRecoveryAutoResume(partialVerdict.context, 'partial-verdict')).toMatchObject({ status: 'stopped', reason: 'partial-sidecar' });

    const ineligible = await makeHarness();
    await seedFailedRecoveryFixture(ineligible.cwd, 'ineligible-artifacts', { eligible: false });
    expect(await evaluateGuardedRecoveryAutoResume(ineligible.context, 'ineligible-artifacts')).toMatchObject({ status: 'stopped', reason: 'ineligible-artifacts' });
  });

  it('stops dirty worktrees, conflicting worktrees, held failed PRDs, and conflicting applied markers before queueing', async () => {
    const dirty = await makeHarness();
    await seedFailedRecoveryFixture(dirty.cwd, 'dirty-worktree');
    await writeFile(join(dirty.cwd, 'uncommitted.txt'), 'dirty', 'utf-8');
    expect(await evaluateGuardedRecoveryAutoResume(dirty.context, 'dirty-worktree')).toMatchObject({ status: 'stopped', reason: 'dirty-worktree' });

    const conflicting = await makeHarness();
    await seedFailedRecoveryFixture(conflicting.cwd, 'conflicting-worktree');
    await writeFile(join(conflicting.cwd, 'conflict.txt'), 'base\n', 'utf-8');
    execFileSync('git', ['add', 'conflict.txt'], { cwd: conflicting.cwd });
    execFileSync('git', ['commit', '-m', 'base conflict fixture'], { cwd: conflicting.cwd });
    execFileSync('git', ['switch', '-c', 'conflicting-side'], { cwd: conflicting.cwd });
    await writeFile(join(conflicting.cwd, 'conflict.txt'), 'side\n', 'utf-8');
    execFileSync('git', ['commit', '-am', 'side conflict fixture'], { cwd: conflicting.cwd });
    execFileSync('git', ['switch', 'main'], { cwd: conflicting.cwd });
    await writeFile(join(conflicting.cwd, 'conflict.txt'), 'main\n', 'utf-8');
    execFileSync('git', ['commit', '-am', 'main conflict fixture'], { cwd: conflicting.cwd });
    try { execFileSync('git', ['merge', 'conflicting-side'], { cwd: conflicting.cwd }); } catch { /* expected conflict */ }
    expect(await evaluateGuardedRecoveryAutoResume(conflicting.context, 'conflicting-worktree')).toMatchObject({ status: 'stopped', reason: 'conflicting-worktree', attempt: 0 });

    const held = await makeHarness();
    await seedFailedRecoveryFixture(held.cwd, 'held-prd', { held: true });
    expect(await evaluateGuardedRecoveryAutoResume(held.context, 'held-prd')).toMatchObject({ status: 'stopped', reason: 'active-gate-or-hold' });

    const applied = await makeHarness();
    await seedFailedRecoveryFixture(applied.cwd, 'conflicting-applied', { appliedAction: 'retry' });
    expect(await evaluateGuardedRecoveryAutoResume(applied.context, 'conflicting-applied')).toMatchObject({ status: 'stopped', reason: 'conflicting-applied-marker' });
  });

  it('stops malformed prior auto-resume markers after an automatic attempt', async () => {
    const { cwd, db, context, mutationReasons, wakeReasons } = await makeHarness({ config: makeConfig({ enabled: true, maxAttempts: 2 }) });
    await seedFailedRecoveryFixture(cwd, 'malformed-prior-markers', { autoResume: { attempts: 1, lastProgressMarker: 42 } });
    const before = await readFile(join(cwd, '.eforge/queue/failed/malformed-prior-markers.recovery.json'), 'utf-8');

    const outcome = await evaluateGuardedRecoveryAutoResume(context, 'malformed-prior-markers');

    expect(outcome).toMatchObject({ status: 'stopped', reason: 'malformed-sidecar', attempt: 1 });
    await expectStoppedWithoutMutation({ cwd, db, mutationReasons, wakeReasons, prdId: 'malformed-prior-markers', before, reason: 'malformed-sidecar', attempt: 1, maxAttempts: 2 });
  });

  it('stops repeated identical failures after an automatic attempt', async () => {
    const { cwd, db, context } = await makeHarness({ config: makeConfig({ enabled: true, maxAttempts: 2 }) });
    const progressMarker = JSON.stringify({ commits: '', diffStat: '' });
    const failureSignature = JSON.stringify({
      failures: [{ planId: 'plan-01', terminalSubtype: 'validation', errorMessage: 'Type error' }],
      terminalFailure: { stage: 'validation', message: 'Type error' },
    });
    await seedFailedRecoveryFixture(cwd, 'same-failure', {
      autoResume: { attempts: 1, lastProgressMarker: progressMarker, lastFailureSignature: failureSignature },
    });

    const outcome = await evaluateGuardedRecoveryAutoResume(context, 'same-failure');

    expect(outcome).toMatchObject({ status: 'stopped', reason: 'repeated-failure-signature', attempt: 1 });
    expect(daemonEvents(db).at(-1)).toMatchObject({ reason: 'repeated-failure-signature', attempt: 1, maxAttempts: 2 });
  });

  it('stops missing and malformed sidecars with durable audit reasons', async () => {
    const missing = await makeHarness();
    await mkdir(join(missing.cwd, '.eforge/queue/failed'), { recursive: true });
    expect(await evaluateGuardedRecoveryAutoResume(missing.context, 'missing-sidecar')).toMatchObject({ status: 'stopped', reason: 'missing-sidecar' });

    const malformed = await makeHarness();
    await mkdir(join(malformed.cwd, '.eforge/queue/failed'), { recursive: true });
    await writeFile(join(malformed.cwd, '.eforge/queue/failed/bad.recovery.json'), '{not json', 'utf-8');
    expect(await evaluateGuardedRecoveryAutoResume(malformed.context, 'bad')).toMatchObject({ status: 'stopped', reason: 'malformed-sidecar' });

    const malformedSchema = await makeHarness();
    await seedFailedRecoveryFixture(malformedSchema.cwd, 'bad-schema', { confidence: 'high' });
    const badSchemaPath = join(malformedSchema.cwd, '.eforge/queue/failed/bad-schema.recovery.json');
    const badSchema = JSON.parse(await readFile(badSchemaPath, 'utf-8')) as { verdict: { confidence: string } };
    badSchema.verdict.confidence = 'certain';
    await writeFile(badSchemaPath, `${JSON.stringify(badSchema, null, 2)}\n`, 'utf-8');
    expect(await evaluateGuardedRecoveryAutoResume(malformedSchema.context, 'bad-schema')).toMatchObject({ status: 'stopped', reason: 'malformed-sidecar' });
  });

  it('queues an eligible first continue-repair attempt, records state, notifies scheduling, and emits parseable audit events', async () => {
    const { cwd, db, context, wakeReasons, mutationReasons } = await makeHarness();
    const prdId = 'positive-auto-resume';
    const setName = `${prdId}-set`;
    await seedFailedRecoveryFixture(cwd, prdId, { landedCommitSha: 'abc123', diffStat: ' plan-01.md | 1 +' });
    await writeCompiledArtifactsOnFeatureBranch(cwd, setName);

    const outcome = await evaluateGuardedRecoveryAutoResume(context, prdId);

    expect(outcome).toMatchObject({ status: 'queued', attempt: 1 });
    expect(wakeReasons).toEqual([]);
    expect(mutationReasons).toEqual(['apply-recovery']);
    expect(await readFile(join(cwd, '.eforge/queue', `${prdId}.md`), 'utf-8')).toContain('resume_mode: compiled');
    const sidecar = JSON.parse(await readFile(join(cwd, '.eforge/queue/failed', `${prdId}.recovery.json`), 'utf-8')) as { autoResume?: { attempts?: number; lastAttemptAt?: string; lastProgressMarker?: string; lastFailureSignature?: string }; applied?: { action?: string } };
    expect(sidecar.autoResume?.attempts).toBe(1);
    expect(Date.parse(sidecar.autoResume?.lastAttemptAt ?? '')).not.toBeNaN();
    expect(sidecar.autoResume?.lastProgressMarker).toBe(JSON.stringify({ commits: 'abc123', diffStat: ' plan-01.md | 1 +' }));
    expect(sidecar.autoResume?.lastFailureSignature).toContain('Type error');
    expect(sidecar.applied?.action).toBe('continue-repair');
    const events = daemonEvents(db);
    expect(events.map((event) => event.type)).toEqual(['recovery:auto-resume:evaluate', 'recovery:auto-resume:queued']);
    for (const event of events) expect(safeParseEforgeEvent(event).success).toBe(true);
  });

  it('queues continue-repair when compiled artifacts are recoverable from an existing merge worktree', async () => {
    const { cwd, db, context, mutationReasons } = await makeHarness();
    const prdId = 'merge-worktree-auto-resume';
    const setName = `${prdId}-set`;
    await seedFailedRecoveryFixture(cwd, prdId, { landedCommitSha: 'merge123', diffStat: ' plan-01.md | 1 +' });
    await writeCompiledArtifactsOnlyInMergeWorktree(cwd, setName);

    const outcome = await evaluateGuardedRecoveryAutoResume(context, prdId);

    expect(outcome).toMatchObject({ status: 'queued', attempt: 1 });
    expect(mutationReasons).toEqual(['apply-recovery']);
    expect(await readFile(join(cwd, '.eforge/queue', `${prdId}.md`), 'utf-8')).toContain('resume_mode: compiled');
    const sidecar = JSON.parse(await readFile(join(cwd, '.eforge/queue/failed', `${prdId}.recovery.json`), 'utf-8')) as { autoResume?: { attempts?: number }; applied?: { action?: string } };
    expect(sidecar.autoResume?.attempts).toBe(1);
    expect(sidecar.applied?.action).toBe('continue-repair');
    const events = daemonEvents(db);
    expect(events.map((event) => event.type)).toEqual(['recovery:auto-resume:evaluate', 'recovery:auto-resume:queued']);
    for (const event of events) expect(safeParseEforgeEvent(event).success).toBe(true);
  });

  it('queues continue-repair when compiled artifacts are recoverable from branch history rather than branch tip', async () => {
    const { cwd, db, context, mutationReasons } = await makeHarness();
    const prdId = 'branch-history-auto-resume';
    const setName = `${prdId}-set`;
    await seedFailedRecoveryFixture(cwd, prdId, { landedCommitSha: 'history123', diffStat: ' plan-01.md | 1 +' });
    await writeCompiledArtifactsOnlyInBranchHistory(cwd, setName);

    const outcome = await evaluateGuardedRecoveryAutoResume(context, prdId);

    expect(outcome).toMatchObject({ status: 'queued', attempt: 1 });
    expect(mutationReasons).toEqual(['apply-recovery']);
    expect(await readFile(join(cwd, '.eforge/queue', `${prdId}.md`), 'utf-8')).toContain('resume_mode: compiled');
    const sidecar = JSON.parse(await readFile(join(cwd, '.eforge/queue/failed', `${prdId}.recovery.json`), 'utf-8')) as { autoResume?: { attempts?: number }; applied?: { action?: string } };
    expect(sidecar.autoResume?.attempts).toBe(1);
    expect(sidecar.applied?.action).toBe('continue-repair');
    const events = daemonEvents(db);
    expect(events.map((event) => event.type)).toEqual(['recovery:auto-resume:evaluate', 'recovery:auto-resume:queued']);
    for (const event of events) expect(safeParseEforgeEvent(event).success).toBe(true);
  });

  it('allows a later automatic attempt when progress changed and budget remains', async () => {
    const { cwd, context } = await makeHarness({ config: makeConfig({ enabled: true, maxAttempts: 2 }) });
    const prdId = 'progress-auto-resume';
    const setName = `${prdId}-set`;
    const currentFailureSignature = JSON.stringify({
      failures: [{ planId: 'plan-01', terminalSubtype: 'validation', errorMessage: 'Type error' }],
      terminalFailure: { stage: 'validation', message: 'Type error' },
    });
    await seedFailedRecoveryFixture(cwd, prdId, {
      landedCommitSha: 'new-progress',
      diffStat: ' plan-01.md | 2 ++',
      autoResume: { attempts: 1, lastProgressMarker: JSON.stringify({ commits: '', diffStat: '' }), lastFailureSignature: currentFailureSignature },
    });
    await writeCompiledArtifactsOnFeatureBranch(cwd, setName);

    const outcome = await evaluateGuardedRecoveryAutoResume(context, prdId);

    expect(outcome).toMatchObject({ status: 'queued', attempt: 2 });
    const sidecar = JSON.parse(await readFile(join(cwd, '.eforge/queue/failed', `${prdId}.recovery.json`), 'utf-8')) as { autoResume?: { attempts?: number; lastProgressMarker?: string; lastFailureSignature?: string } };
    expect(sidecar.autoResume?.attempts).toBe(2);
    expect(sidecar.autoResume?.lastProgressMarker).toBe(JSON.stringify({ commits: 'new-progress', diffStat: ' plan-01.md | 2 ++' }));
    expect(sidecar.autoResume?.lastFailureSignature).toContain('Type error');
  });

  it('allows a later automatic attempt when the failure signature changed and budget remains', async () => {
    const { cwd, context } = await makeHarness({ config: makeConfig({ enabled: true, maxAttempts: 2 }) });
    const prdId = 'different-failure-auto-resume';
    const setName = `${prdId}-set`;
    await seedFailedRecoveryFixture(cwd, prdId, {
      errorMessage: 'Different type error',
      autoResume: { attempts: 1, lastProgressMarker: JSON.stringify({ commits: '', diffStat: '' }), lastFailureSignature: 'old-failure' },
    });
    await writeCompiledArtifactsOnFeatureBranch(cwd, setName);

    const outcome = await evaluateGuardedRecoveryAutoResume(context, prdId);

    expect(outcome).toMatchObject({ status: 'queued', attempt: 2 });
  });

  it('stops high-confidence eligible sidecars whose compiled artifacts are missing without consuming an attempt', async () => {
    const { cwd, db, context, mutationReasons, wakeReasons } = await makeHarness();
    await seedFailedRecoveryFixture(cwd, 'missing-artifacts');
    const before = await readFile(join(cwd, '.eforge/queue/failed/missing-artifacts.recovery.json'), 'utf-8');

    const outcome = await evaluateGuardedRecoveryAutoResume(context, 'missing-artifacts');

    expect(outcome).toMatchObject({ status: 'stopped', reason: 'ineligible-artifacts', attempt: 0 });
    await expectStoppedWithoutMutation({ cwd, db, mutationReasons, wakeReasons, prdId: 'missing-artifacts', before, reason: 'ineligible-artifacts', attempt: 0, maxAttempts: 1 });
  });

  it('stops missing eligibility metadata and queue preflight blockers without consuming an attempt', async () => {
    const missingEligibility = await makeHarness();
    await seedFailedRecoveryFixture(missingEligibility.cwd, 'missing-eligibility');
    const sidecarPath = join(missingEligibility.cwd, '.eforge/queue/failed/missing-eligibility.recovery.json');
    const sidecar = JSON.parse(await readFile(sidecarPath, 'utf-8')) as Record<string, unknown>;
    delete sidecar.continueRepairEligibility;
    await writeFile(sidecarPath, `${JSON.stringify(sidecar, null, 2)}\n`, 'utf-8');
    expect(await evaluateGuardedRecoveryAutoResume(missingEligibility.context, 'missing-eligibility')).toMatchObject({ status: 'stopped', reason: 'not-eligible', attempt: 0 });

    const rootBlocked = await makeHarness();
    await seedFailedRecoveryFixture(rootBlocked.cwd, 'root-blocked');
    await mkdir(join(rootBlocked.cwd, '.eforge/queue'), { recursive: true });
    await writeFile(join(rootBlocked.cwd, '.eforge/queue/root-blocked.md'), '# conflicting queued PRD\n', 'utf-8');
    expect(await evaluateGuardedRecoveryAutoResume(rootBlocked.context, 'root-blocked')).toMatchObject({ status: 'stopped', reason: 'queue-preflight-blocked', attempt: 0 });

    const descendantBlocked = await makeHarness();
    const prdId = 'descendant-blocked';
    await seedFailedRecoveryFixture(descendantBlocked.cwd, prdId, { landedCommitSha: 'abc123' });
    await writeCompiledArtifactsOnFeatureBranch(descendantBlocked.cwd, `${prdId}-set`);
    await mkdir(join(descendantBlocked.cwd, '.eforge/queue/skipped'), { recursive: true });
    await mkdir(join(descendantBlocked.cwd, '.eforge/queue/waiting'), { recursive: true });
    await writeFile(join(descendantBlocked.cwd, '.eforge/queue/skipped/child.md'), `---\ntitle: child\ndepends_on: [${prdId}]\n---\n\n# child`, 'utf-8');
    await writeFile(join(descendantBlocked.cwd, '.eforge/queue/waiting/child.md'), '# target collision\n', 'utf-8');
    const before = await readFile(join(descendantBlocked.cwd, '.eforge/queue/failed', `${prdId}.recovery.json`), 'utf-8');
    const outcome = await evaluateGuardedRecoveryAutoResume(descendantBlocked.context, prdId);
    expect(outcome).toMatchObject({ status: 'stopped', reason: 'queue-preflight-blocked', attempt: 0 });
    await expectStoppedWithoutMutation({ cwd: descendantBlocked.cwd, db: descendantBlocked.db, mutationReasons: descendantBlocked.mutationReasons, wakeReasons: descendantBlocked.wakeReasons, prdId, before, reason: 'queue-preflight-blocked', attempt: 0, maxAttempts: 1 });
  });

  it('stops active queue-dispatch policy gates without consuming an attempt', async () => {
    const { cwd, context } = await makeHarness();
    await seedFailedRecoveryFixture(cwd, 'policy-blocked');
    context.options.nativeExtensionRegistry = {
      policyGates: [{
        kind: 'policyGate',
        gateKind: 'queue-dispatch',
        method: 'beforeQueueDispatch',
        registrationIndex: 0,
        extensionName: 'test-policy',
        extensionPath: cwd,
        value: () => ({ decision: 'require-approval', reason: 'approval required' }),
      }],
    };

    expect(await evaluateGuardedRecoveryAutoResume(context, 'policy-blocked')).toMatchObject({ status: 'stopped', reason: 'active-gate-or-hold', attempt: 0 });
  });
});
