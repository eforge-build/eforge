import { describe, it, expect } from 'vitest';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { validatePrdFrontmatter, resolveQueueOrder, claimPrd, releasePrd, movePrdToSubdir, cleanupCompletedPrd, setQueuedPrdProfile, isPrdRunning, readPrdLockStatus, type QueuedPrd } from '@eforge-build/engine/prd-queue';
import { findQueuedPrdForControl, removeQueuedPrd, updateQueuedPrdPriority, isQueueControlError,
  overrideQueuedPrdDependency,
} from '@eforge-build/engine/queue/control';
import { useTempDir } from './test-tmpdir.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQueuedPrd(overrides: Partial<QueuedPrd> & { id: string }): QueuedPrd {
  return {
    filePath: `/tmp/${overrides.id}.md`,
    frontmatter: { title: overrides.id },
    content: `---\ntitle: ${overrides.id}\n---\n\n# ${overrides.id}`,
    lastCommitHash: '',
    lastCommitDate: '',
    ...overrides,
  };
}

function makeDeadPid(): number {
  for (let attempt = 0; attempt < 5; attempt++) {
    const result = spawnSync(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' });
    if (result.error) throw result.error;
    if (typeof result.pid !== 'number' || result.pid <= 0) {
      throw new Error('spawnSync did not return a positive child pid');
    }

    try {
      process.kill(result.pid, 0);
    } catch {
      return result.pid;
    }
  }
  throw new Error('could not create a definitely dead pid for lock tests');
}

// ---------------------------------------------------------------------------
// Frontmatter Validation
// ---------------------------------------------------------------------------

describe('validatePrdFrontmatter', () => {
  it('accepts valid frontmatter with all fields', () => {
    const result = validatePrdFrontmatter({
      title: 'Add user auth',
      created: '2026-01-15',
      priority: 1,
      depends_on: ['setup-db'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe('Add user auth');
      expect(result.data.priority).toBe(1);
      expect(result.data.depends_on).toEqual(['setup-db']);
    }
  });

  it('rejects frontmatter missing title', () => {
    const result = validatePrdFrontmatter({
      created: '2026-01-15',
      priority: 1,
    });
    expect(result.success).toBe(false);
  });

  it('rejects frontmatter with missing created (optional - should pass)', () => {
    // created is optional per schema
    const result = validatePrdFrontmatter({
      title: 'No date',
    });
    expect(result.success).toBe(true);
  });

  it('ignores extra fields gracefully', () => {
    const result = validatePrdFrontmatter({
      title: 'Extra fields',
      created: '2026-01-15',
      customField: 'should be ignored',
      anotherOne: 42,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe('Extra fields');
    }
  });
});

// ---------------------------------------------------------------------------
// Queue Ordering
// ---------------------------------------------------------------------------

describe('resolveQueueOrder', () => {
  it('sorts by priority ascending (lower = higher priority)', () => {
    const prds = [
      makeQueuedPrd({ id: 'low', frontmatter: { title: 'Low', priority: 3 } }),
      makeQueuedPrd({ id: 'high', frontmatter: { title: 'High', priority: 1 } }),
      makeQueuedPrd({ id: 'mid', frontmatter: { title: 'Mid', priority: 2 } }),
    ];

    const ordered = resolveQueueOrder(prds);
    expect(ordered.map((p) => p.id)).toEqual(['high', 'mid', 'low']);
  });

  it('respects dependency waves - dependents come after dependencies', () => {
    const prds = [
      makeQueuedPrd({
        id: 'api',
        frontmatter: { title: 'API', depends_on: ['db'] },
      }),
      makeQueuedPrd({
        id: 'db',
        frontmatter: { title: 'Database' },
      }),
    ];

    const ordered = resolveQueueOrder(prds);
    expect(ordered.map((p) => p.id)).toEqual(['db', 'api']);
  });

  it('handles priority + deps combined - deps first, then priority within wave', () => {
    const prds = [
      makeQueuedPrd({
        id: 'feature-b',
        frontmatter: { title: 'Feature B', priority: 1, depends_on: ['foundation'] },
      }),
      makeQueuedPrd({
        id: 'feature-a',
        frontmatter: { title: 'Feature A', priority: 2, depends_on: ['foundation'] },
      }),
      makeQueuedPrd({
        id: 'foundation',
        frontmatter: { title: 'Foundation', priority: 3 },
      }),
    ];

    const ordered = resolveQueueOrder(prds);
    // Foundation first (wave 0), then feature-b before feature-a (priority)
    expect(ordered.map((p) => p.id)).toEqual(['foundation', 'feature-b', 'feature-a']);
  });

  it('returns all PRDs in queue (all are pending by definition)', () => {
    const prds = [
      makeQueuedPrd({ id: 'a', frontmatter: { title: 'A' } }),
      makeQueuedPrd({ id: 'b', frontmatter: { title: 'B' } }),
    ];

    const ordered = resolveQueueOrder(prds);
    expect(ordered).toHaveLength(2);
  });

  it('returns empty array for empty input', () => {
    expect(resolveQueueOrder([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// movePrdToSubdir
// ---------------------------------------------------------------------------

describe('movePrdToSubdir', () => {
  const makeTempDir = useTempDir('eforge-prd-move-');

  it('moves a PRD file to a subdirectory via filesystem rename (no git commit)', async () => {
    const dir = makeTempDir();
    // Initialize git repo (queue is gitignored)
    execFileSync('git', ['init'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
    writeFileSync(join(dir, '.gitignore'), '.eforge/\n');
    execFileSync('git', ['add', '.gitignore'], { cwd: dir });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: dir });

    const queueDir = join(dir, '.eforge', 'queue');
    mkdirSync(queueDir, { recursive: true });

    const filePath = join(queueDir, 'test-prd.md');
    writeFileSync(filePath, '---\ntitle: Test\n---\n\n# Test\n');

    const initialHash = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir }).toString().trim();

    await movePrdToSubdir(filePath, 'failed', dir);

    expect(existsSync(join(queueDir, 'failed', 'test-prd.md'))).toBe(true);
    expect(existsSync(filePath)).toBe(false);

    // No new commit was created
    const currentHash = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir }).toString().trim();
    expect(currentHash).toBe(initialHash);
  });
});

// ---------------------------------------------------------------------------
// cleanupCompletedPrd — filesystem-only, no git commit
// ---------------------------------------------------------------------------

describe('cleanupCompletedPrd', () => {
  const makeTempDir = useTempDir('eforge-prd-cleanup-');

  it('removes the PRD file via rm and does NOT create a git commit', async () => {
    const dir = makeTempDir();
    execFileSync('git', ['init'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
    writeFileSync(join(dir, '.gitignore'), '.eforge/\n');
    execFileSync('git', ['add', '.gitignore'], { cwd: dir });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: dir });

    const queueDirAbs = join(dir, '.eforge', 'queue');
    mkdirSync(queueDirAbs, { recursive: true });
    const filePath = join(queueDirAbs, 'done.md');
    writeFileSync(filePath, '---\ntitle: Done\n---\n\n# Done\n');

    const initialHash = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir }).toString().trim();

    await cleanupCompletedPrd(filePath, '.eforge/queue', dir);

    expect(existsSync(filePath)).toBe(false);

    // No new commit was created
    const currentHash = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir }).toString().trim();
    expect(currentHash).toBe(initialHash);
  });

  it('throws when filePath is outside the queue directory (path traversal guard)', async () => {
    const dir = makeTempDir();
    const queueDirAbs = join(dir, '.eforge', 'queue');
    mkdirSync(queueDirAbs, { recursive: true });
    const outsidePath = join(dir, 'outside.md');
    writeFileSync(outsidePath, 'unrelated');

    await expect(
      cleanupCompletedPrd(outsidePath, '.eforge/queue', dir),
    ).rejects.toThrow(/outside queue directory/);

    // The "outside" file must still exist (rm was not called)
    expect(existsSync(outsidePath)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// setQueuedPrdProfile — filesystem-only, no git commit
// ---------------------------------------------------------------------------

describe('setQueuedPrdProfile', () => {
  const makeTempDir = useTempDir('eforge-prd-profile-');

  it('appends profile: when absent and does NOT create a git commit', async () => {
    const dir = makeTempDir();
    execFileSync('git', ['init'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
    writeFileSync(join(dir, '.gitignore'), '.eforge/\n');
    execFileSync('git', ['add', '.gitignore'], { cwd: dir });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: dir });

    const queueDirAbs = join(dir, '.eforge', 'queue');
    mkdirSync(queueDirAbs, { recursive: true });
    const filePath = join(queueDirAbs, 'p.md');
    const original = '---\ntitle: P\n---\n\n# P\n\nBody.\n';
    writeFileSync(filePath, original);

    const initialHash = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir }).toString().trim();

    const prd = makeQueuedPrd({
      id: 'p',
      filePath,
      content: original,
      frontmatter: { title: 'P' },
    });

    const result = await setQueuedPrdProfile(prd, 'docs-heavy', dir);

    expect(result.frontmatter.profile).toBe('docs-heavy');
    const written = readFileSync(filePath, 'utf-8');
    expect(written).toContain('profile: docs-heavy');
    expect(written).toContain('# P');
    expect(written).toContain('Body.');

    // No new commit was created
    const currentHash = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir }).toString().trim();
    expect(currentHash).toBe(initialHash);
  });

  it('replaces an existing profile: line in-place without committing', async () => {
    const dir = makeTempDir();
    const queueDirAbs = join(dir, '.eforge', 'queue');
    mkdirSync(queueDirAbs, { recursive: true });
    const filePath = join(queueDirAbs, 'p.md');
    const original = '---\ntitle: P\nprofile: old-profile\n---\n\n# P\n';
    writeFileSync(filePath, original);

    const prd = makeQueuedPrd({
      id: 'p',
      filePath,
      content: original,
      frontmatter: { title: 'P', profile: 'old-profile' },
    });

    const result = await setQueuedPrdProfile(prd, 'new-profile', dir);

    expect(result.frontmatter.profile).toBe('new-profile');
    const written = readFileSync(filePath, 'utf-8');
    expect(written).toContain('profile: new-profile');
    expect(written).not.toContain('old-profile');
    // Exactly one profile: line
    const matches = written.match(/^profile\s*:/gm);
    expect(matches?.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// isPrdRunning
// ---------------------------------------------------------------------------

describe('isPrdRunning', () => {
  const makeTempDir = useTempDir('eforge-prd-running-');

  it('returns false when no lock file exists', async () => {
    const dir = makeTempDir();
    expect(await isPrdRunning('test', dir)).toBe(false);
  });

  it('returns true when lock file exists', async () => {
    const dir = makeTempDir();
    const lockDir = join(dir, '.eforge', 'queue-locks');
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(join(lockDir, 'test.lock'), String(process.pid));

    expect(await isPrdRunning('test', dir)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// claimPrd / releasePrd
// ---------------------------------------------------------------------------

describe('claimPrd', () => {
  const makeTempDir = useTempDir('eforge-prd-claim-');

  it('returns true on first call and creates .lock file', async () => {
    const dir = makeTempDir();
    const prdId = 'test';

    const result = await claimPrd(prdId, dir);
    expect(result).toBe(true);
    expect(existsSync(join(dir, '.eforge', 'queue-locks', `${prdId}.lock`))).toBe(true);
  });

  it('returns false on second call for the same prdId', async () => {
    const dir = makeTempDir();
    const prdId = 'test';

    const first = await claimPrd(prdId, dir);
    expect(first).toBe(true);

    const second = await claimPrd(prdId, dir);
    expect(second).toBe(false);
  });

  it('returns false when lock file contains a dead PID (stale-lock cleanup is the reconciler\'s job, not claimPrd\'s)', async () => {
    const dir = makeTempDir();
    const prdId = 'test';
    const lockPath = join(dir, '.eforge', 'queue-locks', `${prdId}.lock`);

    const deadPid = makeDeadPid();
    mkdirSync(join(dir, '.eforge', 'queue-locks'), { recursive: true });
    writeFileSync(lockPath, String(deadPid));

    // claimPrd treats any existing lock as held. The daemon's startup
    // reconciler is responsible for sweeping dead-PID locks.
    const result = await claimPrd(prdId, dir);
    expect(result).toBe(false);

    // Lock file is untouched by claimPrd
    const lockContent = readFileSync(lockPath, 'utf-8');
    expect(lockContent).toBe(String(deadPid));
  });

  it('returns false when lock file contains a live PID', async () => {
    const dir = makeTempDir();
    const prdId = 'test';
    const lockPath = join(dir, '.eforge', 'queue-locks', `${prdId}.lock`);

    // Write a lock file with the current (alive) process PID
    mkdirSync(join(dir, '.eforge', 'queue-locks'), { recursive: true });
    writeFileSync(lockPath, String(process.pid));

    const result = await claimPrd(prdId, dir);
    expect(result).toBe(false);
  });

  it('returns false when lock file contains invalid content', async () => {
    const dir = makeTempDir();
    const prdId = 'test';
    const lockPath = join(dir, '.eforge', 'queue-locks', `${prdId}.lock`);

    // Write a lock file with non-numeric content
    mkdirSync(join(dir, '.eforge', 'queue-locks'), { recursive: true });
    writeFileSync(lockPath, 'not-a-pid');

    const result = await claimPrd(prdId, dir);
    expect(result).toBe(false);
  });

  it('returns false when lock file is empty', async () => {
    const dir = makeTempDir();
    const prdId = 'test';
    const lockPath = join(dir, '.eforge', 'queue-locks', `${prdId}.lock`);

    // Write an empty lock file
    mkdirSync(join(dir, '.eforge', 'queue-locks'), { recursive: true });
    writeFileSync(lockPath, '');

    const result = await claimPrd(prdId, dir);
    expect(result).toBe(false);
  });

  it('succeeds again after releasePrd', async () => {
    const dir = makeTempDir();
    const prdId = 'test';

    await claimPrd(prdId, dir);
    await releasePrd(prdId, dir);

    const result = await claimPrd(prdId, dir);
    expect(result).toBe(true);
  });
});

describe('releasePrd', () => {
  const makeTempDir = useTempDir('eforge-prd-release-');

  it('removes the .lock file', async () => {
    const dir = makeTempDir();
    const prdId = 'test';
    const lockPath = join(dir, '.eforge', 'queue-locks', `${prdId}.lock`);

    await claimPrd(prdId, dir);
    expect(existsSync(lockPath)).toBe(true);

    await releasePrd(prdId, dir);
    expect(existsSync(lockPath)).toBe(false);
  });

  it('does not throw when lock file is already gone', async () => {
    const dir = makeTempDir();
    const prdId = 'nonexistent';

    // Should not throw even though there's no lock file
    await expect(releasePrd(prdId, dir)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// readPrdLockStatus
// ---------------------------------------------------------------------------

describe('readPrdLockStatus', () => {
  const makeTempDir = useTempDir('eforge-prd-lock-status-');

  it('returns absent when no lock file exists', async () => {
    const dir = makeTempDir();
    const result = await readPrdLockStatus('nonexistent', dir);
    expect(result).toEqual({ state: 'absent' });
  });

  it('returns live with current process pid when lock contains the current pid', async () => {
    const dir = makeTempDir();
    const lockDir = join(dir, '.eforge', 'queue-locks');
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(join(lockDir, 'test.lock'), String(process.pid));

    const result = await readPrdLockStatus('test', dir);
    expect(result).toEqual({ state: 'live', pid: process.pid });
  });

  it('returns stale with pid for a dead positive pid', async () => {
    const dir = makeTempDir();
    const lockDir = join(dir, '.eforge', 'queue-locks');
    mkdirSync(lockDir, { recursive: true });
    const deadPid = makeDeadPid();
    writeFileSync(join(lockDir, 'test.lock'), String(deadPid));

    const result = await readPrdLockStatus('test', dir);
    expect(result).toEqual({ state: 'stale', pid: deadPid });
  });

  it('returns corrupt for empty content', async () => {
    const dir = makeTempDir();
    const lockDir = join(dir, '.eforge', 'queue-locks');
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(join(lockDir, 'test.lock'), '');

    const result = await readPrdLockStatus('test', dir);
    expect(result).toEqual({ state: 'corrupt' });
  });

  it('returns corrupt for non-numeric content', async () => {
    const dir = makeTempDir();
    const lockDir = join(dir, '.eforge', 'queue-locks');
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(join(lockDir, 'test.lock'), 'not-a-pid');

    const result = await readPrdLockStatus('test', dir);
    expect(result).toEqual({ state: 'corrupt' });
  });

  it('returns corrupt for non-decimal numeric content', async () => {
    const dir = makeTempDir();
    const lockDir = join(dir, '.eforge', 'queue-locks');
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(join(lockDir, 'test.lock'), '0x10');

    const result = await readPrdLockStatus('test', dir);
    expect(result).toEqual({ state: 'corrupt' });
  });

  it('returns corrupt for a non-positive (zero) pid', async () => {
    const dir = makeTempDir();
    const lockDir = join(dir, '.eforge', 'queue-locks');
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(join(lockDir, 'test.lock'), '0');

    const result = await readPrdLockStatus('test', dir);
    expect(result).toEqual({ state: 'corrupt' });
  });

  it('returns corrupt for a negative pid', async () => {
    const dir = makeTempDir();
    const lockDir = join(dir, '.eforge', 'queue-locks');
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(join(lockDir, 'test.lock'), '-1');

    const result = await readPrdLockStatus('test', dir);
    expect(result).toEqual({ state: 'corrupt' });
  });

  it('returns corrupt for a non-integer (float) pid', async () => {
    const dir = makeTempDir();
    const lockDir = join(dir, '.eforge', 'queue-locks');
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(join(lockDir, 'test.lock'), '3.14');

    const result = await readPrdLockStatus('test', dir);
    expect(result).toEqual({ state: 'corrupt' });
  });

  it('returns corrupt for a non-finite pid', async () => {
    const dir = makeTempDir();
    const lockDir = join(dir, '.eforge', 'queue-locks');
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(join(lockDir, 'test.lock'), 'Infinity');

    const result = await readPrdLockStatus('test', dir);
    expect(result).toEqual({ state: 'corrupt' });
  });

  it('claimPrd still returns false for dead-pid, invalid, and empty locks', async () => {
    const dir = makeTempDir();
    const lockDir = join(dir, '.eforge', 'queue-locks');
    mkdirSync(lockDir, { recursive: true });

    // Dead pid: claimPrd must return false and leave file untouched
    const deadPid = makeDeadPid();
    writeFileSync(join(lockDir, 'dead.lock'), String(deadPid));
    expect(await claimPrd('dead', dir)).toBe(false);
    expect(readFileSync(join(lockDir, 'dead.lock'), 'utf-8')).toBe(String(deadPid));

    // Invalid content: claimPrd must return false and leave file untouched
    writeFileSync(join(lockDir, 'invalid.lock'), 'bad-content');
    expect(await claimPrd('invalid', dir)).toBe(false);
    expect(readFileSync(join(lockDir, 'invalid.lock'), 'utf-8')).toBe('bad-content');

    // Empty: claimPrd must return false and leave file untouched
    writeFileSync(join(lockDir, 'empty.lock'), '');
    expect(await claimPrd('empty', dir)).toBe(false);
    expect(readFileSync(join(lockDir, 'empty.lock'), 'utf-8')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Queue-control helpers (priority + removal)
// ---------------------------------------------------------------------------

describe('queue-control helpers', () => {
  const makeTempDir = useTempDir('eforge-prd-control-');

  function queueRoot(dir: string): string {
    return join(dir, '.eforge', 'queue');
  }

  function writePrdFile(
    dir: string,
    sub: '' | 'waiting' | 'failed' | 'skipped',
    id: string,
    frontmatterExtra = '',
    body = 'Original body text.',
  ): string {
    const targetDir = sub ? join(queueRoot(dir), sub) : queueRoot(dir);
    mkdirSync(targetDir, { recursive: true });
    const filePath = join(targetDir, `${id}.md`);
    writeFileSync(filePath, `---\ntitle: ${id}${frontmatterExtra}\n---\n\n# ${id}\n\n${body}\n`);
    return filePath;
  }

  function writeLock(dir: string, id: string, content: string): string {
    const lockDir = join(dir, '.eforge', 'queue-locks');
    mkdirSync(lockDir, { recursive: true });
    const lockPath = join(lockDir, `${id}.lock`);
    writeFileSync(lockPath, content);
    return lockPath;
  }

  async function expectKind(promise: Promise<unknown>, kind: string): Promise<Error> {
    let caught: unknown;
    try { await promise; } catch (err) { caught = err; }
    expect(isQueueControlError(caught)).toBe(true);
    expect((caught as { kind: string }).kind).toBe(kind);
    return caught as Error;
  }

  it('classifies a root PRD as pending (absent lock) and running (live lock)', async () => {
    const dir = makeTempDir();
    const queueDir = queueRoot(dir);
    writePrdFile(dir, '', 'p');

    const pending = await findQueuedPrdForControl({ cwd: dir, queueDir, prdId: 'p' });
    expect(pending.status).toBe('pending');
    expect(pending.location).toBe('queue');

    writeLock(dir, 'p', String(process.pid));
    const running = await findQueuedPrdForControl({ cwd: dir, queueDir, prdId: 'p' });
    expect(running.status).toBe('running');
  });

  it('sets priority on a pending root PRD, preserving body and unrelated frontmatter', async () => {
    const dir = makeTempDir();
    const queueDir = queueRoot(dir);
    const filePath = writePrdFile(dir, '', 'p', '\ndepends_on: [other]\nprofile: careful', 'Keep this body.');

    const result = await updateQueuedPrdPriority({ cwd: dir, queueDir, prdId: 'p', priority: 5 });
    expect(result).toEqual({ id: 'p', previousStatus: 'pending', currentStatus: 'pending', priority: 5 });

    const written = readFileSync(filePath, 'utf-8');
    expect(written).toContain('priority: 5');
    expect(written).toContain('Keep this body.');
    expect(written).toContain('profile: careful');
    expect(written).toContain('depends_on: [other]');
  });

  it('sets priority on a waiting PRD', async () => {
    const dir = makeTempDir();
    const queueDir = queueRoot(dir);
    const filePath = writePrdFile(dir, 'waiting', 'w');

    const result = await updateQueuedPrdPriority({ cwd: dir, queueDir, prdId: 'w', priority: 9 });
    expect(result).toEqual({ id: 'w', previousStatus: 'waiting', currentStatus: 'waiting', priority: 9 });
    expect(readFileSync(filePath, 'utf-8')).toContain('priority: 9');
  });

  it('rejects non-integer priority before touching the file', async () => {
    const dir = makeTempDir();
    const queueDir = queueRoot(dir);
    const filePath = writePrdFile(dir, '', 'p');
    const before = readFileSync(filePath, 'utf-8');

    await expectKind(updateQueuedPrdPriority({ cwd: dir, queueDir, prdId: 'p', priority: 1.5 }), 'validation');
    await expectKind(updateQueuedPrdPriority({ cwd: dir, queueDir, prdId: 'p', priority: Infinity }), 'validation');
    expect(readFileSync(filePath, 'utf-8')).toBe(before);
  });

  it('returns not-found for ids absent from all queue locations', async () => {
    const dir = makeTempDir();
    const queueDir = queueRoot(dir);
    mkdirSync(queueDir, { recursive: true });
    await expectKind(updateQueuedPrdPriority({ cwd: dir, queueDir, prdId: 'missing', priority: 1 }), 'not-found');
    await expectKind(removeQueuedPrd({ cwd: dir, queueDir, prdId: 'missing' }), 'not-found');
  });

  it('rejects priority change for a live running PRD and leaves the file unchanged', async () => {
    const dir = makeTempDir();
    const queueDir = queueRoot(dir);
    const filePath = writePrdFile(dir, '', 'p');
    const lockPath = writeLock(dir, 'p', String(process.pid));
    const before = readFileSync(filePath, 'utf-8');

    const err = await expectKind(updateQueuedPrdPriority({ cwd: dir, queueDir, prdId: 'p', priority: 5 }), 'conflict');
    expect(err.message).toMatch(/running/);
    expect(err.message).toMatch(/cancel/);
    expect(readFileSync(filePath, 'utf-8')).toBe(before);
    expect(existsSync(lockPath)).toBe(true);
  });

  it('rejects priority change for failed and skipped PRDs and leaves files plus sidecars unchanged', async () => {
    const dir = makeTempDir();
    const queueDir = queueRoot(dir);
    const failedPath = writePrdFile(dir, 'failed', 'f');
    const skippedPath = writePrdFile(dir, 'skipped', 's');
    const sidecarPath = join(queueDir, 'failed', 'f.recovery.json');
    writeFileSync(sidecarPath, '{"verdict":"manual"}');

    await expectKind(updateQueuedPrdPriority({ cwd: dir, queueDir, prdId: 'f', priority: 2 }), 'conflict');
    await expectKind(updateQueuedPrdPriority({ cwd: dir, queueDir, prdId: 's', priority: 2 }), 'conflict');

    expect(readFileSync(failedPath, 'utf-8')).not.toContain('priority: 2');
    expect(readFileSync(skippedPath, 'utf-8')).not.toContain('priority: 2');
    expect(existsSync(sidecarPath)).toBe(true);
  });

  it('removes pending, waiting, failed, and skipped PRD files', async () => {
    const dir = makeTempDir();
    const queueDir = queueRoot(dir);
    const cases: Array<['' | 'waiting' | 'failed' | 'skipped', string, string]> = [
      ['', 'p', 'pending'],
      ['waiting', 'w', 'waiting'],
      ['failed', 'f', 'failed'],
      ['skipped', 's', 'skipped'],
    ];
    for (const [sub, id, previousStatus] of cases) {
      const filePath = writePrdFile(dir, sub, id);
      const result = await removeQueuedPrd({ cwd: dir, queueDir, prdId: id });
      expect(result).toEqual({ id, previousStatus, currentStatus: 'removed', removedSidecars: [] });
      expect(existsSync(filePath)).toBe(false);
    }
  });

  it('removes a failed PRD and its recovery sidecars, reporting queue-relative paths', async () => {
    const dir = makeTempDir();
    const queueDir = queueRoot(dir);
    const filePath = writePrdFile(dir, 'failed', 'f');
    const failedDir = join(queueDir, 'failed');
    writeFileSync(join(failedDir, 'f.recovery.md'), '# recovery');
    writeFileSync(join(failedDir, 'f.recovery.json'), '{}');

    const result = await removeQueuedPrd({ cwd: dir, queueDir, prdId: 'f' });
    expect(result.currentStatus).toBe('removed');
    expect([...result.removedSidecars].sort()).toEqual(['failed/f.recovery.json', 'failed/f.recovery.md']);
    expect(existsSync(filePath)).toBe(false);
    expect(existsSync(join(failedDir, 'f.recovery.md'))).toBe(false);
    expect(existsSync(join(failedDir, 'f.recovery.json'))).toBe(false);
  });

  it('refuses to remove a live running PRD and leaves the file and lock in place', async () => {
    const dir = makeTempDir();
    const queueDir = queueRoot(dir);
    const filePath = writePrdFile(dir, '', 'p');
    const lockPath = writeLock(dir, 'p', String(process.pid));

    const err = await expectKind(removeQueuedPrd({ cwd: dir, queueDir, prdId: 'p' }), 'conflict');
    expect(err.message).toMatch(/running/);
    expect(existsSync(filePath)).toBe(true);
    expect(existsSync(lockPath)).toBe(true);
  });

  it('removes a stale root lock before deleting the PRD file', async () => {
    const dir = makeTempDir();
    const queueDir = queueRoot(dir);
    const filePath = writePrdFile(dir, '', 'p');
    const lockPath = writeLock(dir, 'p', String(makeDeadPid()));

    const result = await removeQueuedPrd({ cwd: dir, queueDir, prdId: 'p' });
    expect(result.currentStatus).toBe('removed');
    expect(existsSync(filePath)).toBe(false);
    expect(existsSync(lockPath)).toBe(false);
  });

  it('removes a corrupt root lock before deleting the PRD file', async () => {
    const dir = makeTempDir();
    const queueDir = queueRoot(dir);
    const filePath = writePrdFile(dir, '', 'p');
    const lockPath = writeLock(dir, 'p', 'not-a-pid');

    const result = await removeQueuedPrd({ cwd: dir, queueDir, prdId: 'p' });
    expect(result.currentStatus).toBe('removed');
    expect(existsSync(filePath)).toBe(false);
    expect(existsSync(lockPath)).toBe(false);
  });

  it('refuses removal when a live root or waiting dependent lists the target and leaves files in place', async () => {
    const dir = makeTempDir();
    const queueDir = queueRoot(dir);
    const basePath = writePrdFile(dir, '', 'base');
    const rootDepPath = writePrdFile(dir, '', 'root-dep', '\ndepends_on: [base]');
    const waitingDepPath = writePrdFile(dir, 'waiting', 'waiting-dep', '\ndepends_on: [base]');

    const err = await expectKind(removeQueuedPrd({ cwd: dir, queueDir, prdId: 'base' }), 'conflict');
    expect(err.message).toContain('root-dep');
    expect(err.message).toContain('waiting-dep');
    expect(existsSync(basePath)).toBe(true);
    expect(existsSync(rootDepPath)).toBe(true);
    expect(existsSync(waitingDepPath)).toBe(true);
  });

  it('overrides one dependency on a pending PRD and preserves remaining dependencies', async () => {
    const dir = makeTempDir();
    const queueDir = queueRoot(dir);
    const filePath = writePrdFile(dir, '', 'p', '\ndepends_on: [base, other]\nprofile: careful', 'Keep this body.');

    const result = await overrideQueuedPrdDependency({ cwd: dir, queueDir, prdId: 'p', dependencyId: 'base' });
    expect(result).toEqual({
      id: 'p',
      title: 'p',
      previousStatus: 'pending',
      currentStatus: 'pending',
      removedDependency: 'base',
      previousDependsOn: ['base', 'other'],
      currentDependsOn: ['other'],
      movedToQueueRoot: false,
    });

    const written = readFileSync(filePath, 'utf-8');
    expect(written).toContain('depends_on: ["other"]');
    expect(written).toContain('profile: careful');
    expect(written).toContain('Keep this body.');
  });

  it('moves a waiting PRD to the queue root when its last dependency is overridden', async () => {
    const dir = makeTempDir();
    const queueDir = queueRoot(dir);
    const waitingPath = writePrdFile(dir, 'waiting', 'w', '\ndepends_on: [base]', 'Waiting body.');
    const rootPath = join(queueDir, 'w.md');

    const result = await overrideQueuedPrdDependency({ cwd: dir, queueDir, prdId: 'w', dependencyId: 'base' });
    expect(result).toMatchObject({
      id: 'w',
      previousStatus: 'waiting',
      currentStatus: 'pending',
      currentDependsOn: [],
      movedToQueueRoot: true,
    });
    expect(existsSync(waitingPath)).toBe(false);
    expect(existsSync(rootPath)).toBe(true);
    expect(readFileSync(rootPath, 'utf-8')).toContain('depends_on: []');
  });

  it('keeps a waiting PRD in waiting when dependency overrides leave remaining blockers', async () => {
    const dir = makeTempDir();
    const queueDir = queueRoot(dir);
    const waitingPath = writePrdFile(dir, 'waiting', 'w2', '\ndepends_on: [base, other]');

    const result = await overrideQueuedPrdDependency({ cwd: dir, queueDir, prdId: 'w2', dependencyId: 'base' });
    expect(result).toMatchObject({
      previousStatus: 'waiting',
      currentStatus: 'waiting',
      currentDependsOn: ['other'],
      movedToQueueRoot: false,
    });
    expect(existsSync(waitingPath)).toBe(true);
    expect(existsSync(join(queueDir, 'w2.md'))).toBe(false);
    expect(readFileSync(waitingPath, 'utf-8')).toContain('depends_on: ["other"]');
  });

  it('rejects dependency overrides for running, terminal, missing dependency, and unsafe ids', async () => {
    const dir = makeTempDir();
    const queueDir = queueRoot(dir);
    writePrdFile(dir, '', 'running', '\ndepends_on: [base]');
    writeLock(dir, 'running', String(process.pid));
    writePrdFile(dir, 'failed', 'failed', '\ndepends_on: [base]');
    writePrdFile(dir, '', 'pending', '\ndepends_on: [base]');

    await expectKind(overrideQueuedPrdDependency({ cwd: dir, queueDir, prdId: 'running', dependencyId: 'base' }), 'conflict');
    await expectKind(overrideQueuedPrdDependency({ cwd: dir, queueDir, prdId: 'failed', dependencyId: 'base' }), 'conflict');
    await expectKind(overrideQueuedPrdDependency({ cwd: dir, queueDir, prdId: 'pending', dependencyId: 'missing' }), 'conflict');
    await expectKind(overrideQueuedPrdDependency({ cwd: dir, queueDir, prdId: 'pending', dependencyId: '../base' }), 'validation');
  });
});
