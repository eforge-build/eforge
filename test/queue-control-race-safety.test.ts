import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  claimPrd,
  cleanupCompletedPrd,
  loadQueue,
  setQueuedPrdFrontmatterFields,
  setQueuedPrdFrontmatterFieldsExistingOnly,
} from '@eforge-build/engine/prd-queue';
import { isQueueControlError, removeQueuedPrd, updateQueuedPrdPriority } from '@eforge-build/engine/queue/control';
import { useTempDir } from './test-tmpdir.js';

type QueueControlRaceHooks = {
  afterLocate?: () => void | Promise<void>;
  afterRootClaim?: () => void | Promise<void>;
  beforePriorityWrite?: () => void | Promise<void>;
  beforeMainRemoval?: () => void | Promise<void>;
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

  function lockPath(dir: string, id: string): string {
    return join(dir, '.eforge', 'queue-locks', `${id}.lock`);
  }

  function recoverySidecarPath(dir: string, id: string, ext: 'md' | 'json'): string {
    return join(queueRoot(dir), 'failed', `${id}.recovery.${ext}`);
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
      afterLocate: () => cleanupCompletedPrd(queuePath(dir, 'p'), queueRoot(dir), dir),
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
    expect(existsSync(lockPath(dir, 'p'))).toBe(false);
  });

  it('uses freshly reloaded root PRD content for priority updates', async () => {
    const dir = makeTempDir();
    writePrdFile(dir, 'queue', 'p', '', 'Original body text.');

    await updateQueuedPrdPriority(priorityOptions(dir, 'p', {
      afterRootClaim: () => writePrdFile(dir, 'queue', 'p', '\nprofile: concurrent', 'Concurrent body text.'),
    }));

    const content = readFileSync(queuePath(dir, 'p'), 'utf-8');
    expect(content).toContain('priority: 7');
    expect(content).toContain('profile: concurrent');
    expect(content).toContain('Concurrent body text.');
    expect(content).not.toContain('Original body text.');
  });

  it('fails existing-only frontmatter writes on a missing file without recreating it', async () => {
    const dir = makeTempDir();
    writePrdFile(dir, 'queue', 'p');
    const [prd] = await loadQueue(queueRoot(dir), dir);

    rmSync(queuePath(dir, 'p'));

    await expect(setQueuedPrdFrontmatterFieldsExistingOnly(prd, { priority: 7 }))
      .rejects.toMatchObject({ code: 'ENOENT' });
    expect(existsSync(queuePath(dir, 'p'))).toBe(false);

    await setQueuedPrdFrontmatterFields(prd, { priority: 7 });
    expect(readFileSync(queuePath(dir, 'p'), 'utf-8')).toContain('priority: 7');
  });

  it('fails priority without recreating the PRD when it disappears after reload but before write', async () => {
    const dir = makeTempDir();
    writePrdFile(dir, 'waiting', 'w');

    const err = await expectQueueControlFailure(updateQueuedPrdPriority(priorityOptions(dir, 'w', {
      beforePriorityWrite: () => rmSync(subdirPath(dir, 'waiting', 'w')),
    })));

    expect(err.kind).toBe('not-found');
    expect(existsSync(subdirPath(dir, 'waiting', 'w'))).toBe(false);
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

  it('uses freshly reloaded waiting PRD content for priority updates', async () => {
    const dir = makeTempDir();
    writePrdFile(dir, 'waiting', 'w', '', 'Original body text.');

    await updateQueuedPrdPriority(priorityOptions(dir, 'w', {
      afterLocate: () => writePrdFile(dir, 'waiting', 'w', '\nprofile: concurrent', 'Concurrent body text.'),
    }));

    const content = readFileSync(subdirPath(dir, 'waiting', 'w'), 'utf-8');
    expect(content).toContain('priority: 7');
    expect(content).toContain('profile: concurrent');
    expect(content).toContain('Concurrent body text.');
    expect(content).not.toContain('Original body text.');
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
    expect(existsSync(lockPath(dir, 'p'))).toBe(false);
  });

  it('fails removal when the root file disappears after reload but before deletion', async () => {
    const dir = makeTempDir();
    writePrdFile(dir, 'queue', 'p');

    const err = await expectQueueControlFailure(removeQueuedPrd(removeOptions(dir, 'p', {
      beforeMainRemoval: () => rmSync(queuePath(dir, 'p')),
    })));

    expect(err.kind).toBe('not-found');
    expect(existsSync(queuePath(dir, 'p'))).toBe(false);
    expect(existsSync(lockPath(dir, 'p'))).toBe(false);
  });

  it.each(['queue', 'waiting'] as const)(
    'fails root removal when a %s dependent is added after the claim',
    async (dependentLocation) => {
      const dir = makeTempDir();
      writePrdFile(dir, 'queue', 'p');

      const err = await expectQueueControlFailure(removeQueuedPrd(removeOptions(dir, 'p', {
        afterRootClaim: () => writePrdFile(dir, dependentLocation, 'dep', '\ndepends_on: ["p"]'),
      })));

      expect(err.kind).toBe('conflict');
      expect(err.message).toContain('dep');
      expect(existsSync(queuePath(dir, 'p'))).toBe(true);
    },
  );

  it.each(['queue', 'waiting'] as const)(
    'fails root removal when a %s dependent is added immediately before deletion',
    async (dependentLocation) => {
      const dir = makeTempDir();
      writePrdFile(dir, 'queue', 'p');

      const err = await expectQueueControlFailure(removeQueuedPrd(removeOptions(dir, 'p', {
        beforeMainRemoval: () => writePrdFile(dir, dependentLocation, 'late-dep', '\ndepends_on: ["p"]'),
      })));

      expect(err.kind).toBe('conflict');
      expect(err.message).toContain('late-dep');
      expect(existsSync(queuePath(dir, 'p'))).toBe(true);
    },
  );

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

  it('keeps failed recovery sidecars when removal fails after reload but before deletion', async () => {
    const dir = makeTempDir();
    writePrdFile(dir, 'failed', 'm');
    writeFileSync(recoverySidecarPath(dir, 'm', 'md'), '# Recovery\n');
    writeFileSync(recoverySidecarPath(dir, 'm', 'json'), '{"verdict":"manual"}\n');

    const err = await expectQueueControlFailure(removeQueuedPrd(removeOptions(dir, 'm', {
      beforeMainRemoval: () => rmSync(subdirPath(dir, 'failed', 'm')),
    })));

    expect(err.kind).toBe('not-found');
    expect(existsSync(recoverySidecarPath(dir, 'm', 'md'))).toBe(true);
    expect(existsSync(recoverySidecarPath(dir, 'm', 'json'))).toBe(true);
  });

  it.each([
    ['waiting', 'failed'],
    ['failed', 'skipped'],
    ['skipped', 'waiting'],
  ] as const)(
    'fails %s removal after the file moves to %s post-location instead of reporting success',
    async (from, to) => {
      const dir = makeTempDir();
      writePrdFile(dir, from, 'm');

      const err = await expectQueueControlFailure(removeQueuedPrd(removeOptions(dir, 'm', {
        afterLocate: () => movePrdFile(dir, 'm', from, to),
      })));

      expect(['not-found', 'conflict']).toContain(err.kind);
      expect(existsSync(subdirPath(dir, from, 'm'))).toBe(false);
      expect(existsSync(subdirPath(dir, to, 'm'))).toBe(true);
    },
  );
});
