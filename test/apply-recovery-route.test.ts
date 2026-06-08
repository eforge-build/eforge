/**
 * End-to-end tests for POST /api/recover/apply.
 *
 * Verifies the in-process synchronous apply route:
 * - retry happy-path: PRD moved to queue, sidecars removed (filesystem-only — commitSha:""), correct response
 * - abandon happy-path: PRD and sidecars removed (filesystem-only — commitSha:"")
 * - missing sidecar JSON → 404 with descriptive error
 * - malformed sidecar JSON → 400 with descriptive error
 * - split missing suggestedSuccessorPrd → 500 (apply helper throws; route surfaces as 500)
 * - no worker is spawned (WorkerTracker.spawnWorker never called)
 *
 * Follows AGENTS.md conventions:
 * - No mocks. Real git repos, real SQLite, no agent stubs needed (apply helpers run git directly).
 * - useTempDir for filesystem cleanup.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFile, mkdir, access, readFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { useTempDir } from './test-tmpdir.js';
import { openDatabase } from '@eforge-build/monitor/db';
import {
  startServer,
  type MonitorServer,
  type DaemonState,
  type WorkerTracker,
} from '@eforge-build/monitor/server';
import { API_ROUTES } from '@eforge-build/client';
import { requireAcceptanceCriteriaInventoryFromPrd } from '@eforge-build/engine/validation/acceptance-criteria-inventory';
import { AutoBuildSupervisor, type AutoBuildQueueMutationReason } from '@eforge-build/monitor/auto-build-supervisor';
import { StubHarness } from './stub-harness.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function initGitRepo(dir: string): void {
  const opts = { cwd: dir };
  execFileSync('git', ['init', '-b', 'main'], opts);
  execFileSync('git', ['config', 'user.email', 'test@eforge.test'], opts);
  execFileSync('git', ['config', 'user.name', 'Test'], opts);
  execFileSync('git', ['commit', '--allow-empty', '-m', 'initial'], opts);
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

const RECOVERY_AC_SENTENCE = 'The successor must persist canonical acceptance criteria before recovery queueing completes.';

function recoverySidecarFromLegacy(legacy: { generatedAt?: string; summary: Record<string, unknown>; verdict: Record<string, unknown>; applied?: unknown }): Record<string, unknown> {
  const summary = legacy.summary;
  const generatedAt = legacy.generatedAt ?? new Date().toISOString();
  const prdId = String(summary.prdId);
  const setName = String(summary.setName ?? prdId);
  return {
    schemaVersion: 3,
    generatedAt,
    prdId,
    setName,
    verdict: legacy.verdict,
    report: { operatorSummary: String(legacy.verdict.rationale ?? 'Test rationale.'), recommendedAction: 'Apply the test recovery verdict.', keyEvidence: [], completedWork: [], remainingWork: [], risks: [] },
    boundedEvidence: {
      identity: { prdId, setName, featureBranch: String(summary.featureBranch ?? `eforge/${setName}`), baseBranch: String(summary.baseBranch ?? 'main'), failedAt: String(summary.failedAt ?? generatedAt) },
      plans: Array.isArray(summary.plans) ? summary.plans : [],
      failingPlan: summary.failingPlan ?? { planId: 'plan-01' },
      landedCommits: Array.isArray(summary.landedCommits) ? summary.landedCommits : [],
      modelsUsed: Array.isArray(summary.modelsUsed) ? summary.modelsUsed : [],
      ...(summary.terminalFailure && typeof summary.terminalFailure === 'object' ? { terminalFailure: summary.terminalFailure } : {}),
      ...(summary.acceptanceValidation && typeof summary.acceptanceValidation === 'object' ? { acceptanceValidation: summary.acceptanceValidation } : {}),
      ...(Array.isArray(summary.validationCommands) ? { validationCommands: summary.validationCommands } : {}),
      ...(typeof summary.diffStat === 'string' ? { diffStat: summary.diffStat } : {}),
    },
    ...(legacy.applied !== undefined ? { applied: legacy.applied } : {}),
  };
}

function bodyWithRecoveryAcceptanceCriteria(body: string): string {
  return `${body.trimEnd()}\n\n## Acceptance Criteria\n\n- ${RECOVERY_AC_SENTENCE}\n`;
}

function validRecoveryExtractorResponse(): { resultText: string } {
  return {
    resultText: JSON.stringify({
      version: 1,
      criteria: [{
        text: RECOVERY_AC_SENTENCE,
        raw: `- ${RECOVERY_AC_SENTENCE}`,
        sourceQuote: RECOVERY_AC_SENTENCE,
        confidence: 0.95,
      }],
    }),
  };
}

let autoBuildWakeReasons: string[];

class RecordingAutoBuildSupervisor extends AutoBuildSupervisor {
  override notifyQueueMutation(reason?: AutoBuildQueueMutationReason) {
    autoBuildWakeReasons.push(reason ?? 'external');
    return super.notifyQueueMutation(reason);
  }
}

function makeDaemonState(): DaemonState {
  return {
    autoBuildController: new RecordingAutoBuildSupervisor(),
  };
}

interface SpawnCall {
  command: string;
  args: string[];
}

/** Stub WorkerTracker that records spawn calls without actually spawning. */
function makeStubTracker(): { tracker: WorkerTracker; calls: SpawnCall[] } {
  const calls: SpawnCall[] = [];
  let pidCounter = 10000;
  let sessionCounter = 0;

  const tracker: WorkerTracker = {
    spawnWorker(command: string, args: string[]): { sessionId: string; pid: number } {
      const sessionId = `stub-${++sessionCounter}`;
      const pid = ++pidCounter;
      calls.push({ command, args });
      return { sessionId, pid };
    },
    cancelWorker(_sessionId: string): boolean {
      return false;
    },
  };

  return { tracker, calls };
}

