import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { API_ROUTES, type DaemonStreamSnapshot, type QueueItemWithCapabilities } from '@eforge-build/client';
import { upsertArtifact, upsertCompletion } from '@eforge-build/engine/artifacts';
import { consumeQueuePrdCancellation, requestQueuePrdCancellation } from '@eforge-build/engine/queue/cancellation';
import { openDatabase, type MonitorDB } from '@eforge-build/monitor/db';
import { projectQueueForContext, projectRunsForContext, projectSessionMetadataForContext } from '@eforge-build/monitor/projections/monitor-state';
import { reconcileOrphanedState, replayPersistedOrphanQueueCompletions, writeDaemonEvent } from '@eforge-build/monitor/server-main';
import { startControlRouteHarness, type ControlRouteHarness } from '../packages/monitor/src/__tests__/routes-control-harness';
import { makeDeadPid } from './process-helpers';
import { createTestEnv, makeQueuedPrd, waitForSpawnCallCount, writeQueuedPrdFile } from './queue-scheduler-helpers';
import { useTempDir } from './test-tmpdir';

const makeTempDir = useTempDir('eforge-ac008-regression-');
let harness: ControlRouteHarness | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

function openTempDb(cwd: string): MonitorDB {
  mkdirSync(join(cwd, '.eforge'), { recursive: true });
  return openDatabase(join(cwd, '.eforge', 'monitor.db'));
}

function writeQueuePrd(cwd: string, id: string, dependsOn: string[] = []): string {
  const queueDir = join(cwd, '.eforge', 'queue');
  mkdirSync(queueDir, { recursive: true });
  const dependsOnLine = dependsOn.length > 0 ? `depends_on: [${dependsOn.join(', ')}]\n` : '';
  const path = join(queueDir, `${id}.md`);
  writeFileSync(path, `---\ntitle: ${id}\n${dependsOnLine}---\n\n# ${id}\n`, 'utf-8');
  return path;
}

function writeLock(cwd: string, prdId: string, payload: string): string {
  const lockDir = join(cwd, '.eforge', 'queue-locks');
  mkdirSync(lockDir, { recursive: true });
  const path = join(lockDir, `${prdId}.lock`);
  writeFileSync(path, payload, 'utf-8');
  return path;
}

async function readFirstDaemonHello(url: string): Promise<DaemonStreamSnapshot> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1_000);
  const res = await fetch(`${url}${API_ROUTES.daemonEvents}`, { signal: controller.signal });
  const reader = res.body?.getReader();
  if (!reader) throw new Error('missing daemon SSE body');
  let text = '';
  try {
    while (!text.includes('\n\n')) {
      const next = await reader.read();
      if (next.done) break;
      text += new TextDecoder().decode(next.value);
    }
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
  const dataLine = text.split('\n').find((line) => line.startsWith('data: '));
  if (!dataLine) throw new Error(`missing daemon hello data: ${text}`);
  return JSON.parse(dataLine.slice('data: '.length)) as DaemonStreamSnapshot;
}

async function seedCompletedAdoptedRoot(cwd: string, prdId: string, recordedAt: string): Promise<void> {
  await upsertArtifact(cwd, {
    prdId,
    artifactBranch: `eforge/${prdId}`,
    commitSha: 'abc123',
    resolvedBase: 'main',
    landingAction: 'pr',
    status: 'built',
    recordedAt,
    updatedAt: recordedAt,
  });
  await upsertCompletion(cwd, {
    prdId,
    status: 'completed',
    artifactAvailable: true,
    artifactBranch: `eforge/${prdId}`,
    completedAt: recordedAt,
    updatedAt: recordedAt,
  });
}

