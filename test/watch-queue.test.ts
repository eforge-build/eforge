import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { abortableSleep, EforgeEngine } from '@eforge-build/engine/eforge';
import type { EforgeEvent } from '@eforge-build/engine/events';
import type { SchedulerInputEvent } from '@eforge-build/engine/eforge';
import { StubHarness } from './stub-harness.js';

// ---------------------------------------------------------------------------
// Test environment setup
// ---------------------------------------------------------------------------

// Point EFORGE_CLI_PATH at a minimal stub that exits immediately with code 1.
// Without this, spawnPrdChild falls back to process.argv[1] which may be the
// vitest runner — causing subprocesses to take several seconds to fail, making
// tests that wait for queue:prd:complete unreliable.
const CLI_STUB = resolve(fileURLToPath(import.meta.url), '..', 'fixtures', 'cli-stub-fail.mjs');
let previousCliPath: string | undefined;

beforeAll(() => {
  previousCliPath = process.env.EFORGE_CLI_PATH;
  process.env.EFORGE_CLI_PATH = CLI_STUB;
});

afterAll(() => {
  if (previousCliPath === undefined) {
    delete process.env.EFORGE_CLI_PATH;
  } else {
    process.env.EFORGE_CLI_PATH = previousCliPath;
  }
});

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
    // The scheduler only emits queue:prd:discovered for PRDs injected via
    // queue:mutation (not for initialPrds loaded at startup). This test uses
    // two inject cycles to verify both the first-time discovery and re-discovery
    // work correctly:
    //
    //   1. watchQueue starts with an empty queue.
    //   2. After queue:start, inject the PRD for the first time (first discovery).
    //   3. After queue:prd:complete fires (PRD fails), inject again (second discovery).
    //
    // EFORGE_CLI_PATH must be set so the subprocess exits immediately (see beforeAll).
    const { engine, queueDir } = await createTestEngine();
    const abortController = new AbortController();

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

    let capturedInject: ((event: SchedulerInputEvent) => void) | null = null;
    const events: EforgeEvent[] = [];
    let discoveredCount = 0;
    let sawComplete = false;
    let injectedInitial = false;

    for await (const event of engine.watchQueue({
      abortController,
      onInjectEventRegister: (inject) => {
        capturedInject = inject;
      },
    })) {
      events.push(event);

      // After queue:start, inject the PRD for the first time
      if (event.type === 'queue:start' && capturedInject && !injectedInitial) {
        injectedInitial = true;
        await writeFile(join(queueDir, 'requeue-prd.md'), prdContent);
        capturedInject({
          type: 'queue:mutation',
          reason: 'enqueue',
          timestamp: new Date().toISOString(),
        });
      }

      if (event.type === 'queue:prd:discovered') {
        discoveredCount++;
        if (discoveredCount >= 2) {
          // Second discovery means the re-queue logic worked
          abortController.abort();
        }
      }

      if (event.type === 'queue:prd:complete' && !sawComplete && capturedInject) {
        sawComplete = true;
        // The scheduler emits completion on the bus before yielding it, but the
        // async onComplete continuation may still be finalizing running state.
        // Wait one turn before re-injecting so re-discovery happens after that
        // completion handler has had a chance to settle.
        await new Promise<void>((resolve) => setImmediate(resolve));
        // PRD failed — write it back to queue/ and inject a mutation event
        await writeFile(join(queueDir, 'requeue-prd.md'), prdContent + '\n');
        capturedInject({
          type: 'queue:mutation',
          reason: 'enqueue',
          timestamp: new Date().toISOString(),
        });
      }
    }

    // Should have been discovered twice: once via first inject, once after re-queue
    expect(discoveredCount).toBeGreaterThanOrEqual(2);
    const discoveredEvents = events.filter((e) => e.type === 'queue:prd:discovered');
    expect(discoveredEvents.length).toBeGreaterThanOrEqual(2);
    expect((discoveredEvents[0] as { prdId: string }).prdId).toBe('requeue-prd');
    expect((discoveredEvents[1] as { prdId: string }).prdId).toBe('requeue-prd');
  }, 20_000);

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
