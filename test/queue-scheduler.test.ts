/**
 * Unit tests for QueueScheduler.
 *
 * Drives the scheduler in isolation with a stub EventEmitter bus and a stub
 * spawnPrdChild. No subprocess, no daemon, no filesystem watcher.
 *
 * Tests:
 *   1. queue:mutation event triggers discovery + spawn of a newly-discovered PRD.
 *   2. queue:prd:complete (completed) triggers discovery + spawn of a dependent PRD.
 *   3. queue:prd:complete (failed) marks dependents as blocked (no spawn).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { QueueScheduler, SCHEDULER_INPUT_TYPES, type SchedulerInputEvent } from '@eforge-build/engine/queue/scheduler';
import { EforgeEngine } from '@eforge-build/engine/eforge';
import { AsyncEventQueue } from '@eforge-build/engine/concurrency';
import type { EforgeEvent } from '@eforge-build/engine/events';
import { QueueExecExitCode, type QueuedPrd } from '@eforge-build/engine/prd-queue';
import type { PolicyGateRegistration, ProfileRouterRegistration } from '@eforge-build/engine/extensions/types';
import { StubHarness } from './stub-harness';

const exec = promisify(execFile);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQueuedPrd(id: string, dependsOn: string[] = [], filePath?: string): QueuedPrd {
  return {
    id,
    filePath: filePath ?? `/tmp/${id}.md`,
    frontmatter: { title: id, depends_on: dependsOn.length ? dependsOn : undefined },
    content: `---\ntitle: ${id}\n---\n\n# ${id}`,
    lastCommitHash: '',
    lastCommitDate: '',
  };
}

function makeQueueDispatchPolicyGate(
  value: PolicyGateRegistration['value'],
): PolicyGateRegistration {
  return {
    kind: 'policyGate',
    extensionName: 'test-policy',
    extensionPath: '/tmp/test-policy.js',
    value,
    gateKind: 'queue-dispatch',
    method: 'beforeQueueDispatch',
    registrationIndex: 0,
  };
}

function makeProfileRouter(
  selectBuildProfile: ProfileRouterRegistration['value']['selectBuildProfile'],
): ProfileRouterRegistration {
  return {
    kind: 'profileRouter',
    extensionName: 'test-router-extension',
    extensionPath: '/tmp/test-router.js',
    name: 'test-router',
    value: { name: 'test-router', selectBuildProfile },
  };
}

async function createTestEnv(): Promise<{
  cwd: string;
  queueDir: string;
  bus: EventEmitter;
  eventQueue: AsyncEventQueue<EforgeEvent>;
  spawnPrdChild: ReturnType<typeof vi.fn>;
  makeScheduler: (
    initialPrds: QueuedPrd[],
    policyGates?: PolicyGateRegistration[],
    profileRouters?: ProfileRouterRegistration[],
  ) => QueueScheduler;
}> {
  const cwd = await mkdtemp(join(tmpdir(), 'eforge-sched-unit-'));
  await exec('git', ['init'], { cwd });
  await exec('git', ['config', 'user.email', 'test@test.com'], { cwd });
  await exec('git', ['config', 'user.name', 'Test'], { cwd });
  const queueDir = 'eforge/queue';
  await mkdir(join(cwd, 'eforge', 'queue'), { recursive: true });

  const bus = new EventEmitter();
  const eventQueue = new AsyncEventQueue<EforgeEvent>();
  // Keep the queue alive for the duration of the test (watcher producer).
  eventQueue.addProducer();

  // Stub spawnPrdChild: resolves to 'completed' by default.
  const spawnPrdChild = vi.fn<[QueuedPrd, unknown, string], Promise<'completed' | 'failed' | 'skipped' | 'already-claimed'>>()
    .mockResolvedValue('completed');

  const abortController = new AbortController();

  const makeScheduler = (
    initialPrds: QueuedPrd[],
    policyGates: PolicyGateRegistration[] = [],
    profileRouters: ProfileRouterRegistration[] = [],
  ): QueueScheduler =>
    new QueueScheduler({
      bus,
      cwd,
      queueDir,
      config: {
        maxConcurrentBuilds: 2,
        prdQueue: { dir: queueDir, watchPollIntervalMs: 0 },
        plugins: { enabled: false },
        extensions: { policyGateTimeoutMs: 5000, policyGateFailurePolicy: 'fail-closed' },
      } as unknown as import('@eforge-build/engine/config').EforgeConfig,
      configProfile: { name: null, source: 'none', scope: null, config: null },
      parallelism: 2,
      abortController,
      eventQueue,
      spawnPrdChild,
      options: { auto: true },
      initialPrds,
      extensionRegistry: { policyGates, profileRouters },
    });

  return { cwd, queueDir, bus, eventQueue, spawnPrdChild, makeScheduler };
}

// ---------------------------------------------------------------------------
// SCHEDULER_INPUT_TYPES export check
// ---------------------------------------------------------------------------

describe('SCHEDULER_INPUT_TYPES', () => {
  it('contains queue:mutation and queue:prd:complete', () => {
    expect(SCHEDULER_INPUT_TYPES.has('queue:mutation')).toBe(true);
    expect(SCHEDULER_INPUT_TYPES.has('queue:prd:complete')).toBe(true);
  });
});

// --- eforge:region plan-02-policy-gate-engine-integration ---
describe('QueueScheduler — queue dispatch policy gates', () => {
  it('blocks before profile routing, session start, semaphore acquisition, or spawn', async () => {
    const { cwd, eventQueue, spawnPrdChild, makeScheduler } = await createTestEnv();
    const prdPath = join(cwd, 'eforge', 'queue', 'blocked-prd.md');
    await writeFile(prdPath, '---\ntitle: Blocked PRD\n---\n\n# Blocked PRD');
    await exec('git', ['add', '.'], { cwd });
    await exec('git', ['commit', '-m', 'queue files'], { cwd });

    const profileRouter = vi.fn(() => ({ profile: 'routed-profile' }));
    const scheduler = makeScheduler(
      [makeQueuedPrd('blocked-prd', [], prdPath)],
      [makeQueueDispatchPolicyGate(() => ({ decision: 'block', reason: 'policy says no' }))],
      [makeProfileRouter(profileRouter)],
    );

    await scheduler.start();
    await new Promise((r) => setTimeout(r, 200));

    const events = eventQueue.drainAvailable();
    expect(spawnPrdChild).not.toHaveBeenCalled();
    expect(profileRouter).not.toHaveBeenCalled();
    expect(events.some((event) => event.type === 'session:start')).toBe(false);
    expect(events.some((event) => event.type === 'queue:profile:selected')).toBe(false);
    const dequeuedIndex = events.findIndex((event) => event.type === 'daemon:scheduler:dequeued');
    const policyDecisionIndex = events.findIndex((event) => event.type === 'extension:policy:decision');
    expect(dequeuedIndex).toBeGreaterThanOrEqual(0);
    expect(policyDecisionIndex).toBeGreaterThanOrEqual(0);
    expect(dequeuedIndex).toBeLessThan(policyDecisionIndex);
    expect(events).toContainEqual(expect.objectContaining({ type: 'extension:policy:decision', decision: 'block', reason: 'policy says no' }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'queue:prd:complete', prdId: 'blocked-prd', status: 'failed' }));
    expect(existsSync(prdPath)).toBe(false);
    expect(existsSync(join(cwd, 'eforge', 'queue', 'failed', 'blocked-prd.md'))).toBe(true);

    eventQueue.removeProducer();
  });

  it('treats require-approval dispatch decisions as failed completions without spawning', async () => {
    const { cwd, eventQueue, spawnPrdChild, makeScheduler } = await createTestEnv();
    const prdPath = join(cwd, 'eforge', 'queue', 'approval-prd.md');
    await writeFile(prdPath, '---\ntitle: Approval PRD\n---\n\n# Approval PRD');
    await exec('git', ['add', '.'], { cwd });
    await exec('git', ['commit', '-m', 'queue files'], { cwd });

    const scheduler = makeScheduler(
      [makeQueuedPrd('approval-prd', [], prdPath)],
      [makeQueueDispatchPolicyGate(() => ({ decision: 'require-approval', reason: 'needs human review' }))],
    );

    await scheduler.start();
    await new Promise((r) => setTimeout(r, 200));

    const events = eventQueue.drainAvailable();
    expect(spawnPrdChild).not.toHaveBeenCalled();
    expect(events).toContainEqual(expect.objectContaining({ type: 'extension:policy:decision', decision: 'require-approval', reason: 'needs human review' }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'queue:prd:complete', prdId: 'approval-prd', status: 'failed' }));
    expect(existsSync(prdPath)).toBe(false);
    expect(existsSync(join(cwd, 'eforge', 'queue', 'failed', 'approval-prd.md'))).toBe(true);

    eventQueue.removeProducer();
  });

  it('passes the current frontmatter context to queue dispatch policy gates', async () => {
    const { cwd, eventQueue, makeScheduler } = await createTestEnv();
    const prdPath = join(cwd, 'eforge', 'queue', 'profiled-prd.md');
    await writeFile(prdPath, '---\ntitle: Profiled PRD\npriority: 7\nprofile: careful\ndepends_on: [base-prd]\n---\n\n# Profiled PRD');
    await exec('git', ['add', '.'], { cwd });
    await exec('git', ['commit', '-m', 'queue files'], { cwd });

    let seenContext: { gateKind?: string; prdId?: string; prdTitle?: string; priority?: number; profile?: string; dependsOn?: string[] } | undefined;
    const scheduler = makeScheduler(
      [{ ...makeQueuedPrd('profiled-prd', ['base-prd'], prdPath), frontmatter: { title: 'Profiled PRD', priority: 7, profile: 'careful', depends_on: ['base-prd'] } }],
      [makeQueueDispatchPolicyGate(((ctx: { gateKind?: string; prdId?: string; prdTitle?: string; priority?: number; profile?: string; dependsOn?: string[] }) => {
        seenContext = ctx;
        return { decision: 'allow' };
      }) as PolicyGateRegistration['value'])],
    );

    await scheduler.start();
    await new Promise((r) => setTimeout(r, 200));

    expect(seenContext).toEqual(expect.objectContaining({
      gateKind: 'queue-dispatch',
      prdId: 'profiled-prd',
      prdTitle: 'Profiled PRD',
      priority: 7,
      profile: 'careful',
      dependsOn: ['base-prd'],
    }));

    eventQueue.removeProducer();
  });

  it('leaves a dependent PRD unspawned after blocked dispatch completion propagation', async () => {
    const { cwd, bus, eventQueue, spawnPrdChild, makeScheduler } = await createTestEnv();
    const blockedPath = join(cwd, 'eforge', 'queue', 'blocked-prd.md');
    const dependentPath = join(cwd, 'eforge', 'queue', 'dependent-prd.md');
    await writeFile(blockedPath, '---\ntitle: Blocked PRD\n---\n\n# Blocked PRD');
    await writeFile(dependentPath, '---\ntitle: Dependent PRD\ndepends_on: [blocked-prd]\n---\n\n# Dependent PRD');
    await exec('git', ['add', '.'], { cwd });
    await exec('git', ['commit', '-m', 'queue files'], { cwd });

    const scheduler = makeScheduler(
      [makeQueuedPrd('blocked-prd', [], blockedPath), makeQueuedPrd('dependent-prd', ['blocked-prd'], dependentPath)],
      [makeQueueDispatchPolicyGate(() => ({ decision: 'block', reason: 'policy says no' }))],
    );

    await scheduler.start();
    await new Promise((r) => setTimeout(r, 200));

    const events = eventQueue.drainAvailable();
    const completion = events.find((event) => event.type === 'queue:prd:complete' && event.prdId === 'blocked-prd') as SchedulerInputEvent | undefined;
    expect(spawnPrdChild).not.toHaveBeenCalled();
    expect(completion).toEqual(expect.objectContaining({ type: 'queue:prd:complete', prdId: 'blocked-prd', status: 'failed' }));
    expect(events).not.toContainEqual(expect.objectContaining({ type: 'session:start' }));

    if (completion) bus.emit('queue:prd:complete', completion);
    await new Promise((r) => setTimeout(r, 200));
    expect(spawnPrdChild).not.toHaveBeenCalled();
    scheduler.finalizeBlockedAsSkipped();
    expect(scheduler.skipped).toBe(1);

    eventQueue.removeProducer();
  });
});
// --- eforge:endregion plan-02-policy-gate-engine-integration ---

// ---------------------------------------------------------------------------
// Test 1: queue:mutation triggers discovery and spawn
// ---------------------------------------------------------------------------

describe('QueueScheduler — queue:mutation event', () => {
  it('dispatches an independent queued PRD while parallel capacity remains', async () => {
    const { cwd, bus, eventQueue, spawnPrdChild, makeScheduler } = await createTestEnv();

    const runningPrd = makeQueuedPrd('already-running');
    const scheduler = makeScheduler([runningPrd]);
    await scheduler.start();
    await new Promise((r) => setTimeout(r, 50));
    expect(spawnPrdChild).toHaveBeenCalledTimes(1);

    await writeFile(join(cwd, 'eforge', 'queue', 'independent-prd.md'), '---\ntitle: Independent PRD\n---\n\n# Independent PRD');
    const mutationEvent: SchedulerInputEvent = {
      type: 'queue:mutation',
      reason: 'enqueue',
      timestamp: new Date().toISOString(),
    };
    bus.emit('queue:mutation', mutationEvent);

    await new Promise((r) => setTimeout(r, 200));

    expect(spawnPrdChild).toHaveBeenCalledTimes(2);
    expect(spawnPrdChild.mock.calls.map((call) => call[0].id)).toContain('independent-prd');

    eventQueue.removeProducer();
  });

  it('triggers discoverNewPrds and startReadyPrds when injected', async () => {
    const { cwd, queueDir, bus, eventQueue, spawnPrdChild, makeScheduler } = await createTestEnv();

    // Start with empty initial PRDs
    const scheduler = makeScheduler([]);
    await scheduler.start();

    // Write a PRD file to the queue directory
    const prdContent = '---\ntitle: New PRD\nstatus: pending\n---\n\n# New PRD\n\nDo something.';
    await writeFile(join(cwd, 'eforge', 'queue', 'new-prd.md'), prdContent);

    // Inject a queue:mutation event
    const mutationEvent: SchedulerInputEvent = {
      type: 'queue:mutation',
      reason: 'enqueue',
      timestamp: new Date().toISOString(),
    };
    bus.emit('queue:mutation', mutationEvent);

    // Wait for the scheduler to react: discoverNewPrds + startReadyPrds
    await new Promise((r) => setTimeout(r, 200));

    // Drain available events from the queue
    const events = eventQueue.drainAvailable();
    const types = events.map((e) => e.type);

    // Should have discovered the PRD
    expect(types).toContain('queue:prd:discovered');
    const discovered = events.find((e) => e.type === 'queue:prd:discovered') as { prdId: string } | undefined;
    expect(discovered?.prdId).toBe('new-prd');

    // Should have spawned a build (session:start emitted before spawnPrdChild)
    expect(types).toContain('session:start');
    expect(spawnPrdChild).toHaveBeenCalledOnce();
    expect(spawnPrdChild.mock.calls[0][0].id).toBe('new-prd');

    // Release the watcher producer so the queue can terminate
    eventQueue.removeProducer();
  });
});

// ---------------------------------------------------------------------------
// Test 2: queue:prd:complete (completed) unblocks dependent PRD
// ---------------------------------------------------------------------------

describe('QueueScheduler — queue:prd:complete (completed)', () => {
  it('spawns dependent PRD after upstream completes', async () => {
    const { bus, eventQueue, spawnPrdChild, makeScheduler } = await createTestEnv();

    // Two PRDs: 'foundation' (no deps) and 'feature' (depends_on: ['foundation'])
    const foundation = makeQueuedPrd('foundation');
    const feature = makeQueuedPrd('feature', ['foundation']);

    // spawnPrdChild: foundation completes successfully; feature also resolves
    spawnPrdChild.mockResolvedValueOnce('completed').mockResolvedValueOnce('completed');

    const scheduler = makeScheduler([foundation, feature]);
    await scheduler.start();

    // start() calls startReadyPrds() — 'foundation' is ready, 'feature' is not yet
    await new Promise((r) => setTimeout(r, 50));
    expect(spawnPrdChild).toHaveBeenCalledTimes(1);
    expect(spawnPrdChild.mock.calls[0][0].id).toBe('foundation');

    // Simulate foundation completing: the pump would emit this on the bus
    const completeEvent: SchedulerInputEvent = {
      type: 'queue:prd:complete',
      prdId: 'foundation',
      status: 'completed',
      timestamp: new Date().toISOString(),
    };
    bus.emit('queue:prd:complete', completeEvent);

    // Wait for onComplete to run (async)
    await new Promise((r) => setTimeout(r, 200));

    // Feature should now be spawned
    expect(spawnPrdChild).toHaveBeenCalledTimes(2);
    expect(spawnPrdChild.mock.calls[1][0].id).toBe('feature');

    // Counters: foundation processed (not skipped)
    expect(scheduler.processed).toBe(1);
    expect(scheduler.skipped).toBe(0);

    eventQueue.removeProducer();
  });
});

// ---------------------------------------------------------------------------
// Test 3: queue:prd:complete (skipped) unblocks dependent PRD
// ---------------------------------------------------------------------------

describe('QueueScheduler — queue:prd:complete (skipped)', () => {
  it('spawns dependent PRD after upstream is terminally skipped', async () => {
    const { bus, eventQueue, spawnPrdChild, makeScheduler } = await createTestEnv();

    const foundation = makeQueuedPrd('foundation');
    const feature = makeQueuedPrd('feature', ['foundation']);

    spawnPrdChild.mockImplementation(() => new Promise<'completed' | 'failed' | 'skipped' | 'already-claimed'>(() => {}));

    const scheduler = makeScheduler([foundation, feature]);
    await scheduler.start();

    await new Promise((r) => setTimeout(r, 50));
    expect(spawnPrdChild).toHaveBeenCalledTimes(1);
    expect(spawnPrdChild.mock.calls[0][0].id).toBe('foundation');

    const skippedEvent: SchedulerInputEvent = {
      type: 'queue:prd:complete',
      prdId: 'foundation',
      status: 'skipped',
      timestamp: new Date().toISOString(),
    };
    bus.emit('queue:prd:complete', skippedEvent);

    await new Promise((r) => setTimeout(r, 200));

    expect(spawnPrdChild).toHaveBeenCalledTimes(2);
    expect(spawnPrdChild.mock.calls[1][0].id).toBe('feature');
    expect(scheduler.processed).toBe(0);
    expect(scheduler.skipped).toBe(1);

    eventQueue.removeProducer();
  });
});

// ---------------------------------------------------------------------------
// Test 4: queue:prd:complete (failed) blocks dependents
// ---------------------------------------------------------------------------

describe('QueueScheduler — queue:prd:complete (failed)', () => {
  it('marks dependent PRDs as blocked without spawning them', async () => {
    const { bus, eventQueue, spawnPrdChild, makeScheduler } = await createTestEnv();

    const foundation = makeQueuedPrd('foundation');
    const feature = makeQueuedPrd('feature', ['foundation']);

    // foundation fails
    spawnPrdChild.mockResolvedValueOnce('failed');

    const scheduler = makeScheduler([foundation, feature]);
    await scheduler.start();

    // Only foundation is spawned initially
    await new Promise((r) => setTimeout(r, 50));
    expect(spawnPrdChild).toHaveBeenCalledTimes(1);
    expect(spawnPrdChild.mock.calls[0][0].id).toBe('foundation');

    // Simulate foundation failing
    const failEvent: SchedulerInputEvent = {
      type: 'queue:prd:complete',
      prdId: 'foundation',
      status: 'failed',
      timestamp: new Date().toISOString(),
    };
    bus.emit('queue:prd:complete', failEvent);

    // Wait for onComplete to run
    await new Promise((r) => setTimeout(r, 200));

    // Feature should NOT have been spawned (it's blocked)
    expect(spawnPrdChild).toHaveBeenCalledTimes(1);

    // Finalize counts: foundation processed (failed), feature will be counted as skipped
    scheduler.finalizeBlockedAsSkipped();
    expect(scheduler.processed).toBe(1); // foundation was processed (failed, not skipped)
    expect(scheduler.skipped).toBe(1);   // feature was blocked → skipped

    eventQueue.removeProducer();
  });
});

// ---------------------------------------------------------------------------
// Test 4: pause() prevents new PRD from being dequeued
// ---------------------------------------------------------------------------

describe('QueueScheduler — pause() suspends new launches', () => {
  it('pause() causes a ready PRD to NOT be dequeued until resume()', async () => {
    const { cwd, queueDir, bus, eventQueue, spawnPrdChild, makeScheduler } = await createTestEnv();

    // Pause the scheduler before start to ensure no launch on first tick
    const scheduler = makeScheduler([]);
    // Start with no initial PRDs, then pause, write file, inject mutation
    await scheduler.start();

    scheduler.pause();
    expect(scheduler.isSuspended).toBe(true);

    // Write a PRD file to the queue directory
    const prdContent = '---\ntitle: PRD A\nstatus: pending\n---\n\n# PRD A\n\nDo something.';
    await writeFile(join(cwd, queueDir, 'prd-a.md'), prdContent);

    // Inject a queue:mutation to trigger discovery
    const mutationEvent: SchedulerInputEvent = {
      type: 'queue:mutation',
      reason: 'enqueue',
      timestamp: new Date().toISOString(),
    };
    bus.emit('queue:mutation', mutationEvent);

    // Wait for the async discovery to run
    await new Promise((r) => setTimeout(r, 200));

    // PRD should be discovered but NOT spawned (suspended)
    const events = eventQueue.drainAvailable();
    const types = events.map((e) => e.type);
    expect(types).toContain('queue:prd:discovered');
    expect(types).not.toContain('daemon:scheduler:dequeued');
    expect(spawnPrdChild).not.toHaveBeenCalled();

    // Now resume — should immediately dequeue prd-a
    scheduler.resume();
    expect(scheduler.isSuspended).toBe(false);
    await new Promise((r) => setTimeout(r, 200));

    const eventsAfterResume = eventQueue.drainAvailable();
    const typesAfterResume = eventsAfterResume.map((e) => e.type);
    expect(typesAfterResume).toContain('daemon:scheduler:resumed');
    expect(typesAfterResume).toContain('daemon:scheduler:dequeued');
    expect(spawnPrdChild).toHaveBeenCalledTimes(1);
    expect(spawnPrdChild.mock.calls[0][0].id).toBe('prd-a');

    eventQueue.removeProducer();
  });
});

// ---------------------------------------------------------------------------
// Test 5: lock-aware startup regression
// ---------------------------------------------------------------------------

describe('QueueScheduler — lock-aware startup', () => {
  it('treats locked PRDs as running, dequeues only independent PRDs, emits correct diagnostic events', async () => {
    const { cwd, eventQueue, spawnPrdChild, makeScheduler } = await createTestEnv();

    // PRDs: a (will be locked), b (independent), c (depends_on a), d (independent)
    // With parallelism=2, locked a (running) + launched b = 2 = capacity.
    // c is dependency-blocked (a is running, not completed/skipped).
    // d is capacity-blocked (runningCount=2 >= parallelism=2).
    const aPrd = makeQueuedPrd('a');
    const bPrd = makeQueuedPrd('b');
    const cPrd = makeQueuedPrd('c', ['a']);
    const dPrd = makeQueuedPrd('d');

    // Create a live queue lock for PRD a to simulate an in-flight build.
    await mkdir(join(cwd, '.eforge', 'queue-locks'), { recursive: true });
    await writeFile(join(cwd, '.eforge', 'queue-locks', 'a.lock'), String(process.pid));

    // spawnPrdChild never resolves so we can inspect the scheduler events synchronously.
    spawnPrdChild.mockImplementation(() => new Promise<'completed' | 'failed' | 'skipped' | 'already-claimed'>(() => {}));

    const scheduler = makeScheduler([aPrd, bPrd, cPrd, dPrd]);
    await scheduler.start();

    // Give the IIFE a tick to start before draining events.
    await new Promise((r) => setTimeout(r, 50));

    const events = eventQueue.drainAvailable();

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

    await new Promise((r) => setTimeout(r, 200));

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
    await new Promise((r) => setTimeout(r, 50));

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

    await new Promise((r) => setTimeout(r, 200));

    const events = eventQueue.drainAvailable();
    expect(spawnPrdChild).toHaveBeenCalledTimes(1);
    expect(events.filter((e) => e.type === 'daemon:scheduler:dequeued')).toHaveLength(0);
    expect(scheduler.processed).toBe(1);

    eventQueue.removeProducer();
  });
});

// ---------------------------------------------------------------------------
// Test 6: already-claimed child result semantics
// ---------------------------------------------------------------------------

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

  it('leaves dependents blocked and counters unchanged when spawnPrdChild returns already-claimed', async () => {
    const { bus, eventQueue, spawnPrdChild, makeScheduler } = await createTestEnv();

    // PRDs: a (no deps), c (depends_on a)
    const aPrd = makeQueuedPrd('a');
    const cPrd = makeQueuedPrd('c', ['a']);

    // a resolves with 'already-claimed'; c should never be launched.
    spawnPrdChild
      .mockResolvedValueOnce('already-claimed')
      .mockResolvedValue('completed');

    const scheduler = makeScheduler([aPrd, cPrd]);
    await scheduler.start();

    // Wait for the IIFE to resolve.
    await new Promise((r) => setTimeout(r, 100));

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

    // Trigger a scheduler tick via mutation — c must still not be launched.
    const mutationEvent: SchedulerInputEvent = {
      type: 'queue:mutation',
      reason: 'enqueue',
      timestamp: new Date().toISOString(),
    };
    bus.emit('queue:mutation', mutationEvent);
    await new Promise((r) => setTimeout(r, 100));

    // Still only one call (for a); c remains blocked by a's running state.
    expect(spawnPrdChild).toHaveBeenCalledTimes(1);

    // Once the original worker emits a real terminal completion, the dependent
    // PRD can proceed and the completion is counted normally.
    const completeEvent: SchedulerInputEvent = {
      type: 'queue:prd:complete',
      prdId: 'a',
      status: 'completed',
      timestamp: new Date().toISOString(),
    };
    bus.emit('queue:prd:complete', completeEvent);
    await new Promise((r) => setTimeout(r, 100));

    expect(scheduler.processed).toBe(1);
    expect(scheduler.skipped).toBe(0);
    expect(spawnPrdChild).toHaveBeenCalledTimes(2);
    expect(spawnPrdChild.mock.calls[1][0].id).toBe('c');

    eventQueue.removeProducer();
  });
});

// ---------------------------------------------------------------------------
// Test 5: onComplete still runs while suspended (state finalization)
// ---------------------------------------------------------------------------

describe('QueueScheduler — onComplete runs while suspended', () => {
  it('failed completion finalizes prdState to failed even when suspended', async () => {
    const { bus, eventQueue, spawnPrdChild, makeScheduler } = await createTestEnv();

    const foundation = makeQueuedPrd('foundation');
    const feature = makeQueuedPrd('feature', ['foundation']);

    spawnPrdChild.mockResolvedValueOnce('failed');

    const scheduler = makeScheduler([foundation, feature]);
    await scheduler.start();

    // foundation is spawned; pause before the completion arrives
    await new Promise((r) => setTimeout(r, 50));
    expect(spawnPrdChild).toHaveBeenCalledTimes(1);

    scheduler.pause();

    // Simulate foundation failing while suspended
    const failEvent: SchedulerInputEvent = {
      type: 'queue:prd:complete',
      prdId: 'foundation',
      status: 'failed',
      timestamp: new Date().toISOString(),
    };
    bus.emit('queue:prd:complete', failEvent);

    // Wait for onComplete to run
    await new Promise((r) => setTimeout(r, 200));

    // onComplete should have processed the failure: counter incremented
    expect(scheduler.processed).toBe(1);

    // feature should be blocked (propagateBlocked ran)
    scheduler.finalizeBlockedAsSkipped();
    expect(scheduler.skipped).toBe(1);

    // No new builds should have started (suspended)
    expect(spawnPrdChild).toHaveBeenCalledTimes(1);

    eventQueue.removeProducer();
  });
});