async function seedFailedPrd(
  dir: string,
  prdId: string,
  verdict: 'retry' | 'split' | 'abandon' | 'manual',
  opts?: { suggestedSuccessorPrd?: string; malformedJson?: boolean; missingJson?: boolean; summary?: Record<string, unknown> },
): Promise<void> {
  const failedDir = join(dir, '.eforge', 'queue', 'failed');
  await mkdir(failedDir, { recursive: true });

  // Write PRD file
  await writeFile(
    join(failedDir, `${prdId}.md`),
    `---\ntitle: Test PRD ${prdId}\ncreated: 2024-01-01\n---\n\n# Test PRD\n\nDo work.\n`,
  );

  // Write recovery markdown sidecar
  await writeFile(
    join(failedDir, `${prdId}.recovery.md`),
    `## Recovery Report\n\nVerdict: ${verdict}`,
  );

  // Write recovery JSON sidecar (or malformed/missing as requested)
  if (!opts?.missingJson) {
    if (opts?.malformedJson) {
      await writeFile(join(failedDir, `${prdId}.recovery.json`), 'NOT VALID JSON {{{');
    } else {
      const verdictData: Record<string, unknown> = {
        verdict,
        confidence: 'high',
        rationale: 'Test rationale.',
        completedWork: [],
        remainingWork: [],
        risks: [],
      };
      if (verdict === 'split') {
        verdictData.suggestedSuccessorPrd = bodyWithRecoveryAcceptanceCriteria(
          opts?.suggestedSuccessorPrd ?? '# Successor Feature\n\nContinue the work.',
        );
      }
      const sidecarJson = {
        schemaVersion: 3,
        generatedAt: new Date().toISOString(),
        summary: {
          prdId,
          setName: 'test-set',
          featureBranch: 'eforge/test-set',
          baseBranch: 'main',
          plans: [],
          failingPlan: { planId: 'plan-01' },
          landedCommits: [],
          diffStat: '',
          modelsUsed: [],
          failedAt: new Date().toISOString(),
          ...opts?.summary,
        },
        verdict: verdictData,
      };
      await writeFile(
        join(failedDir, `${prdId}.recovery.json`),
        JSON.stringify(recoverySidecarFromLegacy(sidecarJson), null, 2),
      );
    }
  }

  // Stage and commit all files so they are tracked by git
  execFileSync('git', ['add', '--', failedDir], { cwd: dir });
  execFileSync('git', ['commit', '-m', `chore: seed failed prd ${prdId}`], { cwd: dir });
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

const makeTempDir = useTempDir('eforge-apply-route-test-');

let tmpDir: string;
let dbPath: string;
let server: MonitorServer;
let spawnCalls: SpawnCall[];

async function setupServer(): Promise<void> {
  const { tracker, calls } = makeStubTracker();
  spawnCalls = calls;
  autoBuildWakeReasons = [];

  server = await startServer(
    openDatabase(dbPath),
    0,
    {
      strictPort: true,
      cwd: tmpDir,
      daemonState: makeDaemonState(),
      workerTracker: tracker,
      agentRuntimes: new StubHarness([validRecoveryExtractorResponse()]),
    },
  );
}

beforeEach(async () => {
  tmpDir = makeTempDir();
  dbPath = resolve(tmpDir, 'monitor.db');
  initGitRepo(tmpDir);
  await setupServer();
});

afterEach(async () => {
  await server?.stop();
});

// ---------------------------------------------------------------------------
// POST /api/recover/apply — retry happy-path
// ---------------------------------------------------------------------------

describe('POST /api/recover/apply — retry', () => {
  it('moves PRD to queue, removes sidecars, returns { verdict, commitSha, noAction }', async () => {
    const prdId = 'test-retry-prd';
    await seedFailedPrd(tmpDir, prdId, 'retry');

    const res = await fetch(`http://localhost:${server.port}${API_ROUTES.applyRecovery}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prdId }),
    });

    expect(res.status).toBe(200);
    const data = await res.json() as { verdict: string; commitSha?: string; noAction?: boolean };
    expect(data.verdict).toBe('retry');
    expect(data.noAction).toBe(false);
    // Filesystem-only — commitSha is empty string (no git commit for queue operations)
    expect(data.commitSha).toBe('');

    // PRD moved to queue directory
    expect(await pathExists(join(tmpDir, '.eforge', 'queue', `${prdId}.md`))).toBe(true);
    // Failed PRD removed
    expect(await pathExists(join(tmpDir, '.eforge', 'queue', 'failed', `${prdId}.md`))).toBe(false);
    // Both sidecar files removed
    expect(await pathExists(join(tmpDir, '.eforge', 'queue', 'failed', `${prdId}.recovery.md`))).toBe(false);
    expect(await pathExists(join(tmpDir, '.eforge', 'queue', 'failed', `${prdId}.recovery.json`))).toBe(false);
    expect(autoBuildWakeReasons).toContain('apply-recovery');
  });

  it('does not spawn any worker', async () => {
    const prdId = 'test-retry-no-spawn';
    await seedFailedPrd(tmpDir, prdId, 'retry');

    await fetch(`http://localhost:${server.port}${API_ROUTES.applyRecovery}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prdId }),
    });

    expect(spawnCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// POST /api/recover/apply — abandon happy-path
// ---------------------------------------------------------------------------

describe('POST /api/recover/apply — abandon', () => {
  it('removes PRD and sidecars (filesystem-only), returns { verdict, commitSha: "", noAction }', async () => {
    const prdId = 'test-abandon-prd';
    await seedFailedPrd(tmpDir, prdId, 'abandon');

    const res = await fetch(`http://localhost:${server.port}${API_ROUTES.applyRecovery}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prdId }),
    });

    expect(res.status).toBe(200);
    const data = await res.json() as { verdict: string; commitSha?: string; noAction?: boolean };
    expect(data.verdict).toBe('abandon');
    expect(data.noAction).toBe(false);
    // Filesystem-only — commitSha is empty string (no git commit for queue operations)
    expect(data.commitSha).toBe('');

    // All failed files removed
    expect(await pathExists(join(tmpDir, '.eforge', 'queue', 'failed', `${prdId}.md`))).toBe(false);
    expect(await pathExists(join(tmpDir, '.eforge', 'queue', 'failed', `${prdId}.recovery.md`))).toBe(false);
    expect(await pathExists(join(tmpDir, '.eforge', 'queue', 'failed', `${prdId}.recovery.json`))).toBe(false);
    expect(autoBuildWakeReasons).toContain('apply-recovery');
  });
});

// ---------------------------------------------------------------------------
// POST /api/recover/apply — missing sidecar JSON → 404
// ---------------------------------------------------------------------------

describe('POST /api/recover/apply — missing sidecar', () => {
  it('returns 404 with error message containing prdId when sidecar JSON is missing', async () => {
    const prdId = 'test-missing-sidecar';
    await seedFailedPrd(tmpDir, prdId, 'retry', { missingJson: true });

    const res = await fetch(`http://localhost:${server.port}${API_ROUTES.applyRecovery}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prdId }),
    });

    expect(res.status).toBe(404);
    const data = await res.json() as { error: string };
    expect(data.error).toContain(prdId);
    expect(autoBuildWakeReasons).toEqual([]);
  });

  it('does not spawn any worker on 404', async () => {
    const prdId = 'test-missing-no-spawn';
    await seedFailedPrd(tmpDir, prdId, 'retry', { missingJson: true });

    await fetch(`http://localhost:${server.port}${API_ROUTES.applyRecovery}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prdId }),
    });

    expect(spawnCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// POST /api/recover/apply — malformed sidecar JSON → 400
// ---------------------------------------------------------------------------

describe('POST /api/recover/apply — malformed sidecar', () => {
  it('returns 400 with error message referencing the validation failure when JSON is malformed', async () => {
    const prdId = 'test-malformed-sidecar';
    await seedFailedPrd(tmpDir, prdId, 'retry', { malformedJson: true });

    const res = await fetch(`http://localhost:${server.port}${API_ROUTES.applyRecovery}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prdId }),
    });

    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(typeof data.error).toBe('string');
    expect(data.error.length).toBeGreaterThan(0);
    expect(autoBuildWakeReasons).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// POST /api/recover/apply — split continuation parity
// ---------------------------------------------------------------------------

describe('POST /api/recover/apply — split continuation', () => {
  it('writes continuation frontmatter when partial work evidence and branch are present', async () => {
    const prdId = 'test-route-split-continuation';
    execFileSync('git', ['branch', 'eforge/test-set'], { cwd: tmpDir });
    await seedFailedPrd(tmpDir, prdId, 'split', {
      summary: {
        landedCommits: [{ sha: 'abc123', subject: 'partial work', author: 'Test', date: new Date().toISOString() }],
      },
    });

    const res = await fetch(`http://localhost:${server.port}${API_ROUTES.applyRecovery}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prdId }),
    });

    expect(res.status).toBe(200);
    const data = await res.json() as { successorPrdId: string };
    const content = await readFile(join(tmpDir, '.eforge', 'queue', `${data.successorPrdId}.md`), 'utf-8');
    expect(content).toContain(`recovery_from: ${prdId}`);
    expect(content).toContain('recovery_set_name: test-set');
    expect(content).toContain('recovery_feature_branch: eforge/test-set');
    expect(content).toContain('recovery_base_branch: main');
    expect(requireAcceptanceCriteriaInventoryFromPrd(content).criteria).toHaveLength(1);
  });

  it('returns non-2xx and writes no successor when partial work references a missing branch', async () => {
    const prdId = 'test-route-split-missing-branch';
    await seedFailedPrd(tmpDir, prdId, 'split', {
      summary: {
        landedCommits: [{ sha: 'abc123', subject: 'partial work', author: 'Test', date: new Date().toISOString() }],
      },
    });

    const res = await fetch(`http://localhost:${server.port}${API_ROUTES.applyRecovery}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prdId }),
    });

    expect(res.status).toBeGreaterThanOrEqual(400);
    const entries = await readdir(join(tmpDir, '.eforge', 'queue'));
    expect(entries.filter((entry) => entry.endsWith('.md'))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// POST /api/recover/apply — split idempotency
// ---------------------------------------------------------------------------

describe('POST /api/recover/apply — split idempotency', () => {
  it('repeated split apply returns already-applied with the same successorPrdId and no duplicate successor', async () => {
    const prdId = 'test-route-split-idempotent';
    await seedFailedPrd(tmpDir, prdId, 'split', { suggestedSuccessorPrd: '# Idempotent Successor\n\nContinue.' });

    const apply = () => fetch(`http://localhost:${server.port}${API_ROUTES.applyRecovery}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prdId }),
    });

    const firstRes = await apply();
    expect(firstRes.status).toBe(200);
    const first = await firstRes.json() as { verdict: string; successorPrdId: string; status?: string };
    expect(first.verdict).toBe('split');
    expect(first.status).toBe('applied');
    expect(first.successorPrdId).toBeTruthy();

    const secondRes = await apply();
    expect(secondRes.status).toBe(200);
    const second = await secondRes.json() as { verdict: string; successorPrdId: string; status?: string };
    expect(second.status).toBe('already-applied');
    expect(second.successorPrdId).toBe(first.successorPrdId);

    // Exactly one successor file in the queue root — no `-2` duplicate.
    const entries = await readdir(join(tmpDir, '.eforge', 'queue'));
    const successorFiles = entries.filter((e) => e.endsWith('.md'));
    expect(successorFiles).toEqual([`${first.successorPrdId}.md`]);
  });
});

// ---------------------------------------------------------------------------
// POST /api/recover/apply — split missing suggestedSuccessorPrd → 500
// ---------------------------------------------------------------------------

describe('POST /api/recover/apply — split missing successor', () => {
  it('returns 500 when split verdict has no suggestedSuccessorPrd (apply helper throws)', async () => {
    const prdId = 'test-split-no-successor';
    // Write a split verdict sidecar with no suggestedSuccessorPrd
    const failedDir = join(tmpDir, '.eforge', 'queue', 'failed');
    await mkdir(failedDir, { recursive: true });
    await writeFile(
      join(failedDir, `${prdId}.md`),
      `---\ntitle: Test Split PRD\ncreated: 2024-01-01\n---\n\n# Split PRD\n`,
    );
    await writeFile(
      join(failedDir, `${prdId}.recovery.md`),
      `## Recovery Report\n\nVerdict: split`,
    );
    const sidecarJson = {
      schemaVersion: 3,
      generatedAt: new Date().toISOString(),
      summary: {
        prdId,
        setName: 'test-set',
        featureBranch: 'eforge/test-set',
        baseBranch: 'main',
        plans: [],
        failingPlan: { planId: 'plan-01' },
        landedCommits: [],
        diffStat: '',
        modelsUsed: [],
        failedAt: new Date().toISOString(),
      },
      // split verdict WITHOUT suggestedSuccessorPrd
      verdict: {
        verdict: 'split',
        confidence: 'high',
        rationale: 'Should have successor but missing.',
        completedWork: [],
        remainingWork: [],
        risks: [],
        // No suggestedSuccessorPrd intentionally
      },
    };
    await writeFile(
      join(failedDir, `${prdId}.recovery.json`),
      JSON.stringify(recoverySidecarFromLegacy(sidecarJson), null, 2),
    );
    execFileSync('git', ['add', '--', failedDir], { cwd: tmpDir });
    execFileSync('git', ['commit', '-m', `chore: seed split no-successor ${prdId}`], { cwd: tmpDir });

    const res = await fetch(`http://localhost:${server.port}${API_ROUTES.applyRecovery}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prdId }),
    });

    expect(res.status).toBe(500);
    const data = await res.json() as { error: string };
    expect(data.error).toContain(prdId);
  });
});

// ---------------------------------------------------------------------------
// POST /api/recover/apply — 503 when no daemonState
// ---------------------------------------------------------------------------

describe('POST /api/recover/apply — 503 without daemonState', () => {
  it('returns 503 when server is started without daemonState', async () => {
    // Start a second server without daemonState
    const tmpDir2 = makeTempDir();
    const dbPath2 = resolve(tmpDir2, 'monitor.db');
    const server2 = await startServer(
      openDatabase(dbPath2),
      0,
      { strictPort: true, cwd: tmpDir2 },
    );

    try {
      const res = await fetch(`http://localhost:${server2.port}${API_ROUTES.applyRecovery}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prdId: 'any-prd' }),
      });
      expect(res.status).toBe(503);
    } finally {
      await server2.stop();
    }
  });
});

// ---------------------------------------------------------------------------
// Accept-build-as-successful recovery routes (plan-02)
// ---------------------------------------------------------------------------

describe('accept-success recovery routes', () => {
  function git(dir: string, args: string[]): void {
    execFileSync('git', args, { cwd: dir });
  }

  async function seedAcceptRoute(dir: string, prdId: string, opts: { landing?: 'pr' | 'merge' | 'leave'; landingAutoMerge?: boolean; configLandingAction?: 'pr' | 'merge' | 'leave'; configAutoMerge?: 'ask' | 'always' | 'never'; autoMerge?: { status: 'complete' } | { status: 'skipped' | 'failed'; reason: string } } = {}): Promise<void> {
    const setName = prdId;
    const feature = `eforge/${setName}`;
    await mkdir(join(dir, 'eforge'), { recursive: true });
    await writeFile(join(dir, 'eforge', 'config.yaml'), `landing:\n  action: ${opts.configLandingAction ?? 'leave'}\n  pr:\n    autoMerge: ${opts.configAutoMerge ?? 'ask'}\n`);
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-m', 'chore: config']);

    git(dir, ['checkout', '-b', feature]);
    await mkdir(join(dir, 'eforge', 'plans', setName), { recursive: true });
    await writeFile(join(dir, 'eforge', 'plans', setName, 'plan-01.md'), '# plan');
    await mkdir(join(dir, 'eforge', 'prds'), { recursive: true });
    await writeFile(join(dir, 'eforge', 'prds', `${prdId}.md`), '# prd');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-m', 'feat: landed work']);
    git(dir, ['checkout', 'main']);

    const failedDir = join(dir, '.eforge', 'queue', 'failed');
    await mkdir(failedDir, { recursive: true });
    await writeFile(join(failedDir, `${prdId}.md`), `---\ntitle: ${prdId}\n${opts.landing ? `landing: ${opts.landing}\n` : ''}${opts.landingAutoMerge !== undefined ? `landing_auto_merge: ${opts.landingAutoMerge}\n` : ''}---\n# ${prdId}`);
    await writeFile(join(failedDir, `${prdId}.recovery.md`), '## Recovery');
    const sidecar = {
      schemaVersion: 3,
      generatedAt: new Date().toISOString(),
      summary: {
        prdId, setName, featureBranch: feature, baseBranch: 'main',
        plans: [], failingPlan: { planId: 'plan-01' },
        landedCommits: [{ sha: 'abc123', subject: 'work', author: 'Test', date: new Date().toISOString() }],
        diffStat: '', modelsUsed: [], failedAt: new Date().toISOString(),
        acceptanceValidation: { passed: false, total: 1, pass: 0, fail: 1, unknown: 0, verdicts: [] },
        validationCommands: [{ command: 'pnpm test', exitCode: 0 }],
      },
      verdict: { verdict: 'manual', confidence: 'low', rationale: 'm', completedWork: [], remainingWork: [], risks: [] },
    };
    await writeFile(join(failedDir, `${prdId}.recovery.json`), JSON.stringify(recoverySidecarFromLegacy(sidecar), null, 2));
  }

  function setupOriginRemote(dir: string, name: string): void {
    const remote = join(dir, `${name}.git`);
    execFileSync('git', ['init', '--bare', remote]);
    execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: dir });
    execFileSync('git', ['push', '-u', 'origin', 'main'], { cwd: dir });
  }

  async function fakeGh(dir: string): Promise<{ bin: string; log: string }> {
    const bin = join(dir, 'fake-gh-bin');
    const log = join(dir, 'fake-gh.log');
    await mkdir(bin, { recursive: true });
    const script = join(bin, 'gh');
    await writeFile(script, `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
if (args[0] === '--version') process.exit(0);
if (args[0] === 'pr' && args[1] === 'create') { console.log('https://github.test/repo/pull/1'); process.exit(0); }
if (args[0] === 'pr' && args[1] === 'merge') process.exit(0);
process.exit(0);
`);
    execFileSync('chmod', ['755', script]);
    return { bin, log };
  }

  async function readGhCalls(log: string): Promise<string[][]> {
    try {
      return (await readFile(log, 'utf-8')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    } catch {
      return [];
    }
  }

  it('previews eligibility for an acceptance-validation failure with effective landing auto-merge outcome', async () => {
    for (const [prdId, landingAutoMerge, configAutoMerge, effectiveLandingAutoMerge] of [
      ['route-accept-preview-true', true, 'ask', true],
      ['route-accept-preview-false', false, 'always', false],
      ['route-accept-preview-omitted-always', undefined, 'always', true],
      ['route-accept-preview-true-never', true, 'never', false],
    ] as const) {
      await seedAcceptRoute(tmpDir, prdId, { landing: 'pr', configAutoMerge, ...(landingAutoMerge !== undefined ? { landingAutoMerge } : {}) });
      const res = await fetch(`http://localhost:${server.port}${API_ROUTES.acceptRecoverySuccessPreview}?prdId=${prdId}`);
      expect(res.status).toBe(200);
      const data = await res.json() as { status: string; landingAction: string; landingAutoMerge?: boolean; effectiveLandingAutoMerge?: boolean };
      expect(data.status).toBe('eligible');
      expect(data.landingAction).toBe('pr');
      expect(data.landingAutoMerge).toBe(landingAutoMerge);
      expect(data.effectiveLandingAutoMerge).toBe(effectiveLandingAutoMerge);
    }
  });

  it('ignores unrelated invalid failed PRD frontmatter when previewing accept-success', async () => {
    const prdId = 'route-accept-preview-targeted';
    await seedAcceptRoute(tmpDir, prdId, { landing: 'pr' });
    await writeFile(join(tmpDir, '.eforge', 'queue', 'failed', 'unrelated-invalid.md'), '---\ntitle: bad\nonSuccess: issue-pr\n---\n# bad');

    const res = await fetch(`http://localhost:${server.port}${API_ROUTES.acceptRecoverySuccessPreview}?prdId=${prdId}`);
    expect(res.status).toBe(200);
    const data = await res.json() as { status: string; landingAction: string };
    expect(data.status).toBe('eligible');
    expect(data.landingAction).toBe('pr');
  });

  it('returns 400 when reasonCategory is missing', async () => {
    const prdId = 'route-accept-badreq';
    await seedAcceptRoute(tmpDir, prdId);
    const res = await fetch(`http://localhost:${server.port}${API_ROUTES.acceptRecoverySuccess}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prdId, reason: 'no category' }),
    });
    expect(res.status).toBe(400);
  });

  it('applies accepted-success and is idempotent on reapply', async () => {
    const prdId = 'route-accept-apply';
    await seedAcceptRoute(tmpDir, prdId);
    const apply = () => fetch(`http://localhost:${server.port}${API_ROUTES.acceptRecoverySuccess}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prdId, reasonCategory: 'bad_acceptance_criterion', reason: 'criterion was wrong', unblockDependentIds: [] }),
    });

    const firstRes = await apply();
    expect(firstRes.status).toBe(200);
    const first = await firstRes.json() as { status: string; applied: { action: string } };
    expect(first.status).toBe('applied');
    expect(first.applied.action).toBe('accepted-success');
    expect(autoBuildWakeReasons).toContain('apply-recovery');

    const secondRes = await apply();
    expect(secondRes.status).toBe(200);
    const second = await secondRes.json() as { status: string };
    expect(second.status).toBe('already-applied');
  });

  it('returns accepted-success landing autoMerge metadata on already-applied responses', async () => {
    for (const [prdId, autoMerge] of [
      ['route-auto-complete', { status: 'complete' }],
      ['route-auto-skipped', { status: 'skipped', reason: 'policy' }],
      ['route-auto-failed', { status: 'failed', reason: 'gh pr merge failed: nope' }],
    ] as const) {
      await seedAcceptRoute(tmpDir, prdId, { autoMerge });
      const sidecarPath = join(tmpDir, '.eforge', 'queue', 'failed', `${prdId}.recovery.json`);
      const sidecar = JSON.parse(await readFile(sidecarPath, 'utf-8'));
      sidecar.applied = { action: 'accepted-success', acceptedAt: new Date().toISOString(), reasonCategory: 'other', reason: 'ok', cleanup: { status: 'noop' }, landing: { action: 'pr', status: 'complete', branch: `eforge/${prdId}`, autoMerge }, dependents: { unblocked: [], remainedBlocked: [], notFound: [] } };
      await writeFile(sidecarPath, JSON.stringify(sidecar, null, 2));
      const res = await fetch(`http://localhost:${server.port}${API_ROUTES.acceptRecoverySuccess}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prdId, reasonCategory: 'other', reason: 'again', unblockDependentIds: [] }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { applied: { landing: { autoMerge?: unknown } } };
      expect(body.applied.landing.autoMerge).toEqual(autoMerge);
    }
  });

  it.each([
    ['route-auto-matrix-true-ask', true, 'ask', true, 'complete'],
    ['route-auto-matrix-false-always', false, 'always', false, 'skipped'],
    ['route-auto-matrix-omitted-always', undefined, 'always', true, 'complete'],
    ['route-auto-matrix-omitted-ask', undefined, 'ask', false, 'skipped'],
  ] as const)('applies accepted-success PR auto-merge matrix for %s', async (prdId, landingAutoMerge, configAutoMerge, expectMerge, expectedStatus) => {
    await seedAcceptRoute(tmpDir, prdId, {
      landing: 'pr',
      ...(landingAutoMerge !== undefined ? { landingAutoMerge } : {}),
      configLandingAction: 'pr',
      configAutoMerge,
    });
    setupOriginRemote(tmpDir, prdId);
    const { bin, log } = await fakeGh(tmpDir);
    const oldPath = process.env.PATH;
    process.env.PATH = `${bin}:${oldPath}`;
    try {
      const res = await fetch(`http://localhost:${server.port}${API_ROUTES.acceptRecoverySuccess}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prdId, reasonCategory: 'other', reason: 'accepted', unblockDependentIds: [] }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { applied: { landing: { status: string; autoMerge?: { status: string } } } };
      expect(body.applied.landing.status).toBe('complete');
      expect(body.applied.landing.autoMerge?.status).toBe(expectedStatus);
      const calls = await readGhCalls(log);
      expect(calls.some((args) => args[0] === 'pr' && args[1] === 'create')).toBe(true);
      expect(calls.some((args) => args[0] === 'pr' && args[1] === 'merge' && args.includes('--auto') && args.includes('--merge'))).toBe(expectMerge);
    } finally {
      process.env.PATH = oldPath;
    }
  }, 10_000);
});
