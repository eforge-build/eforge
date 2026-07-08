import { describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { finalizeQueuedPrd } from '@eforge-build/engine/queue/finalizer';
import { parseRecoverySidecarPayload } from '@eforge-build/engine/recovery/sidecar-read';
import { loadCompletionRegistry, upsertCompletion } from '@eforge-build/engine/artifacts/completions';
import { upsertArtifact } from '@eforge-build/engine/artifacts';
import type { SchedulerInputEvent } from '@eforge-build/engine/queue/scheduler';
import { createTestEnv, makeQueuedPrd, waitForSpawnCallCount, writeQueuedPrdFile } from './queue-scheduler-helpers';
import { useTempDir } from './test-tmpdir';

const makeTempDir = useTempDir('eforge-queue-finalizer-');

async function writePrd(path: string, title: string, dependsOn: string[] = []): Promise<void> {
  const depLine = dependsOn.length > 0 ? `depends_on: [${dependsOn.join(', ')}]\n` : '';
  await writeFile(path, `---\ntitle: ${title}\n${depLine}---\n\n# ${title}\n`, 'utf-8');
}

describe('shared queued PRD finalizer', () => {
  it('atomically no-ops duplicate completion/PID-poll races and propagates dependent skips once', async () => {
    const cwd = makeTempDir();
    const queueDir = 'eforge/queue';
    await mkdir(join(cwd, queueDir, 'waiting'), { recursive: true });
    await mkdir(join(cwd, '.eforge', 'queue-locks'), { recursive: true });
    await writePrd(join(cwd, queueDir, 'parent.md'), 'Parent');
    await writePrd(join(cwd, queueDir, 'waiting', 'child.md'), 'Child', ['parent']);
    await writeFile(join(cwd, '.eforge', 'queue-locks', 'parent.lock'), String(process.pid), 'utf-8');

    const [first, second] = await Promise.all([
      finalizeQueuedPrd({ cwd, queueDir, prdId: 'parent', status: 'failed' }),
      finalizeQueuedPrd({ cwd, queueDir, prdId: 'parent', status: 'failed' }),
    ]);

    expect(first).toMatchObject({ finalized: true, terminalTransition: 'failed' });
    expect(second).toMatchObject({ finalized: true, terminalTransition: 'failed' });
    expect(existsSync(join(cwd, '.eforge', 'queue-locks', 'parent.lock'))).toBe(false);
    expect(existsSync(join(cwd, queueDir, 'failed', 'parent.md'))).toBe(true);
    expect(existsSync(join(cwd, queueDir, 'skipped', 'child.md'))).toBe(true);
    expect((await readdir(join(cwd, queueDir, 'failed'))).filter((name) => name === 'parent.md')).toHaveLength(1);
    expect((await readdir(join(cwd, queueDir, 'skipped'))).filter((name) => name === 'child.md')).toHaveLength(1);

    const evidenceRaw = await readFile(join(cwd, queueDir, 'failed', 'parent.recovery.json'), 'utf-8');
    const evidence = parseRecoverySidecarPayload(evidenceRaw, 'parent');
    expect(evidence.schemaVersion).toBe(3);
    expect(evidence.verdict.recommendationSource).toBe('manual-fallback');
    expect(evidence.boundedEvidence.identity.baseBranch).toBe('main');
    // Assert on the raw JSON too: the parser's legacy fallback maps '' to
    // 'main', so only the on-disk value pins the write-side fix.
    const rawIdentity = (JSON.parse(evidenceRaw) as { boundedEvidence: { identity: { baseBranch: string } } }).boundedEvidence.identity;
    expect(rawIdentity.baseBranch).toBe('main');

    const registry = await loadCompletionRegistry(cwd);
    expect(registry.completions.parent).toMatchObject({ status: 'failed' });

    await expect(finalizeQueuedPrd({ cwd, queueDir, prdId: 'parent', status: 'failed' })).resolves.toMatchObject({ finalized: false });
  });

  it('propagates already-terminal completed replay with missing root PRD to waiting dependents', async () => {
    const cwd = makeTempDir();
    const queueDir = 'eforge/queue';
    await mkdir(join(cwd, queueDir, 'waiting'), { recursive: true });
    await mkdir(join(cwd, '.eforge', 'queue-locks'), { recursive: true });
    await writePrd(join(cwd, queueDir, 'waiting', 'child.md'), 'Child', ['root']);
    await writeFile(join(cwd, '.eforge', 'queue-locks', 'root.lock'), String(process.pid), 'utf-8');
    const now = new Date().toISOString();
    await upsertArtifact(cwd, {
      prdId: 'root',
      artifactBranch: 'eforge/root',
      commitSha: 'abc123',
      resolvedBase: 'main',
      landingAction: 'pr',
      status: 'built',
      recordedAt: now,
      updatedAt: now,
    });
    await upsertCompletion(cwd, { prdId: 'root', status: 'completed', artifactAvailable: true, artifactBranch: 'eforge/root', completedAt: now, updatedAt: now });

    const result = await finalizeQueuedPrd({ cwd, queueDir, prdId: 'root', status: 'completed' });

    expect(result).toMatchObject({ finalized: false, lockReleased: true, terminalTransition: 'already-terminal' });
    expect(existsSync(join(cwd, queueDir, 'child.md'))).toBe(true);
    expect(existsSync(join(cwd, queueDir, 'waiting', 'child.md'))).toBe(false);
    expect(existsSync(join(cwd, '.eforge', 'queue-locks', 'root.lock'))).toBe(false);
  });

  it('propagates already-terminal failed replay with missing root PRD to waiting dependents', async () => {
    const cwd = makeTempDir();
    const queueDir = 'eforge/queue';
    await mkdir(join(cwd, queueDir, 'waiting'), { recursive: true });
    await writePrd(join(cwd, queueDir, 'waiting', 'child.md'), 'Child', ['root']);
    const now = new Date().toISOString();
    await upsertCompletion(cwd, { prdId: 'root', status: 'failed', artifactAvailable: false, completedAt: now, updatedAt: now });

    const result = await finalizeQueuedPrd({ cwd, queueDir, prdId: 'root', status: 'failed' });

    expect(result).toMatchObject({ finalized: false, terminalTransition: 'already-terminal' });
    expect(existsSync(join(cwd, queueDir, 'skipped', 'child.md'))).toBe(true);
    expect(existsSync(join(cwd, queueDir, 'waiting', 'child.md'))).toBe(false);
  });

  it('propagates already-terminal skipped replay with missing root PRD to waiting dependents', async () => {
    const cwd = makeTempDir();
    const queueDir = 'eforge/queue';
    await mkdir(join(cwd, queueDir, 'waiting'), { recursive: true });
    await writePrd(join(cwd, queueDir, 'waiting', 'child.md'), 'Child', ['root']);
    const now = new Date().toISOString();
    await upsertCompletion(cwd, { prdId: 'root', status: 'skipped', artifactAvailable: false, completedAt: now, updatedAt: now });

    const result = await finalizeQueuedPrd({ cwd, queueDir, prdId: 'root', status: 'skipped' });

    expect(result).toMatchObject({ finalized: false, terminalTransition: 'already-terminal' });
    expect(existsSync(join(cwd, queueDir, 'skipped', 'child.md'))).toBe(true);
    expect(existsSync(join(cwd, queueDir, 'waiting', 'child.md'))).toBe(false);
  });

  it('writes normal failed-build evidence exactly once under duplicate finalization', async () => {
    const cwd = makeTempDir();
    const queueDir = 'eforge/queue';
    await mkdir(join(cwd, queueDir), { recursive: true });
    await mkdir(join(cwd, '.eforge', 'queue-locks'), { recursive: true });
    const prdPath = join(cwd, queueDir, 'normal-fail.md');
    await writePrd(prdPath, 'Normal Fail');
    await writeFile(join(cwd, '.eforge', 'queue-locks', 'normal-fail.lock'), String(process.pid), 'utf-8');

    let evidenceWrites = 0;
    const writeFailedEvidence = vi.fn(async (filePath: string) => {
      evidenceWrites++;
      await new Promise((resolve) => setTimeout(resolve, 25));
      const failedDir = join(cwd, queueDir, 'failed');
      await mkdir(failedDir, { recursive: true });
      await rename(filePath, join(failedDir, 'normal-fail.md'));
      await writeFile(join(failedDir, 'normal-fail.recovery.json'), JSON.stringify({ verdict: { recommendationSource: 'normal-writer' } }), 'utf-8');
    });

    await Promise.all([
      finalizeQueuedPrd({ cwd, queueDir, prdId: 'normal-fail', status: 'failed', writeFailedEvidence }),
      finalizeQueuedPrd({ cwd, queueDir, prdId: 'normal-fail', status: 'failed', writeFailedEvidence }),
    ]);

    expect(writeFailedEvidence).toHaveBeenCalledTimes(1);
    expect(evidenceWrites).toBe(1);
    expect(existsSync(join(cwd, queueDir, 'failed', 'normal-fail.md'))).toBe(true);
    const evidence = JSON.parse(await readFile(join(cwd, queueDir, 'failed', 'normal-fail.recovery.json'), 'utf-8')) as { verdict: { recommendationSource?: string } };
    expect(evidence.verdict.recommendationSource).toBe('normal-writer');
    expect(existsSync(join(cwd, '.eforge', 'queue-locks', 'normal-fail.lock'))).toBe(false);
  });

  it('writes degraded evidence with explicit base branch when writeFailedEvidence throws', async () => {
    const cwd = makeTempDir();
    const queueDir = 'eforge/queue';
    await mkdir(join(cwd, queueDir), { recursive: true });
    await mkdir(join(cwd, '.eforge', 'queue-locks'), { recursive: true });
    await writePrd(join(cwd, queueDir, 'writer-throws.md'), 'Writer Throws');
    await writeFile(join(cwd, '.eforge', 'queue-locks', 'writer-throws.lock'), String(process.pid), 'utf-8');

    const result = await finalizeQueuedPrd({
      cwd,
      queueDir,
      prdId: 'writer-throws',
      status: 'failed',
      baseBranch: 'develop',
      writeFailedEvidence: async () => { throw new Error('writer failed'); },
    });

    expect(result).toMatchObject({ finalized: true, lockReleased: true, terminalTransition: 'failed' });
    expect(existsSync(join(cwd, queueDir, 'failed', 'writer-throws.md'))).toBe(true);
    expect(existsSync(join(cwd, queueDir, 'failed', 'writer-throws.recovery.json'))).toBe(true);
    expect(existsSync(join(cwd, '.eforge', 'queue-locks', 'writer-throws.lock'))).toBe(false);
    const evidence = parseRecoverySidecarPayload(await readFile(join(cwd, queueDir, 'failed', 'writer-throws.recovery.json'), 'utf-8'), 'writer-throws');
    expect(evidence.boundedEvidence.identity.baseBranch).toBe('develop');
    const registry = await loadCompletionRegistry(cwd);
    expect(registry.completions['writer-throws']).toMatchObject({ status: 'failed' });
  });

  it('resolves degraded evidence base branch from git remote HEAD when none is provided', async () => {
    const cwd = makeTempDir();
    const exec = promisify(execFile);
    await exec('git', ['init'], { cwd });
    // Point origin/HEAD at a non-main trunk. The sidecar reader's legacy
    // fallback also yields 'main', so only real git resolution in
    // degradedEvidenceBaseBranch can produce 'trunk' here.
    await exec('git', ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk'], { cwd });
    const queueDir = 'eforge/queue';
    await mkdir(join(cwd, queueDir), { recursive: true });
    await mkdir(join(cwd, '.eforge', 'queue-locks'), { recursive: true });
    await writePrd(join(cwd, queueDir, 'git-trunk.md'), 'Git Trunk');
    await writeFile(join(cwd, '.eforge', 'queue-locks', 'git-trunk.lock'), String(process.pid), 'utf-8');

    const result = await finalizeQueuedPrd({
      cwd,
      queueDir,
      prdId: 'git-trunk',
      status: 'failed',
      writeFailedEvidence: async () => { throw new Error('writer failed'); },
    });

    expect(result).toMatchObject({ finalized: true, terminalTransition: 'failed' });
    const raw = await readFile(join(cwd, queueDir, 'failed', 'git-trunk.recovery.json'), 'utf-8');
    expect(parseRecoverySidecarPayload(raw, 'git-trunk').boundedEvidence.identity.baseBranch).toBe('trunk');
  });

  it('writes degraded evidence when writeFailedEvidence omits sidecars', async () => {
    const cwd = makeTempDir();
    const queueDir = 'eforge/queue';
    await mkdir(join(cwd, queueDir), { recursive: true });
    await mkdir(join(cwd, '.eforge', 'queue-locks'), { recursive: true });
    await writePrd(join(cwd, queueDir, 'writer-omits.md'), 'Writer Omits');
    await writeFile(join(cwd, '.eforge', 'queue-locks', 'writer-omits.lock'), String(process.pid), 'utf-8');

    const result = await finalizeQueuedPrd({
      cwd,
      queueDir,
      prdId: 'writer-omits',
      status: 'failed',
      writeFailedEvidence: async (filePath) => {
        await mkdir(join(cwd, queueDir, 'failed'), { recursive: true });
        await rename(filePath, join(cwd, queueDir, 'failed', 'writer-omits.md'));
      },
    });

    expect(result).toMatchObject({ finalized: true, lockReleased: true, terminalTransition: 'failed' });
    expect(existsSync(join(cwd, queueDir, 'failed', 'writer-omits.md'))).toBe(true);
    expect(existsSync(join(cwd, queueDir, 'failed', 'writer-omits.recovery.json'))).toBe(true);
    expect(existsSync(join(cwd, '.eforge', 'queue-locks', 'writer-omits.lock'))).toBe(false);
    const registry = await loadCompletionRegistry(cwd);
    expect(registry.completions['writer-omits']).toMatchObject({ status: 'failed' });
  });

  it('writes degraded evidence when a failed PRD was already moved without sidecars', async () => {
    const cwd = makeTempDir();
    const queueDir = 'eforge/queue';
    await mkdir(join(cwd, queueDir, 'failed'), { recursive: true });
    await writePrd(join(cwd, queueDir, 'failed', 'premoved.md'), 'Premoved');

    await expect(finalizeQueuedPrd({ cwd, queueDir, prdId: 'premoved', status: 'failed' })).resolves.toMatchObject({ terminalTransition: 'failed' });

    const evidence = JSON.parse(await readFile(join(cwd, queueDir, 'failed', 'premoved.recovery.json'), 'utf-8')) as { verdict: { recommendationSource?: string } };
    expect(evidence.verdict.recommendationSource).toBe('manual-fallback');
  });

  it('writes degraded evidence and releases lock for missing failed PRD file replay', async () => {
    const cwd = makeTempDir();
    const queueDir = 'eforge/queue';
    await mkdir(join(cwd, queueDir, 'waiting'), { recursive: true });
    await mkdir(join(cwd, '.eforge', 'queue-locks'), { recursive: true });
    await writePrd(join(cwd, queueDir, 'waiting', 'child.md'), 'Child', ['missing-parent']);
    await writeFile(join(cwd, '.eforge', 'queue-locks', 'missing-parent.lock'), String(process.pid), 'utf-8');

    const result = await finalizeQueuedPrd({ cwd, queueDir, prdId: 'missing-parent', status: 'failed' });

    expect(result).toMatchObject({ finalized: true, lockReleased: true, terminalTransition: 'missing' });
    expect(existsSync(join(cwd, queueDir, 'failed', 'missing-parent.recovery.json'))).toBe(true);
    expect(existsSync(join(cwd, '.eforge', 'queue-locks', 'missing-parent.lock'))).toBe(false);
    expect(existsSync(join(cwd, queueDir, 'skipped', 'child.md'))).toBe(true);
    const registry = await loadCompletionRegistry(cwd);
    expect(registry.completions['missing-parent']).toMatchObject({ status: 'failed' });
  });

  it('cleans up a persisted orphan queue:prd:complete replay before completion handling can continue', async () => {
    const cwd = makeTempDir();
    const queueDir = 'eforge/queue';
    await mkdir(join(cwd, queueDir), { recursive: true });
    await mkdir(join(cwd, '.eforge', 'queue-locks'), { recursive: true });
    await writePrd(join(cwd, queueDir, 'orphan.md'), 'Orphan');
    await writeFile(join(cwd, '.eforge', 'queue-locks', 'orphan.lock'), String(process.pid), 'utf-8');

    const result = await finalizeQueuedPrd({ cwd, queueDir, prdId: 'orphan', status: 'completed' });

    expect(result).toMatchObject({ finalized: true, lockReleased: true, terminalTransition: 'completed-cleanup' });
    expect(existsSync(join(cwd, queueDir, 'orphan.md'))).toBe(false);
    expect(existsSync(join(cwd, '.eforge', 'queue-locks', 'orphan.lock'))).toBe(false);

    const registry = await loadCompletionRegistry(cwd);
    expect(registry.completions.orphan).toMatchObject({ status: 'completed' });
  });

  it('gates orphan queue:prd:complete scheduler dispatch behind cleanup and ignores replay duplicates', async () => {
    const { cwd, bus, eventQueue, spawnPrdChild, makeScheduler } = await createTestEnv();
    const rootPath = await writeQueuedPrdFile(cwd, 'root');
    const childPath = await writeQueuedPrdFile(cwd, 'child', ['root']);
    await mkdir(join(cwd, '.eforge', 'queue-locks'), { recursive: true });
    await writeFile(join(cwd, '.eforge', 'queue-locks', 'root.lock'), String(process.pid), 'utf-8');

    let rootExistsAtChildSpawn: boolean | undefined;
    let lockExistsAtChildSpawn: boolean | undefined;
    spawnPrdChild.mockImplementationOnce(() => {
      rootExistsAtChildSpawn = existsSync(rootPath);
      lockExistsAtChildSpawn = existsSync(join(cwd, '.eforge', 'queue-locks', 'root.lock'));
      return new Promise<'completed' | 'failed' | 'skipped' | 'already-claimed'>(() => {});
    });

    const scheduler = makeScheduler([
      makeQueuedPrd('root', [], rootPath),
      makeQueuedPrd('child', ['root'], childPath),
    ]);
    await scheduler.start();
    expect(spawnPrdChild).not.toHaveBeenCalled();

    const now = new Date().toISOString();
    await upsertArtifact(cwd, {
      prdId: 'root',
      artifactBranch: 'eforge/root',
      commitSha: 'abc123',
      resolvedBase: 'main',
      landingAction: 'pr',
      status: 'built',
      recordedAt: now,
      updatedAt: now,
    });

    const completeEvent: SchedulerInputEvent = {
      type: 'queue:prd:complete',
      prdId: 'root',
      status: 'completed',
      timestamp: new Date().toISOString(),
    };
    bus.emit('queue:prd:complete', completeEvent);
    bus.emit('queue:prd:complete', completeEvent);

    await waitForSpawnCallCount(spawnPrdChild, 1);
    await vi.waitFor(() => expect(scheduler.processed).toBe(1));
    expect(rootExistsAtChildSpawn).toBe(false);
    expect(lockExistsAtChildSpawn).toBe(false);
    expect(spawnPrdChild.mock.calls.map(([prd]) => prd.id)).toEqual(['child']);
    expect(eventQueue.drainAvailable().some((event) => event.type === 'queue:prd:complete' && 'status' in event && event.status === 'failed')).toBe(false);

    eventQueue.removeProducer();
  });
});
