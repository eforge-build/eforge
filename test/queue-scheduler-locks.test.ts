import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { QueueScheduler, SCHEDULER_INPUT_TYPES, type SchedulerInputEvent } from '@eforge-build/engine/queue/scheduler';
import { EforgeEngine } from '@eforge-build/engine/eforge';
import type { EforgeEvent } from '@eforge-build/engine/events';
import { QueueExecExitCode, type QueuedPrd } from '@eforge-build/engine/prd-queue';
import { upsertArtifact } from '@eforge-build/engine/artifacts';
import { StubHarness } from './stub-harness';
import {
  createTestEnv,
  exec,
  makeDeadPid,
  makeProfileRouter,
  makeQueueDispatchPolicyGate,
  makeQueuedPrd,
  waitForSchedulerEvents,
  waitForSpawnCallCount,
} from './queue-scheduler-helpers';

describe('QueueScheduler — lock-aware startup', () => {
  it('treats locked PRDs as running, dequeues only independent PRDs, emits correct diagnostic events', async () => {
    const { cwd, eventQueue, spawnPrdChild, makeScheduler } = await createTestEnv();

    // PRDs: a (will be locked), b (independent), c (depends_on a), d (independent)
    // With parallelism=2, locked a (running) + launched b = 2 = capacity.
    // c is dependency-blocked (a is running, not completed/skipped).
    // d is capacity-blocked (runningCount=2 >= parallelism=2).
    // Write real files so discoverNewPrds() finds them and reconcileQueueState works.
    const aPath = join(cwd, 'eforge', 'queue', 'a.md');
    const bPath = join(cwd, 'eforge', 'queue', 'b.md');
    const cPath = join(cwd, 'eforge', 'queue', 'c.md');
    const dPath = join(cwd, 'eforge', 'queue', 'd.md');
    await writeFile(aPath, '---\ntitle: A\n---\n\n# A');
    await writeFile(bPath, '---\ntitle: B\n---\n\n# B');
    await writeFile(cPath, '---\ntitle: C\ndepends_on: [a]\n---\n\n# C');
    await writeFile(dPath, '---\ntitle: D\n---\n\n# D');

    const aPrd = makeQueuedPrd('a', [], aPath);
    const bPrd = makeQueuedPrd('b', [], bPath);
    const cPrd = makeQueuedPrd('c', ['a'], cPath);
    const dPrd = makeQueuedPrd('d', [], dPath);

    // Create a live queue lock for PRD a to simulate an in-flight build.
    await mkdir(join(cwd, '.eforge', 'queue-locks'), { recursive: true });
    await writeFile(join(cwd, '.eforge', 'queue-locks', 'a.lock'), String(process.pid));

    // spawnPrdChild never resolves so we can inspect the scheduler events synchronously.
    spawnPrdChild.mockImplementation(() => new Promise<'completed' | 'failed' | 'skipped' | 'already-claimed'>(() => {}));

    const scheduler = makeScheduler([aPrd, bPrd, cPrd, dPrd]);
    await scheduler.start();

    const events = await waitForSchedulerEvents(eventQueue, (seen) =>
      seen.some((event) => event.type === 'daemon:scheduler:dequeued' && event.prdId === 'b')
      && seen.some((event) => event.type === 'daemon:scheduler:dependency-blocked')
      && seen.some((event) => event.type === 'daemon:scheduler:capacity-blocked'),
    );

    // spawnPrdChild must NOT be called for a (it's locked) or d (capacity-blocked).
    // It IS called for b.
    expect(spawnPrdChild).toHaveBeenCalledTimes(1);
    expect(spawnPrdChild.mock.calls[0][0].id).toBe('b');

    // daemon:scheduler:dequeued for b: locked a counts as one running PRD,
    // so after launching b, runningCount=2 and capacityRemaining=0.
    type DequeuedEvent = Extract<EforgeEvent, { type: 'daemon:scheduler:dequeued' }>;
    const dequeued = events.find((e) => e.type === 'daemon:scheduler:dequeued') as DequeuedEvent | undefined;
    expect(dequeued).toBeDefined();
    expect(dequeued?.prdId).toBe('b');
    expect(dequeued?.capacityRemaining).toBe(0);

    // daemon:scheduler:dependency-blocked for c with blockedBy: ['a'].
    type DepBlockedEvent = Extract<EforgeEvent, { type: 'daemon:scheduler:dependency-blocked' }>;
    const depBlocked = events.find((e) => e.type === 'daemon:scheduler:dependency-blocked') as DepBlockedEvent | undefined;
    expect(depBlocked).toBeDefined();
    expect(depBlocked?.prdId).toBe('c');
    expect(depBlocked?.blockedBy).toContain('a');

    // daemon:scheduler:capacity-blocked emitted because d is ready but capacity is full.
    // runningCount includes locked a plus scheduler-started b.
    type CapacityBlockedEvent = Extract<EforgeEvent, { type: 'daemon:scheduler:capacity-blocked' }>;
    const capBlocked = events.find((e) => e.type === 'daemon:scheduler:capacity-blocked') as CapacityBlockedEvent | undefined;
    expect(capBlocked).toBeDefined();
    expect(capBlocked?.runningCount).toBe(2);
    expect(capBlocked?.limit).toBe(2);

    eventQueue.removeProducer();
  });

  it('reconciles locks for newly discovered PRDs before dispatching them', async () => {
    const { cwd, bus, eventQueue, spawnPrdChild, makeScheduler } = await createTestEnv();

    const scheduler = makeScheduler([]);
    await scheduler.start();

    await writeFile(join(cwd, 'eforge', 'queue', 'a.md'), '---\ntitle: A\n---\n\n# A');
    await writeFile(join(cwd, 'eforge', 'queue', 'b.md'), '---\ntitle: B\n---\n\n# B');
    await mkdir(join(cwd, '.eforge', 'queue-locks'), { recursive: true });
    await writeFile(join(cwd, '.eforge', 'queue-locks', 'a.lock'), String(process.pid));

    spawnPrdChild.mockImplementation(() => new Promise<'completed' | 'failed' | 'skipped' | 'already-claimed'>(() => {}));

    const mutationEvent: SchedulerInputEvent = {
      type: 'queue:mutation',
      reason: 'enqueue',
      timestamp: new Date().toISOString(),
    };
    bus.emit('queue:mutation', mutationEvent);

    await waitForSpawnCallCount(spawnPrdChild, 1);

    const events = eventQueue.drainAvailable();
    expect(spawnPrdChild).toHaveBeenCalledTimes(1);
    expect(spawnPrdChild.mock.calls[0][0].id).toBe('b');

    type DequeuedEvent = Extract<EforgeEvent, { type: 'daemon:scheduler:dequeued' }>;
    const dequeued = events.find((e) => e.type === 'daemon:scheduler:dequeued') as DequeuedEvent | undefined;
    expect(dequeued).toEqual(expect.objectContaining({
      prdId: 'b',
      capacityRemaining: 0,
    }));

    eventQueue.removeProducer();
  });

  it('reconciles locks for re-queued PRDs before redispatching them', async () => {
    const { cwd, bus, eventQueue, spawnPrdChild, makeScheduler } = await createTestEnv();
    const prdPath = join(cwd, 'eforge', 'queue', 'a.md');
    await writeFile(prdPath, '---\ntitle: A\n---\n\n# A');

    spawnPrdChild.mockImplementation(() => new Promise<'completed' | 'failed' | 'skipped' | 'already-claimed'>(() => {}));

    const scheduler = makeScheduler([makeQueuedPrd('a', [], prdPath)]);
    await scheduler.start();
    await waitForSpawnCallCount(spawnPrdChild, 1);

    expect(spawnPrdChild).toHaveBeenCalledTimes(1);
    eventQueue.drainAvailable();

    await mkdir(join(cwd, '.eforge', 'queue-locks'), { recursive: true });
    await writeFile(join(cwd, '.eforge', 'queue-locks', 'a.lock'), String(process.pid));

    const failedEvent: SchedulerInputEvent = {
      type: 'queue:prd:complete',
      prdId: 'a',
      status: 'failed',
      timestamp: new Date().toISOString(),
    };
    bus.emit('queue:prd:complete', failedEvent);

    await vi.waitFor(() => {
      expect(scheduler.processed).toBe(1);
    });

    const events = eventQueue.drainAvailable();
    expect(spawnPrdChild).toHaveBeenCalledTimes(1);
    expect(events.filter((e) => e.type === 'daemon:scheduler:dequeued')).toHaveLength(0);
    expect(scheduler.processed).toBe(1);

    eventQueue.removeProducer();
  });
});

