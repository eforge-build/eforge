import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { claimPrd } from '@eforge-build/engine/prd-queue';
import { isQueueControlError, removeQueuedPrd, updateQueuedPrdPriority } from '@eforge-build/engine/queue/control';
import { useTempDir } from './test-tmpdir.js';

type QueueControlRaceHooks = {
  afterLocate?: () => void | Promise<void>;
  afterRootClaim?: () => void | Promise<void>;
};

describe('queue-control race safety', () => {
  const makeTempDir = useTempDir('eforge-queue-control-race-');

  function queueRoot(dir: string): string {
    return join(dir, '.eforge', 'queue');
  }

  function queuePath(dir: string, id: string): string {
    return join(queueRoot(dir), `${id}.md`);
  }

  function subdirPath(dir: string, subdir: 'waiting' | 'failed' | 'skipped', id: string): string {
    return join(queueRoot(dir), subdir, `${id}.md`);
  }

  function writePrdFile(
    dir: string,
    location: 'queue' | 'waiting' | 'failed' | 'skipped',
    id: string,
    frontmatterExtra = '',
    body = 'Original body text.',
  ): string {
    const targetDir = location === 'queue' ? queueRoot(dir) : join(queueRoot(dir), location);
    mkdirSync(targetDir, { recursive: true });
    const filePath = join(targetDir, `${id}.md`);
    writeFileSync(filePath, `---\ntitle: ${id}${frontmatterExtra}\n---\n\n# ${id}\n\n${body}\n`);
    return filePath;
  }

  function movePrdFile(
    dir: string,
    id: string,
    from: 'queue' | 'waiting' | 'failed' | 'skipped',
    to: 'queue' | 'waiting' | 'failed' | 'skipped',
  ): string {
    const fromPath = from === 'queue' ? queuePath(dir, id) : subdirPath(dir, from, id);
    const toDir = to === 'queue' ? queueRoot(dir) : join(queueRoot(dir), to);
    mkdirSync(toDir, { recursive: true });
    const toPath = join(toDir, `${id}.md`);
    renameSync(fromPath, toPath);
    return toPath;
  }

  function priorityOptions(dir: string, prdId: string, hooks: QueueControlRaceHooks) {
    return {
      cwd: dir,
      queueDir: queueRoot(dir),
      prdId,
      priority: 7,
      __testHooks: hooks,
    } as Parameters<typeof updateQueuedPrdPriority>[0];
  }

  function removeOptions(dir: string, prdId: string, hooks: QueueControlRaceHooks) {
    return {
      cwd: dir,
      queueDir: queueRoot(dir),
      prdId,
      __testHooks: hooks,
    } as Parameters<typeof removeQueuedPrd>[0];
  }

  async function expectQueueControlFailure(promise: Promise<unknown>): Promise<{ kind: string; message: string }> {
    let caught: unknown;
    try {
      await promise;
    } catch (err) {
      caught = err;
    }
    expect(isQueueControlError(caught)).toBe(true);
    return caught as { kind: string; message: string };
  }

  it('fails root priority after the root file is deleted post-location and does not recreate it', async () => {
    const dir = makeTempDir();
    writePrdFile(dir, 'queue', 'p');

    const err = await expectQueueControlFailure(updateQueuedPrdPriority(priorityOptions(dir, 'p', {
      afterLocate: () => rmSync(queuePath(dir, 'p')),
    })));

    expect(['not-found', 'conflict']).toContain(err.kind);
    expect(existsSync(queuePath(dir, 'p'))).toBe(false);
  });

  it.each(['failed', 'skipped', 'waiting'] as const)(
    'fails root priority after the root file moves to %s post-location and does not recreate the root file',
    async (target) => {
      const dir = makeTempDir();
      writePrdFile(dir, 'queue', 'p');

      const err = await expectQueueControlFailure(updateQueuedPrdPriority(priorityOptions(dir, 'p', {
        afterLocate: () => movePrdFile(dir, 'p', 'queue', target),
      })));

      expect(['not-found', 'conflict']).toContain(err.kind);
      expect(existsSync(queuePath(dir, 'p'))).toBe(false);
      expect(readFileSync(subdirPath(dir, target, 'p'), 'utf-8')).not.toContain('priority: 7');
    },
  );

  it('fails root priority after the root file is completed post-location and does not recreate it', async () => {
    const dir = makeTempDir();
    writePrdFile(dir, 'queue', 'p');

    const err = await expectQueueControlFailure(updateQueuedPrdPriority(priorityOptions(dir, 'p', {
      afterLocate: () => rmSync(queuePath(dir, 'p')),
    })));

    expect(['not-found', 'conflict']).toContain(err.kind);
    expect(existsSync(queuePath(dir, 'p'))).toBe(false);
  });

  it('fails root priority after another worker claims the root file post-location and leaves content unchanged', async () => {
    const dir = makeTempDir();
    const filePath = writePrdFile(dir, 'queue', 'p', '', 'Keep this content.');
    const before = readFileSync(filePath, 'utf-8');

    const err = await expectQueueControlFailure(updateQueuedPrdPriority(priorityOptions(dir, 'p', {
      afterLocate: async () => {
        expect(await claimPrd('p', dir)).toBe(true);
      },
    })));

    expect(err.kind).toBe('conflict');
    expect(readFileSync(filePath, 'utf-8')).toBe(before);
  });

  it('fails root priority after the root file is deleted post-claim and does not recreate it', async () => {
    const dir = makeTempDir();
    writePrdFile(dir, 'queue', 'p');

    const err = await expectQueueControlFailure(updateQueuedPrdPriority(priorityOptions(dir, 'p', {
      afterRootClaim: () => rmSync(queuePath(dir, 'p')),
    })));

    expect(['not-found', 'conflict']).toContain(err.kind);
    expect(existsSync(queuePath(dir, 'p'))).toBe(false);
  });

  it('fails waiting priority after the waiting file is deleted post-location and does not recreate it', async () => {
    const dir = makeTempDir();
    writePrdFile(dir, 'waiting', 'w');

    const err = await expectQueueControlFailure(updateQueuedPrdPriority(priorityOptions(dir, 'w', {
      afterLocate: () => rmSync(subdirPath(dir, 'waiting', 'w')),
    })));

    expect(['not-found', 'conflict']).toContain(err.kind);
    expect(existsSync(subdirPath(dir, 'waiting', 'w'))).toBe(false);
  });

  it('fails waiting priority after the waiting file moves post-location and does not recreate it', async () => {
    const dir = makeTempDir();
    writePrdFile(dir, 'waiting', 'w');

    const err = await expectQueueControlFailure(updateQueuedPrdPriority(priorityOptions(dir, 'w', {
      afterLocate: () => movePrdFile(dir, 'w', 'waiting', 'skipped'),
    })));

    expect(['not-found', 'conflict']).toContain(err.kind);
    expect(existsSync(subdirPath(dir, 'waiting', 'w'))).toBe(false);
    expect(readFileSync(subdirPath(dir, 'skipped', 'w'), 'utf-8')).not.toContain('priority: 7');
  });

  it('fails root removal after the root file is deleted post-location instead of reporting success', async () => {
    const dir = makeTempDir();
    writePrdFile(dir, 'queue', 'p');

    const err = await expectQueueControlFailure(removeQueuedPrd(removeOptions(dir, 'p', {
      afterLocate: () => rmSync(queuePath(dir, 'p')),
    })));

    expect(['not-found', 'conflict']).toContain(err.kind);
    expect(existsSync(queuePath(dir, 'p'))).toBe(false);
  });

  it('fails root removal after the root file moves post-location instead of reporting success', async () => {
    const dir = makeTempDir();
    writePrdFile(dir, 'queue', 'p');

    const err = await expectQueueControlFailure(removeQueuedPrd(removeOptions(dir, 'p', {
      afterLocate: () => movePrdFile(dir, 'p', 'queue', 'failed'),
    })));

    expect(['not-found', 'conflict']).toContain(err.kind);
    expect(existsSync(queuePath(dir, 'p'))).toBe(false);
    expect(existsSync(subdirPath(dir, 'failed', 'p'))).toBe(true);
  });

  it('fails root removal after the root file is deleted post-claim instead of reporting success', async () => {
    const dir = makeTempDir();
    writePrdFile(dir, 'queue', 'p');

    const err = await expectQueueControlFailure(removeQueuedPrd(removeOptions(dir, 'p', {
      afterRootClaim: () => rmSync(queuePath(dir, 'p')),
    })));

    expect(['not-found', 'conflict']).toContain(err.kind);
    expect(existsSync(queuePath(dir, 'p'))).toBe(false);
  });

  it.each(['waiting', 'failed', 'skipped'] as const)(
    'fails %s removal after the file is deleted post-location instead of reporting success',
    async (location) => {
      const dir = makeTempDir();
      writePrdFile(dir, location, 'm');

      const err = await expectQueueControlFailure(removeQueuedPrd(removeOptions(dir, 'm', {
        afterLocate: () => rmSync(subdirPath(dir, location, 'm')),
      })));

      expect(['not-found', 'conflict']).toContain(err.kind);
      expect(existsSync(subdirPath(dir, location, 'm'))).toBe(false);
    },
  );
});
