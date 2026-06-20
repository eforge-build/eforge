import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import type { RecoveryVerdictSidecar } from '@eforge-build/client';
import { prepareRecoveryGuidance, recoveryGuidanceResumeBlocker } from '@eforge-build/engine/recovery/guidance';
import { countRecoveryGuidanceSections } from '@eforge-build/engine/recovery/guidance-render';

const dirs: string[] = [];
const SET_NAME = 'demo-set';
const PRD_ID = 'prd-1';
const FEATURE_BRANCH = 'feature/recovery-guidance';
const BASE_BRANCH = 'main';

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'eforge-recovery-guidance-'));
  dirs.push(dir);
  return dir;
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

async function writeFileEnsuringDir(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf-8');
}

async function initRepo(): Promise<string> {
  const cwd = await tempDir();
  dirs.push(join(dirname(cwd), `${basename(cwd)}-${SET_NAME}-worktrees`));
  git(cwd, ['init', '-b', BASE_BRANCH]);
  git(cwd, ['config', 'user.email', 'test@example.com']);
  git(cwd, ['config', 'user.name', 'Test User']);
  await writeFileEnsuringDir(join(cwd, 'README.md'), '# fixture\n');
  git(cwd, ['add', 'README.md']);
  git(cwd, ['commit', '-m', 'chore: initial']);
  return cwd;
}

function mergeWorktreePath(cwd: string): string {
  return join(dirname(cwd), `${basename(cwd)}-${SET_NAME}-worktrees`, '__merge__');
}

async function writeCompiledPlanSet(cwd: string, planBodies: Record<string, string>): Promise<void> {
  const planDir = join(cwd, 'eforge', 'plans', SET_NAME);
  await writeFileEnsuringDir(join(planDir, 'orchestration.yaml'), `name: ${SET_NAME}\nbase_branch: ${BASE_BRANCH}\nplans: []\n`);
  for (const [planId, body] of Object.entries(planBodies)) {
    await writeFileEnsuringDir(join(planDir, `${planId}.md`), body);
  }
}

async function writeSidecar(cwd: string, overrides: Partial<RecoveryVerdictSidecar> = {}): Promise<void> {
  const sidecar = makeSidecar(overrides);
  await writeFileEnsuringDir(
    join(cwd, '.eforge', 'queue', 'failed', `${PRD_ID}.recovery.json`),
    `${JSON.stringify(sidecar, null, 2)}\n`,
  );
}

function makeSidecar(overrides: Partial<RecoveryVerdictSidecar> = {}): RecoveryVerdictSidecar {
  const base: RecoveryVerdictSidecar = {
    schemaVersion: 3,
    generatedAt: '2026-01-02T03:04:05.000Z',
    prdId: PRD_ID,
    setName: SET_NAME,
    verdict: {
      verdict: 'continue-repair',
      confidence: 'high',
      rationale: 'compiled artifacts can be resumed',
      completedWork: ['dependency work completed'],
      remainingWork: ['fix the failed root plan'],
      risks: ['do not rerun dependency-satisfied work'],
    },
    report: {
      operatorSummary: 'root plans failed validation',
      recommendedAction: 'continue repair from preserved artifacts',
      rootFailure: { planId: 'plan-a', stage: 'validation', message: 'validation failed' },
      keyEvidence: ['validator reported failure'],
      completedWork: ['dependency work completed'],
      remainingWork: ['fix the failed root plan'],
      risks: ['do not rerun dependency-satisfied work'],
    },
    boundedEvidence: {
      identity: {
        prdId: PRD_ID,
        setName: SET_NAME,
        featureBranch: FEATURE_BRANCH,
        baseBranch: BASE_BRANCH,
        failedAt: '2026-01-02T03:04:05.000Z',
      },
      plans: [
        { planId: 'plan-a', status: 'failed', error: 'validation failed' },
        { planId: 'plan-dependent', status: 'skipped' },
      ],
      failingPlan: { planId: 'plan-a', errorMessage: 'validation failed', terminalSubtype: 'validation' },
      landedCommits: [],
      modelsUsed: [],
    },
  };
  return {
    ...base,
    ...overrides,
    report: { ...base.report, ...overrides.report },
    boundedEvidence: { ...base.boundedEvidence, ...overrides.boundedEvidence },
  } as RecoveryVerdictSidecar;
}

