/**
 * Tests for onSuccess propagation from PRD frontmatter through the scheduler
 * to the child process via the --on-success CLI flag.
 *
 * Uses the existing spawnPrdChild stub pattern from queue-scheduler.test.ts.
 * Verifies:
 *   1. When frontmatter.onSuccess is set, the scheduler passes it to spawnPrdChild.
 *   2. When frontmatter.onSuccess is absent, the flag is omitted (spawnPrdChild
 *      is called without it).
 *
 * Note: the scheduler itself doesn't modify CLI args — that is `spawnPrdChild`'s
 * responsibility (in eforge.ts). The scheduler only forwards the QueuedPrd object.
 * These tests verify that prd.frontmatter.onSuccess flows through correctly to
 * the spawn call site by intercepting at the spawnPrdChild boundary.
 */

import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { QueueScheduler } from '@eforge-build/engine/queue/scheduler';
import { AsyncEventQueue } from '@eforge-build/engine/concurrency';
import type { EforgeEvent } from '@eforge-build/engine/events';
import type { QueuedPrd } from '@eforge-build/engine/prd-queue';

const exec = promisify(execFile);

function makeQueuedPrd(id: string, onSuccess?: 'merge-to-base-branch' | 'issue-pr' | 'leave-branch', filePath?: string): QueuedPrd {
  return {
    id,
    filePath: filePath ?? `/tmp/${id}.md`,
    frontmatter: {
      title: id,
      ...(onSuccess !== undefined && { onSuccess }),
    },
    content: `---\ntitle: ${id}\n${onSuccess ? `onSuccess: ${onSuccess}\n` : ''}---\n\n# ${id}`,
    lastCommitHash: '',
    lastCommitDate: '',
  };
}

async function createTestEnv(): Promise<{
  cwd: string;
  queueDir: string;
  eventQueue: AsyncEventQueue<EforgeEvent>;
  spawnPrdChild: ReturnType<typeof vi.fn>;
  makeScheduler: (initialPrds: QueuedPrd[]) => QueueScheduler;
}> {
  const cwd = await mkdtemp(join(tmpdir(), 'eforge-onsuccess-sched-'));
  await exec('git', ['init'], { cwd });
  await exec('git', ['config', 'user.email', 'test@test.com'], { cwd });
  await exec('git', ['config', 'user.name', 'Test'], { cwd });
  const queueDir = 'eforge/queue';
  await mkdir(join(cwd, 'eforge', 'queue'), { recursive: true });

  const bus = new EventEmitter();
  const eventQueue = new AsyncEventQueue<EforgeEvent>();
  eventQueue.addProducer();

  const spawnPrdChild = vi.fn<[QueuedPrd, unknown, string, string | undefined], Promise<'completed' | 'failed' | 'skipped' | 'already-claimed'>>()
    .mockResolvedValue('completed');

  const abortController = new AbortController();

  const makeScheduler = (initialPrds: QueuedPrd[]): QueueScheduler =>
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
    });

  return { cwd, queueDir, eventQueue, spawnPrdChild, makeScheduler };
}

describe('QueueScheduler — onSuccess propagation via QueuedPrd', () => {
  it('spawnPrdChild receives a PRD with frontmatter.onSuccess set when configured', async () => {
    const { cwd, queueDir, eventQueue, spawnPrdChild, makeScheduler } = await createTestEnv();

    const prdPath = join(cwd, queueDir, 'feature-prd.md');
    await writeFile(prdPath, '---\ntitle: Feature PRD\nonSuccess: leave-branch\n---\n\n# Feature PRD');

    const prd = makeQueuedPrd('feature-prd', 'leave-branch', prdPath);
    const scheduler = makeScheduler([prd]);
    await scheduler.start();
    await new Promise((r) => setTimeout(r, 200));

    expect(spawnPrdChild).toHaveBeenCalledTimes(1);
    const calledWithPrd = spawnPrdChild.mock.calls[0][0] as QueuedPrd;
    expect(calledWithPrd.frontmatter.onSuccess).toBe('leave-branch');

    eventQueue.removeProducer();
  });

  it('spawnPrdChild receives a PRD without onSuccess when not set in frontmatter', async () => {
    const { cwd, queueDir, eventQueue, spawnPrdChild, makeScheduler } = await createTestEnv();

    const prdPath = join(cwd, queueDir, 'plain-prd.md');
    await writeFile(prdPath, '---\ntitle: Plain PRD\n---\n\n# Plain PRD');

    const prd = makeQueuedPrd('plain-prd', undefined, prdPath);
    const scheduler = makeScheduler([prd]);
    await scheduler.start();
    await new Promise((r) => setTimeout(r, 200));

    expect(spawnPrdChild).toHaveBeenCalledTimes(1);
    const calledWithPrd = spawnPrdChild.mock.calls[0][0] as QueuedPrd;
    expect(calledWithPrd.frontmatter.onSuccess).toBeUndefined();

    eventQueue.removeProducer();
  });

  it('passes issue-pr onSuccess through to spawnPrdChild', async () => {
    const { cwd, queueDir, eventQueue, spawnPrdChild, makeScheduler } = await createTestEnv();

    const prdPath = join(cwd, queueDir, 'pr-prd.md');
    await writeFile(prdPath, '---\ntitle: PR PRD\nonSuccess: issue-pr\n---\n\n# PR PRD');

    const prd = makeQueuedPrd('pr-prd', 'issue-pr', prdPath);
    const scheduler = makeScheduler([prd]);
    await scheduler.start();
    await new Promise((r) => setTimeout(r, 200));

    expect(spawnPrdChild).toHaveBeenCalledTimes(1);
    const calledWithPrd = spawnPrdChild.mock.calls[0][0] as QueuedPrd;
    expect(calledWithPrd.frontmatter.onSuccess).toBe('issue-pr');

    eventQueue.removeProducer();
  });
});
