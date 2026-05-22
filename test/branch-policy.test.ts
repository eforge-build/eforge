import { describe, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { resolveTrunkBranch, isTrunkBranch } from '@eforge-build/engine/branch-policy';
import type { EforgeConfig } from '@eforge-build/engine/config';

const exec = promisify(execFile);

describe('resolveTrunkBranch', () => {
  it('returns configured trunkBranch without spawning git', async () => {
    const config = { build: { trunkBranch: 'develop' } } as Pick<EforgeConfig, 'build'>;
    // Use a non-existent path to prove no git I/O happens
    const result = await resolveTrunkBranch(config, '/nonexistent/__eforge_test__');
    expect(result).toBe('develop');
  });

  it('returns branch derived from origin/HEAD when config has no trunkBranch', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'eforge-branch-policy-'));
    try {
      await exec('git', ['init'], { cwd: tmpDir });
      // Create a fake origin/HEAD pointing to origin/dev
      await exec('git', ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/dev'], { cwd: tmpDir });
      const result = await resolveTrunkBranch(undefined, tmpDir);
      expect(result).toBe('dev');
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  it('returns "main" when no origin/HEAD is set', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'eforge-branch-policy-fallback-'));
    try {
      await exec('git', ['init'], { cwd: tmpDir });
      // No origin/HEAD — git symbolic-ref will fail
      const result = await resolveTrunkBranch(undefined, tmpDir);
      expect(result).toBe('main');
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  it('returns "main" when config is undefined and no git repo exists', async () => {
    // Use a freshly-created subdir of tmpdir() that is guaranteed not to be a
    // git repo (passing tmpdir() directly can pick up an enclosing repo's
    // origin/HEAD on some systems and make this assertion non-deterministic).
    const isolatedDir = await mkdtemp(join(tmpdir(), 'eforge-branch-policy-no-repo-'));
    try {
      const result = await resolveTrunkBranch(undefined, isolatedDir);
      expect(result).toBe('main');
    } finally {
      await rm(isolatedDir, { recursive: true });
    }
  });
});

describe('isTrunkBranch', () => {
  it('returns true when branch equals trunk', () => {
    expect(isTrunkBranch('main', 'main')).toBe(true);
  });

  it('returns false when branch does not equal trunk', () => {
    expect(isTrunkBranch('feature/x', 'main')).toBe(false);
  });

  it('returns false for case-sensitive mismatch', () => {
    expect(isTrunkBranch('Main', 'main')).toBe(false);
  });

  it('returns true for non-main trunk branch', () => {
    expect(isTrunkBranch('develop', 'develop')).toBe(true);
  });
});
