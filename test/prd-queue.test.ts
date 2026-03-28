import { describe, it, expect } from 'vitest';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { validatePrdFrontmatter, resolveQueueOrder, updatePrdStatus, claimPrd, releasePrd, type QueuedPrd } from '../src/engine/prd-queue.js';
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

// ---------------------------------------------------------------------------
// Frontmatter Validation
// ---------------------------------------------------------------------------

describe('validatePrdFrontmatter', () => {
  it('accepts valid frontmatter with all fields', () => {
    const result = validatePrdFrontmatter({
      title: 'Add user auth',
      created: '2026-01-15',
      priority: 1,
      status: 'pending',
      depends_on: ['setup-db'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe('Add user auth');
      expect(result.data.priority).toBe(1);
      expect(result.data.status).toBe('pending');
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

  it('rejects frontmatter with invalid status', () => {
    const result = validatePrdFrontmatter({
      title: 'Bad status',
      status: 'in-progress',
    });
    expect(result.success).toBe(false);
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

  it('accepts all valid status values', () => {
    for (const status of ['pending', 'running', 'completed', 'failed', 'skipped']) {
      const result = validatePrdFrontmatter({ title: 'Test', status });
      expect(result.success).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Queue Ordering
// ---------------------------------------------------------------------------

describe('resolveQueueOrder', () => {
  it('sorts by priority ascending (lower = higher priority)', () => {
    const prds = [
      makeQueuedPrd({ id: 'low', frontmatter: { title: 'Low', priority: 3, status: 'pending' } }),
      makeQueuedPrd({ id: 'high', frontmatter: { title: 'High', priority: 1, status: 'pending' } }),
      makeQueuedPrd({ id: 'mid', frontmatter: { title: 'Mid', priority: 2, status: 'pending' } }),
    ];

    const ordered = resolveQueueOrder(prds);
    expect(ordered.map((p) => p.id)).toEqual(['high', 'mid', 'low']);
  });

  it('respects dependency waves - dependents come after dependencies', () => {
    const prds = [
      makeQueuedPrd({
        id: 'api',
        frontmatter: { title: 'API', status: 'pending', depends_on: ['db'] },
      }),
      makeQueuedPrd({
        id: 'db',
        frontmatter: { title: 'Database', status: 'pending' },
      }),
    ];

    const ordered = resolveQueueOrder(prds);
    expect(ordered.map((p) => p.id)).toEqual(['db', 'api']);
  });

  it('handles priority + deps combined - deps first, then priority within wave', () => {
    const prds = [
      makeQueuedPrd({
        id: 'feature-b',
        frontmatter: { title: 'Feature B', priority: 1, status: 'pending', depends_on: ['foundation'] },
      }),
      makeQueuedPrd({
        id: 'feature-a',
        frontmatter: { title: 'Feature A', priority: 2, status: 'pending', depends_on: ['foundation'] },
      }),
      makeQueuedPrd({
        id: 'foundation',
        frontmatter: { title: 'Foundation', priority: 3, status: 'pending' },
      }),
    ];

    const ordered = resolveQueueOrder(prds);
    // Foundation first (wave 0), then feature-b before feature-a (priority)
    expect(ordered.map((p) => p.id)).toEqual(['foundation', 'feature-b', 'feature-a']);
  });

  it('filters to only pending PRDs', () => {
    const prds = [
      makeQueuedPrd({ id: 'done', frontmatter: { title: 'Done', status: 'completed' } }),
      makeQueuedPrd({ id: 'todo', frontmatter: { title: 'Todo', status: 'pending' } }),
      makeQueuedPrd({ id: 'skip', frontmatter: { title: 'Skip', status: 'skipped' } }),
    ];

    const ordered = resolveQueueOrder(prds);
    expect(ordered).toHaveLength(1);
    expect(ordered[0].id).toBe('todo');
  });

  it('returns empty array when no pending PRDs', () => {
    const prds = [
      makeQueuedPrd({ id: 'done', frontmatter: { title: 'Done', status: 'completed' } }),
    ];
    expect(resolveQueueOrder(prds)).toEqual([]);
  });

  it('treats PRDs without status as pending', () => {
    const prds = [
      makeQueuedPrd({ id: 'no-status', frontmatter: { title: 'No Status' } }),
    ];

    const ordered = resolveQueueOrder(prds);
    expect(ordered).toHaveLength(1);
    expect(ordered[0].id).toBe('no-status');
  });

  it('filters out dependencies referencing non-pending PRDs', () => {
    const prds = [
      makeQueuedPrd({ id: 'completed-dep', frontmatter: { title: 'Completed', status: 'completed' } }),
      makeQueuedPrd({
        id: 'feature',
        frontmatter: { title: 'Feature', status: 'pending', depends_on: ['completed-dep'] },
      }),
    ];

    // completed-dep is not pending, so feature's dependency on it should be filtered out
    const ordered = resolveQueueOrder(prds);
    expect(ordered).toHaveLength(1);
    expect(ordered[0].id).toBe('feature');
  });
});

// ---------------------------------------------------------------------------
// updatePrdStatus
// ---------------------------------------------------------------------------

describe('updatePrdStatus', () => {
  const makeTempDir = useTempDir('eforge-prd-status-');

  it('replaces existing status line', async () => {
    const dir = makeTempDir();
    const filePath = join(dir, 'test.md');
    writeFileSync(filePath, '---\ntitle: Test\nstatus: pending\n---\n\n# Test\n');

    await updatePrdStatus(filePath, 'completed');

    const content = readFileSync(filePath, 'utf-8');
    expect(content).toContain('status: completed');
    expect(content).not.toContain('status: pending');
  });

  it('inserts status when absent', async () => {
    const dir = makeTempDir();
    const filePath = join(dir, 'test.md');
    writeFileSync(filePath, '---\ntitle: Test\n---\n\n# Test\n');

    await updatePrdStatus(filePath, 'running');

    const content = readFileSync(filePath, 'utf-8');
    expect(content).toContain('status: running');
    // Should still have valid frontmatter structure
    expect(content).toMatch(/^---\n/);
    expect(content).toMatch(/\n---\n/);
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

  it('returns true and re-acquires when lock file contains a dead PID', async () => {
    const dir = makeTempDir();
    const prdId = 'test';
    const lockPath = join(dir, '.eforge', 'queue-locks', `${prdId}.lock`);

    // Write a lock file with a PID that does not exist
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(dir, '.eforge', 'queue-locks'), { recursive: true });
    writeFileSync(lockPath, '999999');

    const result = await claimPrd(prdId, dir);
    expect(result).toBe(true);

    // Lock file should now contain our PID
    const lockContent = readFileSync(lockPath, 'utf-8');
    expect(lockContent).toBe(String(process.pid));
  });

  it('returns false when lock file contains a live PID', async () => {
    const dir = makeTempDir();
    const prdId = 'test';
    const lockPath = join(dir, '.eforge', 'queue-locks', `${prdId}.lock`);

    // Write a lock file with the current (alive) process PID
    const { mkdirSync } = await import('node:fs');
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
    const { mkdirSync } = await import('node:fs');
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
    const { mkdirSync } = await import('node:fs');
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
