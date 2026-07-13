import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_CONFIG } from '@eforge-build/engine/config';
import { resolveValidationBase } from '@eforge-build/engine/validation/validation-base';
import { useTempDir } from './test-tmpdir.js';

const makeTempDir = useTempDir('eforge-validation-base-');

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function commit(cwd: string, file: string, contents: string, message: string): string {
  writeFileSync(join(cwd, file), contents);
  git(cwd, 'add', file);
  git(cwd, 'commit', '-m', message);
  return git(cwd, 'rev-parse', 'HEAD');
}

function repo(): string {
  const cwd = makeTempDir();
  git(cwd, 'init', '-b', 'main');
  git(cwd, 'config', 'user.email', 'test@example.com');
  git(cwd, 'config', 'user.name', 'Test');
  commit(cwd, 'README.md', 'initial\n', 'initial');
  return cwd;
}

const config = (trunkBranch = 'main') => ({ build: { ...DEFAULT_CONFIG.build, trunkBranch } });

describe('resolveValidationBase', () => {
  it('fails closed for missing, malformed, and unresolved pins or bases', async () => {
    const cwd = repo();
    await expect(resolveValidationBase({ cwd, baseBranch: 'eforge/parent', config: config() }))
      .resolves.toMatchObject({ available: false, code: 'missing-pin' });
    await expect(resolveValidationBase({ cwd, baseBranch: 'main', diffBaseRef: 'main', config: config() }))
      .resolves.toMatchObject({ available: false, code: 'invalid-pin' });
    await expect(resolveValidationBase({ cwd, baseBranch: 'main', diffBaseRef: 'a'.repeat(40), config: config() }))
      .resolves.toMatchObject({ available: false, code: 'unresolved-pin' });
    await expect(resolveValidationBase({ cwd, baseBranch: 'gone', config: config() }))
      .resolves.toMatchObject({ available: false, code: 'unresolved-base' });
  });

  it('requires a pin to be ancestral to both child HEAD and a live logical parent', async () => {
    const cwd = repo();
    const pin = git(cwd, 'rev-parse', 'HEAD');
    git(cwd, 'switch', '-c', 'eforge/parent');
    commit(cwd, 'parent.txt', 'parent\n', 'parent');
    git(cwd, 'switch', '-c', 'eforge/child');
    commit(cwd, 'child.txt', 'child\n', 'child');
    const childPin = git(cwd, 'rev-parse', 'HEAD');
    git(cwd, 'switch', 'main');
    git(cwd, 'switch', '-c', 'other');
    commit(cwd, 'other.txt', 'other\n', 'other');
    const unrelated = git(cwd, 'rev-parse', 'HEAD');
    git(cwd, 'switch', 'eforge/child');

    await expect(resolveValidationBase({ cwd, baseBranch: 'eforge/parent', diffBaseRef: unrelated, config: config() }))
      .resolves.toMatchObject({ available: false, code: 'pin-not-ancestor-of-head' });
    await expect(resolveValidationBase({ cwd, baseBranch: 'other', diffBaseRef: childPin, config: config() }))
      .resolves.toMatchObject({ available: false, code: 'pin-not-ancestor-of-base' });
    await expect(resolveValidationBase({ cwd, baseBranch: 'eforge/parent', diffBaseRef: pin, config: config() }))
      .resolves.toEqual({ available: true, baseRef: pin, repaired: false });
  });

  it('repairs a deleted parent only after its pin is integrated into the configured trunk', async () => {
    const cwd = repo();
    git(cwd, 'switch', '-c', 'develop');
    git(cwd, 'switch', '-c', 'eforge/parent');
    const pin = commit(cwd, 'parent.txt', 'parent\n', 'parent');
    git(cwd, 'switch', '-c', 'eforge/child');
    commit(cwd, 'child.txt', 'child\n', 'child');
    git(cwd, 'branch', '-D', 'eforge/parent');

    await expect(resolveValidationBase({ cwd, baseBranch: 'eforge/parent', diffBaseRef: pin, config: config('develop') }))
      .resolves.toMatchObject({ available: false, code: 'unintegrated-pin' });

    // Recreate/integrate the parent topology, then advance trunk independently.
    git(cwd, 'branch', 'eforge/parent', 'HEAD~1');
    git(cwd, 'switch', 'develop');
    git(cwd, 'merge', '--ff-only', 'eforge/parent');
    commit(cwd, 'unrelated.txt', 'trunk only\n', 'unrelated trunk advancement');
    git(cwd, 'branch', '-D', 'eforge/parent');
    git(cwd, 'switch', 'eforge/child');

    await expect(resolveValidationBase({ cwd, baseBranch: 'eforge/parent', diffBaseRef: pin, config: config('develop') }))
      .resolves.toEqual({ available: true, baseRef: 'refs/heads/develop', repaired: true });
  });
});
