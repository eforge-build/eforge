// --- eforge:region daemon-recovery-engine-fallback-suite ---
// Split from daemon-recovery.test.ts.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
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

describe('recovery analyst parse error -> manual-verdict sidecar', () => {
  const makeTestDir = useTempDir('eforge-parse-error-test-');

  it('writes sidecar with manual verdict and recoveryError when analyst returns garbage', async () => {
    const dir = makeTestDir();
    initGitRepo(dir);


    const failedDir = join(dir, '.eforge', 'queue', 'failed');
    await mkdir(failedDir, { recursive: true });
    await writeFile(join(failedDir, 'test-prd.md'), '# Test PRD\n\nDo a thing.', 'utf-8');


    const stub = new StubHarness([{ text: 'This is unparseable garbage with no XML block.' }]);
    const engine = await EforgeEngine.create({ cwd: dir, agentRuntimes: stub });

    const events = await collectEvents(engine.recover('test-set', 'test-prd'));

    const complete = events.find(e => e.type === 'recovery:complete') as Extract<EforgeEvent, { type: 'recovery:complete' }> | undefined;
    expect(complete).toBeDefined();
    expect(complete!.sidecarJsonPath).toBeDefined();

    const sidecarContent = JSON.parse(await readFile(complete!.sidecarJsonPath!, 'utf-8'));
    expect(sidecarContent.verdict.verdict).toBe('manual');
    expect(sidecarContent.verdict.recoveryError).toBeDefined();
    expect(sidecarContent.verdict.recoveryError).toBeTruthy();
    expect(sidecarContent.schemaVersion).toBe(3);
  });
});

describe('EforgeEngine.recover() with no state.json + populated event db', () => {
  const makeTestDir = useTempDir('eforge-partial-eventdb-test-');

  it('produces partial sidecar with partial:true and failingPlan.planId from events', async () => {
    const dir = makeTestDir();
    initGitRepo(dir);


    const failedDir = join(dir, '.eforge', 'queue', 'failed');
    await mkdir(failedDir, { recursive: true });
    await writeFile(join(failedDir, 'test-prd.md'), '# Test PRD\n\nDo a thing.', 'utf-8');


    const dbDir = join(dir, '.eforge');
    await mkdir(dbDir, { recursive: true });
    const monitorDbPath = join(dbDir, 'monitor.db');
    const db = openDatabase(monitorDbPath);
    db.insertRun({
      id: 'run-partial-01',
      sessionId: 'session-partial-01',
      planSet: 'test-set',
      command: 'build',
      status: 'failed',
      startedAt: new Date().toISOString(),
      cwd: dir,
      pid: 99999,
    });
    db.insertEvent({
      runId: 'run-partial-01',
      type: 'plan:build:failed',
      planId: 'plan-01-foundation',
      data: JSON.stringify({ type: 'plan:build:failed', planId: 'plan-01-foundation', error: 'Type error in foundation' }),
      timestamp: new Date().toISOString(),
    });
    db.insertEvent({
      runId: 'run-partial-01',
      type: 'agent:start',
      data: JSON.stringify({ type: 'agent:start', model: 'claude-sonnet-4-5', agent: 'builder' }),
      timestamp: new Date().toISOString(),
    });
    db.close();


    const manualVerdictText = `<recovery verdict="manual" confidence="low">
  <rationale>Partial context — state.json was missing, summary synthesized from event DB.</rationale>
  <completedWork></completedWork>
  <remainingWork><item>All work remains</item></remainingWork>
  <risks><item>Root cause unknown without full state</item></risks>
</recovery>`;
    const stub = new StubHarness([{ text: manualVerdictText }]);
    const engine = await EforgeEngine.create({ cwd: dir, agentRuntimes: stub });

    const events = await collectEvents(engine.recover('test-set', 'test-prd'));

    const complete = events.find(e => e.type === 'recovery:complete') as Extract<EforgeEvent, { type: 'recovery:complete' }> | undefined;
    expect(complete).toBeDefined();
    expect(complete!.sidecarJsonPath).toBeDefined();

    const sidecarContent = JSON.parse(await readFile(complete!.sidecarJsonPath!, 'utf-8'));

    expect(sidecarContent.boundedEvidence.identity.partial).toBeUndefined();

    expect(sidecarContent.boundedEvidence.failingPlan.planId).toBe('plan-01-foundation');
    expect(sidecarContent.schemaVersion).toBe(3);
  });
});

