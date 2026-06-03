// --- eforge:region resume-seed-state-suite ---
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

    const plans: PlanSummaryEntry[] = [
      makePlanSummary('plan-05', { status: 'completed', mergedAt: '' }),
    ];
    const result = deriveResumeSeedState(plans);
    expect(result.seededPending).toContain('plan-05');
    expect(result.seededMerged).not.toContain('plan-05');
  });
});

describe('synthesizeFromEvents — resume run selection', () => {
  it('selects a newer failed resume run with plan-state evidence over the original failed build', () => {
    const cwd = makeTempDir();
    const setName = 'repeated-resume-selection';
    const dbPath = seedRecoveryRunSelectionFixture(cwd, setName, 'failed');

    const fragment = synthesizeFromEvents({ setName, prdId: setName, dbPath });

    expect(fragment?.failingPlan?.planId).toBe('plan-07');
    const seed = deriveResumeSeedState(fragment?.plans ?? []);
    expect(seed.seededMerged).toEqual(expect.arrayContaining(['plan-05', 'plan-06']));
    expect(seed.seededPending).toContain('plan-07');
  });

  it('ignores a newer running resume run and keeps the failed build fragment', () => {
    const cwd = makeTempDir();
    const setName = 'running-resume-guard';
    const dbPath = seedRecoveryRunSelectionFixture(cwd, setName, 'running');

    const fragment = synthesizeFromEvents({ setName, prdId: setName, dbPath });

    expect(fragment?.failingPlan?.planId).toBe('plan-05');
    expect(fragment?.plans.map((plan) => plan.planId)).not.toContain('plan-07');
  });
});

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


    expect(state.plans['plan-02'].status).toBe('pending');

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

    for (const id of ['plan-01', 'plan-02', 'plan-03']) {
      expect(state.plans[id].status).toBe('pending');
    }
  });
});

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
// --- eforge:endregion resume-seed-state-suite ---
