// --- eforge:region resume-eligibility-suite ---
// Split from resume-compiled-build-engine.test.ts.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { synthesizeFromEvents } from '@eforge-build/engine/recovery/event-history';
import { deriveResumeSeedState, formatResumeContext, checkResumeEligibility, buildResumeArtifactsProjection, projectResumeEligibility, resolveResumeSetName } from '@eforge-build/engine/resume/compiled-build';
import { applyResumeSeed, initializeState, type ResumeSeedOptions } from '@eforge-build/engine/orchestrator';
import { EforgeEngine } from '@eforge-build/engine/eforge';
import { DEFAULT_CONFIG } from '@eforge-build/engine/config';
import { loadArtifactRegistry } from '@eforge-build/engine/artifacts/registry';
import { loadCompletionRegistry } from '@eforge-build/engine/artifacts/completions';
import { openDatabase } from '@eforge-build/monitor/db';
import type { PlanSummaryEntry, BuildFailureSummary, EforgeEvent } from '@eforge-build/engine/events';
import { StubHarness } from './stub-harness.js';
import { useTempDir } from './test-tmpdir.js';
import { makeResumeFailureSummary as makeFailureSummary, makeResumePlanSummary as makePlanSummary } from './resume-compiled-build-helpers.js';


function makePlans(
  specs: Array<{ id: string; dependsOn?: string[] }>,
) {
  const TEST_REVIEW = { strategy: 'auto' as const, perspectives: ['code'], maxRounds: 1, evaluatorStrictness: 'standard' as const };
  return specs.map((s) => ({
    id: s.id,
    name: s.id,
    dependsOn: s.dependsOn ?? [],
    branch: `feature/${s.id}`,
    build: ['implement', 'review-cycle'],
    review: TEST_REVIEW,
  }));
}

const makeTempDir = useTempDir('eforge-resume-compiled-build-');

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

function writeFileEnsuringDir(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf-8');
}

function initRepo(): string {
  const cwd = makeTempDir();
  git(cwd, ['init', '-b', 'main']);
  git(cwd, ['config', 'user.email', 'test@example.com']);
  git(cwd, ['config', 'user.name', 'Test User']);
  writeFileEnsuringDir(join(cwd, 'README.md'), '# test\n');
  git(cwd, ['add', 'README.md']);
  git(cwd, ['commit', '-m', 'chore: initial']);
  return cwd;
}

function writeCompiledPlanSet(cwd: string, setName: string, opts: { validate?: string[] } = {}): void {
  const validate = opts.validate ?? [];
  const validateYaml = validate.length > 0
    ? `validate:\n${validate.map((cmd) => `  - ${cmd}`).join('\n')}\n`
    : 'validate: []\n';
  writeFileEnsuringDir(join(cwd, 'eforge', 'plans', setName, 'orchestration.yaml'), `name: ${setName}
description: Test resume plan set
base_branch: main
mode: excursion
${validateYaml}plans:
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
  rationale: resume
`);
  writeFileEnsuringDir(join(cwd, 'eforge', 'plans', setName, 'plan-01.md'), `---
id: plan-01
name: Plan 01
---

# Plan 01
`);
}

function seedFailedRunEvidence(cwd: string, setName: string): string {
  const dbPath = join(cwd, '.eforge', 'monitor.db');
  const db = openDatabase(dbPath);
  const runId = `run-${setName}`;
  const ts = '2026-01-01T00:00:00.000Z';
  db.insertRun({ id: runId, planSet: setName, command: 'build', status: 'failed', startedAt: ts, cwd });
  db.insertEvent({ runId, type: 'plan:status:change', planId: 'plan-01', data: JSON.stringify({ type: 'plan:status:change', planId: 'plan-01', status: 'completed', timestamp: ts }), timestamp: ts });
  db.insertEvent({ runId, type: 'plan:merge:complete', planId: 'plan-01', data: JSON.stringify({ type: 'plan:merge:complete', planId: 'plan-01', commitSha: 'abc123', timestamp: ts }), timestamp: ts });
  db.insertEvent({ runId, type: 'plan:build:failed', planId: 'plan-02', data: JSON.stringify({ type: 'plan:build:failed', planId: 'plan-02', error: 'prior failure', timestamp: ts }), timestamp: ts });
  db.insertEvent({ runId, type: 'phase:end', data: JSON.stringify({ type: 'phase:end', runId, result: { status: 'failed', summary: 'failed' }, timestamp: ts }), timestamp: ts });
  db.updateRunStatus(runId, 'failed', ts);
  db.close();
  return dbPath;
}

