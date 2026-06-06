// --- eforge:region daemon-recovery-sidecars-suite ---
// Split from daemon-recovery.test.ts.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useTempDir } from './test-tmpdir.js';
import { openDatabase } from '@eforge-build/monitor/db';
import { startServer, type WorkerTracker, type MonitorServer } from '@eforge-build/monitor/server';
import { moveFailedWithSidecar, type QueuedPrd } from '@eforge-build/engine/prd-queue';
import { EforgeEngine } from '@eforge-build/engine/eforge';
import { StubHarness } from './stub-harness.js';
import { API_ROUTES } from '@eforge-build/client';
import type { EforgeEvent } from '@eforge-build/engine/events';
import { collectDaemonRecoveryEvents as collectEvents, initDaemonRecoveryGitRepo as initGitRepo } from './daemon-recovery-helpers.js';



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
    cancelWorker(_sessionId: string): boolean {
      return false;
    },
  };

  return { tracker, calls };
}





const makeTempDir = useTempDir();

let tmpDir: string;
let dbPath: string;
let server: MonitorServer;
let tracker: WorkerTracker;
let spawnCalls: SpawnCall[];

async function setupServer(): Promise<void> {
  const { tracker: t, calls } = makeStubTracker();
  tracker = t;
  spawnCalls = calls;

  server = await startServer(
    openDatabase(dbPath),
    0,
    {
      strictPort: true,
      cwd: tmpDir,
      workerTracker: tracker,
    },
  );
}

beforeEach(async () => {
  tmpDir = makeTempDir();
  dbPath = resolve(tmpDir, 'monitor.db');
});

afterEach(async () => {
  await server?.stop();
});

describe('moveFailedWithSidecar', () => {
  const makeTestDir = useTempDir('eforge-inline-recovery-test-');

  it('moves PRD to failed/ and writes both sidecar files without creating a git commit', async () => {
    const dir = makeTestDir();
    initGitRepo(dir);


    const queueDir = join(dir, '.eforge', 'queue');
    await mkdir(queueDir, { recursive: true });
    const prdPath = join(queueDir, 'my-prd.md');
    await writeFile(prdPath, '---\ntitle: My PRD\ncreated: 2024-01-01\n---\n\n# My PRD\n\nDo a thing.\n');

    const headBefore = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir }).toString().trim();


    const summary = {
      prdId: 'my-prd',
      setName: 'test-set',
      featureBranch: 'eforge/test-set',
      baseBranch: 'main',
      plans: [{ planId: 'plan-01', status: 'failed', error: 'Type error' }],
      failingPlan: { planId: 'plan-01', errorMessage: 'Type error' },
      landedCommits: [],
      diffStat: '',
      modelsUsed: [],
      failedAt: new Date().toISOString(),
    };
    const verdict = {
      verdict: 'manual' as const,
      confidence: 'low' as const,
      rationale: 'Insufficient evidence.',
      completedWork: [],
      remainingWork: [],
      risks: [],
    };

    const { mdPath, jsonPath, destPath } = await moveFailedWithSidecar(
      prdPath,
      summary,
      verdict,
      undefined,
      dir,
    );


    const headAfter = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir }).toString().trim();
    expect(headAfter).toBe(headBefore);


    const sidecarJson = JSON.parse(await readFile(jsonPath, 'utf-8'));
    expect(sidecarJson.schemaVersion).toBe(3);
    expect(sidecarJson.verdict.verdict).toBe('manual');


    expect(destPath).toContain('failed');
    expect(destPath).toContain('my-prd.md');
    expect(mdPath).toContain('.recovery.md');
    expect(jsonPath).toContain('.recovery.json');




    const { existsSync } = await import('node:fs');
    expect(existsSync(prdPath)).toBe(false);
    expect(existsSync(destPath)).toBe(true);
    expect(existsSync(mdPath)).toBe(true);
    expect(existsSync(jsonPath)).toBe(true);
  });

  // --- eforge:region plan-02-sidecar-resume-option ---
  it('passes optional compiled-build resume evidence through to written sidecars', async () => {
    const dir = makeTestDir();
    initGitRepo(dir);
    const queueDir = join(dir, '.eforge', 'queue');
    await mkdir(queueDir, { recursive: true });
    const prdPath = join(queueDir, 'resume-prd.md');
    await writeFile(prdPath, '---\ntitle: Resume PRD\ncreated: 2024-01-01\n---\n\n# Resume PRD\n');

    const summary = {
      prdId: 'resume-prd',
      setName: 'resume-set',
      featureBranch: 'eforge/resume-set',
      baseBranch: 'main',
      plans: [{ planId: 'plan-01', status: 'failed', error: 'Transient' }],
      failingPlan: { planId: 'plan-01', errorMessage: 'Transient' },
      landedCommits: [],
      diffStat: '',
      modelsUsed: [],
      failedAt: new Date().toISOString(),
    };
    const verdict = {
      verdict: 'manual' as const,
      confidence: 'low' as const,
      rationale: 'Manual with resume option.',
      completedWork: [],
      remainingWork: [],
      risks: [],
    };

    const { jsonPath } = await moveFailedWithSidecar(prdPath, summary, verdict, undefined, dir, {
      resumeEligibility: {
        source: 'projectResumeEligibility',
        eligible: true,
        featureBranch: 'eforge/resume-set',
        artifactAvailability: 'feature-branch',
        landedCommitCount: 1,
        diffStat: '1 file changed',
      },
      recoveryOptions: [{ kind: 'compiled-build-resume', action: 'eforge_resume_build', recommended: true, reason: 'Eligible artifacts.' }],
    });

    const sidecarJson = JSON.parse(await readFile(jsonPath, 'utf-8'));
    expect(sidecarJson.resumeEligibility.eligible).toBe(true);
    expect(sidecarJson.recoveryOptions).toContainEqual(expect.objectContaining({ kind: 'compiled-build-resume', action: 'eforge_resume_build', recommended: true }));
  });
  // --- eforge:endregion plan-02-sidecar-resume-option ---
});

