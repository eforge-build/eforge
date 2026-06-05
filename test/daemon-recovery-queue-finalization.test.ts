// --- eforge:region daemon-recovery-queue-finalization-suite ---
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

describe('sidecar verdict source metadata — deterministic path', () => {
  const makeTestDir = useTempDir('eforge-sidecar-source-metadata-');





  function seedAllTransientDb(dir: string, setName: string): void {
    const dbDir = join(dir, '.eforge');
    mkdirSync(dbDir, { recursive: true });
    const dbPath = join(dbDir, 'monitor.db');
    const db = openDatabase(dbPath);

    db.insertRun({
      id: `run-src-${setName}`,
      sessionId: `session-src-${setName}`,
      planSet: setName,
      command: 'build',
      status: 'failed',
      startedAt: new Date('2026-05-26T05:00:00.000Z').toISOString(),
      cwd: dir,
      pid: 88888,
    });

    db.insertEvent({
      runId: `run-src-${setName}`,
      type: 'plan:status:change',
      planId: 'plan-01',
      data: JSON.stringify({ type: 'plan:status:change', planId: 'plan-01', status: 'failed' }),
      timestamp: new Date('2026-05-26T06:00:00.000Z').toISOString(),
    });
    db.insertEvent({
      runId: `run-src-${setName}`,
      type: 'plan:build:failed',
      planId: 'plan-01',
      data: JSON.stringify({
        type: 'plan:build:failed',
        planId: 'plan-01',
        error: 'API error 529: overloaded_error',
        terminalSubtype: 'error_transient_transport',
      }),
      timestamp: new Date('2026-05-26T06:00:00.000Z').toISOString(),
    });

    db.close();
  }

  it('sidecar JSON has recommendationSource=deterministic when analyst output is malformed and all failures are transient', async () => {
    const dir = makeTestDir();
    initGitRepo(dir);

    const setName = 'src-meta-transient-set';
    seedAllTransientDb(dir, setName);

    const failedDir = join(dir, '.eforge', 'queue', 'failed');
    await mkdir(failedDir, { recursive: true });
    await writeFile(join(failedDir, 'src-meta-prd.md'), '# Test PRD\n\nBuild something.', 'utf-8');


    const stub = new StubHarness([{ text: 'Completely malformed output, no XML.' }]);
    const engine = await EforgeEngine.create({ cwd: dir, agentRuntimes: stub });

    const events = await collectEvents(engine.recover(setName, 'src-meta-prd'));

    const complete = events.find(e => e.type === 'recovery:complete') as Extract<EforgeEvent, { type: 'recovery:complete' }> | undefined;
    expect(complete).toBeDefined();
    expect(complete!.sidecarJsonPath).toBeDefined();

    const sidecarContent = JSON.parse(await readFile(complete!.sidecarJsonPath!, 'utf-8'));


    expect(sidecarContent.verdict.verdict).toBe('retry');

    expect(sidecarContent.verdict.recommendationSource).toBe('deterministic');

    expect(sidecarContent.verdict.recommendationRationale ?? sidecarContent.verdict.rationale).toBeTruthy();
  });

  it('sidecar Markdown displays verdict source section when recommendationSource is present', async () => {
    const dir = makeTestDir();
    initGitRepo(dir);

    const setName = 'src-md-display-set';
    seedAllTransientDb(dir, setName);

    const failedDir = join(dir, '.eforge', 'queue', 'failed');
    await mkdir(failedDir, { recursive: true });
    await writeFile(join(failedDir, 'src-md-prd.md'), '# Test PRD\n\nBuild something.', 'utf-8');

    const stub = new StubHarness([{ text: 'No verdict XML here.' }]);
    const engine = await EforgeEngine.create({ cwd: dir, agentRuntimes: stub });

    const events = await collectEvents(engine.recover(setName, 'src-md-prd'));

    const complete = events.find(e => e.type === 'recovery:complete') as Extract<EforgeEvent, { type: 'recovery:complete' }> | undefined;
    expect(complete).toBeDefined();
    expect(complete!.sidecarMdPath).toBeDefined();

    const md = await readFile(complete!.sidecarMdPath!, 'utf-8');

    expect(md).toContain('**Verdict Source:** deterministic');
  });

  it('sidecar JSON has recommendationSource=analyst when analyst verdict passes invariant validation', async () => {
    const dir = makeTestDir();
    initGitRepo(dir);

    const setName = 'src-analyst-valid-set';
    seedAllTransientDb(dir, setName);

    const failedDir = join(dir, '.eforge', 'queue', 'failed');
    await mkdir(failedDir, { recursive: true });
    await writeFile(join(failedDir, 'analyst-src-prd.md'), '# Test PRD\n\nBuild something.', 'utf-8');


    const validAnalystOutput = `<recovery verdict="retry" confidence="high">
  <rationale>plan-01 failed due to API error 529: overloaded_error which is a transient transport failure. No tool calls were executed.</rationale>
  <completedWork></completedWork>
  <remainingWork><item>plan-01 must be retried</item></remainingWork>
  <risks><item>API 529 errors may recur</item></risks>
</recovery>`;

    const stub = new StubHarness([{ text: validAnalystOutput }]);
    const engine = await EforgeEngine.create({ cwd: dir, agentRuntimes: stub });

    const events = await collectEvents(engine.recover(setName, 'analyst-src-prd'));

    const complete = events.find(e => e.type === 'recovery:complete') as Extract<EforgeEvent, { type: 'recovery:complete' }> | undefined;
    expect(complete).toBeDefined();
    expect(complete!.sidecarJsonPath).toBeDefined();

    const sidecarContent = JSON.parse(await readFile(complete!.sidecarJsonPath!, 'utf-8'));
    expect(sidecarContent.verdict.verdict).toBe('retry');

    expect(sidecarContent.verdict.recommendationSource).toBe('analyst');

    expect(sidecarContent.verdict.verdictInvalidationReason).toBeUndefined();
  });

  it('sidecar Markdown displays analyst invalidation reason when present', async () => {
    const dir = makeTestDir();
    initGitRepo(dir);


    const dbDir = join(dir, '.eforge');
    mkdirSync(dbDir, { recursive: true });
    const dbPath = join(dbDir, 'monitor.db');
    const db = openDatabase(dbPath);

    const setName = 'src-md-invalidation-set';
    db.insertRun({
      id: `run-src-inv-01`,
      sessionId: `session-src-inv-01`,
      planSet: setName,
      command: 'build',
      status: 'failed',
      startedAt: new Date('2026-05-26T05:00:00.000Z').toISOString(),
      cwd: dir,
      pid: 99988,
    });

    for (const [planId, ts] of [
      ['plan-01-alpha', '2026-05-26T06:00:00.000Z'],
      ['plan-02-beta', '2026-05-26T06:05:00.000Z'],
    ] as [string, string][]) {
      db.insertEvent({
        runId: 'run-src-inv-01',
        type: 'plan:status:change',
        planId,
        data: JSON.stringify({ type: 'plan:status:change', planId, status: 'failed' }),
        timestamp: ts,
      });
      db.insertEvent({
        runId: 'run-src-inv-01',
        type: 'plan:build:failed',
        planId,
        data: JSON.stringify({
          type: 'plan:build:failed',
          planId,
          error: 'API error 529: overloaded_error',
          terminalSubtype: 'error_transient_transport',
        }),
        timestamp: ts,
      });
    }
    db.close();

    const failedDir = join(dir, '.eforge', 'queue', 'failed');
    await mkdir(failedDir, { recursive: true });
    await writeFile(join(failedDir, 'md-inv-prd.md'), '# Test PRD\n\nBuild something.', 'utf-8');


    const incompleteOutput = `<recovery verdict="retry" confidence="high">
  <rationale>plan-02-beta failed due to API error 529: overloaded_error transient error.</rationale>
  <completedWork></completedWork>
  <remainingWork><item>plan-02-beta needs retry</item></remainingWork>
  <risks></risks>
</recovery>`;

    const stub = new StubHarness([{ text: incompleteOutput }]);
    const engine = await EforgeEngine.create({ cwd: dir, agentRuntimes: stub });

    const events = await collectEvents(engine.recover(setName, 'md-inv-prd'));

    const complete = events.find(e => e.type === 'recovery:complete') as Extract<EforgeEvent, { type: 'recovery:complete' }> | undefined;
    expect(complete).toBeDefined();
    expect(complete!.sidecarMdPath).toBeDefined();
    expect(complete!.sidecarJsonPath).toBeDefined();

    const md = await readFile(complete!.sidecarMdPath!, 'utf-8');
    const sidecarContent = JSON.parse(await readFile(complete!.sidecarJsonPath!, 'utf-8'));


    expect(sidecarContent.verdict.verdictInvalidationReason).toBeTruthy();


    expect(md).toContain('**Analyst Verdict Rejected:**');
    expect(md).toContain('plan-01-alpha');
  });
});