async function seedFeatureBranchWithArtifacts(cwd: string, planBodies: Record<string, string>): Promise<void> {
  git(cwd, ['checkout', '-b', FEATURE_BRANCH]);
  await writeCompiledPlanSet(cwd, planBodies);
  git(cwd, ['add', 'eforge/plans']);
  git(cwd, ['commit', '-m', 'chore: compile plan artifacts']);
  git(cwd, ['checkout', BASE_BRANCH]);
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).reverse().map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('recovery guidance preparation guards', () => {
  it('rejects unsafe prd ids before reading sidecars or invoking git', async () => {
    const cwd = await tempDir();
    await expect(prepareRecoveryGuidance({ cwd, prdId: '../bad' })).rejects.toThrow(/Invalid prdId/);
    await expect(prepareRecoveryGuidance({ cwd, prdId: 'prd-1\nModels-Used: injected' })).rejects.toThrow(/Invalid prdId/);
    await expect(prepareRecoveryGuidance({ cwd, prdId: 'prd-1\u0000bad' })).rejects.toThrow(/Invalid prdId/);
  });

  it('rejects unsafe output directories before git worktree commands run', async () => {
    const cwd = await initRepo();
    await writeSidecar(cwd);

    await expect(prepareRecoveryGuidance({ cwd, prdId: PRD_ID, outputDir: '../outside' })).rejects.toThrow(/Invalid outputDir/);
    await expect(prepareRecoveryGuidance({ cwd, prdId: PRD_ID, outputDir: ':(top)' })).rejects.toThrow(/Invalid outputDir/);
    await expect(prepareRecoveryGuidance({ cwd, prdId: PRD_ID, outputDir: 'plans/*' })).rejects.toThrow(/Invalid outputDir/);
    await expect(prepareRecoveryGuidance({ cwd, prdId: PRD_ID, outputDir: 'plans/[abc]' })).rejects.toThrow(/Invalid outputDir/);
    expect(existsSync(mergeWorktreePath(cwd))).toBe(false);
  });

  it('reports resume blockers unless every root plan is patched or already current', () => {
    expect(recoveryGuidanceResumeBlocker({
      prdId: 'prd-1',
      setName: 'set',
      featureBranch: 'eforge/set',
      baseBranch: 'main',
      outputDir: 'eforge/plans',
      sidecarPath: '.eforge/queue/failed/prd-1.recovery.json',
      sidecarGeneratedAt: 'now',
      plans: [],
    })).toContain('no root failed plans');

    expect(recoveryGuidanceResumeBlocker({
      prdId: 'prd-1',
      setName: 'set',
      featureBranch: 'eforge/set',
      baseBranch: 'main',
      outputDir: 'eforge/plans',
      sidecarPath: '.eforge/queue/failed/prd-1.recovery.json',
      sidecarGeneratedAt: 'now',
      plans: [{ planId: 'plan-01', path: 'eforge/plans/set/plan-01.md', status: 'artifact-missing' }],
    })).toContain('artifact-missing');

    expect(recoveryGuidanceResumeBlocker({
      prdId: 'prd-1',
      setName: 'set',
      featureBranch: 'eforge/set',
      baseBranch: 'main',
      outputDir: 'eforge/plans',
      sidecarPath: '.eforge/queue/failed/prd-1.recovery.json',
      sidecarGeneratedAt: 'now',
      plans: [
        { planId: 'plan-01', path: 'eforge/plans/set/plan-01.md', status: 'patched' },
        { planId: 'plan-02', path: 'eforge/plans/set/plan-02.md', status: 'already-current' },
      ],
    })).toBeUndefined();
  });
});

