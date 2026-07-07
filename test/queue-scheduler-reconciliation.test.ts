import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { QueueScheduler, SCHEDULER_INPUT_TYPES, type SchedulerInputEvent } from '@eforge-build/engine/queue/scheduler';
import { EforgeEngine } from '@eforge-build/engine/eforge';
import type { EforgeEvent } from '@eforge-build/engine/events';
import { QueueExecExitCode } from '@eforge-build/engine/prd-queue';
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

describe('QueueScheduler — runtime lock reconciliation', () => {
  it('rediscovers auto-resume requeues after failed completion without propagating skipped dependents', async () => {
    const { cwd, bus, eventQueue, spawnPrdChild, makeScheduler } = await createTestEnv();
    spawnPrdChild.mockImplementation(() => new Promise<'completed' | 'failed' | 'skipped' | 'already-claimed'>(() => {}));
    const scheduler = makeScheduler([]);
    await scheduler.start();
    eventQueue.drainAvailable();

    await mkdir(join(cwd, 'eforge', 'queue', 'failed'), { recursive: true });
    await mkdir(join(cwd, 'eforge', 'queue', 'waiting'), { recursive: true });
    await writeFile(join(cwd, 'eforge', 'queue', 'parent.md'), '---\ntitle: parent\n---\n\n# parent');
    await writeFile(join(cwd, 'eforge', 'queue', 'waiting', 'child.md'), '---\ntitle: child\ndepends_on: [parent]\n---\n\n# child');
    await writeFile(join(cwd, 'eforge', 'queue', 'failed', 'parent.recovery.json'), JSON.stringify({ applied: { action: 'continue-repair', appliedAt: '2026-01-01T00:00:00.000Z' } }));

    bus.emit('queue:prd:complete', { type: 'queue:prd:complete', prdId: 'parent', status: 'failed', timestamp: new Date().toISOString() } as SchedulerInputEvent);

    await waitForSpawnCallCount(spawnPrdChild, 1);
    expect(spawnPrdChild.mock.calls[0][0].id).toBe('parent');
    expect(existsSync(join(cwd, 'eforge', 'queue', 'waiting', 'child.md'))).toBe(true);
    expect(existsSync(join(cwd, 'eforge', 'queue', 'skipped', 'child.md'))).toBe(false);
    expect(eventQueue.drainAvailable()).toContainEqual(expect.objectContaining({ type: 'daemon:scheduler:dequeued', prdId: 'parent' }));

    eventQueue.removeProducer();
  });

  it('demotes a running PRD to pending and re-dispatches it after its lock is deleted', async () => {
    // Scenario: a has a live lock at startup (counts as running, not dispatched by
    // this scheduler). After deleting a's lock, the next mutation tick demotes a
    // to pending and dispatches it.
    const { cwd, bus, eventQueue, spawnPrdChild, makeScheduler } = await createTestEnv();

    const aPath = join(cwd, 'eforge', 'queue', 'a.md');
    await writeFile(aPath, '---\ntitle: A\n---\n\n# A');

    await mkdir(join(cwd, '.eforge', 'queue-locks'), { recursive: true });
    await writeFile(join(cwd, '.eforge', 'queue-locks', 'a.lock'), String(process.pid));

    spawnPrdChild.mockImplementation(() => new Promise<'completed' | 'failed' | 'skipped' | 'already-claimed'>(() => {}));

    const scheduler = makeScheduler([makeQueuedPrd('a', [], aPath)]);
    await scheduler.start();

    // a must NOT be dispatched (live lock counts it as already running)
    await vi.waitFor(() => {
      expect(spawnPrdChild).not.toHaveBeenCalled();
    });
    eventQueue.drainAvailable();

    // Delete a's lock (simulates the in-flight build finishing without emitting
    // queue:prd:complete — lock gone but scheduler not notified)
    const { rm } = await import('node:fs/promises');
    await rm(join(cwd, '.eforge', 'queue-locks', 'a.lock'));

    // Emit a mutation to trigger a tick
    bus.emit('queue:mutation', { type: 'queue:mutation', reason: 'external', timestamp: new Date().toISOString() } as SchedulerInputEvent);

    const events = await waitForSchedulerEvents(eventQueue, (seen) => seen.some((event) => event.type === 'daemon:scheduler:dequeued' && event.prdId === 'a'));

    // After reconciliation: a was demoted (absent lock) and re-dispatched
    const dequeued = events.filter((e) => e.type === 'daemon:scheduler:dequeued') as Extract<EforgeEvent, { type: 'daemon:scheduler:dequeued' }>[];
    expect(dequeued.some((e) => e.prdId === 'a')).toBe(true);
    expect(spawnPrdChild).toHaveBeenCalledTimes(1);
    expect(spawnPrdChild.mock.calls[0][0].id).toBe('a');

    eventQueue.removeProducer();
  });

  it('frees capacity for another ready PRD after a running PRD lock is deleted', async () => {
    const { cwd, bus, eventQueue, spawnPrdChild, makeScheduler } = await createTestEnv();

    const aPath = join(cwd, 'eforge', 'queue', 'a.md');
    const bPath = join(cwd, 'eforge', 'queue', 'b.md');
    await writeFile(aPath, '---\ntitle: A\n---\n\n# A');
    // b carries a higher priority (lower number) so resolveQueueOrder dispatches
    // it before a once capacity frees up — dispatch order is driven by the
    // reconciled on-disk queue, not the initial in-memory array order.
    await writeFile(bPath, '---\ntitle: B\npriority: 1\n---\n\n# B');

    const lockPath = join(cwd, '.eforge', 'queue-locks', 'a.lock');
    await mkdir(join(cwd, '.eforge', 'queue-locks'), { recursive: true });
    await writeFile(lockPath, String(process.pid));

    spawnPrdChild.mockImplementation(() => new Promise<'completed' | 'failed' | 'skipped' | 'already-claimed'>(() => {}));

    // Prioritize b and run at capacity=1. While a's live lock is counted as
    // running, b must be capacity-blocked; once the lock is gone, b should be
    // dequeued instead of a stale running count blocking the tick.
    const scheduler = makeScheduler([
      makeQueuedPrd('b', [], bPath),
      makeQueuedPrd('a', [], aPath),
    ], [], [], 1);
    await scheduler.start();

    expect(spawnPrdChild).not.toHaveBeenCalled();
    const startupEvents = await waitForSchedulerEvents(eventQueue, (seen) => seen.some((event) => event.type === 'daemon:scheduler:capacity-blocked'));
    expect(startupEvents).toContainEqual(expect.objectContaining({
      type: 'daemon:scheduler:capacity-blocked',
      runningCount: 1,
      limit: 1,
    }));

    const { rm } = await import('node:fs/promises');
    await rm(lockPath);

    bus.emit('queue:mutation', { type: 'queue:mutation', reason: 'external', timestamp: new Date().toISOString() } as SchedulerInputEvent);

    const events = await waitForSchedulerEvents(eventQueue, (seen) => seen.some((event) => event.type === 'daemon:scheduler:dequeued' && event.prdId === 'b'));
    expect(events).toContainEqual(expect.objectContaining({
      type: 'daemon:scheduler:dequeued',
      prdId: 'b',
      capacityRemaining: 0,
    }));
    expect(spawnPrdChild).toHaveBeenCalledTimes(1);
    expect(spawnPrdChild.mock.calls[0][0].id).toBe('b');

    eventQueue.removeProducer();
  });

  it('removes a dead-PID lock from a pending PRD before dispatching it', async () => {
    const { cwd, eventQueue, spawnPrdChild, makeScheduler } = await createTestEnv();

    const aPath = join(cwd, 'eforge', 'queue', 'a.md');
    const lockPath = join(cwd, '.eforge', 'queue-locks', 'a.lock');
    await writeFile(aPath, '---\ntitle: A\n---\n\n# A');
    await mkdir(join(cwd, '.eforge', 'queue-locks'), { recursive: true });
    await writeFile(lockPath, String(makeDeadPid()));

    spawnPrdChild.mockImplementation(() => {
      expect(existsSync(lockPath)).toBe(false);
      return new Promise<'completed' | 'failed' | 'skipped' | 'already-claimed'>(() => {});
    });

    const scheduler = makeScheduler([makeQueuedPrd('a', [], aPath)]);
    await scheduler.start();
    await waitForSpawnCallCount(spawnPrdChild, 1);

    expect(spawnPrdChild).toHaveBeenCalledTimes(1);
    expect(spawnPrdChild.mock.calls[0][0].id).toBe('a');
    expect(existsSync(lockPath)).toBe(false);

    eventQueue.removeProducer();
  });

  it('removes a corrupt lock from a pending PRD before dispatching it', async () => {
    const { cwd, eventQueue, spawnPrdChild, makeScheduler } = await createTestEnv();

    const aPath = join(cwd, 'eforge', 'queue', 'a.md');
    const lockPath = join(cwd, '.eforge', 'queue-locks', 'a.lock');
    await writeFile(aPath, '---\ntitle: A\n---\n\n# A');
    await mkdir(join(cwd, '.eforge', 'queue-locks'), { recursive: true });
    await writeFile(lockPath, 'not-a-pid');

    spawnPrdChild.mockImplementation(() => {
      expect(existsSync(lockPath)).toBe(false);
      return new Promise<'completed' | 'failed' | 'skipped' | 'already-claimed'>(() => {});
    });

    const scheduler = makeScheduler([makeQueuedPrd('a', [], aPath)]);
    await scheduler.start();
    await waitForSpawnCallCount(spawnPrdChild, 1);

    expect(spawnPrdChild).toHaveBeenCalledTimes(1);
    expect(spawnPrdChild.mock.calls[0][0].id).toBe('a');
    expect(existsSync(lockPath)).toBe(false);

    eventQueue.removeProducer();
  });

  it('removes a dead-PID lock during reconciliation and re-dispatches the PRD', async () => {
    // Scenario: a is promoted to running at startup (live lock), then the lock PID
    // dies (simulated by overwriting with a dead PID). On the next mutation tick,
    // the stale lock is removed and a is demoted → re-dispatched.
    const { cwd, bus, eventQueue, spawnPrdChild, makeScheduler } = await createTestEnv();

    const aPath = join(cwd, 'eforge', 'queue', 'a.md');
    await writeFile(aPath, '---\ntitle: A\n---\n\n# A');

    await mkdir(join(cwd, '.eforge', 'queue-locks'), { recursive: true });
    // Start with a live lock so a is promoted to running at startup
    await writeFile(join(cwd, '.eforge', 'queue-locks', 'a.lock'), String(process.pid));

    spawnPrdChild.mockImplementation(() => new Promise<'completed' | 'failed' | 'skipped' | 'already-claimed'>(() => {}));

    const scheduler = makeScheduler([makeQueuedPrd('a', [], aPath)]);
    await scheduler.start();

    // a is running via live lock — not dispatched yet
    await vi.waitFor(() => {
      expect(spawnPrdChild).not.toHaveBeenCalled();
    });
    eventQueue.drainAvailable();

    // Overwrite with a dead PID to simulate process death
    await writeFile(join(cwd, '.eforge', 'queue-locks', 'a.lock'), String(makeDeadPid()));

    bus.emit('queue:mutation', { type: 'queue:mutation', reason: 'external', timestamp: new Date().toISOString() } as SchedulerInputEvent);

    // Stale lock removed and a dispatched
    await waitForSpawnCallCount(spawnPrdChild, 1);
    expect(spawnPrdChild.mock.calls[0][0].id).toBe('a');

    const { existsSync } = await import('node:fs');
    expect(existsSync(join(cwd, '.eforge', 'queue-locks', 'a.lock'))).toBe(false);

    eventQueue.removeProducer();
  });

  it('removes a corrupt lock during reconciliation and re-dispatches the PRD', async () => {
    // Scenario: a is running (live lock at startup), lock becomes corrupt.
    // On next tick: corrupt lock removed, a demoted → dispatched.
    const { cwd, bus, eventQueue, spawnPrdChild, makeScheduler } = await createTestEnv();

    const aPath = join(cwd, 'eforge', 'queue', 'a.md');
    await writeFile(aPath, '---\ntitle: A\n---\n\n# A');

    await mkdir(join(cwd, '.eforge', 'queue-locks'), { recursive: true });
    await writeFile(join(cwd, '.eforge', 'queue-locks', 'a.lock'), String(process.pid));

    spawnPrdChild.mockImplementation(() => new Promise<'completed' | 'failed' | 'skipped' | 'already-claimed'>(() => {}));

    const scheduler = makeScheduler([makeQueuedPrd('a', [], aPath)]);
    await scheduler.start();

    await vi.waitFor(() => {
      expect(spawnPrdChild).not.toHaveBeenCalled();
    });
    eventQueue.drainAvailable();

    // Overwrite with corrupt content
    await writeFile(join(cwd, '.eforge', 'queue-locks', 'a.lock'), 'not-a-pid');

    bus.emit('queue:mutation', { type: 'queue:mutation', reason: 'external', timestamp: new Date().toISOString() } as SchedulerInputEvent);

    await waitForSpawnCallCount(spawnPrdChild, 1);
    expect(spawnPrdChild.mock.calls[0][0].id).toBe('a');

    const { existsSync } = await import('node:fs');
    expect(existsSync(join(cwd, '.eforge', 'queue-locks', 'a.lock'))).toBe(false);

    eventQueue.removeProducer();
  });

  (process.platform === 'win32' || process.getuid?.() === 0 ? it.skip : it)('keeps a running PRD conservative when stale-lock removal fails', async () => {
    const { cwd, bus, eventQueue, spawnPrdChild, makeScheduler } = await createTestEnv();

    const aPath = join(cwd, 'eforge', 'queue', 'a.md');
    const lockDir = join(cwd, '.eforge', 'queue-locks');
    const lockPath = join(lockDir, 'a.lock');
    await writeFile(aPath, '---\ntitle: A\n---\n\n# A');
    await mkdir(lockDir, { recursive: true });
    await writeFile(lockPath, String(process.pid));

    spawnPrdChild.mockImplementation(() => new Promise<'completed' | 'failed' | 'skipped' | 'already-claimed'>(() => {}));

    const scheduler = makeScheduler([makeQueuedPrd('a', [], aPath)]);
    await scheduler.start();

    await vi.waitFor(() => {
      expect(spawnPrdChild).not.toHaveBeenCalled();
    });
    eventQueue.drainAvailable();

    await writeFile(lockPath, String(makeDeadPid()));
    const { chmod } = await import('node:fs/promises');
    await chmod(lockDir, 0o555);

    try {
      bus.emit('queue:mutation', { type: 'queue:mutation', reason: 'external', timestamp: new Date().toISOString() } as SchedulerInputEvent);
      await new Promise((r) => setTimeout(r, 200));

      const events = eventQueue.drainAvailable();
      expect(events).not.toContainEqual(expect.objectContaining({
        type: 'daemon:scheduler:dequeued',
        prdId: 'a',
      }));
      expect(spawnPrdChild).not.toHaveBeenCalled();
      expect(existsSync(lockPath)).toBe(true);
    } finally {
      await chmod(lockDir, 0o755);
      eventQueue.removeProducer();
    }
  });

  it('keeps a running PRD with a live lock in running state and keeps its dependent dependency-blocked', async () => {
    const { cwd, bus, eventQueue, spawnPrdChild, makeScheduler } = await createTestEnv();

    const aPath = join(cwd, 'eforge', 'queue', 'a.md');
    const cPath = join(cwd, 'eforge', 'queue', 'c.md');
    await writeFile(aPath, '---\ntitle: A\n---\n\n# A');
    await writeFile(cPath, '---\ntitle: C\ndepends_on: [a]\n---\n\n# C');

    // a has a live lock — scheduler counts it as running and c stays dependency-blocked
    await mkdir(join(cwd, '.eforge', 'queue-locks'), { recursive: true });
    await writeFile(join(cwd, '.eforge', 'queue-locks', 'a.lock'), String(process.pid));

    spawnPrdChild.mockImplementation(() => new Promise<'completed' | 'failed' | 'skipped' | 'already-claimed'>(() => {}));

    const scheduler = makeScheduler([makeQueuedPrd('a', [], aPath), makeQueuedPrd('c', ['a'], cPath)]);
    await scheduler.start();

    // a must NOT be spawned (locked by live PID)
    const events = await waitForSchedulerEvents(eventQueue, (seen) => seen.some((event) => event.type === 'daemon:scheduler:dependency-blocked'));
    expect(spawnPrdChild).not.toHaveBeenCalled();

    type DepBlockedEvent = Extract<EforgeEvent, { type: 'daemon:scheduler:dependency-blocked' }>;
    const depBlocked = events.find((e) => e.type === 'daemon:scheduler:dependency-blocked') as DepBlockedEvent | undefined;
    expect(depBlocked?.prdId).toBe('c');
    expect(depBlocked?.blockedBy).toContain('a');

    // After mutation: live lock still present → a stays running, c stays blocked
    bus.emit('queue:mutation', { type: 'queue:mutation', reason: 'external', timestamp: new Date().toISOString() } as SchedulerInputEvent);

    const eventsAfterMutation = await waitForSchedulerEvents(eventQueue, (seen) => seen.some((event) => event.type === 'daemon:scheduler:dependency-blocked'));
    expect(spawnPrdChild).not.toHaveBeenCalled();

    const depBlockedAfter = eventsAfterMutation.find((e) => e.type === 'daemon:scheduler:dependency-blocked') as DepBlockedEvent | undefined;
    expect(depBlockedAfter?.prdId).toBe('c');

    eventQueue.removeProducer();
  });

  it('removes a running PRD from capacity when its root queue file disappears, without emitting queue:prd:complete', async () => {
    // Scenario: a and b are both running via live locks (at capacity with parallelism=2).
    // c is capacity-blocked. Remove a's queue file (but keep locks). On next mutation,
    // a is removed as phantom, capacity opens, and c is dispatched.
    const { cwd, bus, eventQueue, spawnPrdChild, makeScheduler } = await createTestEnv();

    const aPath = join(cwd, 'eforge', 'queue', 'a.md');
    const bPath = join(cwd, 'eforge', 'queue', 'b.md');
    const cPath = join(cwd, 'eforge', 'queue', 'c.md');

    await writeFile(aPath, '---\ntitle: A\n---\n\n# A');
    await writeFile(bPath, '---\ntitle: B\n---\n\n# B');
    await writeFile(cPath, '---\ntitle: C\n---\n\n# C');

    // Live locks for both a and b — both count as running, at capacity
    await mkdir(join(cwd, '.eforge', 'queue-locks'), { recursive: true });
    await writeFile(join(cwd, '.eforge', 'queue-locks', 'a.lock'), String(process.pid));
    await writeFile(join(cwd, '.eforge', 'queue-locks', 'b.lock'), String(process.pid));

    spawnPrdChild.mockImplementation(() => new Promise<'completed' | 'failed' | 'skipped' | 'already-claimed'>(() => {}));

    const scheduler = makeScheduler([
      makeQueuedPrd('a', [], aPath),
      makeQueuedPrd('b', [], bPath),
      makeQueuedPrd('c', [], cPath),
    ]);
    await scheduler.start();

    // a and b running via locks, c is capacity-blocked, nothing dispatched
    const initEvents = await waitForSchedulerEvents(eventQueue, (seen) => seen.some((event) => event.type === 'daemon:scheduler:capacity-blocked'));
    expect(spawnPrdChild).not.toHaveBeenCalled();
    type CapacityBlockedEvent = Extract<EforgeEvent, { type: 'daemon:scheduler:capacity-blocked' }>;
    const initCapBlocked = initEvents.find((e) => e.type === 'daemon:scheduler:capacity-blocked') as CapacityBlockedEvent | undefined;
    expect(initCapBlocked?.runningCount).toBe(2);

    // Remove a's queue file (simulates PRD leaving root queue without completion event)
    const { rm } = await import('node:fs/promises');
    await rm(aPath);

    bus.emit('queue:mutation', { type: 'queue:mutation', reason: 'external', timestamp: new Date().toISOString() } as SchedulerInputEvent);

    const events = await waitForSchedulerEvents(eventQueue, (seen) => seen.some((event) => event.type === 'daemon:scheduler:dequeued' && event.prdId === 'c'));

    // No queue:prd:complete emitted for phantom a
    const completions = events.filter((e) => e.type === 'queue:prd:complete') as Extract<EforgeEvent, { type: 'queue:prd:complete' }>[];
    expect(completions.every((e) => e.prdId !== 'a')).toBe(true);

    // c is now dispatchable (a removed from capacity, b still running, runningCount=1 < 2)
    const dequeued = events.filter((e) => e.type === 'daemon:scheduler:dequeued') as Extract<EforgeEvent, { type: 'daemon:scheduler:dequeued' }>[];
    expect(dequeued.some((e) => e.prdId === 'c')).toBe(true);
    expect(spawnPrdChild).toHaveBeenCalledTimes(1);
    expect(spawnPrdChild.mock.calls[0][0].id).toBe('c');

    // Any capacity-blocked event after removal should show runningCount <= 2
    const capBlocked = events.filter((e) => e.type === 'daemon:scheduler:capacity-blocked') as CapacityBlockedEvent[];
    for (const ev of capBlocked) {
      expect(ev.runningCount).toBeLessThanOrEqual(2);
    }

    eventQueue.removeProducer();
  });

  it('already-claimed with no live lock: demotion on next tick allows scheduler retry; c dispatched after a completes', async () => {
    // Scenario: a returns already-claimed but no lock exists (stub). On the next mutation
    // tick, reconciliation finds a running with no lock → demotes to pending → re-dispatches.
    // c remains dependency-blocked until a completes (via bus event).
    const { cwd, bus, eventQueue, spawnPrdChild, makeScheduler } = await createTestEnv();

    const aPath = join(cwd, 'eforge', 'queue', 'a.md');
    const cPath = join(cwd, 'eforge', 'queue', 'c.md');
    await writeFile(aPath, '---\ntitle: A\n---\n\n# A');
    await writeFile(cPath, '---\ntitle: C\ndepends_on: [a]\n---\n\n# C');

    spawnPrdChild
      .mockResolvedValueOnce('already-claimed')  // call #1: a → already-claimed
      .mockImplementation(() => new Promise<'completed' | 'failed' | 'skipped' | 'already-claimed'>(() => {})); // call #2+: never resolves

    const scheduler = makeScheduler([makeQueuedPrd('a', [], aPath), makeQueuedPrd('c', ['a'], cPath)]);
    await scheduler.start();
    await waitForSpawnCallCount(spawnPrdChild, 1);

    // a was dispatched → already-claimed → stays running, c blocked
    expect(spawnPrdChild).toHaveBeenCalledTimes(1);
    expect(scheduler.processed).toBe(0);

    // No lock exists → mutation tick demotes a to pending → re-dispatches a (call #2)
    bus.emit('queue:mutation', { type: 'queue:mutation', reason: 'external', timestamp: new Date().toISOString() } as SchedulerInputEvent);
    await waitForSpawnCallCount(spawnPrdChild, 2);

    expect(spawnPrdChild).toHaveBeenCalledTimes(2);
    expect(spawnPrdChild.mock.calls[1][0].id).toBe('a');

    // c is still dependency-blocked (a is running again from call #2)
    const events = eventQueue.drainAvailable();
    const completions = events.filter((e) => e.type === 'queue:prd:complete');
    expect(completions.every((e) => e.prdId !== 'c')).toBe(true);

    // Write a registry artifact for a so c's dependency can be satisfied once a completes.
    const nowNoLock = new Date().toISOString();
    await upsertArtifact(cwd, { prdId: 'a', artifactBranch: 'eforge/a', commitSha: 'abc123', resolvedBase: 'main', landingAction: 'pr', status: 'built', recordedAt: nowNoLock, updatedAt: nowNoLock });

    // Original worker emits terminal completion for a → c is now ready
    bus.emit('queue:prd:complete', { type: 'queue:prd:complete', prdId: 'a', status: 'completed', timestamp: new Date().toISOString() } as SchedulerInputEvent);
    await vi.waitFor(() => {
      expect(spawnPrdChild.mock.calls.map((c) => c[0].id)).toContain('c');
    });

    expect(scheduler.processed).toBe(1);
    // c may now be dispatched; check it is attempted after a completes
    // (call #2 for a hasn't resolved, but bus.emit triggers onComplete for a)
    expect(spawnPrdChild.mock.calls.map((c) => c[0].id)).toContain('c');

    eventQueue.removeProducer();
  });
});