function insertRecoverySelectionEvent(
  db: ReturnType<typeof openDatabase>,
  runId: string,
  type: string,
  planId: string | undefined,
  timestamp: string,
  data: Record<string, unknown> = {},
): void {
  db.insertEvent({
    runId,
    type,
    ...(planId ? { planId } : {}),
    data: JSON.stringify({ type, ...(planId ? { planId } : {}), ...data, timestamp }),
    timestamp,
  });
}

function seedRecoveryRunSelectionFixture(cwd: string, setName: string, newerResumeStatus: 'failed' | 'running'): string {
  const dbPath = join(cwd, '.eforge', 'monitor.db');
  const db = openDatabase(dbPath);
  const buildRunId = `run-${setName}-build`;
  const resumeRunId = `run-${setName}-resume`;
  const t0 = '2026-01-01T00:00:00.000Z';
  const t1 = '2026-01-01T01:00:00.000Z';

  db.insertRun({ id: buildRunId, planSet: setName, command: 'build', status: 'failed', startedAt: t0, cwd });
  insertRecoverySelectionEvent(db, buildRunId, 'plan:status:change', 'plan-05', t0, { status: 'failed' });
  insertRecoverySelectionEvent(db, buildRunId, 'plan:build:failed', 'plan-05', t0, { error: 'original build failure' });
  insertRecoverySelectionEvent(db, buildRunId, 'phase:end', undefined, t0, { runId: buildRunId, result: { status: 'failed', summary: 'failed' } });

  db.insertRun({ id: resumeRunId, planSet: setName, command: 'resume', status: newerResumeStatus, startedAt: t1, cwd });
  insertRecoverySelectionEvent(db, resumeRunId, 'plan:status:change', 'plan-05', t1, { status: 'merged' });
  insertRecoverySelectionEvent(db, resumeRunId, 'plan:merge:complete', 'plan-05', t1, { commitSha: 'abc005' });
  insertRecoverySelectionEvent(db, resumeRunId, 'plan:status:change', 'plan-06', t1, { status: 'merged' });
  insertRecoverySelectionEvent(db, resumeRunId, 'plan:merge:complete', 'plan-06', t1, { commitSha: 'abc006' });
  insertRecoverySelectionEvent(db, resumeRunId, 'plan:status:change', 'plan-07', t1, { status: 'failed' });
  insertRecoverySelectionEvent(db, resumeRunId, 'plan:build:failed', 'plan-07', t1, { error: 'resume failure' });
  if (newerResumeStatus === 'failed') {
    insertRecoverySelectionEvent(db, resumeRunId, 'phase:end', undefined, t1, { runId: resumeRunId, result: { status: 'failed', summary: 'failed' } });
  }

  db.close();
  return dbPath;
}

function createFeatureBranchWithArtifacts(cwd: string, setName: string, opts: { removeArtifactsAtTip?: boolean } = {}): void {
  git(cwd, ['switch', '-c', `eforge/${setName}`]);
  writeCompiledPlanSet(cwd, setName);
  git(cwd, ['add', 'eforge']);
  git(cwd, ['commit', '-m', 'plan: compiled artifacts']);
  if (opts.removeArtifactsAtTip) {
    rmSync(join(cwd, 'eforge', 'plans', setName), { recursive: true, force: true });
    git(cwd, ['add', 'eforge']);
    git(cwd, ['commit', '-m', 'cleanup: remove compiled artifacts']);
  }
  git(cwd, ['switch', 'main']);
}

function createFeatureBranchAtTrunkWithArtifacts(cwd: string, setName: string): void {
  writeCompiledPlanSet(cwd, setName);
  git(cwd, ['add', 'eforge']);
  git(cwd, ['commit', '-m', 'plan: compiled artifacts on trunk']);
  git(cwd, ['switch', '-c', `eforge/${setName}`]);
  git(cwd, ['switch', 'main']);
}

