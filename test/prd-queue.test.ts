import { describe, it, expect } from 'vitest';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { validatePrdFrontmatter, resolveQueueOrder, claimPrd, releasePrd, movePrdToSubdir, isPrdRunning, readPrdLockStatus, type QueuedPrd } from '@eforge-build/engine/prd-queue';
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

  it('moves a PRD file to a subdirectory via git mv', async () => {
    const dir = makeTempDir();
    // Initialize git repo
    execFileSync('git', ['init'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });

    const queueDir = join(dir, 'eforge', 'queue');
    mkdirSync(queueDir, { recursive: true });

    const filePath = join(queueDir, 'test-prd.md');
    writeFileSync(filePath, '---\ntitle: Test\n---\n\n# Test\n');
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: dir });

    await movePrdToSubdir(filePath, 'failed', dir);

    expect(existsSync(join(queueDir, 'failed', 'test-prd.md'))).toBe(true);
    expect(existsSync(filePath)).toBe(false);
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
