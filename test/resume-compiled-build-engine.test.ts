/**
 * Engine-level tests for compiled-build resume:
 * - State reconstruction from PlanSummaryEntry lists
 * - Seeded merged/pending classification
 * - Ineligibility cases (branch missing, orchestration.yaml missing, no evidence)
 * - Compile-free execution (no compile-phase events emitted)
 * - Resume context formatting
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { deriveResumeSeedState, formatResumeContext, checkResumeEligibility, buildResumeArtifactsProjection, projectResumeEligibility, resolveResumeSetName } from '@eforge-build/engine/resume/compiled-build';
import { applyResumeSeed, initializeState, type ResumeSeedOptions } from '@eforge-build/engine/orchestrator';
import { EforgeEngine } from '@eforge-build/engine/eforge';
import { DEFAULT_CONFIG } from '@eforge-build/engine/config';
import { openDatabase } from '@eforge-build/monitor/db';
import type { PlanSummaryEntry, BuildFailureSummary, EforgeEvent } from '@eforge-build/engine/events';
import { StubHarness } from './stub-harness.js';
import { useTempDir } from './test-tmpdir.js';


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlanSummary(planId: string, overrides: Partial<PlanSummaryEntry> = {}): PlanSummaryEntry {
  return {
    planId,
    status: 'failed',
    ...overrides,
  };
}

function makeFailureSummary(overrides: Partial<BuildFailureSummary> = {}): BuildFailureSummary {
  return {
    prdId: 'prd-feature-x',
    setName: 'feature-x',
    featureBranch: 'eforge/feature-x',
    baseBranch: 'main',
    plans: [],
    failingPlan: { planId: 'plan-02' },
    landedCommits: [],
    diffStat: '',
    modelsUsed: [],
    failedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

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

// ---------------------------------------------------------------------------
// deriveResumeSeedState
// ---------------------------------------------------------------------------

describe('deriveResumeSeedState — plan-state derivation from failure summary', () => {
  it('classifies a plan with mergedAt as seededMerged', () => {
    const plans: PlanSummaryEntry[] = [
      makePlanSummary('plan-01', { status: 'merged', mergedAt: '2026-01-01T00:00:00.000Z' }),
    ];
    const result = deriveResumeSeedState(plans);
    expect(result.seededMerged).toContain('plan-01');
    expect(result.seededPending).not.toContain('plan-01');
  });

  it('classifies a failed plan without mergedAt as seededPending', () => {
    const plans: PlanSummaryEntry[] = [
      makePlanSummary('plan-02', { status: 'failed' }),
    ];
    const result = deriveResumeSeedState(plans);
    expect(result.seededPending).toContain('plan-02');
    expect(result.seededMerged).not.toContain('plan-02');
  });

  it('classifies a blocked plan as seededPending', () => {
    const plans: PlanSummaryEntry[] = [
      makePlanSummary('plan-03', { status: 'blocked' }),
    ];
    const result = deriveResumeSeedState(plans);
    expect(result.seededPending).toContain('plan-03');
  });

  it('classifies a completed-but-unmerged plan as seededPending (conservative)', () => {
    // No mergedAt field → no merge evidence → conservatively treat as pending
    const plans: PlanSummaryEntry[] = [
      makePlanSummary('plan-04', { status: 'completed' }),
    ];
    const result = deriveResumeSeedState(plans);
    expect(result.seededPending).toContain('plan-04');
    expect(result.seededMerged).not.toContain('plan-04');
  });

  it('handles an empty plan list', () => {
    const result = deriveResumeSeedState([]);
    expect(result.seededMerged).toHaveLength(0);
    expect(result.seededPending).toHaveLength(0);
  });

  it('correctly partitions a mixed graph: one merged, one failed, one blocked', () => {
    const plans: PlanSummaryEntry[] = [
      makePlanSummary('plan-01', { status: 'merged', mergedAt: '2026-01-01T00:00:00.000Z' }),
      makePlanSummary('plan-02', { status: 'failed' }),
      makePlanSummary('plan-03', { status: 'blocked' }),
    ];
    const result = deriveResumeSeedState(plans);
    expect(result.seededMerged).toEqual(['plan-01']);
    expect(result.seededPending).toEqual(expect.arrayContaining(['plan-02', 'plan-03']));
    expect(result.seededPending).toHaveLength(2);
  });

  it('treats a plan with a mergedAt of empty string as seededPending', () => {
    // Empty string is not valid merge evidence
    const plans: PlanSummaryEntry[] = [
      makePlanSummary('plan-05', { status: 'completed', mergedAt: '' }),
    ];
    const result = deriveResumeSeedState(plans);
    expect(result.seededPending).toContain('plan-05');
    expect(result.seededMerged).not.toContain('plan-05');
  });
});

// ---------------------------------------------------------------------------
// applyResumeSeed + initializeState integration
// ---------------------------------------------------------------------------

describe('applyResumeSeed + initializeState — orchestrator state seeding', () => {
  const TEST_CONFIG = {
    name: 'feature-x',
    baseBranch: 'main',
    mode: 'excursion' as const,
    plans: makePlans([
      { id: 'plan-01' },
      { id: 'plan-02', dependsOn: ['plan-01'] },
      { id: 'plan-03', dependsOn: ['plan-02'] },
    ]),
    pipeline: {
      scope: 'excursion' as const,
      compile: [],
      defaultBuild: [],
      defaultReview: { strategy: 'auto' as const, perspectives: ['code'], maxRounds: 1, evaluatorStrictness: 'standard' as const },
    },
  };

  it('seeds plan-01 as merged so plan-02 can be scheduled', () => {
    const { state } = initializeState(TEST_CONFIG, '/tmp/repo');
    const seed: ResumeSeedOptions = {
      seededMerged: ['plan-01'],
      resumeContextByPlan: new Map(),
    };
    applyResumeSeed(state, seed);

    expect(state.plans['plan-01'].status).toBe('merged');
    expect(state.plans['plan-01'].merged).toBe(true);
    expect(state.completedPlans).toContain('plan-01');

    // plan-02 stays pending — it will be scheduled because its dep is merged
    expect(state.plans['plan-02'].status).toBe('pending');
    // plan-03 stays pending too
    expect(state.plans['plan-03'].status).toBe('pending');
  });

  it('seeds plan-01 and plan-02 as merged, leaving plan-03 pending', () => {
    const { state } = initializeState(TEST_CONFIG, '/tmp/repo');
    const seed: ResumeSeedOptions = {
      seededMerged: ['plan-01', 'plan-02'],
      resumeContextByPlan: new Map(),
    };
    applyResumeSeed(state, seed);

    expect(state.plans['plan-01'].status).toBe('merged');
    expect(state.plans['plan-02'].status).toBe('merged');
    expect(state.plans['plan-03'].status).toBe('pending');
    expect(state.completedPlans).toContain('plan-01');
    expect(state.completedPlans).toContain('plan-02');
    expect(state.completedPlans).not.toContain('plan-03');
  });

  it('does not seed any plans when seededMerged is empty', () => {
    const { state } = initializeState(TEST_CONFIG, '/tmp/repo');
    const seed: ResumeSeedOptions = {
      seededMerged: [],
      resumeContextByPlan: new Map(),
    };
    applyResumeSeed(state, seed);

    // All plans remain pending — entire graph will run from scratch
    for (const id of ['plan-01', 'plan-02', 'plan-03']) {
      expect(state.plans[id].status).toBe('pending');
      expect(state.plans[id].merged).toBe(false);
    }
    expect(state.completedPlans).toHaveLength(0);
  });

  it('silently ignores unknown plan IDs in seededMerged', () => {
    const { state } = initializeState(TEST_CONFIG, '/tmp/repo');
    const seed: ResumeSeedOptions = {
      seededMerged: ['plan-99', 'plan-00'],
      resumeContextByPlan: new Map(),
    };
    expect(() => applyResumeSeed(state, seed)).not.toThrow();
    // Real plans untouched
    for (const id of ['plan-01', 'plan-02', 'plan-03']) {
      expect(state.plans[id].status).toBe('pending');
    }
  });
});

// ---------------------------------------------------------------------------
// formatResumeContext
// ---------------------------------------------------------------------------

describe('formatResumeContext — builder prompt injection', () => {
  const BASE_SUMMARY = makeFailureSummary({
    featureBranch: 'eforge/feature-x',
    diffStat: '5 files changed, 42 insertions(+), 3 deletions(-)',
    landedCommits: [
      { sha: 'abc123', subject: 'feat(plan-01): Plan A', author: 'Test', date: '2026-01-01T00:00:00.000Z' },
    ],
    failingPlan: { planId: 'plan-02', errorMessage: 'Socket error: connection reset' },
  });

  it('includes the feature branch in the context', () => {
    const ctx = formatResumeContext({
      planId: 'plan-02',
      summary: BASE_SUMMARY,
      seededMerged: ['plan-01'],
      seededPending: ['plan-02', 'plan-03'],
    });
    expect(ctx).toContain('eforge/feature-x');
  });

  it('includes the terminal failure message', () => {
    const ctx = formatResumeContext({
      planId: 'plan-02',
      summary: BASE_SUMMARY,
      seededMerged: ['plan-01'],
      seededPending: ['plan-02', 'plan-03'],
    });
    expect(ctx).toContain('Socket error: connection reset');
  });

  it('includes landed commit count when commits exist', () => {
    const ctx = formatResumeContext({
      planId: 'plan-02',
      summary: BASE_SUMMARY,
      seededMerged: ['plan-01'],
      seededPending: ['plan-02', 'plan-03'],
    });
    expect(ctx).toContain('Prior landed commits: 1');
  });

  it('includes diffStat when non-empty', () => {
    const ctx = formatResumeContext({
      planId: 'plan-02',
      summary: BASE_SUMMARY,
      seededMerged: ['plan-01'],
      seededPending: ['plan-02', 'plan-03'],
    });
    expect(ctx).toContain('5 files changed');
  });

  it('lists already-merged plans', () => {
    const ctx = formatResumeContext({
      planId: 'plan-02',
      summary: BASE_SUMMARY,
      seededMerged: ['plan-01'],
      seededPending: ['plan-02', 'plan-03'],
    });
    expect(ctx).toContain('plan-01');
  });

  it('identifies the failing plan and instructs to continue rather than restart', () => {
    const ctx = formatResumeContext({
      planId: 'plan-02',
      summary: BASE_SUMMARY,
      seededMerged: ['plan-01'],
      seededPending: ['plan-02', 'plan-03'],
    });
    // Should mention continuing/repairing preserved work
    expect(ctx.toLowerCase()).toContain('continue');
    expect(ctx.toLowerCase()).toContain('plan-02');
  });

  it('omits diffStat line when empty', () => {
    const summary = makeFailureSummary({ diffStat: '', landedCommits: [] });
    const ctx = formatResumeContext({
      planId: 'plan-01',
      summary,
      seededMerged: [],
      seededPending: ['plan-01'],
    });
    expect(ctx).not.toContain('Changed files');
    expect(ctx).not.toContain('Prior landed commits');
  });
});

// ---------------------------------------------------------------------------
// checkResumeEligibility — ineligibility cases (unit-level, no real git/fs)
// ---------------------------------------------------------------------------

describe('checkResumeEligibility — ineligibility and artifact recovery', () => {
  it('returns ineligible with reason containing the branch name when branch is missing', async () => {
    // Use a path that definitely does not exist to exercise the branch-missing path
    const result = await checkResumeEligibility({
      cwd: '/nonexistent-repo-for-testing',
      setName: 'test-feature',
      prdId: 'prd-test',
      mergeWorktreePath: '/nonexistent-worktree',
      outputDir: 'eforge/plans',
      dbPath: undefined,
    });

    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.reason).toContain('eforge/test-feature');
    }
  });

  it('returns ineligible with checkedPath when the branch has no orchestration artifact', async () => {
    const cwd = initRepo();
    const setName = 'missing-orchestration';
    git(cwd, ['switch', '-c', `eforge/${setName}`]);
    writeFileEnsuringDir(join(cwd, 'feature.txt'), 'feature work\n');
    git(cwd, ['add', 'feature.txt']);
    git(cwd, ['commit', '-m', 'feat: branch without artifacts']);
    git(cwd, ['switch', 'main']);

    const result = await checkResumeEligibility({
      cwd,
      setName,
      prdId: setName,
      mergeWorktreePath: join(dirname(cwd), `${setName}-worktrees`, '__merge__'),
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
    const mergeWorktreePath = join(dirname(cwd), `${setName}-worktrees`, '__merge__');

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
    const mergeWorktreePath = join(dirname(cwd), `${setName}-worktrees`, '__merge__');

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
});

// ---------------------------------------------------------------------------
// projectResumeEligibility — read-only, no side effects
// ---------------------------------------------------------------------------

describe('projectResumeEligibility — read-only eligibility projection', () => {
  it('returns ineligible with the branch name when the feature branch is missing', async () => {
    const result = await projectResumeEligibility({
      cwd: '/nonexistent-repo-for-testing',
      setName: 'test-feature',
      prdId: 'prd-test',
      mergeWorktreePath: '/nonexistent-worktree',
      outputDir: 'eforge/plans',
      dbPath: undefined,
    });

    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.featureBranch).toBe('eforge/test-feature');
      expect(result.reason).toContain('eforge/test-feature');
    }
  });

  it('reports feature-branch availability without recreating the merge worktree', async () => {
    const cwd = initRepo();
    const setName = 'feature-branch-availability';
    createFeatureBranchWithArtifacts(cwd, setName);
    const dbPath = seedFailedRunEvidence(cwd, setName);
    const mergeWorktreePath = join(dirname(cwd), `${setName}-worktrees`, '__merge__');

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
    // Read-only: the merge worktree must not have been created.
    expect(existsSync(mergeWorktreePath)).toBe(false);
  });

  it('detects branch-history availability without materializing __resume_artifacts__', async () => {
    const cwd = initRepo();
    const setName = 'history-availability';
    createFeatureBranchWithArtifacts(cwd, setName, { removeArtifactsAtTip: true });
    const dbPath = seedFailedRunEvidence(cwd, setName);
    const mergeWorktreePath = join(dirname(cwd), `${setName}-worktrees`, '__merge__');

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
    // Read-only: neither the merge worktree nor the recovery artifact copy exist.
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

    const result = await projectResumeEligibility({
      cwd,
      setName,
      prdId: setName,
      mergeWorktreePath: join(dirname(cwd), `${setName}-worktrees`, '__merge__'),
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
});

// ---------------------------------------------------------------------------
// resolveResumeSetName
// ---------------------------------------------------------------------------

describe('resolveResumeSetName — sidecar-aware set-name resolution', () => {
  it('returns summary.setName from the recovery sidecar when present', async () => {
    const cwd = makeTempDir();
    const failedDir = join(cwd, '.eforge', 'queue', 'failed');
    writeFileEnsuringDir(
      join(failedDir, 'prd-x.recovery.json'),
      JSON.stringify({ summary: { setName: 'resolved-set' } }),
    );

    const setName = await resolveResumeSetName({ prdId: 'prd-x', failedDir });
    expect(setName).toBe('resolved-set');
  });

  it('falls back to prdId when no sidecar exists', async () => {
    const cwd = makeTempDir();
    const failedDir = join(cwd, '.eforge', 'queue', 'failed');
    const setName = await resolveResumeSetName({ prdId: 'prd-fallback', failedDir });
    expect(setName).toBe('prd-fallback');
  });

  it('falls back to prdId when the sidecar lacks a valid setName', async () => {
    const cwd = makeTempDir();
    const failedDir = join(cwd, '.eforge', 'queue', 'failed');
    writeFileEnsuringDir(
      join(failedDir, 'prd-y.recovery.json'),
      JSON.stringify({ summary: {} }),
    );
    const setName = await resolveResumeSetName({ prdId: 'prd-y', failedDir });
    expect(setName).toBe('prd-y');
  });
});

// ---------------------------------------------------------------------------
// buildResumeArtifactsProjection
// ---------------------------------------------------------------------------

describe('buildResumeArtifactsProjection — recovered resume artifacts', () => {
  const review = { strategy: 'auto' as const, perspectives: ['code'], maxRounds: 1, evaluatorStrictness: 'standard' as const };
  const orchConfig = {
    name: 'feature-x',
    description: 'Feature X',
    created: '2026-01-01T00:00:00.000Z',
    mode: 'excursion' as const,
    baseBranch: 'main',
    pipeline: { scope: 'excursion' as const, compile: [], defaultBuild: [], defaultReview: review, rationale: 'resume' },
    plans: [
      { id: 'plan-01', name: 'Plan 01', dependsOn: [], branch: 'feature-x/plan-01', build: ['implement'], review },
      { id: 'plan-02', name: 'Plan 02', dependsOn: ['plan-01'], branch: 'feature-x/plan-02', build: [['test', 'pnpm test']], review },
    ],
  };

  function planFileMap() {
    return new Map([
      ['plan-01', { id: 'plan-01', name: 'Plan 01', dependsOn: [], branch: 'feature-x/plan-01', body: '# Plan 01', filePath: '/tmp/plan-01.md' }],
      ['plan-02', { id: 'plan-02', name: 'Plan 02', dependsOn: [], branch: 'feature-x/plan-02', body: '# Plan 02', filePath: '/tmp/plan-02.md' }],
    ] as const);
  }

  it('includes plan ids, names, bodies, dependencies, branches, build config, review config, orchestration, and artifact metadata', async () => {
    const projection = await buildResumeArtifactsProjection({
      cwd: makeTempDir(),
      prdId: 'prd-feature-x',
      setName: 'feature-x',
      featureBranch: 'eforge/feature-x',
      artifactSource: 'branch-history',
      artifactCommit: 'abc123',
      summary: makeFailureSummary(),
      orchConfig,
      planFileMap: planFileMap(),
    });

    expect(projection.artifactSource).toBe('branch-history');
    expect(projection.artifactCommit).toBe('abc123');
    expect(projection.orchestration.pipeline.scope).toBe('excursion');
    expect(projection.plans).toEqual([
      { id: 'plan-01', name: 'Plan 01', body: '# Plan 01', dependsOn: [], branch: 'feature-x/plan-01', build: ['implement'], review },
      { id: 'plan-02', name: 'Plan 02', body: '# Plan 02', dependsOn: ['plan-01'], branch: 'feature-x/plan-02', build: [['test', 'pnpm test']], review },
    ]);
  });

  it('uses summary PRD content before filesystem lookup', async () => {
    const projection = await buildResumeArtifactsProjection({
      cwd: makeTempDir(),
      prdId: 'prd-feature-x',
      setName: 'feature-x',
      featureBranch: 'eforge/feature-x',
      artifactSource: 'merge-worktree',
      summary: makeFailureSummary({ prdContent: '# Summary PRD' }),
      orchConfig,
      planFileMap: planFileMap(),
    });

    expect(projection.source).toEqual({ label: 'PRD prd-feature-x', content: '# Summary PRD' });
  });

  it('returns source content when .eforge/queue/failed/<prdId>.md exists', async () => {
    const cwd = makeTempDir();
    writeFileEnsuringDir(join(cwd, '.eforge', 'queue', 'failed', 'prd-feature-x.md'), '# Failed Queue PRD');

    const projection = await buildResumeArtifactsProjection({
      cwd,
      prdId: 'prd-feature-x',
      setName: 'feature-x',
      featureBranch: 'eforge/feature-x',
      artifactSource: 'merge-worktree',
      summary: makeFailureSummary(),
      orchConfig,
      planFileMap: planFileMap(),
    });

    expect(projection.source.label).toBe('.eforge/queue/failed/prd-feature-x.md');
    expect(projection.source.content).toBe('# Failed Queue PRD');
  });

  it('returns a stable source label and omits content when the PRD source is absent', async () => {
    const projection = await buildResumeArtifactsProjection({
      cwd: makeTempDir(),
      prdId: 'prd-missing',
      setName: 'feature-x',
      featureBranch: 'eforge/feature-x',
      artifactSource: 'merge-worktree',
      summary: makeFailureSummary({ prdId: 'prd-missing' }),
      orchConfig,
      planFileMap: planFileMap(),
    });

    expect(projection.source).toEqual({ label: 'PRD prd-missing' });
    expect('content' in projection.source).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// EforgeEngine.resumeBuild compile-free execution
// ---------------------------------------------------------------------------

describe('EforgeEngine.resumeBuild — compile-free execution', () => {
  it('emits a resume phase and no compile phase when compiled artifacts already exist', async () => {
    const cwd = initRepo();
    const setName = 'compile-free-resume';
    createFeatureBranchWithArtifacts(cwd, setName);
    seedFailedRunEvidence(cwd, setName);

    const engine = await EforgeEngine.create({
      cwd,
      agentRuntimes: new StubHarness([]),
      config: {
        landing: { ...DEFAULT_CONFIG.landing, action: 'leave' },
        build: {
          ...DEFAULT_CONFIG.build,
          postMergeCommands: [],
          cleanupPlanFiles: false,
          validation: {
            ...DEFAULT_CONFIG.build.validation,
            allowNoCommands: true,
            noCommandsReason: 'compile-free resume unit test',
          },
        },
      },
    });

    const events: EforgeEvent[] = [];
    for await (const event of engine.resumeBuild(setName, { cwd })) {
      events.push(event);
    }

    const phaseStarts = events.filter((event): event is Extract<EforgeEvent, { type: 'phase:start' }> => event.type === 'phase:start');
    expect(phaseStarts.map((event) => event.command)).toContain('resume');
    expect(phaseStarts.map((event) => event.command)).not.toContain('compile');
    expect(events.some((event) => event.type === 'planning:start')).toBe(false);
    expect(events.some((event) => event.type === 'planning:complete')).toBe(false);
    console.log('RESUME_EVENTS', JSON.stringify(events, null, 2));
    const artifactIndex = events.findIndex((event) => event.type === 'build:resume:artifacts');
    expect(artifactIndex).toBeGreaterThan(-1);
    const firstBuildIndex = events.findIndex((event) => event.type === 'plan:build:start');
    if (firstBuildIndex !== -1) expect(artifactIndex).toBeLessThan(firstBuildIndex);
    expect(events.some((event) => event.type === 'build:resume:state')).toBe(true);
  });
});