describe('recovery guidance preparation with real git artifacts', () => {
  it('patches only root failed plans, commits through forgeCommit, and is idempotent', async () => {
    const cwd = await initRepo();
    await seedFeatureBranchWithArtifacts(cwd, {
      'plan-a': '# Plan A\n\nDo root work.\n',
      'plan-dependent': '# Dependent\n\nDo not patch downstream skipped work.\n',
    });
    await writeSidecar(cwd);

    const response = await prepareRecoveryGuidance({ cwd, prdId: PRD_ID });

    expect(response).toMatchObject({
      prdId: PRD_ID,
      setName: SET_NAME,
      featureBranch: FEATURE_BRANCH,
      baseBranch: BASE_BRANCH,
      outputDir: 'eforge/plans',
      sidecarGeneratedAt: '2026-01-02T03:04:05.000Z',
      plans: [{ planId: 'plan-a', status: 'patched' }],
    });
    expect(response.sidecarPath).toBe(`.eforge/queue/failed/${PRD_ID}.recovery.json`);
    expect(response.commitSha).toMatch(/^[0-9a-f]{40}$/);

    const rootBody = await readFile(join(mergeWorktreePath(cwd), 'eforge', 'plans', SET_NAME, 'plan-a.md'), 'utf-8');
    const dependentBody = await readFile(join(mergeWorktreePath(cwd), 'eforge', 'plans', SET_NAME, 'plan-dependent.md'), 'utf-8');
    expect(countRecoveryGuidanceSections(rootBody)).toBe(1);
    expect(rootBody).toContain('Sidecar generated at: 2026-01-02T03:04:05.000Z');
    expect(rootBody).toContain(`Source sidecar: .eforge/queue/failed/${PRD_ID}.recovery.json`);
    expect(dependentBody).not.toContain('## Recovery Guidance');

    const commitMessage = git(mergeWorktreePath(cwd), ['log', '-1', '--pretty=%B']);
    expect(commitMessage).toContain('Co-Authored-By: forged-by-eforge <noreply@eforge.build>');
    expect(git(mergeWorktreePath(cwd), ['show', '--name-only', '--pretty=', response.commitSha!]).split('\n').filter(Boolean)).toEqual([
      `eforge/plans/${SET_NAME}/plan-a.md`,
    ]);

    const headAfterFirstRun = git(mergeWorktreePath(cwd), ['rev-parse', 'HEAD']);
    const second = await prepareRecoveryGuidance({ cwd, prdId: PRD_ID });
    expect(second.commitSha).toBeUndefined();
    expect(second.plans).toEqual([{ planId: 'plan-a', path: `eforge/plans/${SET_NAME}/plan-a.md`, status: 'already-current' }]);
    expect(git(mergeWorktreePath(cwd), ['rev-parse', 'HEAD'])).toBe(headAfterFirstRun);
  });

  it('prefers multi-root failingPlans over failingPlan and leaves the legacy single failing plan untouched', async () => {
    const cwd = await initRepo();
    await seedFeatureBranchWithArtifacts(cwd, {
      'plan-a': '# Plan A\n',
      'plan-b': '# Plan B\n',
      'plan-legacy': '# Legacy fallback\n',
    });
    await writeSidecar(cwd, {
      boundedEvidence: {
        ...makeSidecar().boundedEvidence,
        plans: [
          { planId: 'plan-a', status: 'failed' },
          { planId: 'plan-b', status: 'failed' },
          { planId: 'plan-legacy', status: 'failed' },
        ],
        failingPlan: { planId: 'plan-legacy', errorMessage: 'legacy root' },
        failingPlans: [
          { planId: 'plan-b', errorMessage: 'second root' },
          { planId: 'plan-a', errorMessage: 'first root' },
        ],
      },
    });

    const response = await prepareRecoveryGuidance({ cwd, prdId: PRD_ID });

    expect(response.plans.map((plan) => plan.planId)).toEqual(['plan-a', 'plan-b']);
    for (const planId of ['plan-a', 'plan-b']) {
      const body = await readFile(join(mergeWorktreePath(cwd), 'eforge', 'plans', SET_NAME, `${planId}.md`), 'utf-8');
      expect(countRecoveryGuidanceSections(body)).toBe(1);
    }
    const legacyBody = await readFile(join(mergeWorktreePath(cwd), 'eforge', 'plans', SET_NAME, 'plan-legacy.md'), 'utf-8');
    expect(legacyBody).not.toContain('## Recovery Guidance');
  });

  it('returns artifact-missing without partially writing another root target', async () => {
    const cwd = await initRepo();
    await seedFeatureBranchWithArtifacts(cwd, { 'plan-a': '# Plan A\n' });
    await writeSidecar(cwd, {
      boundedEvidence: {
        ...makeSidecar().boundedEvidence,
        plans: [
          { planId: 'plan-a', status: 'failed' },
          { planId: 'plan-missing', status: 'failed' },
        ],
        failingPlans: [
          { planId: 'plan-a', errorMessage: 'first root' },
          { planId: 'plan-missing', errorMessage: 'missing root' },
        ],
      },
    });
    const featureHead = git(cwd, ['rev-parse', FEATURE_BRANCH]);

    const response = await prepareRecoveryGuidance({ cwd, prdId: PRD_ID });

    expect(response.commitSha).toBeUndefined();
    expect(response.plans).toEqual([
      { planId: 'plan-a', path: `eforge/plans/${SET_NAME}/plan-a.md`, status: 'blocked', reason: 'Recovery guidance was not applied because another root target is missing.' },
      { planId: 'plan-missing', path: `eforge/plans/${SET_NAME}/plan-missing.md`, status: 'artifact-missing', reason: 'Root failed compiled plan markdown artifact is missing.' },
    ]);
    const rootBody = await readFile(join(mergeWorktreePath(cwd), 'eforge', 'plans', SET_NAME, 'plan-a.md'), 'utf-8');
    expect(rootBody).not.toContain('## Recovery Guidance');
    expect(git(cwd, ['rev-parse', FEATURE_BRANCH])).toBe(featureHead);
  });

  it('blocks skipped root evidence without mutating compiled artifacts', async () => {
    const cwd = await initRepo();
    await seedFeatureBranchWithArtifacts(cwd, { 'plan-a': '# Plan A\n' });
    await writeSidecar(cwd, {
      boundedEvidence: {
        ...makeSidecar().boundedEvidence,
        plans: [{ planId: 'plan-a', status: 'skipped' }],
      },
    });

    const response = await prepareRecoveryGuidance({ cwd, prdId: PRD_ID });

    expect(response.plans).toEqual([{ planId: 'plan-a', path: `eforge/plans/${SET_NAME}/plan-a.md`, status: 'blocked', reason: 'Root plan status is skipped; blocked/skipped artifacts are not patched.' }]);
    const rootBody = await readFile(join(mergeWorktreePath(cwd), 'eforge', 'plans', SET_NAME, 'plan-a.md'), 'utf-8');
    expect(rootBody).not.toContain('## Recovery Guidance');
  });

  it('restores branch-history-only plan sets, patches root guidance, and commits restored paths', async () => {
    const cwd = await initRepo();
    git(cwd, ['checkout', '-b', FEATURE_BRANCH]);
    await writeCompiledPlanSet(cwd, {
      'plan-a': '# Plan A\n',
      'plan-dependent': '# Dependent\n',
    });
    git(cwd, ['add', 'eforge/plans']);
    git(cwd, ['commit', '-m', 'chore: compile plan artifacts']);
    const artifactCommit = git(cwd, ['rev-parse', 'HEAD']);
    execFileSync('git', ['rm', '-r', 'eforge/plans'], { cwd, stdio: 'ignore' });
    git(cwd, ['commit', '-m', 'chore: remove compiled artifacts from tip']);
    git(cwd, ['checkout', BASE_BRANCH]);
    await writeSidecar(cwd);

    const response = await prepareRecoveryGuidance({ cwd, prdId: PRD_ID });

    expect(response.commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(response.plans).toEqual([{ planId: 'plan-a', path: `eforge/plans/${SET_NAME}/plan-a.md`, status: 'patched' }]);
    const rootBody = await readFile(join(mergeWorktreePath(cwd), 'eforge', 'plans', SET_NAME, 'plan-a.md'), 'utf-8');
    const dependentBody = await readFile(join(mergeWorktreePath(cwd), 'eforge', 'plans', SET_NAME, 'plan-dependent.md'), 'utf-8');
    expect(countRecoveryGuidanceSections(rootBody)).toBe(1);
    expect(dependentBody).not.toContain('## Recovery Guidance');
    expect(git(mergeWorktreePath(cwd), ['show', '--name-only', '--pretty=', response.commitSha!]).split('\n').filter(Boolean).sort()).toEqual([
      `eforge/plans/${SET_NAME}/orchestration.yaml`,
      `eforge/plans/${SET_NAME}/plan-a.md`,
      `eforge/plans/${SET_NAME}/plan-dependent.md`,
    ]);
    expect(git(mergeWorktreePath(cwd), ['show', '--pretty=', '--name-only', artifactCommit]).split('\n').filter(Boolean).sort()).toEqual([
      `eforge/plans/${SET_NAME}/orchestration.yaml`,
      `eforge/plans/${SET_NAME}/plan-a.md`,
      `eforge/plans/${SET_NAME}/plan-dependent.md`,
    ]);
  });
});