describe('AC-008 adoption/reconciliation regression matrix', () => {
  it('keeps cancellation authority for adopted live runs while stale/corrupt locks project deterministically through client-owned wire shapes', async () => {
    harness = await startControlRouteHarness({ startStreams: true });
    const deadPid = 2_147_483_647;
    writeQueuePrd(harness.cwd, 'adopted-live');
    writeQueuePrd(harness.cwd, 'stale-root');
    writeQueuePrd(harness.cwd, 'corrupt-root');
    writeQueuePrd(harness.cwd, 'dependent', ['adopted-live']);
    writeLock(harness.cwd, 'adopted-live', String(process.pid));
    writeLock(harness.cwd, 'stale-root', String(deadPid));
    writeLock(harness.cwd, 'corrupt-root', 'not-a-pid');
    const startedAt = '2026-01-01T00:00:00.000Z';
    harness.db.insertRun({ id: 'run-adopted-live', sessionId: 'session-adopted-live', planSet: 'adopted-live', command: 'eforge queue exec adopted-live', status: 'running', startedAt, cwd: harness.cwd, pid: process.pid });
    harness.db.insertRun({ id: 'run-stale-root', sessionId: 'session-stale-root', planSet: 'stale-root', command: 'eforge queue exec stale-root', status: 'running', startedAt, cwd: harness.cwd, pid: deadPid });

    const restQueue = await (await harness.get(API_ROUTES.queue)).json() as QueueItemWithCapabilities[];
    const projectedQueue = await projectQueueForContext(harness.context);

    expect(restQueue).toEqual(projectedQueue);
    expect(restQueue.map((item) => [item.id, item.status]).sort()).toEqual([
      ['adopted-live', 'running'],
      ['corrupt-root', 'pending'],
      ['dependent', 'pending'],
      ['stale-root', 'pending'],
    ]);
    expect(restQueue.find((item) => item.id === 'adopted-live')?.capabilities.cancel).toMatchObject({ allowed: true });
    expect(restQueue.find((item) => item.id === 'stale-root')?.capabilities.cancel).toMatchObject({ allowed: false, reason: expect.stringContaining('stale') });
    expect(restQueue.find((item) => item.id === 'stale-root')?.capabilities.cascadeCancel).toMatchObject({ allowed: false });
    expect(restQueue.find((item) => item.id === 'corrupt-root')?.capabilities.cancel).toMatchObject({ allowed: false, reason: expect.stringContaining('corrupt') });
    expect(restQueue.find((item) => item.id === 'corrupt-root')?.capabilities.cascadeCancel).toMatchObject({ allowed: false });

    const hello = await readFirstDaemonHello(harness.url);
    expect(hello.queue).toEqual(projectedQueue);
    expect(hello.runs).toEqual(projectRunsForContext(harness.context));
    expect(hello.sessionMetadata).toEqual(projectSessionMetadataForContext(harness.context));
  });

  it('makes startup reconciliation restart-safe and keeps cancellation markers authoritative for adopted locks', async () => {
    const cwd = makeTempDir();
    const db = openTempDb(cwd);
    const deadPid = makeDeadPid();
    const liveLock = writeLock(cwd, 'live-adopted', String(process.pid));
    const deadLock = writeLock(cwd, 'dead-lock', String(deadPid));
    const corruptLock = writeLock(cwd, 'corrupt-lock', 'bad-payload');
    await requestQueuePrdCancellation({
      cwd,
      prdId: 'live-adopted',
      reason: 'operator restart test',
      sessionId: 'session-live',
      runId: 'run-live',
      pid: process.pid,
      now: () => '2026-01-01T00:00:00.000Z',
    });

    const first = await reconcileOrphanedState(db, cwd);
    const second = await reconcileOrphanedState(db, cwd);

    expect(first.locksAdopted).toEqual([{ path: liveLock, pid: process.pid, prdId: 'live-adopted' }]);
    expect(first.locksRemoved).toEqual(expect.arrayContaining([
      { path: deadLock, pid: deadPid, reason: 'dead-pid' },
      { path: corruptLock, reason: 'corrupt-payload' },
    ]));
    expect(second.locksAdopted).toEqual([{ path: liveLock, pid: process.pid, prdId: 'live-adopted' }]);
    expect(second.locksRemoved).toEqual([]);
    expect(second.runsFailed).toEqual([]);
    expect(existsSync(liveLock)).toBe(true);
    await expect(consumeQueuePrdCancellation({
      cwd,
      prdId: 'live-adopted',
      expectedSessionId: 'session-live',
      expectedRunId: 'run-live',
      expectedPid: process.pid,
      now: () => new Date('2026-01-01T00:01:00.000Z'),
    })).resolves.toMatchObject({ prdId: 'live-adopted', reason: 'operator restart test', sessionId: 'session-live', runId: 'run-live', pid: process.pid });
    expect(existsSync(deadLock)).toBe(false);
    expect(existsSync(corruptLock)).toBe(false);
    db.close();
  });

  it('replays orphan completion once, preserves adopted success state, and dispatches only the unblocked dependent', async () => {
    const { cwd, queueDir, spawnPrdChild, makeScheduler, cleanup } = await createTestEnv();
    const db = openTempDb(cwd);
    const rootPath = await writeQueuedPrdFile(cwd, 'adopted-root');
    const childPath = await writeQueuedPrdFile(cwd, 'dependent-child', ['adopted-root']);
    await mkdir(join(cwd, queueDir, 'waiting'), { recursive: true });
    await writeFile(join(cwd, queueDir, 'waiting', 'dependent-child.md'), await readFileText(childPath), 'utf-8');
    await rm(childPath, { force: true });
    const lockPath = writeLock(cwd, 'adopted-root', String(makeDeadPid()));
    const recordedAt = '2026-01-01T00:00:00.000Z';
    await seedCompletedAdoptedRoot(cwd, 'adopted-root', recordedAt);
    writeDaemonEvent(db, { type: 'queue:prd:complete', prdId: 'adopted-root', status: 'completed' }, 'daemon-test');
    const startupCursor = db.getMaxDaemonEventId();
    const wakeReasons: string[] = [];

    const replayed = await replayPersistedOrphanQueueCompletions(db, { notifyQueueMutation: (reason: string) => wakeReasons.push(reason) } as never, startupCursor, { cwd, queueDir });
    const replayedAgain = await replayPersistedOrphanQueueCompletions(db, { notifyQueueMutation: (reason: string) => wakeReasons.push(`again:${reason}`) } as never, startupCursor, { cwd, queueDir });

    expect(replayed).toBe(1);
    expect(replayedAgain).toBe(1);
    expect(wakeReasons).toEqual(['external', 'again:external']);
    expect(existsSync(rootPath)).toBe(false);
    expect(existsSync(lockPath)).toBe(false);
    expect(existsSync(join(cwd, queueDir, 'dependent-child.md'))).toBe(true);

    const scheduler = makeScheduler([makeQueuedPrd('dependent-child', ['adopted-root'], join(cwd, queueDir, 'dependent-child.md'))]);
    await scheduler.start();
    await waitForSpawnCallCount(spawnPrdChild, 1);
    expect(spawnPrdChild.mock.calls.map(([prd]) => prd.id)).toEqual(['dependent-child']);
    expect(spawnPrdChild.mock.calls.map(([prd]) => prd.id)).not.toContain('adopted-root');

    db.close();
    await cleanup();
  });
});

async function readFileText(path: string): Promise<string> {
  return await import('node:fs/promises').then(({ readFile }) => readFile(path, 'utf-8'));
}
