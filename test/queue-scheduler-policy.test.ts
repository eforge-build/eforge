import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { QueueScheduler, SCHEDULER_INPUT_TYPES, type SchedulerInputEvent } from '@eforge-build/engine/queue/scheduler';
import { EforgeEngine } from '@eforge-build/engine/eforge';
import type { EforgeEvent } from '@eforge-build/engine/events';
import { QueueExecExitCode } from '@eforge-build/engine/prd-queue';
import type { PolicyGateRegistration } from '@eforge-build/engine/extensions/types';
import { upsertArtifact } from '@eforge-build/engine/artifacts';
import { StubHarness } from './stub-harness';
import {
  createTestEnv,
  exec,
  makeDeadPid,
  makeProfileRouter,
  makeQueueDispatchPolicyGate,
  makeQueuedPrd,
} from './queue-scheduler-helpers';

describe('SCHEDULER_INPUT_TYPES', () => {
  it('contains exactly the supported scheduler input types', () => {
    expect([...SCHEDULER_INPUT_TYPES].sort()).toEqual(['queue:mutation', 'queue:prd:complete']);
  });
});

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
    await vi.waitFor(() => {
      expect(existsSync(join(cwd, 'eforge', 'queue', 'failed', 'blocked-prd.md'))).toBe(true);
    });

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
    await vi.waitFor(() => {
      expect(existsSync(join(cwd, 'eforge', 'queue', 'failed', 'approval-prd.md'))).toBe(true);
    });

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
    // base-prd completed in a prior run — write a registry artifact so profiled-prd is ready.
    const now = new Date().toISOString();
    await upsertArtifact(cwd, { prdId: 'base-prd', artifactBranch: 'eforge/base-prd', commitSha: 'abc123', resolvedBase: 'main', landingAction: 'pr', status: 'built', recordedAt: now, updatedAt: now });

    let seenContext: { gateKind?: string; prdId?: string; prdTitle?: string; priority?: number; profile?: string; dependsOn?: string[] } | undefined;
    const scheduler = makeScheduler(
      [{ ...makeQueuedPrd('profiled-prd', ['base-prd'], prdPath), frontmatter: { title: 'Profiled PRD', priority: 7, profile: 'careful', depends_on: ['base-prd'] } }],
      [makeQueueDispatchPolicyGate(((ctx: { gateKind?: string; prdId?: string; prdTitle?: string; priority?: number; profile?: string; dependsOn?: string[] }) => {
        seenContext = ctx;
        return { decision: 'allow' };
      }) as PolicyGateRegistration['value'])],
    );

    await scheduler.start();
    await vi.waitFor(() => {
      expect(seenContext).toBeDefined();
    });

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
    await vi.waitFor(() => {
      expect(existsSync(join(cwd, 'eforge', 'queue', 'failed', 'blocked-prd.md'))).toBe(true);
    });

    const events = eventQueue.drainAvailable();
    const completion = events.find((event) => event.type === 'queue:prd:complete' && event.prdId === 'blocked-prd') as SchedulerInputEvent | undefined;
    expect(spawnPrdChild).not.toHaveBeenCalled();
    expect(completion).toEqual(expect.objectContaining({ type: 'queue:prd:complete', prdId: 'blocked-prd', status: 'failed' }));
    expect(events).not.toContainEqual(expect.objectContaining({ type: 'session:start' }));

    if (completion) bus.emit('queue:prd:complete', completion);
    const followUpEvents: EforgeEvent[] = [];
    await vi.waitFor(() => {
      followUpEvents.push(...eventQueue.drainAvailable());
      expect(followUpEvents).toContainEqual(expect.objectContaining({ type: 'queue:prd:discovered', prdId: 'dependent-prd' }));
    });
    expect(spawnPrdChild).not.toHaveBeenCalled();
    scheduler.finalizeBlockedAsSkipped();
    expect(scheduler.skipped).toBe(1);

    eventQueue.removeProducer();
  });
});

describe('QueueScheduler — queue:mutation event', () => {
  it('dispatches an independent queued PRD while parallel capacity remains', async () => {
    const { cwd, bus, eventQueue, spawnPrdChild, makeScheduler } = await createTestEnv();

    const runningPrd = makeQueuedPrd('already-running');
    const scheduler = makeScheduler([runningPrd]);
    await scheduler.start();
    await vi.waitFor(() => {
      expect(spawnPrdChild).toHaveBeenCalledTimes(1);
    });

    await writeFile(join(cwd, 'eforge', 'queue', 'independent-prd.md'), '---\ntitle: Independent PRD\n---\n\n# Independent PRD');
    const mutationEvent: SchedulerInputEvent = {
      type: 'queue:mutation',
      reason: 'enqueue',
      timestamp: new Date().toISOString(),
    };
    bus.emit('queue:mutation', mutationEvent);

    await vi.waitFor(() => {
      expect(spawnPrdChild).toHaveBeenCalledTimes(2);
    });

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
    await vi.waitFor(() => {
      expect(spawnPrdChild).toHaveBeenCalledOnce();
    });

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
