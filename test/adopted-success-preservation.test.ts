import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { finalizeQueuedPrd } from '@eforge-build/engine/queue/finalizer';
import { loadArtifactRegistry, loadCompletionRegistry, upsertArtifact, upsertCompletion } from '@eforge-build/engine/artifacts';
import { createTestEnv, makeQueuedPrd, waitForSpawnCallCount } from './queue-scheduler-helpers';
import { useTempDir } from './test-tmpdir';

const makeTempDir = useTempDir('eforge-adopted-success-');

async function writeQueuePrd(path: string, title: string, dependsOn: string[] = []): Promise<void> {
  const dependsOnLine = dependsOn.length > 0 ? `depends_on: [${dependsOn.map((dep) => `"${dep}"`).join(', ')}]\n` : '';
  await writeFile(path, `---\ntitle: ${title}\n${dependsOnLine}---\n\n# ${title}\n`, 'utf-8');
}

async function seedCompletedArtifactAndCompletion(cwd: string, prdId: string, timestamp: string): Promise<void> {
  await upsertArtifact(cwd, {
    prdId,
    artifactBranch: `eforge/${prdId}`,
    commitSha: 'abc123',
    resolvedBase: 'main',
    landingAction: 'pr',
    status: 'built',
    recordedAt: timestamp,
    updatedAt: timestamp,
  });
  await upsertCompletion(cwd, {
    prdId,
    status: 'completed',
    artifactAvailable: true,
    artifactBranch: `eforge/${prdId}`,
    completedAt: timestamp,
    updatedAt: timestamp,
  });
}

describe('adopted successful queued build preservation', () => {
  it('removes only the adopted root queue item while preserving completed artifacts and completion timestamps', async () => {
    const cwd = makeTempDir();
    const queueDir = 'eforge/queue';
    const rootPath = join(cwd, queueDir, 'adopted-root.md');
    const childWaitingPath = join(cwd, queueDir, 'waiting', 'dependent-child.md');
    const lockPath = join(cwd, '.eforge', 'queue-locks', 'adopted-root.lock');
    await mkdir(join(cwd, queueDir, 'waiting'), { recursive: true });
    await mkdir(join(cwd, '.eforge', 'queue-locks'), { recursive: true });
    await writeQueuePrd(rootPath, 'Adopted Root');
    await writeQueuePrd(childWaitingPath, 'Dependent Child', ['adopted-root']);
    await writeFile(lockPath, String(process.pid), 'utf-8');

    const recordedAt = '2025-02-03T04:05:06.000Z';
    await seedCompletedArtifactAndCompletion(cwd, 'adopted-root', recordedAt);
    const artifactsBefore = await loadArtifactRegistry(cwd);
    const completionsBefore = await loadCompletionRegistry(cwd);

    const result = await finalizeQueuedPrd({ cwd, queueDir, prdId: 'adopted-root', status: 'completed' });

    expect(result).toEqual({ finalized: true, lockReleased: true, terminalTransition: 'completed-cleanup' });
    expect(existsSync(rootPath)).toBe(false);
    expect(existsSync(lockPath)).toBe(false);
    expect(existsSync(childWaitingPath)).toBe(false);
    expect(existsSync(join(cwd, queueDir, 'dependent-child.md'))).toBe(true);
    expect(await loadArtifactRegistry(cwd)).toEqual(artifactsBefore);
    expect(await loadCompletionRegistry(cwd)).toEqual(completionsBefore);
  });

  it('makes adopted root completion visible to dependent scheduling without dispatching the root again', async () => {
    const { cwd, queueDir, spawnPrdChild, makeScheduler, cleanup } = await createTestEnv();
    const rootPath = join(cwd, queueDir, 'adopted-root.md');
    const waitingChildPath = join(cwd, queueDir, 'waiting', 'dependent-child.md');
    const pendingChildPath = join(cwd, queueDir, 'dependent-child.md');
    const lockPath = join(cwd, '.eforge', 'queue-locks', 'adopted-root.lock');
    await mkdir(join(cwd, queueDir, 'waiting'), { recursive: true });
    await mkdir(join(cwd, '.eforge', 'queue-locks'), { recursive: true });
    await writeQueuePrd(rootPath, 'Adopted Root');
    await writeQueuePrd(waitingChildPath, 'Dependent Child', ['adopted-root']);
    await writeFile(lockPath, String(process.pid), 'utf-8');
    await seedCompletedArtifactAndCompletion(cwd, 'adopted-root', '2025-02-03T04:05:06.000Z');

    await finalizeQueuedPrd({ cwd, queueDir, prdId: 'adopted-root', status: 'completed' });

    expect(existsSync(rootPath)).toBe(false);
    expect(existsSync(pendingChildPath)).toBe(true);
    expect(await readFile(pendingChildPath, 'utf-8')).toContain('depends_on: ["adopted-root"]');

    const scheduler = makeScheduler([
      makeQueuedPrd('dependent-child', ['adopted-root'], pendingChildPath),
    ]);
    await scheduler.start();
    await waitForSpawnCallCount(spawnPrdChild, 1);

    expect(spawnPrdChild.mock.calls.map(([prd]) => prd.id)).toEqual(['dependent-child']);
    expect(spawnPrdChild.mock.calls.map(([prd]) => prd.id)).not.toContain('adopted-root');
    await cleanup();
  });
});
