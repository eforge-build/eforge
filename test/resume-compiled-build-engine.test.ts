// --- eforge:region resume-compiled-build-engine-suite ---
// Split from resume-compiled-build-engine.test.ts.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { synthesizeFromEvents } from '@eforge-build/engine/recovery/event-history';
import { deriveResumeSeedState, formatResumeContext, checkResumeEligibility, buildResumeArtifactsProjection, projectResumeEligibility, resolveResumeSetName } from '@eforge-build/engine/resume/compiled-build';
import { applyResumeSeed, initializeState, type ResumeSeedOptions } from '@eforge-build/engine/orchestrator';
import { EforgeEngine } from '@eforge-build/engine/eforge';
import { finalizeFailedQueuedResumeSidecars } from '@eforge-build/engine/recovery/failed-resume-sidecar-finalization';
import { DEFAULT_CONFIG } from '@eforge-build/engine/config';
import { loadArtifactRegistry } from '@eforge-build/engine/artifacts/registry';
import { loadCompletionRegistry } from '@eforge-build/engine/artifacts/completions';
import { openDatabase } from '@eforge-build/monitor/db';
import { withRecording } from '@eforge-build/monitor/recorder';
import type { PlanSummaryEntry, BuildFailureSummary, EforgeEvent, AgentRole } from '@eforge-build/engine/events';
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

function minimalV3Sidecar(prdId: string, setName: string, failingPlanId = 'old-plan'): string {
  const generatedAt = new Date().toISOString();
  return JSON.stringify({
    schemaVersion: 3,
    generatedAt,
    prdId,
    setName,
    verdict: { verdict: 'manual', confidence: 'low', rationale: 'old', completedWork: [], remainingWork: [], risks: [] },
    report: { operatorSummary: 'old', recommendedAction: 'Review manually.', keyEvidence: [], completedWork: [], remainingWork: [], risks: [] },
    boundedEvidence: {
      identity: { prdId, setName, featureBranch: `eforge/${setName}`, baseBranch: 'main', failedAt: generatedAt },
      plans: [],
      failingPlan: { planId: failingPlanId },
      landedCommits: [],
      modelsUsed: [],
    },
  });
}

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

function writeCompiledPlanSet(cwd: string, setName: string, opts: { validate?: string[]; includePlan02?: boolean } = {}): void {
  const validate = opts.validate ?? [];
  const plan02Yaml = opts.includePlan02 ? `  - id: plan-02
    name: Plan 02
    depends_on:
      - plan-01
    branch: ${setName}/plan-02
    build:
      - implement
    review:
      strategy: auto
      perspectives:
        - code
      maxRounds: 1
      evaluatorStrictness: standard
` : '';
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
${plan02Yaml}pipeline:
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
  if (opts.includePlan02) {
    writeFileEnsuringDir(join(cwd, 'eforge', 'plans', setName, 'plan-02.md'), `---
id: plan-02
name: Plan 02
---

# Plan 02
`);
  }
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
  writeFileEnsuringDir(join(cwd, '.eforge', 'queue', 'failed', `${setName}.recovery.json`), minimalV3Sidecar(setName, setName, 'plan-01'));
  return dbPath;
}