describe('sidecar path uses prdId not planId', () => {
  const makeTestDir = useTempDir('eforge-sidecar-path-test-');

  it('writeRecoverySidecar uses prdId for filename, not planId', async () => {
    const { writeRecoverySidecar } = await import('@eforge-build/engine/recovery/sidecar');
    const dir = makeTestDir();
    const failedDir = join(dir, 'failed');

    const summary = {
      prdId: 'my-feature-prd',
      setName: 'test-set',
      featureBranch: 'eforge/test-set',
      baseBranch: 'main',
      plans: [
        { planId: 'plan-01', status: 'merged' },
        { planId: 'plan-02', status: 'merged' },
        { planId: 'plan-03', status: 'failed', error: 'Compilation error' },
      ],
      failingPlan: { planId: 'plan-03', errorMessage: 'Compilation error' },
      landedCommits: [],
      diffStat: '',
      modelsUsed: [],
      failedAt: new Date().toISOString(),
    };
    const verdict = {
      verdict: 'manual' as const,
      confidence: 'low' as const,
      rationale: 'See plan-03 failure.',
      completedWork: ['plan-01 merged', 'plan-02 merged'],
      remainingWork: ['plan-03: compilation error'],
      risks: [],
    };

    const { mdPath, jsonPath } = await writeRecoverySidecar({ failedPrdDir: failedDir, prdId: 'my-feature-prd', summary, verdict });


    expect(mdPath).toContain('my-feature-prd.recovery.md');
    expect(jsonPath).toContain('my-feature-prd.recovery.json');


    const { existsSync } = await import('node:fs');
    expect(existsSync(join(failedDir, 'plan-03.recovery.json'))).toBe(false);
    expect(existsSync(join(failedDir, 'plan-03.recovery.md'))).toBe(false);


    expect(existsSync(join(failedDir, 'my-feature-prd.recovery.json'))).toBe(true);
  });
});

