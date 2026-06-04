import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { QueueScheduler, SCHEDULER_INPUT_TYPES, type SchedulerInputEvent } from '@eforge-build/engine/queue/scheduler';
import { EforgeEngine } from '@eforge-build/engine/eforge';
import type { EforgeEvent } from '@eforge-build/engine/events';
import { QueueExecExitCode, movePrdToSubdir } from '@eforge-build/engine/prd-queue';
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
  writeQueuedPrdFile,
} from './queue-scheduler-helpers';

describe('QueueScheduler — queue:prd:complete (completed)', () => {
  it('spawns dependent PRD after upstream completes', async () => {
    const { cwd, bus, eventQueue, spawnPrdChild, makeScheduler } = await createTestEnv();

    // Two PRDs: 'foundation' (no deps) and 'feature' (depends_on: ['foundation'])
    const foundationPath = await writeQueuedPrdFile(cwd, 'foundation');
    const featurePath = await writeQueuedPrdFile(cwd, 'feature', ['foundation']);
    const foundation = makeQueuedPrd('foundation', [], foundationPath);
    const feature = makeQueuedPrd('feature', ['foundation'], featurePath);

    // spawnPrdChild: foundation completes successfully; feature also resolves
    spawnPrdChild.mockResolvedValueOnce('completed').mockResolvedValueOnce('completed');

    const scheduler = makeScheduler([foundation, feature]);
    await scheduler.start();

    // start() calls startReadyPrds() — 'foundation' is ready, 'feature' is not yet
    await waitForSpawnCallCount(spawnPrdChild, 1);
    expect(spawnPrdChild.mock.calls[0][0].id).toBe('foundation');

    // Write a registry artifact for foundation before emitting completion so
    // the artifact-aware scheduler can satisfy feature's dependency.
    const now = new Date().toISOString();
    await upsertArtifact(cwd, { prdId: 'foundation', artifactBranch: 'eforge/foundation', commitSha: 'abc123', resolvedBase: 'main', landingAction: 'pr', status: 'built', recordedAt: now, updatedAt: now });

    // Simulate foundation completing: the pump would emit this on the bus
    const completeEvent: SchedulerInputEvent = {
      type: 'queue:prd:complete',
      prdId: 'foundation',
      status: 'completed',
      timestamp: new Date().toISOString(),
    };
    bus.emit('queue:prd:complete', completeEvent);

    // Feature should now be spawned
    await waitForSpawnCallCount(spawnPrdChild, 2);
    expect(spawnPrdChild.mock.calls[1][0].id).toBe('feature');

    // Counters: foundation processed (not skipped)
    expect(scheduler.processed).toBe(1);
    expect(scheduler.skipped).toBe(0);

    eventQueue.removeProducer();
  });
});

describe('QueueScheduler — queue:prd:complete (skipped)', () => {
  it('does not spawn dependent PRD after upstream is terminally skipped', async () => {
    const { cwd, bus, eventQueue, spawnPrdChild, makeScheduler } = await createTestEnv();

    const foundationPath = await writeQueuedPrdFile(cwd, 'foundation');
    const featurePath = await writeQueuedPrdFile(cwd, 'feature', ['foundation']);
    const foundation = makeQueuedPrd('foundation', [], foundationPath);
    const feature = makeQueuedPrd('feature', ['foundation'], featurePath);

    spawnPrdChild.mockImplementation(() => new Promise<'completed' | 'failed' | 'skipped' | 'already-claimed'>(() => {}));

    const scheduler = makeScheduler([foundation, feature]);
    await scheduler.start();

    await waitForSpawnCallCount(spawnPrdChild, 1);
    expect(spawnPrdChild.mock.calls[0][0].id).toBe('foundation');

    const skippedEvent: SchedulerInputEvent = {
      type: 'queue:prd:complete',
      prdId: 'foundation',
      status: 'skipped',
      timestamp: new Date().toISOString(),
    };
    bus.emit('queue:prd:complete', skippedEvent);

    await vi.waitFor(() => {
      scheduler.finalizeBlockedAsSkipped();
      expect(scheduler.skipped).toBe(2);
    });

    expect(spawnPrdChild).toHaveBeenCalledTimes(1);
    expect(scheduler.processed).toBe(0);
    expect(scheduler.skipped).toBe(2);

    eventQueue.removeProducer();
  });
});

