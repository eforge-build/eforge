// --- eforge:region continue-repair-route-suite ---
/**
 * End-to-end tests for POST /api/recover/continue-repair.
 *
 * Verifies queued continue-and-repair mutation, validation, scheduler notification,
 * profile precedence, and that the route does not spawn workers.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { useTempDir } from './test-tmpdir.js';
import { openDatabase } from '@eforge-build/monitor/db';
import {
  startServer,
  type MonitorServer,
  type WorkerTracker,
} from '@eforge-build/monitor/server';
import { API_ROUTES, type ContinueRepairResponse } from '@eforge-build/client';

interface SpawnCall {
  command: string;
  args: string[];
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

function writeFileEnsuringDir(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf-8');
}

function initRepo(cwd: string): void {
  git(cwd, ['init', '-b', 'main']);
  git(cwd, ['config', 'user.email', 'test@example.com']);
  git(cwd, ['config', 'user.name', 'Test User']);
  writeFileEnsuringDir(join(cwd, 'README.md'), '# test\n');
  git(cwd, ['add', 'README.md']);
  git(cwd, ['commit', '-m', 'chore: initial']);
}

function writeCompiledPlanSet(cwd: string, setName: string): void {
  writeFileEnsuringDir(
    join(cwd, 'eforge', 'plans', setName, 'orchestration.yaml'),
    `name: ${setName}
description: Test continue-repair plan set
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
  rationale: continue-repair
`,
  );
  writeFileEnsuringDir(join(cwd, 'eforge', 'plans', setName, 'plan-01.md'), '---\nid: plan-01\nname: Plan 01\n---\n\n# Plan 01\n');
}

function createFeatureBranchWithArtifacts(cwd: string, setName: string): void {
  git(cwd, ['switch', '-c', `eforge/${setName}`]);
  writeCompiledPlanSet(cwd, setName);
  git(cwd, ['add', 'eforge']);
  git(cwd, ['commit', '-m', 'plan: compiled artifacts']);
  git(cwd, ['switch', 'main']);
}

function makeStubTracker(): { tracker: WorkerTracker; calls: SpawnCall[] } {
  const calls: SpawnCall[] = [];
  const tracker: WorkerTracker = {
    spawnWorker(command: string, args: string[]): { sessionId: string; pid: number } {
      calls.push({ command, args });
      return { sessionId: 'unexpected-continue-repair-worker', pid: 9999 };
    },
    cancelWorker(): boolean {
      return false;
    },
  };
  return { tracker, calls };
}

const VALID_TEST_PROFILE_YAML = 'agents:\n  tiers:\n    planning:\n      harness: claude-sdk\n      model: claude-haiku-4-5\n      effort: low\n';

function writeTestProfile(cwd: string, name = 'continue-repair-profile', profileYaml = VALID_TEST_PROFILE_YAML): void {
  const configDir = join(cwd, 'eforge');
  mkdirSync(join(configDir, 'profiles'), { recursive: true });
  writeFileSync(join(configDir, 'config.yaml'), 'agents:\n  tiers: {}\n', 'utf-8');
  writeFileSync(join(configDir, 'profiles', `${name}.yaml`), profileYaml, 'utf-8');
}

async function writeFailedPrd(cwd: string, prdId: string, opts: { profile?: string; setName?: string } = {}): Promise<void> {
  const failedDir = join(cwd, '.eforge', 'queue', 'failed');
  await mkdir(failedDir, { recursive: true });
  await writeFile(
    join(failedDir, `${prdId}.md`),
    `---\ntitle: Failed PRD\n${opts.profile ? `profile: ${opts.profile}\n` : ''}---\n\n# Failed PRD\n`,
    'utf-8',
  );
  await writeRecoverySidecar(cwd, prdId, opts.setName ?? prdId);
}

async function writeRecoverySidecar(cwd: string, prdId: string, setName: string): Promise<void> {
  const failedDir = join(cwd, '.eforge', 'queue', 'failed');
  await mkdir(failedDir, { recursive: true });
  await writeFile(
    join(failedDir, `${prdId}.recovery.json`),
    JSON.stringify({ schemaVersion: 3, generatedAt: new Date().toISOString(), prdId, setName, verdict: { verdict: 'manual', confidence: 'low', rationale: 'continue-repair metadata', completedWork: [], remainingWork: [], risks: [] }, report: { operatorSummary: 'continue-repair metadata', recommendedAction: 'Continue and repair build.', keyEvidence: [], completedWork: [], remainingWork: ['finish plan-01'], risks: [] }, boundedEvidence: { identity: { prdId, setName, featureBranch: `eforge/${setName}`, baseBranch: 'main', failedAt: new Date().toISOString() }, plans: [{ planId: 'plan-01', status: 'failed' }], failingPlan: { planId: 'plan-01' }, landedCommits: [], modelsUsed: [] } }),
    'utf-8',
  );
}

async function writeSkippedChild(cwd: string, childId: string, parentId: string): Promise<void> {
  const skippedDir = join(cwd, '.eforge', 'queue', 'skipped');
  await mkdir(skippedDir, { recursive: true });
  await writeFile(
    join(skippedDir, `${childId}.md`),
    `---\ntitle: Skipped child\ndepends_on: [${parentId}]\n---\n\n# Skipped child\n`,
    'utf-8',
  );
}

async function postContinueRepair(server: MonitorServer, body: unknown): Promise<Response> {
  return fetch(`http://localhost:${server.port}${API_ROUTES.continueRepair}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const makeTempDir = useTempDir('eforge-continue-repair-route-test-');

let tmpDir: string;
let dbPath: string;
let server: MonitorServer;
let spawnCalls: SpawnCall[];
let queueMutationReasons: string[];

async function setupServer(opts: { withTracker?: boolean; withCwd?: boolean } = {}): Promise<void> {
  const { tracker, calls } = makeStubTracker();
  spawnCalls = calls;
  queueMutationReasons = [];

  server = await startServer(
    openDatabase(dbPath),
    0,
    {
      strictPort: true,
      ...(opts.withCwd === false ? {} : { cwd: tmpDir }),
      ...(opts.withTracker === false ? {} : { workerTracker: tracker }),
      daemonState: {
        autoBuildController: {
          getSnapshot: () => ({ enabled: false, watcher: { running: false, pid: null, sessionId: null }, desired: 'disabled', mode: 'disabled', scheduler: { alive: false, paused: false } }),
          notifyQueueMutation: (reason: string) => { queueMutationReasons.push(reason); },
        } as never,
      },
    },
  );
}

beforeEach(() => {
  tmpDir = makeTempDir();
  dbPath = resolve(tmpDir, 'monitor.db');
  initRepo(tmpDir);
});

afterEach(async () => {
  await server?.stop();
});

describe('POST /api/recover/continue-repair — validation', () => {
  beforeEach(async () => {
    await setupServer();
  });

  it('returns 400 when the JSON body is null or an array', async () => {
    expect((await postContinueRepair(server, null)).status).toBe(400);
    expect((await postContinueRepair(server, [])).status).toBe(400);
    expect(spawnCalls).toHaveLength(0);
  });

  it('returns 400 when prdId is missing or unsafe', async () => {
    expect((await postContinueRepair(server, {})).status).toBe(400);
    expect((await postContinueRepair(server, { prdId: 'some/path' })).status).toBe(400);
    expect((await postContinueRepair(server, { prdId: '../etc/passwd' })).status).toBe(400);
    expect(spawnCalls).toHaveLength(0);
  });

  it('returns 400 when setName contains path separators', async () => {
    const res = await postContinueRepair(server, { prdId: 'valid-prd', setName: 'some/set' });
    expect(res.status).toBe(400);
    expect(spawnCalls).toHaveLength(0);
  });

  it('returns 503 when no working directory is configured', async () => {
    await server.stop();
    await setupServer({ withCwd: false });
    const res = await postContinueRepair(server, { prdId: 'valid-prd' });
    expect(res.status).toBe(503);
  });

  it('does not register the removed public route alias', async () => {
    const removedPath = ['/api/recover', ['resume', '-build'].join('')].join('/');
    const res = await fetch(`http://localhost:${server.port}${removedPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prdId: 'valid-prd' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/recover/continue-repair — queued mutation', () => {
  it('returns queued metadata, moves queue files, notifies the scheduler, and never spawns a worker', async () => {
    const prdId = 'my-feature-prd';
    const childId = 'child-prd';
    createFeatureBranchWithArtifacts(tmpDir, prdId);
    await writeFailedPrd(tmpDir, prdId);
    await writeSkippedChild(tmpDir, childId, prdId);
    await setupServer();

    const res = await postContinueRepair(server, { prdId });
    expect(res.status).toBe(200);
    const data = await res.json() as ContinueRepairResponse & { sessionId?: unknown; pid?: unknown };
    expect(data).toMatchObject({
      kind: 'queued',
      prdId,
      setName: prdId,
      featureBranch: `eforge/${prdId}`,
      baseBranch: 'main',
      movedDescendantIds: [childId],
      status: 'queued',
    });
    expect(data.sessionId).toBeUndefined();
    expect(data.pid).toBeUndefined();
    expect(spawnCalls).toHaveLength(0);
    expect(queueMutationReasons).toEqual(['external']);
    expect(existsSync(join(tmpDir, '.eforge', 'queue', `${prdId}.md`))).toBe(true);
    expect(existsSync(join(tmpDir, '.eforge', 'queue', 'waiting', `${childId}.md`))).toBe(true);
    expect(existsSync(join(tmpDir, '.eforge', 'queue', 'failed', `${prdId}.md`))).toBe(false);
  });

  it('uses setName metadata from the recovery sidecar when omitted', async () => {
    const prdId = 'failed-prd';
    const setName = 'sidecar-set';
    createFeatureBranchWithArtifacts(tmpDir, setName);
    await writeFailedPrd(tmpDir, prdId, { setName });
    await setupServer();

    const res = await postContinueRepair(server, { prdId });
    expect(res.status).toBe(200);
    const data = await res.json() as ContinueRepairResponse;
    expect(data.setName).toBe(setName);
    expect(data.featureBranch).toBe(`eforge/${setName}`);
    expect(await readFile(join(tmpDir, '.eforge', 'queue', `${prdId}.md`), 'utf-8')).toContain(`resume_set_name: ${setName}`);
  });

  it('applies an explicit profile override to the requeued PRD frontmatter', async () => {
    const prdId = 'profile-prd';
    const profile = 'continue-repair-profile';
    createFeatureBranchWithArtifacts(tmpDir, prdId);
    await writeFailedPrd(tmpDir, prdId, { profile: 'old-profile' });
    writeTestProfile(tmpDir, profile);
    await setupServer();

    const res = await postContinueRepair(server, { prdId, profile });
    expect(res.status).toBe(200);
    const data = await res.json() as ContinueRepairResponse;
    expect(data.profile).toBe(profile);
    const queued = await readFile(join(tmpDir, '.eforge', 'queue', `${prdId}.md`), 'utf-8');
    expect(queued).toContain(`profile: ${profile}`);
    expect(queued).not.toContain('profile: old-profile');
  });

  it('preserves existing profile frontmatter when profile is omitted', async () => {
    const prdId = 'preserve-profile-prd';
    createFeatureBranchWithArtifacts(tmpDir, prdId);
    await writeFailedPrd(tmpDir, prdId, { profile: 'existing-profile' });
    await setupServer();

    const res = await postContinueRepair(server, { prdId });
    expect(res.status).toBe(200);
    const data = await res.json() as ContinueRepairResponse;
    expect(data.profile).toBe('existing-profile');
    expect(await readFile(join(tmpDir, '.eforge', 'queue', `${prdId}.md`), 'utf-8')).toContain('profile: existing-profile');
  });

  it('omits profile when neither request nor failed PRD has profile frontmatter', async () => {
    const prdId = 'no-profile-prd';
    createFeatureBranchWithArtifacts(tmpDir, prdId);
    await writeFailedPrd(tmpDir, prdId);
    await setupServer();

    const res = await postContinueRepair(server, { prdId });
    expect(res.status).toBe(200);
    const data = await res.json() as ContinueRepairResponse;
    expect(data.profile).toBeUndefined();
    expect(await readFile(join(tmpDir, '.eforge', 'queue', `${prdId}.md`), 'utf-8')).not.toContain('profile:');
  });

  it('returns queued metadata for an already-queued compiled resume and notifies the scheduler', async () => {
    const prdId = 'already-queued-prd';
    createFeatureBranchWithArtifacts(tmpDir, prdId);
    await mkdir(join(tmpDir, '.eforge', 'queue'), { recursive: true });
    await writeFile(join(tmpDir, '.eforge', 'queue', `${prdId}.md`), `---\ntitle: Already queued\nresume_mode: compiled\nresume_from: ${prdId}\nresume_set_name: ${prdId}\nresume_feature_branch: eforge/${prdId}\nresume_base_branch: main\n---\n\n# Already queued\n`, 'utf-8');
    await writeRecoverySidecar(tmpDir, prdId, prdId);
    await setupServer();

    const res = await postContinueRepair(server, { prdId });
    expect(res.status).toBe(200);
    const data = await res.json() as ContinueRepairResponse;
    expect(data.kind).toBe('queued');
    expect(data.status).toBe('already-queued');
    expect(data.detail).toContain('already queued');
    expect(queueMutationReasons).toEqual(['external']);
    expect(spawnCalls).toHaveLength(0);
  });

  it('succeeds on a server started without workerTracker', async () => {
    const prdId = 'no-worker-tracker-prd';
    createFeatureBranchWithArtifacts(tmpDir, prdId);
    await writeFailedPrd(tmpDir, prdId);
    await setupServer({ withTracker: false });

    const res = await postContinueRepair(server, { prdId });
    expect(res.status).toBe(200);
    expect((await res.json() as ContinueRepairResponse).kind).toBe('queued');
  });
});

describe('POST /api/recover/continue-repair — blocked and profile errors', () => {
  it('returns 409 and leaves queue files unmoved when artifacts are missing', async () => {
    const prdId = 'missing-artifacts-prd';
    await writeFailedPrd(tmpDir, prdId);
    await setupServer();

    const res = await postContinueRepair(server, { prdId });
    expect(res.status).toBe(409);
    expect(existsSync(join(tmpDir, '.eforge', 'queue', 'failed', `${prdId}.md`))).toBe(true);
    expect(existsSync(join(tmpDir, '.eforge', 'queue', `${prdId}.md`))).toBe(false);
    expect(queueMutationReasons).toEqual([]);
  });

  it('rejects empty, missing, and invalid profile overrides before moving queue files', async () => {
    const prdId = 'profile-validation-prd';
    createFeatureBranchWithArtifacts(tmpDir, prdId);
    await writeFailedPrd(tmpDir, prdId);
    await setupServer();

    expect((await postContinueRepair(server, { prdId, profile: '' })).status).toBe(400);
    expect((await postContinueRepair(server, { prdId, profile: 'missing-profile' })).status).toBe(400);

    writeTestProfile(tmpDir, 'bad-profile', 'agents:\n  tiers:\n    planning:\n      harness: invalid-harness\n      model: claude-haiku-4-5\n      effort: low\n');
    expect((await postContinueRepair(server, { prdId, profile: 'bad-profile' })).status).toBe(400);
    expect(existsSync(join(tmpDir, '.eforge', 'queue', 'failed', `${prdId}.md`))).toBe(true);
    expect(existsSync(join(tmpDir, '.eforge', 'queue', `${prdId}.md`))).toBe(false);
    expect(queueMutationReasons).toEqual([]);
  });
});
// --- eforge:endregion continue-repair-route-suite ---
