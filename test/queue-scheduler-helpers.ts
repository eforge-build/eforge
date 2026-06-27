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

import { afterEach, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { QueueScheduler } from '@eforge-build/engine/queue/scheduler';
import { AsyncEventQueue } from '@eforge-build/engine/concurrency';
import type { EforgeEvent } from '@eforge-build/engine/events';
import type { QueuedPrd } from '@eforge-build/engine/prd-queue';
import type { PolicyGateRegistration, ProfileRouterRegistration } from '@eforge-build/engine/extensions/types';
export { makeDeadPid } from './process-helpers.js';

export const exec = promisify(execFile);

const activeCleanups = new Set<() => Promise<void>>();

afterEach(async () => {
  const cleanups = [...activeCleanups];
  activeCleanups.clear();
  await Promise.all(cleanups.map((cleanup) => cleanup()));
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Materialize a queued PRD file on disk and return its path.
 *
 * The scheduler reconciles dispatch order against the on-disk queue on every
 * discovery tick (mirroring production, where initialPrds come from loadQueue),
 * so initial PRDs that must survive reconciliation need a real queue file.
 */
export async function writeQueuedPrdFile(cwd: string, id: string, dependsOn: string[] = []): Promise<string> {
  const filePath = join(cwd, 'eforge', 'queue', `${id}.md`);
  const depsLine = dependsOn.length ? `depends_on: [${dependsOn.join(', ')}]\n` : '';
  await writeFile(filePath, `---\ntitle: ${id}\n${depsLine}---\n\n# ${id}`);
  return filePath;
}

export function makeQueuedPrd(id: string, dependsOn: string[] = [], filePath?: string): QueuedPrd {
  return {
    id,
    filePath: filePath ?? `/tmp/${id}.md`,
    frontmatter: { title: id, depends_on: dependsOn.length ? dependsOn : undefined },
    content: `---\ntitle: ${id}\n---\n\n# ${id}`,
    lastCommitHash: '',
    lastCommitDate: '',
  };
}

export function makeQueueDispatchPolicyGate(
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

export function makeProfileRouter(
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

export async function createTestEnv(): Promise<{
  cwd: string;
  queueDir: string;
  bus: EventEmitter;
  eventQueue: AsyncEventQueue<EforgeEvent>;
  spawnPrdChild: ReturnType<typeof vi.fn>;
  cleanup: () => Promise<void>;
  makeScheduler: (
    initialPrds: QueuedPrd[],
    policyGates?: PolicyGateRegistration[],
    profileRouters?: ProfileRouterRegistration[],
    parallelism?: number,
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
  let cleaned = false;
  const cleanup = async (): Promise<void> => {
    if (cleaned) return;
    cleaned = true;
    activeCleanups.delete(cleanup);
    abortController.abort();
    eventQueue.removeProducer();
    await rm(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  };
  activeCleanups.add(cleanup);

  const makeScheduler = (
    initialPrds: QueuedPrd[],
    policyGates: PolicyGateRegistration[] = [],
    profileRouters: ProfileRouterRegistration[] = [],
    parallelism = 2,
  ): QueueScheduler =>
    new QueueScheduler({
      bus,
      cwd,
      queueDir,
      config: {
        maxConcurrentBuilds: parallelism,
        prdQueue: { dir: queueDir, watchPollIntervalMs: 0 },
        plugins: { enabled: false },
        extensions: { policyGateTimeoutMs: 5000, policyGateFailurePolicy: 'fail-closed' },
      } as unknown as import('@eforge-build/engine/config').EforgeConfig,
      configProfile: { name: null, source: 'none', scope: null, config: null },
      parallelism,
      abortController,
      eventQueue,
      spawnPrdChild,
      options: { auto: true },
      initialPrds,
      extensionRegistry: { policyGates, profileRouters },
    });

  return { cwd, queueDir, bus, eventQueue, spawnPrdChild, cleanup, makeScheduler };
}

export async function waitForSpawnCallCount(spawnPrdChild: ReturnType<typeof vi.fn>, callCount: number): Promise<void> {
  await vi.waitFor(() => {
    expect(spawnPrdChild).toHaveBeenCalledTimes(callCount);
  });
}

export async function waitForSchedulerEvents(
  eventQueue: AsyncEventQueue<EforgeEvent>,
  predicate: (events: EforgeEvent[]) => boolean,
): Promise<EforgeEvent[]> {
  const events: EforgeEvent[] = [];
  await vi.waitFor(() => {
    events.push(...eventQueue.drainAvailable());
    expect(predicate(events)).toBe(true);
  });
  return events;
}

