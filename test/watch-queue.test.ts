import { describe, it, expect, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AsyncEventQueue } from '@eforge-build/engine/concurrency';
import { abortableSleep, EforgeEngine } from '@eforge-build/engine/eforge';
import type { EforgeConfig } from '@eforge-build/engine/config';
import type { EforgeEvent } from '@eforge-build/engine/events';
import type { SchedulerInputEvent } from '@eforge-build/engine/eforge';
import { movePrdToSubdir } from '@eforge-build/engine/prd-queue';
import { QueueScheduler } from '@eforge-build/engine/queue/scheduler';
import { StubHarness } from './stub-harness.js';

describe('abortableSleep', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns false when timer completes normally', async () => {
    vi.useFakeTimers();
    const result = abortableSleep(10);

    await vi.advanceTimersByTimeAsync(10);

    await expect(result).resolves.toBe(false);
  });

  it('returns true when aborted before timer fires', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const result = abortableSleep(5000, controller.signal);

    controller.abort();

    await expect(result).resolves.toBe(true);
  });

  it('returns true immediately if signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(abortableSleep(5000, controller.signal)).resolves.toBe(true);
  });
});

describe('watchQueue', () => {
  async function createTestEngine(): Promise<{ engine: EforgeEngine; cwd: string; queueDir: string }> {
    const cwd = await mkdtemp(join(tmpdir(), 'eforge-watch-test-'));
    const queueDir = join(cwd, 'eforge', 'queue');
    await mkdir(queueDir, { recursive: true });
    const engine = await EforgeEngine.create({
      cwd,
      // Use StubHarness so inline recovery (called when a PRD fails) completes
      // immediately without making real API calls. Tests here exercise queue
      // watch/discovery, not recovery behavior.
      agentRuntimes: new StubHarness([]),
      config: {
        prdQueue: { dir: 'eforge/queue' },
        plugins: { enabled: false },
      },
    });
    return { engine, cwd, queueDir };
  }

  it('abort signal causes clean exit with queue:complete as final event', async () => {
    const { engine } = await createTestEngine();
    const abortController = new AbortController();

    const events: EforgeEvent[] = [];
    for await (const event of engine.watchQueue({ abortController })) {
      events.push(event);
      if (event.type === 'queue:start') abortController.abort();
    }

    const types = events.map((e) => e.type);

    // Should have queue:start and final queue:complete
    expect(types).toContain('queue:start');
    expect(types[types.length - 1]).toBe('queue:complete');
  });

  it('injecting a queue:mutation event triggers queue:prd:discovered for a new PRD', async () => {
    const { engine, queueDir } = await createTestEngine();
    const abortController = new AbortController();

    let capturedInject: ((event: SchedulerInputEvent) => void) | null = null;
    const events: EforgeEvent[] = [];
    let discoveredSeen = false;

    for await (const event of engine.watchQueue({
      abortController,
      onInjectEventRegister: (inject) => {
        capturedInject = inject;
      },
    })) {
      events.push(event);

      // After queue:start, write a PRD and inject a mutation event
      if (event.type === 'queue:start' && capturedInject && !discoveredSeen) {
        const prdContent = [
          '---',
          'title: Inject Test PRD',
          'status: pending',
          'profile: watch-queue-missing-profile',
          '---',
          '',
          '# Inject Test PRD',
          '',
          'Do something.',
        ].join('\n');
        await writeFile(join(queueDir, 'inject-test-prd.md'), prdContent);
        capturedInject({
          type: 'queue:mutation',
          reason: 'external',
          timestamp: new Date().toISOString(),
        });
      }

      if (event.type === 'queue:prd:discovered') {
        discoveredSeen = true;
        abortController.abort();
      }
    }

    expect(discoveredSeen).toBe(true);
    const discoveredEvent = events.find((e) => e.type === 'queue:prd:discovered');
    expect(discoveredEvent).toBeDefined();
    expect((discoveredEvent as { prdId: string }).prdId).toBe('inject-test-prd');

    // Final event should be queue:complete
    expect(events[events.length - 1].type).toBe('queue:complete');
  });

  it('re-queued PRD that was previously failed is re-discovered after inject', async () => {
    // Drive QueueScheduler directly instead of waiting on the long-lived
    // watchQueue generator. This keeps the re-queue rediscovery assertion
    // deterministic while still exercising the scheduler's mutation and
    // completion handlers.
    const cwd = await mkdtemp(join(tmpdir(), 'eforge-watch-requeue-test-'));
    const queueDir = join(cwd, 'eforge', 'queue');
    await mkdir(queueDir, { recursive: true });

    const bus = new EventEmitter();
    const eventQueue = new AsyncEventQueue<EforgeEvent>();
    // Mirror watchQueue's long-lived watcher producer so scheduler events remain
    // observable after a child completion removes its short-lived producer.
    eventQueue.addProducer();
    const scheduler = new QueueScheduler({
      bus,
      cwd,
      queueDir: 'eforge/queue',
      config: { prdQueue: { dir: 'eforge/queue' }, plugins: { enabled: false } } as EforgeConfig,
      configProfile: { name: null, source: 'none', scope: null, config: null },
      parallelism: 1,
      abortController: new AbortController(),
      eventQueue,
      spawnPrdChild: async (prd) => {
        await movePrdToSubdir(prd.filePath, 'failed', cwd);
        return 'failed';
      },
      options: {},
      initialPrds: [],
      configDir: cwd,
    });
    const schedulerDriver = scheduler as unknown as {
      onMutation(event: SchedulerInputEvent): Promise<void>;
      onComplete(event: Extract<SchedulerInputEvent, { type: 'queue:prd:complete' }>): Promise<void>;
    };
    const events: EforgeEvent[] = [];
    const drainEvents = (): void => {
      events.push(...eventQueue.drainAvailable());
    };
    const waitForEventCount = async (type: EforgeEvent['type'], count: number): Promise<void> => {
      await vi.waitFor(() => {
        drainEvents();
        expect(events.filter((event) => event.type === type).length).toBeGreaterThanOrEqual(count);
      });
    };

    await scheduler.start();

    const prdContent = [
      '---',
      'title: Requeue PRD',
      'status: pending',
      '---',
      '',
      '# Requeue PRD',
      '',
      'Do something.',
    ].join('\n');

    await writeFile(join(queueDir, 'requeue-prd.md'), prdContent);
    await schedulerDriver.onMutation({ type: 'queue:mutation', reason: 'enqueue', timestamp: new Date().toISOString() });
    await waitForEventCount('queue:prd:discovered', 1);
    await waitForEventCount('queue:prd:complete', 1);

    const completion = events.find((event): event is Extract<SchedulerInputEvent, { type: 'queue:prd:complete' }> => event.type === 'queue:prd:complete' && event.prdId === 'requeue-prd');
    expect(completion).toBeDefined();
    await schedulerDriver.onComplete(completion!);

    await writeFile(join(queueDir, 'requeue-prd.md'), `${prdContent}\n`);
    await schedulerDriver.onMutation({ type: 'queue:mutation', reason: 'enqueue', timestamp: new Date().toISOString() });
    drainEvents();

    const discoveredEvents = events.filter((event) => event.type === 'queue:prd:discovered');
    expect(discoveredEvents.length).toBeGreaterThanOrEqual(2);
    expect((discoveredEvents[0] as { prdId: string }).prdId).toBe('requeue-prd');
    expect((discoveredEvents[1] as { prdId: string }).prdId).toBe('requeue-prd');
  });

  it('inject is a no-op after the watcher is aborted', async () => {
    const { engine } = await createTestEngine();
    const abortController = new AbortController();

    let capturedInject: ((event: SchedulerInputEvent) => void) | null = null;
    const events: EforgeEvent[] = [];

    for await (const event of engine.watchQueue({
      abortController,
      onInjectEventRegister: (inject) => {
        capturedInject = inject;
      },
    })) {
      events.push(event);
      if (event.type === 'queue:start') abortController.abort();
    }

    // Generator has finished — capturedInject should now be a no-op
    expect(capturedInject).not.toBeNull();

    // Calling inject after abort must not throw and must produce no further events
    expect(() => {
      capturedInject!({
        type: 'queue:mutation',
        reason: 'external',
        timestamp: new Date().toISOString(),
      });
    }).not.toThrow();

    // No events were added after the generator completed
    const types = events.map((e) => e.type);
    expect(types[types.length - 1]).toBe('queue:complete');
  });
});
