// --- eforge:region resume-artifacts-projection-suite ---
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

  it('falls back to prdId when the recovery sidecar JSON is malformed', async () => {
    const cwd = makeTempDir();
    const failedDir = join(cwd, '.eforge', 'queue', 'failed');
    writeFileEnsuringDir(join(failedDir, 'prd-bad.recovery.json'), '{ not json');

    const setName = await resolveResumeSetName({ prdId: 'prd-bad', failedDir });
    expect(setName).toBe('prd-bad');
  });
});

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
// --- eforge:endregion resume-artifacts-projection-suite ---