describe('checkResumeEligibility — ineligibility and artifact recovery', () => {
  it('returns ineligible with reason containing the branch name when branch is missing', async () => {
    const cwd = initRepo();
    const mergeWorktreePath = join(makeTempDir(), 'missing-branch', '__merge__');

    const result = await checkResumeEligibility({
      cwd,
      setName: 'test-feature',
      prdId: 'prd-test',
      mergeWorktreePath,
      outputDir: 'eforge/plans',
      dbPath: undefined,
    });

    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.reason).toContain('eforge/test-feature');
    }
    expect(existsSync(mergeWorktreePath)).toBe(false);
    expect(existsSync(join(dirname(mergeWorktreePath), '__resume_artifacts__'))).toBe(false);
  });

  it('returns ineligible with checkedPath when the branch has no orchestration artifact', async () => {
    const cwd = initRepo();
    const setName = 'missing-orchestration';
    git(cwd, ['switch', '-c', `eforge/${setName}`]);
    writeFileEnsuringDir(join(cwd, 'feature.txt'), 'feature work\n');
    git(cwd, ['add', 'feature.txt']);
    git(cwd, ['commit', '-m', 'feat: branch without artifacts']);
    git(cwd, ['switch', 'main']);

    const mergeWorktreePath = join(makeTempDir(), `${setName}-worktrees`, '__merge__');
    expect(existsSync(mergeWorktreePath)).toBe(false);

    const result = await checkResumeEligibility({
      cwd,
      setName,
      prdId: setName,
      mergeWorktreePath,
      outputDir: 'eforge/plans',
      dbPath: undefined,
      trunkBranch: 'main',
    });

    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.reason).toContain('orchestration.yaml not found');
      expect(result.checkedPath).toContain(join('eforge', 'plans', setName, 'orchestration.yaml'));
    }
  });

  it('recreates a missing merge worktree from the preserved feature branch', async () => {
    const cwd = initRepo();
    const setName = 'branch-tip-artifacts';
    createFeatureBranchWithArtifacts(cwd, setName);
    const dbPath = seedFailedRunEvidence(cwd, setName);
    const mergeWorktreePath = join(makeTempDir(), `${setName}-worktrees`, '__merge__');
    expect(existsSync(mergeWorktreePath)).toBe(false);

    const result = await checkResumeEligibility({
      cwd,
      setName,
      prdId: setName,
      mergeWorktreePath,
      outputDir: 'eforge/plans',
      dbPath,
      trunkBranch: 'main',
    });

    expect(result.eligible).toBe(true);
    if (result.eligible) {
      expect(result.artifactSource).toBe('merge-worktree');
      expect(result.artifactBasePath).toBe(mergeWorktreePath);
      expect(existsSync(join(mergeWorktreePath, 'eforge', 'plans', setName, 'orchestration.yaml'))).toBe(true);
    }
  });

  it('recovers orchestration artifacts from branch history when cleanup removed them at branch tip', async () => {
    const cwd = initRepo();
    const setName = 'history-artifacts';
    createFeatureBranchWithArtifacts(cwd, setName, { removeArtifactsAtTip: true });
    const dbPath = seedFailedRunEvidence(cwd, setName);
    const mergeWorktreePath = join(makeTempDir(), `${setName}-worktrees`, '__merge__');
    expect(existsSync(mergeWorktreePath)).toBe(false);

    const result = await checkResumeEligibility({
      cwd,
      setName,
      prdId: setName,
      mergeWorktreePath,
      outputDir: 'eforge/plans',
      dbPath,
      trunkBranch: 'main',
    });

    expect(result.eligible).toBe(true);
    if (result.eligible) {
      expect(result.artifactSource).toBe('branch-history');
      expect(result.artifactCommit).toMatch(/^[a-f0-9]{40}$/);
      expect(existsSync(join(result.artifactBasePath, 'eforge', 'plans', setName, 'orchestration.yaml'))).toBe(true);
      expect(existsSync(join(result.artifactBasePath, 'eforge', 'plans', setName, 'plan-01.md'))).toBe(true);
    }
  });

  it('rejects preserved compiled artifacts without failed-run evidence', async () => {
    const cwd = initRepo();
    const setName = 'artifacts-no-failure-evidence';
    createFeatureBranchAtTrunkWithArtifacts(cwd, setName);
    expect(git(cwd, ['rev-list', '--count', `main..eforge/${setName}`])).toBe('0');
    const mergeWorktreePath = join(makeTempDir(), `${setName}-worktrees`, '__merge__');

    const result = await checkResumeEligibility({
      cwd,
      setName,
      prdId: setName,
      mergeWorktreePath,
      outputDir: 'eforge/plans',
      dbPath: undefined,
      trunkBranch: 'main',
    });

    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.reason).toContain('no failed-run evidence found');
    }
  });
});

