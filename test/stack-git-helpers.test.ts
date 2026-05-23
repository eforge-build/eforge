import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { useTempDir } from './test-tmpdir.js';
import { branchExists, refExists, getRefSha } from '@eforge-build/engine/worktree-ops';

const exec = promisify(execFile);

/**
 * Initialize a minimal git repository with an initial commit on 'main'.
 * Returns the absolute path to the repo root.
 */
async function initRepo(baseDir: string): Promise<string> {
  const repoRoot = join(baseDir, 'repo');
  await exec('git', ['init', repoRoot]);
  await exec('git', ['config', 'user.email', 'test@test.com'], { cwd: repoRoot });
  await exec('git', ['config', 'user.name', 'Test'], { cwd: repoRoot });
  writeFileSync(join(repoRoot, 'README.md'), '# init\n');
  await exec('git', ['add', '.'], { cwd: repoRoot });
  await exec('git', ['commit', '-m', 'initial commit'], { cwd: repoRoot });
  await exec('git', ['branch', '-M', 'main'], { cwd: repoRoot });
  return repoRoot;
}

describe('branchExists', () => {
  const makeTempDir = useTempDir('eforge-branch-');

  it('returns true for an existing local branch', async () => {
    const baseDir = makeTempDir();
    const repoRoot = await initRepo(baseDir);
    const result = await branchExists(repoRoot, 'main');
    expect(result).toBe(true);
  });

  it('returns false for a branch that does not exist', async () => {
    const baseDir = makeTempDir();
    const repoRoot = await initRepo(baseDir);
    const result = await branchExists(repoRoot, 'nonexistent-branch');
    expect(result).toBe(false);
  });

  it('returns true after creating a branch', async () => {
    const baseDir = makeTempDir();
    const repoRoot = await initRepo(baseDir);
    await exec('git', ['branch', 'feature/my-work'], { cwd: repoRoot });
    const result = await branchExists(repoRoot, 'feature/my-work');
    expect(result).toBe(true);
  });

  it('returns false after deleting a branch', async () => {
    const baseDir = makeTempDir();
    const repoRoot = await initRepo(baseDir);
    await exec('git', ['branch', 'to-delete'], { cwd: repoRoot });
    await exec('git', ['branch', '-D', 'to-delete'], { cwd: repoRoot });
    const result = await branchExists(repoRoot, 'to-delete');
    expect(result).toBe(false);
  });
});

describe('refExists', () => {
  const makeTempDir = useTempDir('eforge-ref-');

  it('returns true for an existing branch ref', async () => {
    const baseDir = makeTempDir();
    const repoRoot = await initRepo(baseDir);
    const result = await refExists(repoRoot, 'main');
    expect(result).toBe(true);
  });

  it('returns true for HEAD', async () => {
    const baseDir = makeTempDir();
    const repoRoot = await initRepo(baseDir);
    const result = await refExists(repoRoot, 'HEAD');
    expect(result).toBe(true);
  });

  it('returns true for a valid commit SHA', async () => {
    const baseDir = makeTempDir();
    const repoRoot = await initRepo(baseDir);
    const { stdout } = await exec('git', ['rev-parse', 'HEAD'], { cwd: repoRoot });
    const sha = stdout.trim();
    const result = await refExists(repoRoot, sha);
    expect(result).toBe(true);
  });

  it('returns false for a nonexistent ref', async () => {
    const baseDir = makeTempDir();
    const repoRoot = await initRepo(baseDir);
    const result = await refExists(repoRoot, 'refs/heads/does-not-exist');
    expect(result).toBe(false);
  });

  it('returns false for a nonexistent short SHA', async () => {
    const baseDir = makeTempDir();
    const repoRoot = await initRepo(baseDir);
    const result = await refExists(repoRoot, 'deadbeef0000');
    expect(result).toBe(false);
  });
});

describe('getRefSha', () => {
  const makeTempDir = useTempDir('eforge-sha-');

  it('returns the full SHA for HEAD', async () => {
    const baseDir = makeTempDir();
    const repoRoot = await initRepo(baseDir);
    const { stdout } = await exec('git', ['rev-parse', 'HEAD'], { cwd: repoRoot });
    const expected = stdout.trim();
    const result = await getRefSha(repoRoot, 'HEAD');
    expect(result).toBe(expected);
  });

  it('returns the full SHA for a branch name', async () => {
    const baseDir = makeTempDir();
    const repoRoot = await initRepo(baseDir);
    const { stdout } = await exec('git', ['rev-parse', 'main'], { cwd: repoRoot });
    const expected = stdout.trim();
    const result = await getRefSha(repoRoot, 'main');
    expect(result).toBe(expected);
  });

  it('returns a 40-character hex string', async () => {
    const baseDir = makeTempDir();
    const repoRoot = await initRepo(baseDir);
    const sha = await getRefSha(repoRoot, 'HEAD');
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it('SHA for HEAD and main point to the same commit after init', async () => {
    const baseDir = makeTempDir();
    const repoRoot = await initRepo(baseDir);
    const headSha = await getRefSha(repoRoot, 'HEAD');
    const mainSha = await getRefSha(repoRoot, 'main');
    expect(headSha).toBe(mainSha);
  });

  it('throws when ref does not exist', async () => {
    const baseDir = makeTempDir();
    const repoRoot = await initRepo(baseDir);
    await expect(getRefSha(repoRoot, 'refs/heads/nonexistent')).rejects.toThrow();
  });

  it('peels annotated tags to the tagged commit SHA', async () => {
    const baseDir = makeTempDir();
    const repoRoot = await initRepo(baseDir);
    await exec('git', ['tag', '-a', 'v1.0.0', '-m', 'version 1.0.0'], { cwd: repoRoot });
    const { stdout } = await exec('git', ['rev-parse', 'HEAD'], { cwd: repoRoot });
    const expected = stdout.trim();

    const result = await getRefSha(repoRoot, 'v1.0.0');
    expect(result).toBe(expected);
  });

  it('returns different SHAs for different commits', async () => {
    const baseDir = makeTempDir();
    const repoRoot = await initRepo(baseDir);
    const firstSha = await getRefSha(repoRoot, 'HEAD');

    // Make a second commit
    writeFileSync(join(repoRoot, 'second.txt'), 'second\n');
    await exec('git', ['add', '.'], { cwd: repoRoot });
    await exec('git', ['commit', '-m', 'second commit'], { cwd: repoRoot });

    const secondSha = await getRefSha(repoRoot, 'HEAD');
    expect(secondSha).not.toBe(firstSha);
  });
});
