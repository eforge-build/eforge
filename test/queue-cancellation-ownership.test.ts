import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { classifyQueueChildExit, consumeQueuePrdCancellation, requestQueuePrdCancellation, resolveRunningPrdOwnership } from '@eforge-build/engine/queue/cancellation';
import { useTempDir } from './test-tmpdir.js';

function lock(dir: string, id: string, content: string): void {
  const lockDir = join(dir, '.eforge', 'queue-locks');
  mkdirSync(lockDir, { recursive: true });
  writeFileSync(join(lockDir, `${id}.lock`), content);
}

describe('queue cancellation ownership', () => {
  const tmp = useTempDir('eforge-queue-cancel-');

  it('refuses absent, corrupt, and missing-run ownership evidence', async () => {
    const dir = tmp();
    await expect(resolveRunningPrdOwnership({ cwd: dir, prdId: 'p', runs: [] })).resolves.toMatchObject({ owned: false, reason: expect.stringContaining('no live lock') });
    lock(dir, 'bad', 'nope');
    await expect(resolveRunningPrdOwnership({ cwd: dir, prdId: 'bad', runs: [] })).resolves.toMatchObject({ owned: false, reason: expect.stringContaining('corrupt') });
    lock(dir, 'p', String(process.pid));
    await expect(resolveRunningPrdOwnership({ cwd: dir, prdId: 'p', runs: [] })).resolves.toMatchObject({ owned: false, reason: expect.stringContaining('no matching running run') });
  });

  it('accepts live lock plus daemon run/session evidence', async () => {
    const dir = tmp();
    lock(dir, 'p', String(process.pid));
    await expect(resolveRunningPrdOwnership({ cwd: dir, prdId: 'p', runs: [{ id: 'run', planSet: 'p', sessionId: 's', status: 'running', pid: process.pid } as never], workerSessions: new Set(['s']) })).resolves.toMatchObject({ owned: true, sessionId: 's', runId: 'run', pid: process.pid });
  });

  it('writes and consumes cancellation markers once', async () => {
    const dir = tmp();
    await requestQueuePrdCancellation({ cwd: dir, prdId: 'p', reason: 'operator', sessionId: 's', now: () => '2026-01-01T00:00:00.000Z' });
    const path = join(dir, '.eforge', 'queue-cancellations', 'p.json');
    expect(existsSync(path)).toBe(true);
    await expect(requestQueuePrdCancellation({ cwd: dir, prdId: 'p' })).rejects.toMatchObject({ kind: 'conflict' });
    await expect(consumeQueuePrdCancellation({ cwd: dir, prdId: 'p', expectedSessionId: 's', now: () => new Date('2026-01-01T00:01:00.000Z') })).resolves.toMatchObject({ prdId: 'p', reason: 'operator', sessionId: 's' });
    await expect(consumeQueuePrdCancellation({ cwd: dir, prdId: 'p' })).resolves.toBeNull();
  });

  it('classifies operator cancellation as skipped and preserves other child exits', () => {
    expect(classifyQueueChildExit({ exitCode: null, signal: 'SIGTERM', schedulerAborted: false, operatorCancellation: { prdId: 'p', requestedAt: 'now' } })).toMatchObject({ status: 'skipped', moveTo: 'skipped' });
    expect(classifyQueueChildExit({ exitCode: null, signal: 'SIGTERM', schedulerAborted: true, operatorCancellation: null })).toMatchObject({ status: 'skipped', moveTo: null });
    expect(classifyQueueChildExit({ exitCode: 0, signal: null, schedulerAborted: false, operatorCancellation: null })).toMatchObject({ status: 'completed', shouldCleanupCompleted: true });
    expect(classifyQueueChildExit({ exitCode: 10, signal: null, schedulerAborted: false, operatorCancellation: null })).toMatchObject({ status: 'already-claimed' });
  });
});