describe('projectResumeEligibility — read-only eligibility projection', () => {
  it('returns ineligible with the branch name when the feature branch is missing', async () => {
    const cwd = initRepo();
    const mergeWorktreePath = join(makeTempDir(), 'missing-projection-branch', '__merge__');

    const result = await projectResumeEligibility({
      cwd,
      setName: 'test-feature',
      prdId: 'prd-test',
      mergeWorktreePath,
      outputDir: 'eforge/plans',
      dbPath: undefined,
    });

    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.featureBranch).toBe('eforge/test-feature');
      expect(result.reason).toContain('eforge/test-feature');
    }
    expect(existsSync(mergeWorktreePath)).toBe(false);
    expect(existsSync(join(dirname(mergeWorktreePath), '__resume_artifacts__'))).toBe(false);
  });

  it('reports feature-branch availability without recreating the merge worktree', async () => {
    const cwd = initRepo();
    const setName = 'feature-branch-availability';
    createFeatureBranchWithArtifacts(cwd, setName);
    const dbPath = seedFailedRunEvidence(cwd, setName);
    const mergeWorktreePath = join(makeTempDir(), `${setName}-worktrees`, '__merge__');

    const result = await projectResumeEligibility({
      cwd,
      setName,
      prdId: setName,
      mergeWorktreePath,
      outputDir: 'eforge/plans',
      dbPath,
      trunkBranch: 'main',
    });

    expect(result.eligible).toBe(true);
    if (result.eligible) {
      expect(result.artifactAvailability).toBe('feature-branch');
      expect(result.featureBranch).toBe(`eforge/${setName}`);
    }

    expect(existsSync(mergeWorktreePath)).toBe(false);
  });

  it('detects branch-history availability without materializing __resume_artifacts__', async () => {
    const cwd = initRepo();
    const setName = 'history-availability';
    createFeatureBranchWithArtifacts(cwd, setName, { removeArtifactsAtTip: true });
    const dbPath = seedFailedRunEvidence(cwd, setName);
    const mergeWorktreePath = join(makeTempDir(), `${setName}-worktrees`, '__merge__');

    const result = await projectResumeEligibility({
      cwd,
      setName,
      prdId: setName,
      mergeWorktreePath,
      outputDir: 'eforge/plans',
      dbPath,
      trunkBranch: 'main',
    });

    expect(result.eligible).toBe(true);
    if (result.eligible) {
      expect(result.artifactAvailability).toBe('branch-history');
      expect(result.artifactCommit).toMatch(/^[a-f0-9]{40}$/);
    }

    expect(existsSync(mergeWorktreePath)).toBe(false);
    const resumeArtifactsDir = join(dirname(mergeWorktreePath), '__resume_artifacts__');
    expect(existsSync(resumeArtifactsDir)).toBe(false);
  });

  it('returns ineligible with a checkedPath when no orchestration artifact exists', async () => {
    const cwd = initRepo();
    const setName = 'no-artifacts';
    git(cwd, ['switch', '-c', `eforge/${setName}`]);
    writeFileEnsuringDir(join(cwd, 'feature.txt'), 'feature work\n');
    git(cwd, ['add', 'feature.txt']);
    git(cwd, ['commit', '-m', 'feat: branch without artifacts']);
    git(cwd, ['switch', 'main']);

    const mergeWorktreePath = join(makeTempDir(), `${setName}-worktrees`, '__merge__');

    const result = await projectResumeEligibility({
      cwd,
      setName,
      prdId: setName,
      mergeWorktreePath,
      outputDir: 'eforge/plans',
      dbPath: undefined,
      trunkBranch: 'main',
    });

    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.reason).toContain('orchestration.yaml not found');
      expect(result.checkedPath).toContain(join('eforge', 'plans', setName, 'orchestration.yaml'));
    }
  });

  it('reports preserved compiled artifacts as ineligible without failed-run evidence and stays read-only', async () => {
    const cwd = initRepo();
    const setName = 'projection-artifacts-no-failure-evidence';
    createFeatureBranchAtTrunkWithArtifacts(cwd, setName);
    expect(git(cwd, ['rev-list', '--count', `main..eforge/${setName}`])).toBe('0');
    const mergeWorktreePath = join(makeTempDir(), `${setName}-worktrees`, '__merge__');

    const result = await projectResumeEligibility({
      cwd,
      setName,
      prdId: setName,
      mergeWorktreePath,
      outputDir: 'eforge/plans',
      dbPath: undefined,
      trunkBranch: 'main',
    });

    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.reason).toContain('no failed-run evidence found');
    }
    expect(existsSync(mergeWorktreePath)).toBe(false);
    expect(existsSync(join(dirname(mergeWorktreePath), '__resume_artifacts__'))).toBe(false);
  });
});
// --- eforge:endregion resume-eligibility-suite ---