describe('QueueScheduler — already-claimed child result', () => {
  it('maps the already-claimed child exit code to a non-terminal scheduler result', async () => {
    const { cwd, eventQueue } = await createTestEnv();
    const prdPath = join(cwd, 'eforge', 'queue', 'a.md');
    const lockPath = join(cwd, '.eforge', 'queue-locks', 'a.lock');
    const cliPath = join(cwd, 'fake-eforge-cli.js');

    await writeFile(prdPath, '---\ntitle: A\n---\n\n# A');
    await mkdir(join(cwd, '.eforge', 'queue-locks'), { recursive: true });
    await writeFile(lockPath, String(process.pid));
    await writeFile(cliPath, `process.exit(${QueueExecExitCode.SkippedAlreadyClaimed});\n`);

    const previousCliPath = process.env.EFORGE_CLI_PATH;
    process.env.EFORGE_CLI_PATH = cliPath;

    try {
      const engine = await EforgeEngine.create({ cwd, agentRuntimes: new StubHarness([]) });
      type SpawnPrdChildForTest = {
        spawnPrdChild: (
          prd: QueuedPrd,
          options: { auto?: boolean; verbose?: boolean; noMonitor?: boolean },
          prdSessionId: string,
          pushEvent: (event: EforgeEvent) => void,
        ) => Promise<'completed' | 'failed' | 'skipped' | 'already-claimed'>;
      };

      const result = await (engine as unknown as SpawnPrdChildForTest).spawnPrdChild(
        makeQueuedPrd('a', [], prdPath),
        { auto: true, noMonitor: true },
        'session-a',
        () => {},
      );

      expect(result).toBe('already-claimed');
      expect(existsSync(prdPath)).toBe(true);
      expect(existsSync(lockPath)).toBe(true);
    } finally {
      if (previousCliPath === undefined) {
        delete process.env.EFORGE_CLI_PATH;
      } else {
        process.env.EFORGE_CLI_PATH = previousCliPath;
      }
      eventQueue.removeProducer();
    }
  });

  it('deletes the root queue PRD when the child exits completed', async () => {
    const { cwd, eventQueue } = await createTestEnv();
    const prdPath = join(cwd, 'eforge', 'queue', 'a.md');
    const lockPath = join(cwd, '.eforge', 'queue-locks', 'a.lock');
    const cliPath = join(cwd, 'fake-eforge-cli.js');

    await writeFile(prdPath, '---\ntitle: A\n---\n\n# A');
    await mkdir(join(cwd, '.eforge', 'queue-locks'), { recursive: true });
    await writeFile(lockPath, String(process.pid));
    await writeFile(cliPath, `process.exit(${QueueExecExitCode.Completed});\n`);

    const previousCliPath = process.env.EFORGE_CLI_PATH;
    process.env.EFORGE_CLI_PATH = cliPath;

    try {
      const engine = await EforgeEngine.create({
        cwd,
        agentRuntimes: new StubHarness([]),
        config: { prdQueue: { dir: 'eforge/queue' }, plugins: { enabled: false } },
      });
      type SpawnPrdChildForTest = {
        spawnPrdChild: (
          prd: QueuedPrd,
          options: { auto?: boolean; verbose?: boolean; noMonitor?: boolean },
          prdSessionId: string,
          pushEvent: (event: EforgeEvent) => void,
        ) => Promise<'completed' | 'failed' | 'skipped' | 'already-claimed'>;
      };

      const result = await (engine as unknown as SpawnPrdChildForTest).spawnPrdChild(
        makeQueuedPrd('a', [], prdPath),
        { auto: true, noMonitor: true },
        'session-a',
        () => {},
      );

      expect(result).toBe('completed');
      expect(existsSync(prdPath)).toBe(false);
      expect(existsSync(lockPath)).toBe(false);
    } finally {
      if (previousCliPath === undefined) {
        delete process.env.EFORGE_CLI_PATH;
      } else {
        process.env.EFORGE_CLI_PATH = previousCliPath;
      }
      eventQueue.removeProducer();
    }
  });

  it('leaves dependents blocked and counters unchanged when spawnPrdChild returns already-claimed', async () => {
    const { cwd, bus, eventQueue, spawnPrdChild, makeScheduler } = await createTestEnv();

    // Write real PRD files so reconcileQueueState can load them from disk.
    const aPath = join(cwd, 'eforge', 'queue', 'a.md');
    const cPath = join(cwd, 'eforge', 'queue', 'c.md');
    await writeFile(aPath, '---\ntitle: A\n---\n\n# A');
    await writeFile(cPath, '---\ntitle: C\ndepends_on: [a]\n---\n\n# C');

    // PRDs: a (no deps), c (depends_on a)
    const aPrd = makeQueuedPrd('a', [], aPath);
    const cPrd = makeQueuedPrd('c', ['a'], cPath);

    // a resolves with 'already-claimed'; c should never be launched first.
    spawnPrdChild
      .mockResolvedValueOnce('already-claimed')
      .mockResolvedValue('completed');

    const scheduler = makeScheduler([aPrd, cPrd]);
    await scheduler.start();

    await waitForSpawnCallCount(spawnPrdChild, 1);

    // Counters must not be incremented for an already-claimed result.
    expect(scheduler.processed).toBe(0);
    expect(scheduler.skipped).toBe(0);

    // No queue:prd:complete must have been emitted for a.
    const eventsAfterSpawn = eventQueue.drainAvailable();
    const completions = eventsAfterSpawn.filter((e) => e.type === 'queue:prd:complete');
    expect(completions).toHaveLength(0);

    // spawnPrdChild was called once (for a). c was not launched because a is
    // still 'running' in the scheduler's prdState.
    expect(spawnPrdChild).toHaveBeenCalledTimes(1);
    expect(spawnPrdChild.mock.calls[0][0].id).toBe('a');

    // Write a live lock for a to simulate the already-claimed owner still holding
    // the claim. With a live lock present, reconciliation keeps a running and c
    // remains dependency-blocked on mutation ticks.
    await mkdir(join(cwd, '.eforge', 'queue-locks'), { recursive: true });
    await writeFile(join(cwd, '.eforge', 'queue-locks', 'a.lock'), String(process.pid));

    // Trigger a scheduler tick via mutation — c must still not be launched.
    const mutationEvent: SchedulerInputEvent = {
      type: 'queue:mutation',
      reason: 'enqueue',
      timestamp: new Date().toISOString(),
    };
    bus.emit('queue:mutation', mutationEvent);
    await waitForSchedulerEvents(eventQueue, (seen) => seen.some((event) => event.type === 'daemon:scheduler:dependency-blocked'));

    // Still only one call (for a); c remains blocked by a's running state (live lock).
    expect(spawnPrdChild).toHaveBeenCalledTimes(1);

    // Write a registry artifact for a so c's dependency can be satisfied once a completes.
    const nowAlreadyClaimed = new Date().toISOString();
    await upsertArtifact(cwd, { prdId: 'a', artifactBranch: 'eforge/a', commitSha: 'abc123', resolvedBase: 'main', landingAction: 'pr', status: 'built', recordedAt: nowAlreadyClaimed, updatedAt: nowAlreadyClaimed });

    // Once the original worker emits a real terminal completion, the dependent
    // PRD can proceed and the completion is counted normally.
    const completeEvent: SchedulerInputEvent = {
      type: 'queue:prd:complete',
      prdId: 'a',
      status: 'completed',
      timestamp: new Date().toISOString(),
    };
    bus.emit('queue:prd:complete', completeEvent);
    await waitForSpawnCallCount(spawnPrdChild, 2);

    expect(scheduler.processed).toBe(1);
    expect(scheduler.skipped).toBe(0);
    expect(spawnPrdChild).toHaveBeenCalledTimes(2);
    expect(spawnPrdChild.mock.calls[1][0].id).toBe('c');

    eventQueue.removeProducer();
  });
});