function seedFailedRunEvidenceWithSyntheticAcceptance(cwd: string, setName: string, opts: { merged?: boolean } = {}): string {
  const dbPath = seedFailedRunEvidence(cwd, setName);
  const db = openDatabase(dbPath);
  const runId = `run-${setName}`;
  const ts = '2026-01-01T00:01:00.000Z';
  if (opts.merged) {
    db.insertEvent({ runId, type: 'plan:status:change', planId: 'acceptance-validation', data: JSON.stringify({ type: 'plan:status:change', planId: 'acceptance-validation', status: 'completed', timestamp: ts }), timestamp: ts });
    db.insertEvent({ runId, type: 'plan:merge:complete', planId: 'acceptance-validation', data: JSON.stringify({ type: 'plan:merge:complete', planId: 'acceptance-validation', commitSha: 'def456', timestamp: ts }), timestamp: ts });
  } else {
    db.insertEvent({ runId, type: 'plan:status:change', planId: 'acceptance-validation', data: JSON.stringify({ type: 'plan:status:change', planId: 'acceptance-validation', status: 'failed', timestamp: ts }), timestamp: ts });
    db.insertEvent({ runId, type: 'plan:build:failed', planId: 'acceptance-validation', data: JSON.stringify({ type: 'plan:build:failed', planId: 'acceptance-validation', error: 'acceptance validation failed', timestamp: ts }), timestamp: ts });
  }
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

function seedRecoveryRunSelectionFixture(cwd: string, setName: string, newerResumeStatus: 'failed' | 'running', opts: { prdId?: string; featureBranch?: string; baseBranch?: string } = {}): string {
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
  insertRecoverySelectionEvent(db, resumeRunId, 'build:resume:start', undefined, t1, { prdId: opts.prdId ?? setName, setName, featureBranch: opts.featureBranch ?? `eforge/${setName}`, baseBranch: opts.baseBranch ?? 'main' });
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

function seedFailedQueuedResumePrd(cwd: string, prdId: string, setName: string, location: 'failed' | 'root' = 'failed', opts: { featureBranch?: string; baseBranch?: string } = {}): void {
  const dir = location === 'failed' ? join(cwd, '.eforge', 'queue', 'failed') : join(cwd, '.eforge', 'queue');
  writeFileEnsuringDir(join(dir, `${prdId}.md`), `---
title: Queued Resume PRD
created: 2026-01-01
resume_mode: compiled
resume_from: ${prdId}
resume_set_name: ${setName}
resume_feature_branch: ${opts.featureBranch ?? `eforge/${setName}`}
resume_base_branch: ${opts.baseBranch ?? 'main'}
---

# Queued Resume PRD
`);
}

function recoveryAnalystManualXml(planId: string): string {
  return `<recovery verdict="manual" confidence="low"><rationale>Manual review for ${planId}</rationale><completed_work></completed_work><remaining_work><item>${planId}</item></remaining_work><risks></risks></recovery>`;
}

class RoleRecordingStubHarness extends StubHarness {
  readonly roles: AgentRole[] = [];
  readonly planIds: (string | undefined)[] = [];

  override async *run(options: Parameters<StubHarness['run']>[0], agent: AgentRole, planId?: string): ReturnType<StubHarness['run']> {
    this.roles.push(agent);
    this.planIds.push(planId);
    yield* super.run(options, agent, planId);
  }
}

function createFeatureBranchWithArtifacts(cwd: string, setName: string, opts: { removeArtifactsAtTip?: boolean; includePlan02?: boolean } = {}): void {
  git(cwd, ['switch', '-c', `eforge/${setName}`]);
  writeCompiledPlanSet(cwd, setName, { includePlan02: opts.includePlan02 });
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
  it('emits a continue-repair phase and no compile phase when compiled artifacts already exist', async () => {
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
    expect(phaseStarts.map((event) => event.command)).toContain('continue-repair');
    expect(phaseStarts.map((event) => event.command)).not.toContain('compile');
    expect(events.some((event) => event.type === 'planning:start')).toBe(false);
    expect(events.some((event) => event.type === 'planning:complete')).toBe(false);
    const artifactIndex = events.findIndex((event) => event.type === 'build:resume:artifacts');
    expect(artifactIndex).toBeGreaterThan(-1);
    const firstBuildIndex = events.findIndex((event) => event.type === 'plan:build:start');
    if (firstBuildIndex !== -1) expect(artifactIndex).toBeLessThan(firstBuildIndex);
    expect(events.some((event) => event.type === 'build:resume:state')).toBe(true);
  });

  it('filters synthetic acceptance-validation evidence from emitted resume state and artifacts', async () => {
    const cwd = initRepo();
    const setName = 'synthetic-acceptance-resume';
    createFeatureBranchWithArtifacts(cwd, setName);
    seedFailedRunEvidenceWithSyntheticAcceptance(cwd, setName);

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
            noCommandsReason: 'synthetic resume lane filter unit test',
          },
        },
      },
    });

    const events: EforgeEvent[] = [];
    for await (const event of engine.resumeBuild(setName, { cwd })) {
      events.push(event);
    }

    const resumeState = events.find((event): event is Extract<EforgeEvent, { type: 'build:resume:state' }> => event.type === 'build:resume:state');
    expect(resumeState).toBeDefined();
    expect(resumeState!.seededMerged).toEqual(['plan-01']);
    expect(resumeState!.seededPending).toEqual([]);

    const artifacts = events.find((event): event is Extract<EforgeEvent, { type: 'build:resume:artifacts' }> => event.type === 'build:resume:artifacts');
    expect(artifacts).toBeDefined();
    expect(artifacts!.plans.map((plan) => plan.id)).toEqual(['plan-01']);
  });

  it('builds resume context only for filtered real pending plan ids', async () => {
    const cwd = initRepo();
    const setName = 'real-pending-synthetic-acceptance-resume';
    createFeatureBranchWithArtifacts(cwd, setName, { includePlan02: true });
    seedFailedRunEvidenceWithSyntheticAcceptance(cwd, setName, { merged: true });

    const harness = new RoleRecordingStubHarness([{ error: new Error('stop after builder prompt') }]);
    const engine = await EforgeEngine.create({
      cwd,
      agentRuntimes: harness,
      config: {
        landing: { ...DEFAULT_CONFIG.landing, action: 'leave' },
        build: {
          ...DEFAULT_CONFIG.build,
          postMergeCommands: [],
          cleanupPlanFiles: false,
          validation: {
            ...DEFAULT_CONFIG.build.validation,
            allowNoCommands: true,
            noCommandsReason: 'resume context filtering unit test',
          },
        },
      },
    });

    const events: EforgeEvent[] = [];
    for await (const event of engine.resumeBuild(setName, { cwd })) {
      events.push(event);
    }

    const resumeState = events.find((event): event is Extract<EforgeEvent, { type: 'build:resume:state' }> => event.type === 'build:resume:state');
    expect(resumeState?.seededMerged).toEqual(['plan-01']);
    expect(resumeState?.seededPending).toEqual(['plan-02']);
    expect(harness.roles).toEqual(['builder']);
    expect(harness.planIds).toEqual(['plan-02']);
    expect(harness.prompts).toHaveLength(1);
    expect(harness.prompts[0]).toContain('plan-02');
    expect(harness.prompts[0]).not.toContain('acceptance-validation');
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
      schemaVersion: 3,
      generatedAt: '2026-01-01T00:00:00.000Z',
      prdId,
      setName,
      verdict: { verdict: 'manual', confidence: 'high', rationale: 'Resume queued work.', completedWork: [], remainingWork: [], risks: [] },
      report: { operatorSummary: 'Resume queued work.', recommendedAction: 'Resume the compiled build.', keyEvidence: [], completedWork: [], remainingWork: [], risks: [] },
      boundedEvidence: {
        identity: { prdId, setName, featureBranch: `eforge/${setName}`, baseBranch: 'main', failedAt: '2026-01-01T00:00:00.000Z' },
        plans: [],
        failingPlan: { planId: 'plan-01' },
        landedCommits: [],
        modelsUsed: [],
      },
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
            allowNoAcceptanceCriteria: true,
            noAcceptanceCriteriaReason: 'direct resume side-effect test does not configure a PRD validator',
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
        expect(existsSync(join(cwd, '.eforge', 'queue', 'skipped', 'child-prd.md'))).toBe(false);
        expect(existsSync(join(cwd, '.eforge', 'queue', 'waiting', 'child-prd.md'))).toBe(false);
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
    const originalRecoveryMd = '# Recovery\n';
    const generatedAt = '2026-01-01T00:00:00.000Z';
    const originalRecoveryJson = JSON.stringify({
      schemaVersion: 3,
      generatedAt,
      prdId,
      setName,
      verdict: { verdict: 'manual', confidence: 'high', rationale: 'Resume rollback fixture.', completedWork: [], remainingWork: [], risks: [] },
      report: { operatorSummary: 'Resume rollback fixture.', recommendedAction: 'Review manually.', keyEvidence: [], completedWork: [], remainingWork: [], risks: [] },
      boundedEvidence: {
        identity: { prdId, setName, featureBranch: `eforge/${setName}`, baseBranch: 'main', failedAt: generatedAt },
        plans: [],
        failingPlan: { planId: 'old-plan' },
        landedCommits: [],
        modelsUsed: [],
      },
    });
    writeFileEnsuringDir(join(cwd, '.eforge', 'queue', 'failed', `${prdId}.recovery.md`), originalRecoveryMd);
    writeFileEnsuringDir(join(cwd, '.eforge', 'queue', 'failed', `${prdId}.recovery.json`), originalRecoveryJson);
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
    expect(readFileSync(join(cwd, '.eforge', 'queue', 'failed', `${prdId}.recovery.md`), 'utf-8')).toBe(originalRecoveryMd);
    expect(readFileSync(join(cwd, '.eforge', 'queue', 'failed', `${prdId}.recovery.json`), 'utf-8')).toBe(originalRecoveryJson);
  });

  it('preserves non-default compiled-resume branch metadata in refreshed sidecars', async () => {
    const cwd = initRepo();
    const prdId = 'non-default-metadata-prd';
    const setName = 'non-default-metadata-set';
    const featureBranch = 'custom/resume-feature';
    const baseBranch = 'release/base';
    const failedDir = join(cwd, '.eforge', 'queue', 'failed');
    writeFileEnsuringDir(join(failedDir, `${prdId}.md`), '# PRD\n');
    seedRecoveryRunSelectionFixture(cwd, setName, 'failed', { prdId, featureBranch, baseBranch });

    const result = await finalizeFailedQueuedResumeSidecars({
      cwd,
      prdId,
      setName,
      featureBranch,
      baseBranch,
      agentRuntimes: new StubHarness([{ text: recoveryAnalystManualXml('plan-07') }]),
      config: DEFAULT_CONFIG,
      resumeRunId: `run-${setName}-resume`,
    });

    expect(result.status).toBe('refreshed');
    const parsed = JSON.parse(readFileSync(join(failedDir, `${prdId}.recovery.json`), 'utf-8')) as any;
    const md = readFileSync(join(failedDir, `${prdId}.recovery.md`), 'utf-8');
    expect(parsed.setName).toBe(setName);
    expect(parsed.boundedEvidence.failingPlan.planId).toBe('plan-07');
    expect(parsed.boundedEvidence.identity.featureBranch).toBe(featureBranch);
    expect(parsed.boundedEvidence.identity.baseBranch).toBe(baseBranch);
    expect(md).toContain(featureBranch);
    expect(md).toContain(baseBranch);
  });

  it('refreshes sidecars for failed queued resume with acceptance-validation terminal evidence and no plan events', async () => {
    const cwd = initRepo();
    const prdId = 'acceptance-terminal-resume-prd';
    const setName = 'acceptance-terminal-resume-set';
    createFeatureBranchWithArtifacts(cwd, setName);
    seedFailedQueuedResumePrd(cwd, prdId, setName);
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    const runId = 'acceptance-terminal-resume-run';
    const ts = '2026-01-01T00:00:00.000Z';
    db.insertRun({ id: runId, planSet: setName, command: 'continue-repair', status: 'failed', startedAt: ts, cwd });
    insertRecoverySelectionEvent(db, runId, 'build:resume:start', undefined, ts, { prdId, setName });
    insertRecoverySelectionEvent(db, runId, 'prd_validation:complete', undefined, ts, { passed: true, gaps: [], completionPercent: 99 });
    insertRecoverySelectionEvent(db, runId, 'acceptance_validation:complete', undefined, ts, { passed: false, verdicts: [{ criterion: 'C1', verdict: 'unknown', evidence: 'Needs resolver evidence.' }], source: 'prd' });
    insertRecoverySelectionEvent(db, runId, 'build:terminal-failure', undefined, ts, { runId, failure: { scope: 'acceptance-validation', message: 'Acceptance criteria validation inconclusive', authoritative: true, sourceEventType: 'acceptance_validation:complete', acceptanceValidationPassed: false } });
    insertRecoverySelectionEvent(db, runId, 'phase:end', undefined, ts, { runId, result: { status: 'failed', summary: 'Acceptance criteria validation failed' } });
    db.close();

    const result = await finalizeFailedQueuedResumeSidecars({
      cwd,
      prdId,
      setName,
      featureBranch: `eforge/${setName}`,
      baseBranch: 'main',
      agentRuntimes: new StubHarness([{ text: recoveryAnalystManualXml('acceptance-validation') }]),
      config: DEFAULT_CONFIG,
      resumeRunId: runId,
    });

    expect(result.status).toBe('refreshed');
    const parsed = JSON.parse(readFileSync(join(cwd, '.eforge', 'queue', 'failed', `${prdId}.recovery.json`), 'utf-8')) as any;
    expect(parsed.boundedEvidence.terminalFailure.scope).toBe('acceptance-validation');
    expect(parsed.boundedEvidence.acceptanceValidation.passed).toBe(false);
    expect(parsed.boundedEvidence.landedCommits.length).toBeGreaterThan(0);
  });

  it('writes degraded manual sidecar for activated resume evidence without summarizable plan evidence', async () => {
    const cwd = initRepo();
    const prdId = 'degraded-evidence-prd';
    const setName = 'degraded-evidence-set';
    const failedDir = join(cwd, '.eforge', 'queue', 'failed');
    writeFileEnsuringDir(join(failedDir, `${prdId}.md`), '# PRD\n');
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    const runId = 'current-incomplete-resume';
    const ts = '2026-01-01T00:00:00.000Z';
    db.insertRun({ id: runId, planSet: setName, command: 'resume', status: 'running', startedAt: ts, cwd });
    insertRecoverySelectionEvent(db, runId, 'build:resume:start', undefined, ts, { prdId, setName });
    db.close();

    const result = await finalizeFailedQueuedResumeSidecars({
      cwd,
      prdId,
      setName,
      featureBranch: `eforge/${setName}`,
      baseBranch: 'main',
      agentRuntimes: new StubHarness([]),
      config: DEFAULT_CONFIG,
      resumeRunId: runId,
    });

    expect(result.status).toBe('degraded');
    const parsed = JSON.parse(readFileSync(join(failedDir, `${prdId}.recovery.json`), 'utf-8')) as any;
    expect(parsed.boundedEvidence.identity.partial).toBe(true);
    expect(parsed.boundedEvidence.failingPlan.planId).toBe('unknown');
    expect(parsed.verdict.verdict).toBe('manual');
    expect(parsed.verdict.confidence).toBe('low');
    expect(parsed.verdict.partial).toBe(true);
    expect(parsed.verdict.recoveryError).toContain('incomplete or not summarizable');
  });

  it('invalidates old sidecars when failed-resume sidecar rewrite fails', async () => {
    const cwd = initRepo();
    const prdId = 'rewrite-failure-prd';
    const setName = 'rewrite-failure-set';
    const failedDir = join(cwd, '.eforge', 'queue', 'failed');
    writeFileEnsuringDir(join(failedDir, `${prdId}.md`), '# PRD\n');
    writeFileEnsuringDir(join(failedDir, `${prdId}.recovery.md`), '# Old\n');
    writeFileEnsuringDir(join(failedDir, `${prdId}.recovery.json`), '{"old":true}\n');
    mkdirSync(join(failedDir, `${prdId}.recovery.json.tmp`), { recursive: true });

    const result = await finalizeFailedQueuedResumeSidecars({
      cwd,
      prdId,
      setName,
      featureBranch: `eforge/${setName}`,
      baseBranch: 'main',
      agentRuntimes: new StubHarness([]),
      config: DEFAULT_CONFIG,
      activationReached: true,
      degradedReason: 'forced rewrite failure',
    });

    expect(result.status).toBe('invalidated');
    expect(existsSync(join(failedDir, `${prdId}.recovery.md`))).toBe(false);
    expect(existsSync(join(failedDir, `${prdId}.recovery.json`))).toBe(false);
  });

  it('replaces old sidecars after direct queued resume fails after activation', async () => {
    const cwd = initRepo();
    const setName = 'activated-resume-sidecars';
    const prdId = 'activated-resume-prd';
    createFeatureBranchWithArtifacts(cwd, setName);
    seedRecoveryRunSelectionFixture(cwd, setName, 'failed');
    seedFailedQueuedResumePrd(cwd, prdId, setName);
    writeFileEnsuringDir(join(cwd, '.eforge', 'queue', 'failed', `${prdId}.recovery.md`), '# Old recovery for plan-01\n');
    writeFileEnsuringDir(join(cwd, '.eforge', 'queue', 'failed', `${prdId}.recovery.json`), minimalV3Sidecar(prdId, setName, 'plan-01'));

    const harness = new RoleRecordingStubHarness([{ error: new Error('resume builder failure') }, { text: recoveryAnalystManualXml('plan-01') }]);
    const engine = await EforgeEngine.create({ cwd, agentRuntimes: harness, config: { landing: { ...DEFAULT_CONFIG.landing, action: 'leave' }, build: { ...DEFAULT_CONFIG.build, postMergeCommands: [], cleanupPlanFiles: false, validation: { ...DEFAULT_CONFIG.build.validation, allowNoCommands: true, noCommandsReason: 'direct failed resume sidecar test' } } } });
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    const events: EforgeEvent[] = [];
    let currentRunId: string | undefined;
    try {
      for await (const event of withRecording(engine.resumeBuild(prdId, { cwd }), db, cwd)) {
        events.push(event);
        if (event.type === 'phase:start' && event.command === 'continue-repair') currentRunId = event.runId;
        if (event.type === 'build:resume:start' && currentRunId !== undefined) {
          const now = new Date().toISOString();
          insertRecoverySelectionEvent(db, currentRunId, 'plan:status:change', 'plan-01', now, { status: 'failed' });
          insertRecoverySelectionEvent(db, currentRunId, 'plan:build:failed', 'plan-01', now, { error: 'current direct resume failure' });
        }
      }
    } finally {
      db.close();
    }

    expect(events.some((event) => event.type === 'build:resume:start')).toBe(true);
    expect(events.some((event) => event.type === 'build:resume:complete')).toBe(false);
    const parsed = JSON.parse(readFileSync(join(cwd, '.eforge', 'queue', 'failed', `${prdId}.recovery.json`), 'utf-8')) as any;
    const md = readFileSync(join(cwd, '.eforge', 'queue', 'failed', `${prdId}.recovery.md`), 'utf-8');
    expect(parsed.setName).toBe(setName);
    expect(parsed.boundedEvidence.failingPlan.planId).toBe('plan-01');
    expect(harness.roles).toEqual(['builder', 'recovery-analyst']);
    expect(parsed.verdict.verdict).toBe('continue-repair');
    expect(parsed.verdict.recommendationSource).toBe('deterministic');
    expect(parsed.verdict.recommendationRationale).toContain('Compiled plan artifacts are eligible');
    expect(md).toContain(setName);
    expect(md).toContain('plan-01');
  });

  it('does not refresh old sidecars when direct queued resume rollback is blocked', async () => {
    const cwd = initRepo();
    const setName = 'blocked-rollback-sidecars';
    const prdId = 'blocked-rollback-prd';
    createFeatureBranchWithArtifacts(cwd, setName);
    seedFailedQueuedResumePrd(cwd, prdId, setName);
    const oldMd = '# Old recovery stays authoritative until manual cleanup\n';
    const oldJson = minimalV3Sidecar(prdId, setName, 'plan-01');
    writeFileEnsuringDir(join(cwd, '.eforge', 'queue', 'failed', `${prdId}.recovery.md`), oldMd);
    writeFileEnsuringDir(join(cwd, '.eforge', 'queue', 'failed', `${prdId}.recovery.json`), oldJson);

    const harness = new RoleRecordingStubHarness([{ error: new Error('resume builder failure') }, { text: recoveryAnalystManualXml('plan-01') }]);
    const engine = await EforgeEngine.create({ cwd, agentRuntimes: harness, config: { landing: { ...DEFAULT_CONFIG.landing, action: 'leave' }, build: { ...DEFAULT_CONFIG.build, postMergeCommands: [], cleanupPlanFiles: false, validation: { ...DEFAULT_CONFIG.build.validation, allowNoCommands: true, noCommandsReason: 'blocked rollback sidecar test' } } } });
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    const events: EforgeEvent[] = [];
    let currentRunId: string | undefined;
    try {
      for await (const event of withRecording(engine.resumeBuild(prdId, { cwd }), db, cwd)) {
        events.push(event);
        if (event.type === 'phase:start' && event.command === 'continue-repair') currentRunId = event.runId;
        if (event.type === 'build:resume:start' && currentRunId !== undefined) {
          const now = new Date().toISOString();
          writeFileEnsuringDir(join(cwd, '.eforge', 'queue', 'failed', `${prdId}.md`), '# Collision PRD\n');
          insertRecoverySelectionEvent(db, currentRunId, 'plan:status:change', 'plan-01', now, { status: 'failed' });
          insertRecoverySelectionEvent(db, currentRunId, 'plan:build:failed', 'plan-01', now, { error: 'current blocked resume failure' });
          db.updateRunStatus(currentRunId, 'failed', now);
        }
      }
    } finally {
      db.close();
    }

    expect(events.some((event) => event.type === 'build:resume:start')).toBe(true);
    expect(events.some((event) => event.type === 'build:resume:complete')).toBe(false);
    expect(events.some((event) => event.type === 'phase:end' && event.result.summary.includes('rollback blocked'))).toBe(true);
    expect(harness.roles).toEqual(['builder']);
    expect(readFileSync(join(cwd, '.eforge', 'queue', 'failed', `${prdId}.recovery.md`), 'utf-8')).toBe(oldMd);
    expect(readFileSync(join(cwd, '.eforge', 'queue', 'failed', `${prdId}.recovery.json`), 'utf-8')).toBe(oldJson);
  });

  it('records success-finalization failure in a degraded manual sidecar', async () => {
    const cwd = initRepo();
    const setName = 'scheduler-degraded-sidecars';
    const prdId = 'scheduler-degraded-prd';
    const failedDir = join(cwd, '.eforge', 'queue', 'failed');
    writeFileEnsuringDir(join(failedDir, `${prdId}.md`), '# PRD\n');
    const reason = `Cannot finalize queued resume for ${prdId}: no usable built artifact exists.`;

    const result = await finalizeFailedQueuedResumeSidecars({
      cwd,
      prdId,
      setName,
      featureBranch: `eforge/${setName}`,
      baseBranch: 'main',
      agentRuntimes: new StubHarness([]),
      config: DEFAULT_CONFIG,
      activationReached: true,
      degradedReason: reason,
    });

    expect(result.status).toBe('degraded');
    const parsed = JSON.parse(readFileSync(join(failedDir, `${prdId}.recovery.json`), 'utf-8')) as any;
    expect(parsed.boundedEvidence.identity.partial).toBe(true);
    expect(parsed.boundedEvidence.failingPlan.planId).toBe('unknown');
    expect(parsed.verdict.verdict).toBe('manual');
    expect(parsed.verdict.confidence).toBe('low');
    expect(parsed.verdict.recoveryError).toBe(reason);
  });

  it('refreshes scheduler-owned failed compiled-resume sidecars before queue completion', async () => {
    const cwd = initRepo();
    const setName = 'scheduler-resume-sidecars';
    const prdId = 'scheduler-resume-prd';
    createFeatureBranchWithArtifacts(cwd, setName);
    seedRecoveryRunSelectionFixture(cwd, setName, 'failed');
    seedFailedQueuedResumePrd(cwd, prdId, setName, 'root');
    writeFileEnsuringDir(join(cwd, '.eforge', 'queue', 'failed', `${prdId}.recovery.md`), '# Old scheduler recovery\n');
    writeFileEnsuringDir(join(cwd, '.eforge', 'queue', 'failed', `${prdId}.recovery.json`), minimalV3Sidecar(prdId, setName));
    writeFileEnsuringDir(join(cwd, '.eforge', 'queue', 'waiting', 'child-prd.md'), `---
title: Child PRD
created: 2026-01-01
depends_on: ["${prdId}"]
---

# Child PRD
`);
    const cliPath = join(cwd, 'fake-eforge-cli.js');
    writeFileSync(cliPath, `const { DatabaseSync } = require('node:sqlite');
const { join } = require('node:path');
const sessionId = process.argv[process.argv.indexOf('--session-id') + 1];
const cwd = process.cwd();
const runId = 'child-resume-run';
const ts = new Date().toISOString();
const db = new DatabaseSync(join(cwd, '.eforge', 'monitor.db'));
db.prepare('INSERT INTO runs (id, session_id, plan_set, command, status, started_at, cwd) VALUES (?, ?, ?, ?, ?, ?, ?)').run(runId, sessionId, '${setName}', 'resume', 'failed', ts, cwd);
function insert(type, planId, data = {}) {
  db.prepare('INSERT INTO events (run_id, type, plan_id, data, timestamp) VALUES (?, ?, ?, ?, ?)').run(runId, type, planId ?? null, JSON.stringify({ type, ...(planId ? { planId } : {}), ...data, timestamp: ts }), ts);
}
insert('build:resume:start', null, { prdId: '${prdId}', setName: '${setName}', featureBranch: 'eforge/${setName}' });
insert('plan:status:change', 'plan-07', { status: 'failed' });
insert('plan:build:failed', 'plan-07', { error: 'resume failure' });
db.close();
process.exit(1);
`, 'utf-8');
    const oldCliPath = process.env.EFORGE_CLI_PATH;
    process.env.EFORGE_CLI_PATH = cliPath;
    let checkedAtComplete = false;
    const harness = new StubHarness([{ text: recoveryAnalystManualXml('plan-07') }]);
    try {
      const engine = await EforgeEngine.create({ cwd, agentRuntimes: harness, config: { landing: { ...DEFAULT_CONFIG.landing, action: 'leave' }, build: { ...DEFAULT_CONFIG.build, postMergeCommands: [], cleanupPlanFiles: false, validation: { ...DEFAULT_CONFIG.build.validation, allowNoCommands: true, noCommandsReason: 'scheduler sidecar test' } } } });
      for await (const event of engine.runQueue({ name: prdId, cwd })) {
        if (event.type === 'queue:prd:complete' && event.prdId === prdId) {
          checkedAtComplete = true;
          expect(existsSync(join(cwd, '.eforge', 'queue', 'failed', `${prdId}.md`))).toBe(true);
          expect(existsSync(join(cwd, '.eforge', 'queue', 'failed', `${prdId}.recovery.md`))).toBe(true);
          expect(existsSync(join(cwd, '.eforge', 'queue', 'failed', `${prdId}.recovery.json`))).toBe(true);
          const parsed = JSON.parse(readFileSync(join(cwd, '.eforge', 'queue', 'failed', `${prdId}.recovery.json`), 'utf-8')) as any;
          const md = readFileSync(join(cwd, '.eforge', 'queue', 'failed', `${prdId}.recovery.md`), 'utf-8');
          expect(parsed.setName).toBe(setName);
          expect(parsed.boundedEvidence.failingPlan.planId).toBe('plan-07');
          expect(harness.calls.some((call) => call.prompt.includes('plan-07'))).toBe(true);
          expect(md).toContain(setName);
          expect(md).toContain('plan-07');
          expect(existsSync(join(cwd, '.eforge', 'queue', 'skipped', 'child-prd.md'))).toBe(true);
          expect(existsSync(join(cwd, '.eforge', 'queue', 'waiting', 'child-prd.md'))).toBe(false);
        }
      }
    } finally {
      if (oldCliPath === undefined) delete process.env.EFORGE_CLI_PATH;
      else process.env.EFORGE_CLI_PATH = oldCliPath;
    }
    expect(checkedAtComplete).toBe(true);
  });
});
// --- eforge:endregion resume-compiled-build-engine-suite ---