describe('EforgeEngine.recover() fallback: multi-plan DB + unparsable analyst output', () => {
  const makeTestDir = useTempDir('eforge-recover-fallback-multiplan-');





  function seedMultiPlanDb(dir: string, dbPath: string): void {
    const db = openDatabase(dbPath);
    const baseTs = new Date('2026-05-26T05:00:00.000Z').getTime();

    db.insertRun({
      id: 'run-fallback-multi-01',
      sessionId: 'session-fallback-01',
      planSet: 'fallback-multi-set',
      command: 'build',
      status: 'failed',
      startedAt: new Date(baseTs).toISOString(),
      cwd: dir,
      pid: 11111,
    });

    const mergedPlanIds = [
      'plan-01-console-shell',
      'plan-02-activity-audit-view',
      'plan-03-now-dashboard',
      'plan-05-runs-build-entrypoints',
      'plan-07-system-configuration-view',
    ];
    for (let i = 0; i < mergedPlanIds.length; i++) {
      const planId = mergedPlanIds[i]!;
      const ts = new Date(baseTs + (i + 1) * 60_000).toISOString();
      db.insertEvent({
        runId: 'run-fallback-multi-01',
        type: 'plan:status:change',
        planId,
        data: JSON.stringify({ type: 'plan:status:change', planId, status: 'merged' }),
        timestamp: ts,
      });
    }

    db.insertEvent({
      runId: 'run-fallback-multi-01',
      type: 'plan:status:change',
      planId: 'plan-04-queue-view',
      data: JSON.stringify({ type: 'plan:status:change', planId: 'plan-04-queue-view', status: 'failed' }),
      timestamp: new Date('2026-05-26T06:15:04.000Z').toISOString(),
    });
    db.insertEvent({
      runId: 'run-fallback-multi-01',
      type: 'plan:build:failed',
      planId: 'plan-04-queue-view',
      data: JSON.stringify({
        type: 'plan:build:failed',
        planId: 'plan-04-queue-view',
        error: 'API error 529: overloaded_error',
        terminalSubtype: 'error_transient_transport',
      }),
      timestamp: new Date('2026-05-26T06:15:04.000Z').toISOString(),
    });

    db.insertEvent({
      runId: 'run-fallback-multi-01',
      type: 'plan:status:change',
      planId: 'plan-06-static-serving',
      data: JSON.stringify({ type: 'plan:status:change', planId: 'plan-06-static-serving', status: 'failed' }),
      timestamp: new Date('2026-05-26T06:15:10.000Z').toISOString(),
    });
    db.insertEvent({
      runId: 'run-fallback-multi-01',
      type: 'plan:build:failed',
      planId: 'plan-06-static-serving',
      data: JSON.stringify({
        type: 'plan:build:failed',
        planId: 'plan-06-static-serving',
        error: 'API error 529: overloaded_error',
        terminalSubtype: 'error_transient_transport',
      }),
      timestamp: new Date('2026-05-26T06:15:10.000Z').toISOString(),
    });

    db.close();
  }

  it('fallback sidecar contains all reconstructed plans and both failed plans from DB when analyst output is unparsable', async () => {
    const dir = makeTestDir();
    initGitRepo(dir);


    const failedDir = join(dir, '.eforge', 'queue', 'failed');
    await mkdir(failedDir, { recursive: true });
    await writeFile(join(failedDir, 'fallback-multi-prd.md'), '# Fallback Multi PRD\n\nTest.', 'utf-8');


    const dbDir = join(dir, '.eforge');
    mkdirSync(dbDir, { recursive: true });
    const monitorDbPath = join(dbDir, 'monitor.db');
    seedMultiPlanDb(dir, monitorDbPath);



    const stub = new StubHarness([{ text: 'This is completely unparseable output with no XML.' }]);
    const engine = await EforgeEngine.create({ cwd: dir, agentRuntimes: stub });

    const events: EforgeEvent[] = [];
    for await (const event of engine.recover('fallback-multi-set', 'fallback-multi-prd')) {
      events.push(event);
    }

    const complete = events.find(e => e.type === 'recovery:complete') as Extract<EforgeEvent, { type: 'recovery:complete' }> | undefined;
    expect(complete).toBeDefined();
    expect(complete!.sidecarJsonPath).toBeDefined();
    expect(complete!.sidecarMdPath).toBeDefined();

    const sidecarContent = JSON.parse(await readFile(complete!.sidecarJsonPath!, 'utf-8'));



    expect(sidecarContent.verdict.verdict).toBe('split');
    expect(sidecarContent.verdict.recommendationSource).toBe('deterministic');
    expect(sidecarContent.verdict.recoveryError).toBeTruthy();


    expect(sidecarContent.boundedEvidence.plans).toHaveLength(7);
    const planIds: string[] = sidecarContent.boundedEvidence.plans.map((p: { planId: string }) => p.planId);
    const expectedPlanIds = [
      'plan-01-console-shell',
      'plan-02-activity-audit-view',
      'plan-03-now-dashboard',
      'plan-04-queue-view',
      'plan-05-runs-build-entrypoints',
      'plan-06-static-serving',
      'plan-07-system-configuration-view',
    ];
    expect(new Set(planIds)).toEqual(new Set(expectedPlanIds));


    expect(sidecarContent.boundedEvidence.failingPlans).toBeDefined();
    expect(Array.isArray(sidecarContent.boundedEvidence.failingPlans)).toBe(true);
    expect(sidecarContent.boundedEvidence.failingPlans).toHaveLength(2);
    const failingIds: string[] = sidecarContent.boundedEvidence.failingPlans.map((p: { planId: string }) => p.planId);
    expect(new Set(failingIds)).toEqual(new Set(['plan-04-queue-view', 'plan-06-static-serving']));


    const md = await readFile(complete!.sidecarMdPath!, 'utf-8');
    expect(md).toContain('### Failing Plans');
    expect(md).toContain('plan-04-queue-view');
    expect(md).toContain('plan-06-static-serving');
  });
});