describe('inline queue finalization: recovery sidecar written on build failure', () => {


  const CLI_STUB = resolve(fileURLToPath(import.meta.url), '..', 'fixtures', 'cli-stub-fail.mjs');

  const makeTestDir = useTempDir('eforge-inline-queue-recovery-');

  it('writes sidecar with deterministic verdict when analyst output is malformed and all failures are transient', async () => {
    const dir = makeTestDir();
    initGitRepo(dir);

    const prdId = 'inline-queue-recovery-prd';


    const dbDir = join(dir, '.eforge');
    mkdirSync(dbDir, { recursive: true });
    const dbPath = join(dbDir, 'monitor.db');
    const db = openDatabase(dbPath);

    db.insertRun({
      id: 'run-inline-01',
      sessionId: 'session-inline-01',
      planSet: prdId,
      command: 'build',
      status: 'failed',
      startedAt: new Date('2026-05-26T05:00:00.000Z').toISOString(),
      cwd: dir,
      pid: 77777,
    });
    db.insertEvent({
      runId: 'run-inline-01',
      type: 'plan:status:change',
      planId: 'plan-01',
      data: JSON.stringify({ type: 'plan:status:change', planId: 'plan-01', status: 'failed' }),
      timestamp: new Date('2026-05-26T06:00:00.000Z').toISOString(),
    });
    db.insertEvent({
      runId: 'run-inline-01',
      type: 'plan:build:failed',
      planId: 'plan-01',
      data: JSON.stringify({
        type: 'plan:build:failed',
        planId: 'plan-01',
        error: 'API error 529: overloaded_error',
        terminalSubtype: 'error_transient_transport',
      }),
      timestamp: new Date('2026-05-26T06:00:00.000Z').toISOString(),
    });
    db.close();


    const queueDir = join(dir, '.eforge', 'queue');
    await mkdir(queueDir, { recursive: true });
    const prdPath = join(queueDir, `${prdId}.md`);
    await writeFile(prdPath, `---\ntitle: ${prdId}\n---\n\n# Inline Queue Recovery Test\n\nDo things.\n`, 'utf-8');


    const stub = new StubHarness([{ text: 'This is completely unparseable output with no XML.' }]);
    const engine = await EforgeEngine.create({ cwd: dir, agentRuntimes: stub });

    type SpawnPrdChildForTest = {
      spawnPrdChild: (
        prd: QueuedPrd,
        options: { auto?: boolean; verbose?: boolean },
        prdSessionId: string,
        pushEvent: (event: EforgeEvent) => void,
      ) => Promise<'completed' | 'failed' | 'skipped' | 'already-claimed'>;
    };

    const previousCliPath = process.env.EFORGE_CLI_PATH;
    process.env.EFORGE_CLI_PATH = CLI_STUB;
    try {
      const prd: QueuedPrd = {
        id: prdId,
        filePath: prdPath,
        frontmatter: { title: prdId },
        content: `---\ntitle: ${prdId}\n---\n\n# Inline Queue Recovery Test\n`,
        lastCommitHash: '',
        lastCommitDate: '',
      };

      const result = await (engine as unknown as SpawnPrdChildForTest).spawnPrdChild(
        prd,
        { auto: true },
        'session-inline-01',
        () => {},
      );

      expect(result).toBe('failed');
    } finally {
      if (previousCliPath === undefined) {
        delete process.env.EFORGE_CLI_PATH;
      } else {
        process.env.EFORGE_CLI_PATH = previousCliPath;
      }
    }


    const failedDir = join(queueDir, 'failed');
    const sidecarJsonPath = join(failedDir, `${prdId}.recovery.json`);
    const sidecarContent = JSON.parse(await readFile(sidecarJsonPath, 'utf-8'));


    expect(sidecarContent.verdict.verdict).toBe('retry');

    expect(sidecarContent.verdict.recommendationSource).toBe('deterministic');

    expect(sidecarContent.verdict.recommendationRationale).toBeTruthy();

    expect(sidecarContent.verdict.recoveryError).toBeTruthy();
  });
});
// --- eforge:endregion daemon-recovery-queue-finalization-suite ---