describe('QueueScheduler — queue:prd:complete (failed)', () => {
  it('marks dependent PRDs as blocked without spawning them', async () => {
    const { cwd, bus, eventQueue, spawnPrdChild, makeScheduler } = await createTestEnv();

    const foundationPath = await writeQueuedPrdFile(cwd, 'foundation');
    const featurePath = await writeQueuedPrdFile(cwd, 'feature', ['foundation']);
    const foundation = makeQueuedPrd('foundation', [], foundationPath);
    const feature = makeQueuedPrd('feature', ['foundation'], featurePath);

    // foundation fails — mirror production by moving its file out of the root
    // queue (the child process does this), so reconciliation does not re-queue it.
    spawnPrdChild.mockImplementationOnce(async () => {
      await movePrdToSubdir(foundationPath, 'failed', cwd);
      return 'failed';
    });

    const scheduler = makeScheduler([foundation, feature]);
    await scheduler.start();

    // Only foundation is spawned initially
    await waitForSpawnCallCount(spawnPrdChild, 1);
    expect(spawnPrdChild.mock.calls[0][0].id).toBe('foundation');

    // Simulate foundation failing
    const failEvent: SchedulerInputEvent = {
      type: 'queue:prd:complete',
      prdId: 'foundation',
      status: 'failed',
      timestamp: new Date().toISOString(),
    };
    bus.emit('queue:prd:complete', failEvent);

    // Feature should NOT have been spawned (it's blocked)
    await vi.waitFor(() => {
      scheduler.finalizeBlockedAsSkipped();
      expect(scheduler.skipped).toBe(1);
    });
    expect(spawnPrdChild).toHaveBeenCalledTimes(1);

    // Finalize counts: foundation processed (failed), feature will be counted as skipped
    expect(scheduler.processed).toBe(1); // foundation was processed (failed, not skipped)
    expect(scheduler.skipped).toBe(1);   // feature was blocked → skipped

    eventQueue.removeProducer();
  });
});

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

    // PRD should be discovered but NOT spawned (suspended)
    const events = await waitForSchedulerEvents(eventQueue, (seen) => seen.some((event) => event.type === 'queue:prd:discovered'));
    const types = events.map((e) => e.type);
    expect(types).toContain('queue:prd:discovered');
    expect(types).not.toContain('daemon:scheduler:dequeued');
    expect(spawnPrdChild).not.toHaveBeenCalled();

    // Now resume — should immediately dequeue prd-a
    scheduler.resume();
    expect(scheduler.isSuspended).toBe(false);
    await waitForSpawnCallCount(spawnPrdChild, 1);

    const eventsAfterResume = await waitForSchedulerEvents(eventQueue, (seen) => seen.some((event) => event.type === 'daemon:scheduler:resumed') && seen.some((event) => event.type === 'daemon:scheduler:dequeued'));
    const typesAfterResume = eventsAfterResume.map((e) => e.type);
    expect(typesAfterResume).toContain('daemon:scheduler:resumed');
    expect(typesAfterResume).toContain('daemon:scheduler:dequeued');
    expect(spawnPrdChild).toHaveBeenCalledTimes(1);
    expect(spawnPrdChild.mock.calls[0][0].id).toBe('prd-a');

    eventQueue.removeProducer();
  });
});

describe('QueueScheduler — onComplete runs while suspended', () => {
  it('failed completion finalizes prdState to failed even when suspended', async () => {
    const { cwd, bus, eventQueue, spawnPrdChild, makeScheduler } = await createTestEnv();

    const foundationPath = await writeQueuedPrdFile(cwd, 'foundation');
    const featurePath = await writeQueuedPrdFile(cwd, 'feature', ['foundation']);
    const foundation = makeQueuedPrd('foundation', [], foundationPath);
    const feature = makeQueuedPrd('feature', ['foundation'], featurePath);

    // foundation fails — mirror production by moving its file out of the root
    // queue (the child process does this), so reconciliation does not re-queue it.
    spawnPrdChild.mockImplementationOnce(async () => {
      await movePrdToSubdir(foundationPath, 'failed', cwd);
      return 'failed';
    });

    const scheduler = makeScheduler([foundation, feature]);
    await scheduler.start();

    // foundation is spawned; pause before the completion arrives
    await waitForSpawnCallCount(spawnPrdChild, 1);

    scheduler.pause();

    // Simulate foundation failing while suspended
    const failEvent: SchedulerInputEvent = {
      type: 'queue:prd:complete',
      prdId: 'foundation',
      status: 'failed',
      timestamp: new Date().toISOString(),
    };
    bus.emit('queue:prd:complete', failEvent);

    // onComplete should have processed the failure: counter incremented
    await vi.waitFor(() => {
      scheduler.finalizeBlockedAsSkipped();
      expect(scheduler.skipped).toBe(1);
    });
    expect(scheduler.processed).toBe(1);

    // feature should be blocked (propagateBlocked ran)
    expect(scheduler.skipped).toBe(1);

    // No new builds should have started (suspended)
    expect(spawnPrdChild).toHaveBeenCalledTimes(1);

    eventQueue.removeProducer();
  });
});