describe('EforgeEngine.recover() with no state.json AND no event db', () => {
  const makeTestDir = useTempDir('eforge-no-context-test-');

  it('produces partial sidecar with manual verdict and recoveryError when context is fully absent', async () => {
    const dir = makeTestDir();
    initGitRepo(dir);


    const failedDir = join(dir, '.eforge', 'queue', 'failed');
    await mkdir(failedDir, { recursive: true });
    await writeFile(join(failedDir, 'test-prd.md'), '# Test PRD\n\nDo a thing.', 'utf-8');


    const stub = new StubHarness([{ text: 'Completely unparseable output with no XML.' }]);
    const engine = await EforgeEngine.create({ cwd: dir, agentRuntimes: stub });

    const events = await collectEvents(engine.recover('test-set', 'test-prd'));

    const complete = events.find(e => e.type === 'recovery:complete') as Extract<EforgeEvent, { type: 'recovery:complete' }> | undefined;
    expect(complete).toBeDefined();
    expect(complete!.sidecarJsonPath).toBeDefined();

    const sidecarContent = JSON.parse(await readFile(complete!.sidecarJsonPath!, 'utf-8'));

    expect(sidecarContent.boundedEvidence.identity.partial).toBe(true);

    expect(sidecarContent.verdict.verdict).toBe('manual');
    expect(sidecarContent.verdict.recoveryError).toBeDefined();
    expect(typeof sidecarContent.verdict.recoveryError).toBe('string');
    expect(sidecarContent.verdict.recoveryError.length).toBeGreaterThan(0);
    expect(sidecarContent.schemaVersion).toBe(3);

    expect(sidecarContent.verdict.recommendationSource).toBe('manual-fallback');
    expect(typeof sidecarContent.verdict.recommendationRationale).toBe('string');
    expect(sidecarContent.verdict.recommendationRationale.length).toBeGreaterThan(0);


    expect(complete!.sidecarMdPath).toBeDefined();
    const md = await readFile(complete!.sidecarMdPath!, 'utf-8');
    expect(md).toContain('**Verdict Source:** manual-fallback');
  });
});
// --- eforge:endregion daemon-recovery-engine-fallback-suite ---