describe('multi-plan sidecar content when verdict is fallback manual', () => {
  const makeTestDir = useTempDir('eforge-multi-plan-sidecar-test-');







  function makeMultiPlanSummary() {
    return {
      prdId: 'add-eforge-console-side-by-side-with-legacy-monitor-ui',
      setName: 'multi-plan-set',
      featureBranch: 'eforge/multi-plan-set',
      baseBranch: 'main',
      plans: [
        { planId: 'plan-01-console-shell', status: 'merged' },
        { planId: 'plan-02-activity-audit-view', status: 'merged' },
        { planId: 'plan-03-now-dashboard', status: 'merged' },
        { planId: 'plan-05-runs-build-entrypoints', status: 'merged' },
        { planId: 'plan-07-system-configuration-view', status: 'merged' },
        { planId: 'plan-04-queue-view', status: 'failed', error: 'API error 529: overloaded_error' },
        { planId: 'plan-06-static-serving-package-integration', status: 'failed', error: 'API error 529: overloaded_error' },
      ],
      failingPlan: {
        planId: 'plan-06-static-serving-package-integration',
        errorMessage: 'API error 529: overloaded_error',
        terminalSubtype: 'error_transient_transport',
      },

      failingPlans: [
        { planId: 'plan-04-queue-view', errorMessage: 'API error 529: overloaded_error', terminalSubtype: 'error_transient_transport' },
        { planId: 'plan-06-static-serving-package-integration', errorMessage: 'API error 529: overloaded_error', terminalSubtype: 'error_transient_transport' },
      ],
      landedCommits: [
        { sha: 'abc1234def5678901234567890abcdef12345678', subject: 'feat: plan-01-console-shell implementation', author: 'Test', date: '2026-05-26T05:30:00.000Z' },
        { sha: 'def5678901234567890abcdef12345678abc1234', subject: 'feat: plan-02-activity-audit-view', author: 'Test', date: '2026-05-26T05:45:00.000Z' },
      ],
      diffStat: '42 files changed, 1337 insertions(+)',
      modelsUsed: ['claude-sonnet-4-6'],
      failedAt: '2026-05-26T06:15:10.000Z',
    };
  }

  const fallbackManualVerdict = {
    verdict: 'manual' as const,
    confidence: 'low' as const,
    rationale: 'Recovery analyst failed or timed out.',
    completedWork: [],
    remainingWork: [],
    risks: [],
    recoveryError: 'Recovery analyst timed out after 90000ms',
  };

  it('Markdown sidecar lists all 5 merged plans when verdict is fallback manual', async () => {
    const { writeRecoverySidecar } = await import('@eforge-build/engine/recovery/sidecar');
    const dir = makeTestDir();


    const summary = makeMultiPlanSummary() as any;

    const { mdPath } = await writeRecoverySidecar({
      failedPrdDir: dir,
      prdId: 'add-eforge-console-side-by-side-with-legacy-monitor-ui',
      summary,
      verdict: fallbackManualVerdict,
    });

    const md = await readFile(mdPath, 'utf-8');


    expect(md).toContain('plan-01-console-shell');
    expect(md).toContain('plan-02-activity-audit-view');
    expect(md).toContain('plan-03-now-dashboard');
    expect(md).toContain('plan-05-runs-build-entrypoints');
    expect(md).toContain('plan-07-system-configuration-view');
  });

  it('Markdown sidecar lists both failed plan IDs even when verdict is fallback manual', async () => {
    const { writeRecoverySidecar } = await import('@eforge-build/engine/recovery/sidecar');
    const dir = makeTestDir();


    const summary = makeMultiPlanSummary() as any;

    const { mdPath } = await writeRecoverySidecar({
      failedPrdDir: dir,
      prdId: 'add-eforge-console-side-by-side-with-legacy-monitor-ui',
      summary,
      verdict: fallbackManualVerdict,
    });

    const md = await readFile(mdPath, 'utf-8');


    expect(md).toContain('### Failing Plans');



    expect(md).toContain('plan-04-queue-view');
    expect(md).toContain('plan-06-static-serving-package-integration');

    expect(md).toContain('API error 529: overloaded_error');
    expect(md).toContain('error_transient_transport');
  });

  it('JSON sidecar preserves failingPlans array with both failed plan IDs', async () => {
    const { writeRecoverySidecar } = await import('@eforge-build/engine/recovery/sidecar');
    const dir = makeTestDir();


    const summary = makeMultiPlanSummary() as any;

    const { jsonPath } = await writeRecoverySidecar({
      failedPrdDir: dir,
      prdId: 'add-eforge-console-side-by-side-with-legacy-monitor-ui',
      summary,
      verdict: fallbackManualVerdict,
    });

    const raw = await readFile(jsonPath, 'utf-8');
    const parsed = JSON.parse(raw);


    expect(parsed.boundedEvidence.failingPlans).toBeDefined();
    expect(Array.isArray(parsed.boundedEvidence.failingPlans)).toBe(true);
    expect(parsed.boundedEvidence.failingPlans).toHaveLength(2);

    const failingPlanIds = parsed.boundedEvidence.failingPlans.map((p: { planId: string }) => p.planId);
    expect(failingPlanIds).toContain('plan-04-queue-view');
    expect(failingPlanIds).toContain('plan-06-static-serving-package-integration');
  });

  it('JSON sidecar contains all 7 plans in boundedEvidence.plans when verdict is fallback manual', async () => {
    const { writeRecoverySidecar } = await import('@eforge-build/engine/recovery/sidecar');
    const dir = makeTestDir();


    const summary = makeMultiPlanSummary() as any;

    const { jsonPath } = await writeRecoverySidecar({
      failedPrdDir: dir,
      prdId: 'add-eforge-console-side-by-side-with-legacy-monitor-ui',
      summary,
      verdict: fallbackManualVerdict,
    });

    const raw = await readFile(jsonPath, 'utf-8');
    const parsed = JSON.parse(raw);

    expect(parsed.boundedEvidence.plans).toHaveLength(7);
    const planIds = parsed.boundedEvidence.plans.map((p: { planId: string }) => p.planId);
    expect(planIds).toContain('plan-01-console-shell');
    expect(planIds).toContain('plan-04-queue-view');
    expect(planIds).toContain('plan-06-static-serving-package-integration');
  });

  it('JSON sidecar schemaVersion is 3 and verdict is manual for fallback path', async () => {
    const { writeRecoverySidecar } = await import('@eforge-build/engine/recovery/sidecar');
    const dir = makeTestDir();


    const summary = makeMultiPlanSummary() as any;

    const { jsonPath } = await writeRecoverySidecar({
      failedPrdDir: dir,
      prdId: 'add-eforge-console-side-by-side-with-legacy-monitor-ui',
      summary,
      verdict: fallbackManualVerdict,
    });

    const raw = await readFile(jsonPath, 'utf-8');
    const parsed = JSON.parse(raw);

    expect(parsed.schemaVersion).toBe(3);
    expect(parsed.verdict.verdict).toBe('manual');

    expect(parsed.boundedEvidence.failingPlan.planId).toBe('plan-06-static-serving-package-integration');
  });
});
// --- eforge:endregion daemon-recovery-sidecars-suite ---
