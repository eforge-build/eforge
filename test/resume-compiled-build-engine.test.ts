// --- eforge:region resume-compiled-build-engine-suite ---
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
    const artifactIndex = events.findIndex((event) => event.type === 'build:resume:artifacts');
    expect(artifactIndex).toBeGreaterThan(-1);
    const firstBuildIndex = events.findIndex((event) => event.type === 'plan:build:start');
    if (firstBuildIndex !== -1) expect(artifactIndex).toBeLessThan(firstBuildIndex);
    expect(events.some((event) => event.type === 'build:resume:state')).toBe(true);
  });

  it('records the resumed artifact against the original queued PRD id and finalizes queued resume state before completion', async () => {
    const cwd = initRepo();
    const setName = 'compile-free-resume-original-prd';
    const prdId = 'original-queued-prd';
    createFeatureBranchWithArtifacts(cwd, setName);
    seedFailedRunEvidence(cwd, setName);
    writeFileEnsuringDir(join(cwd, '.eforge', 'queue', 'failed', `${prdId}.md`), `---
title: Original Queued PRD
created: 2026-01-01
---

# Original Queued PRD
`);
    writeFileEnsuringDir(join(cwd, '.eforge', 'queue', 'failed', `${prdId}.recovery.md`), '# Recovery\n');
    writeFileEnsuringDir(join(cwd, '.eforge', 'queue', 'skipped', 'child-prd.md'), `---
title: Child PRD
created: 2026-01-01
depends_on: ["${prdId}"]
---

# Child PRD
`);
    writeFileEnsuringDir(join(cwd, '.eforge', 'artifacts', 'completions.json'), JSON.stringify({
      version: 1,
      completions: { [prdId]: { prdId, status: 'failed', artifactAvailable: false, completedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' } },
    }));
    writeFileEnsuringDir(join(cwd, '.eforge', 'queue', 'failed', `${prdId}.recovery.json`), JSON.stringify({
      summary: { setName },
      verdict: { verdict: 'resume', confidence: 'high' },
    }));

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
            noCommandsReason: 'compile-free resume artifact unit test',
          },
        },
      },
    });

    const events: EforgeEvent[] = [];
    let checkedCompleteSideEffects = false;
    for await (const event of engine.resumeBuild(prdId, { cwd })) {
      events.push(event);
      if (event.type === 'build:resume:complete') {
        checkedCompleteSideEffects = true;
        const completions = await loadCompletionRegistry(cwd);
        expect(existsSync(join(cwd, '.eforge', 'queue', `${prdId}.md`))).toBe(false);
        expect(existsSync(join(cwd, '.eforge', 'queue', 'failed', `${prdId}.md`))).toBe(false);
        expect(existsSync(join(cwd, '.eforge', 'queue', 'failed', `${prdId}.recovery.md`))).toBe(false);
        expect(existsSync(join(cwd, '.eforge', 'queue', 'failed', `${prdId}.recovery.json`))).toBe(false);
        expect(existsSync(join(cwd, '.eforge', 'queue-locks', `${prdId}.lock`))).toBe(false);
        expect(existsSync(join(cwd, '.eforge', 'queue', 'child-prd.md'))).toBe(true);
        expect(completions.completions[prdId].status).toBe('completed');
        expect(completions.completions[prdId].artifactAvailable).toBe(true);
      }
    }

    const registry = await loadArtifactRegistry(cwd);
    expect(registry.builds).toEqual(expect.arrayContaining([
      expect.objectContaining({ prdId, status: 'built' }),
    ]));
    expect(checkedCompleteSideEffects).toBe(true);
    expect(events.filter((event) => event.type === 'build:resume:complete')).toHaveLength(1);
  });

  it('rolls back queued resume state when the resumed build becomes ineligible after queue activation', async () => {
    const cwd = initRepo();
    const setName = 'missing-resume-artifacts';
    const prdId = 'queued-ineligible-prd';
    seedFailedRunEvidence(cwd, setName);
    writeFileEnsuringDir(join(cwd, '.eforge', 'queue', 'failed', `${prdId}.md`), `---
title: Queued Ineligible PRD
created: 2026-01-01
---

# Queued Ineligible PRD
`);
    writeFileEnsuringDir(join(cwd, '.eforge', 'queue', 'failed', `${prdId}.recovery.md`), '# Recovery\n');
    writeFileEnsuringDir(join(cwd, '.eforge', 'queue', 'failed', `${prdId}.recovery.json`), JSON.stringify({
      summary: { setName },
      verdict: { verdict: 'resume', confidence: 'high' },
    }));
    writeFileEnsuringDir(join(cwd, '.eforge', 'queue', 'skipped', 'child-prd.md'), `---
title: Child PRD
created: 2026-01-01
depends_on: ["${prdId}"]
---

# Child PRD
`);

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
            noCommandsReason: 'compile-free resume rollback unit test',
          },
        },
      },
    });

    const events: EforgeEvent[] = [];
    for await (const event of engine.resumeBuild(prdId, { cwd })) {
      events.push(event);
    }

    expect(events.some((event) => event.type === 'build:resume:ineligible')).toBe(true);
    expect(events.some((event) => event.type === 'build:resume:complete')).toBe(false);
    expect(existsSync(join(cwd, '.eforge', 'queue', 'failed', `${prdId}.md`))).toBe(true);
    expect(existsSync(join(cwd, '.eforge', 'queue', `${prdId}.md`))).toBe(false);
    expect(existsSync(join(cwd, '.eforge', 'queue-locks', `${prdId}.lock`))).toBe(false);
    expect(existsSync(join(cwd, '.eforge', 'queue', 'skipped', 'child-prd.md'))).toBe(true);
    expect(existsSync(join(cwd, '.eforge', 'queue', 'waiting', 'child-prd.md'))).toBe(false);
    expect(existsSync(join(cwd, '.eforge', 'queue', 'failed', `${prdId}.recovery.md`))).toBe(true);
    expect(existsSync(join(cwd, '.eforge', 'queue', 'failed', `${prdId}.recovery.json`))).toBe(true);
  });
});
// --- eforge:endregion resume-compiled-build-engine-suite ---
