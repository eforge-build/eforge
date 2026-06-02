/**
 * Tests for the read-only resume eligibility daemon route:
 *   GET /api/recover/resume-eligibility
 *
 * Coverage:
 * - validation (missing/unsafe prdId)
 * - ineligible when the feature branch is missing
 * - eligible when feature branch + artifacts + failure evidence exist
 *   (with sessionId/pid absent — this route never spawns a worker)
 * - setName resolution from the recovery sidecar when the query omits setName
 * - the route never spawns a worker
 * - a server started without a workerTracker still serves the route
 *
 * Follows AGENTS.md conventions: no mocks, real git repos, real SQLite, stub
 * tracker for worker spawning. useTempDir for cleanup.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir } from 'node:fs/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { useTempDir } from './test-tmpdir.js';
import { openDatabase } from '@eforge-build/monitor/db';
import { startServer, type WorkerTracker, type MonitorServer } from '@eforge-build/monitor/server';
import { API_ROUTES, type ResumeEligibilityResponse } from '@eforge-build/client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
description: Test resume plan set
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
  rationale: resume
`,
  );
  writeFileEnsuringDir(
    join(cwd, 'eforge', 'plans', setName, 'plan-01.md'),
    `---\nid: plan-01\nname: Plan 01\n---\n\n# Plan 01\n`,
  );
}

function createFeatureBranchWithArtifacts(cwd: string, setName: string): void {
  git(cwd, ['switch', '-c', `eforge/${setName}`]);
  writeCompiledPlanSet(cwd, setName);
  git(cwd, ['add', 'eforge']);
  git(cwd, ['commit', '-m', 'plan: compiled artifacts']);
  git(cwd, ['switch', 'main']);
}

interface SpawnCall {
  command: string;
  args: string[];
  sessionId: string;
  pid: number;
}

function makeStubTracker(): { tracker: WorkerTracker; calls: SpawnCall[] } {
  const calls: SpawnCall[] = [];
  let pidCounter = 10000;
  let sessionCounter = 0;
  const tracker: WorkerTracker = {
    spawnWorker(command: string, args: string[]): { sessionId: string; pid: number } {
      const sessionId = `stub-${++sessionCounter}`;
      const pid = ++pidCounter;
      calls.push({ command, args, sessionId, pid });
      return { sessionId, pid };
    },
    cancelWorker(): boolean {
      return false;
    },
  };
  return { tracker, calls };
}

const makeTempDir = useTempDir('eforge-resume-eligibility-');

let tmpDir: string;
let dbPath: string;
let server: MonitorServer | undefined;
let spawnCalls: SpawnCall[];

async function setupServer(opts: { withTracker?: boolean } = {}): Promise<void> {
  const { tracker, calls } = makeStubTracker();
  spawnCalls = calls;
  server = await startServer(openDatabase(dbPath), 0, {
    strictPort: true,
    cwd: tmpDir,
    ...(opts.withTracker === false ? {} : { workerTracker: tracker }),
  });
}

function eligibilityUrl(query: Record<string, string>): string {
  const params = new URLSearchParams(query);
  return `http://localhost:${server!.port}${API_ROUTES.resumeEligibility}?${params.toString()}`;
}

beforeEach(() => {
  tmpDir = makeTempDir();
  dbPath = resolve(tmpDir, 'monitor.db');
});

afterEach(async () => {
  await server?.stop();
  server = undefined;
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe('GET /api/recover/resume-eligibility — validation', () => {
  beforeEach(async () => {
    initRepo(tmpDir);
    await setupServer();
  });

  it('returns 400 when prdId is missing', async () => {
    const res = await fetch(`http://localhost:${server!.port}${API_ROUTES.resumeEligibility}`);
    expect(res.status).toBe(400);
  });

  it('returns 400 when prdId is unsafe (path traversal)', async () => {
    const res = await fetch(eligibilityUrl({ prdId: '../escape' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when setName is unsafe', async () => {
    const res = await fetch(eligibilityUrl({ prdId: 'safe-prd', setName: '../escape' }));
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Ineligible
// ---------------------------------------------------------------------------

describe('GET /api/recover/resume-eligibility — ineligible', () => {
  beforeEach(async () => {
    initRepo(tmpDir);
    await setupServer();
  });

  it('returns eligible:false with a reason when the feature branch is missing', async () => {
    const res = await fetch(eligibilityUrl({ prdId: 'no-such-set' }));
    expect(res.status).toBe(200);
    const data = (await res.json()) as ResumeEligibilityResponse;
    expect(data.eligible).toBe(false);
    if (!data.eligible) {
      expect(data.featureBranch).toBe('eforge/no-such-set');
      expect(data.reason).toContain('eforge/no-such-set');
    }
    // Read-only route — must not spawn a worker.
    expect(spawnCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Eligible
// ---------------------------------------------------------------------------

describe('GET /api/recover/resume-eligibility — eligible', () => {
  beforeEach(async () => {
    initRepo(tmpDir);
  });

  it('returns eligible:true with sessionId and pid absent when artifacts and evidence exist', async () => {
    const setName = 'eligible-set';
    createFeatureBranchWithArtifacts(tmpDir, setName);
    await setupServer();

    const res = await fetch(eligibilityUrl({ prdId: setName }));
    expect(res.status).toBe(200);
    const data = (await res.json()) as ResumeEligibilityResponse & { sessionId?: unknown; pid?: unknown };
    expect(data.eligible).toBe(true);
    if (data.eligible) {
      expect(data.prdId).toBe(setName);
      expect(data.setName).toBe(setName);
      expect(data.featureBranch).toBe(`eforge/${setName}`);
      expect(data.artifactAvailability).toBe('feature-branch');
      expect(typeof data.landedCommitCount).toBe('number');
    }
    // This route never spawns a resume worker.
    expect(data.sessionId).toBeUndefined();
    expect(data.pid).toBeUndefined();
    expect(spawnCalls).toHaveLength(0);
  });

  it('resolves setName from the recovery sidecar when the query omits setName', async () => {
    const prdId = 'prd-with-sidecar';
    const resolvedSet = 'resolved-set';
    createFeatureBranchWithArtifacts(tmpDir, resolvedSet);

    // Write a recovery sidecar whose summary.setName differs from the prdId.
    const failedDir = join(tmpDir, '.eforge', 'queue', 'failed');
    await mkdir(failedDir, { recursive: true });
    await writeFile(
      join(failedDir, `${prdId}.recovery.json`),
      JSON.stringify({ schemaVersion: 2, summary: { prdId, setName: resolvedSet } }),
    );

    await setupServer();

    const res = await fetch(eligibilityUrl({ prdId }));
    expect(res.status).toBe(200);
    const data = (await res.json()) as ResumeEligibilityResponse;
    expect(data.eligible).toBe(true);
    if (data.eligible) {
      expect(data.setName).toBe(resolvedSet);
      expect(data.featureBranch).toBe(`eforge/${resolvedSet}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Read-only route does not require a workerTracker
// ---------------------------------------------------------------------------

describe('GET /api/recover/resume-eligibility — no workerTracker required', () => {
  beforeEach(async () => {
    initRepo(tmpDir);
  });

  it('serves the route on a server started without a workerTracker', async () => {
    const setName = 'no-tracker-set';
    createFeatureBranchWithArtifacts(tmpDir, setName);
    await setupServer({ withTracker: false });

    const res = await fetch(eligibilityUrl({ prdId: setName }));
    expect(res.status).toBe(200);
    const data = (await res.json()) as ResumeEligibilityResponse;
    expect(data.eligible).toBe(true);
  });
});
