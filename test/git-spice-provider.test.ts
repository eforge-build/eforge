import { describe, it, expect } from 'vitest';
import { writeFileSync, chmodSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { useTempDir } from './test-tmpdir.js';
import {
  createGitSpiceAdapter,
  GitSpiceNotAvailableError,
} from '@eforge-build/engine/stacking/git-spice';
import { createProvider } from '@eforge-build/engine/stacking/provider';

/**
 * Write a shell-script stub executable and mark it executable.
 * Returns the absolute path to the created stub.
 */
function makeStub(dir: string, name: string, script: string): string {
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/sh\n${script}\n`);
  chmodSync(path, 0o755);
  return path;
}

describe('GitSpiceAdapter', () => {
  const makeTempDir = useTempDir('eforge-gs-');

  // ---------------------------------------------------------------------------
  // Detection
  // ---------------------------------------------------------------------------

  it('detects git-spice when --version returns version text', async () => {
    const dir = makeTempDir();
    const stub = makeStub(dir, 'git-spice', 'echo "git-spice version 0.1.0"');
    const adapter = createGitSpiceAdapter({ gitSpice: { command: stub } });
    await expect(adapter.requireAvailable(dir)).resolves.toBeUndefined();
  });

  it('throws GitSpiceNotAvailableError when command is missing', async () => {
    const adapter = createGitSpiceAdapter({ gitSpice: { command: '/nonexistent/path/git-spice' } });
    await expect(adapter.requireAvailable('/tmp')).rejects.toBeInstanceOf(GitSpiceNotAvailableError);
  });

  it('error message contains "git-spice" when detection fails', async () => {
    const adapter = createGitSpiceAdapter({ gitSpice: { command: '/nonexistent/path/git-spice' } });
    const err = await adapter.requireAvailable('/tmp').catch((e: unknown) => e);
    expect((err as Error).message).toContain('git-spice');
  });

  it('error message contains "stacking.gitSpice.command" when detection fails', async () => {
    const adapter = createGitSpiceAdapter({ gitSpice: { command: '/nonexistent/path/git-spice' } });
    const err = await adapter.requireAvailable('/tmp').catch((e: unknown) => e);
    expect((err as Error).message).toContain('stacking.gitSpice.command');
  });

  // ---------------------------------------------------------------------------
  // Command override
  // ---------------------------------------------------------------------------

  it('uses configured absolute command path, not the default git-spice', async () => {
    const dir = makeTempDir();
    const argsFile = join(dir, 'args.txt');
    // Stub records its argv then prints a version line
    const stub = makeStub(dir, 'my-gs', `echo "$@" >> "${argsFile}"\necho "my-gs version 1.0"`);
    const adapter = createGitSpiceAdapter({ gitSpice: { command: stub } });
    await adapter.requireAvailable(dir);
    const contents = readFileSync(argsFile, 'utf8').trim();
    expect(contents).toBe('--version');
  });

  it('resolvedCommand returns the configured command, never gs', async () => {
    const adapter = createGitSpiceAdapter({ gitSpice: { command: '/custom/git-spice' } });
    expect(adapter.resolvedCommand).toBe('/custom/git-spice');
    expect(adapter.resolvedCommand).not.toBe('gs');
  });

  it('resolvedCommand defaults to git-spice when no override is configured', () => {
    const adapter = createGitSpiceAdapter({});
    expect(adapter.resolvedCommand).toBe('git-spice');
    expect(adapter.resolvedCommand).not.toBe('gs');
  });

  // ---------------------------------------------------------------------------
  // No gs requirement
  // ---------------------------------------------------------------------------

  it('does not require the gs alias — runs fine without gs in the directory', async () => {
    const dir = makeTempDir();
    // Only create 'git-spice', not 'gs'
    const stub = makeStub(dir, 'git-spice', 'echo "git-spice version 0.1.0"');
    const adapter = createGitSpiceAdapter({ gitSpice: { command: stub } });
    await expect(adapter.requireAvailable(dir)).resolves.toBeUndefined();
    // Confirm gs does not exist in the temp dir
    expect(existsSync(join(dir, 'gs'))).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Argv construction — branch tracking
  // ---------------------------------------------------------------------------

  it('trackBranch invokes branch track --base <base>', async () => {
    const dir = makeTempDir();
    const argsFile = join(dir, 'args.txt');
    const stub = makeStub(dir, 'git-spice', `echo "$@" >> "${argsFile}"`);
    const adapter = createGitSpiceAdapter({ gitSpice: { command: stub } });
    await adapter.trackBranch(dir, 'main');
    const args = readFileSync(argsFile, 'utf8').trim();
    expect(args).toBe('branch track --base main');
  });

  it('trackBranch passes the base branch name verbatim', async () => {
    const dir = makeTempDir();
    const argsFile = join(dir, 'args.txt');
    const stub = makeStub(dir, 'git-spice', `echo "$@" >> "${argsFile}"`);
    const adapter = createGitSpiceAdapter({ gitSpice: { command: stub } });
    await adapter.trackBranch(dir, 'feature/upstream-a');
    const args = readFileSync(argsFile, 'utf8').trim();
    expect(args).toBe('branch track --base feature/upstream-a');
  });

  // ---------------------------------------------------------------------------
  // Argv construction — submit and sync
  // ---------------------------------------------------------------------------

  it('submitBranch invokes branch submit', async () => {
    const dir = makeTempDir();
    const argsFile = join(dir, 'args.txt');
    const stub = makeStub(dir, 'git-spice', `echo "$@" >> "${argsFile}"`);
    const adapter = createGitSpiceAdapter({ gitSpice: { command: stub } });
    await adapter.submitBranch(dir);
    const args = readFileSync(argsFile, 'utf8').trim();
    expect(args).toBe('branch submit');
  });

  it('submitStack invokes stack submit', async () => {
    const dir = makeTempDir();
    const argsFile = join(dir, 'args.txt');
    const stub = makeStub(dir, 'git-spice', `echo "$@" >> "${argsFile}"`);
    const adapter = createGitSpiceAdapter({ gitSpice: { command: stub } });
    await adapter.submitStack(dir);
    const args = readFileSync(argsFile, 'utf8').trim();
    expect(args).toBe('stack submit');
  });

  it('syncRepo invokes repo sync', async () => {
    const dir = makeTempDir();
    const argsFile = join(dir, 'args.txt');
    const stub = makeStub(dir, 'git-spice', `echo "$@" >> "${argsFile}"`);
    const adapter = createGitSpiceAdapter({ gitSpice: { command: stub } });
    await adapter.syncRepo(dir);
    const args = readFileSync(argsFile, 'utf8').trim();
    expect(args).toBe('repo sync');
  });

  // ---------------------------------------------------------------------------
  // Argv construction — restack
  // ---------------------------------------------------------------------------

  it('restackBranch invokes branch restack', async () => {
    const dir = makeTempDir();
    const argsFile = join(dir, 'args.txt');
    const stub = makeStub(dir, 'git-spice', `echo "$@" >> "${argsFile}"`);
    const adapter = createGitSpiceAdapter({ gitSpice: { command: stub } });
    await adapter.restackBranch(dir);
    const args = readFileSync(argsFile, 'utf8').trim();
    expect(args).toBe('branch restack');
  });

  it('restackStack invokes stack restack', async () => {
    const dir = makeTempDir();
    const argsFile = join(dir, 'args.txt');
    const stub = makeStub(dir, 'git-spice', `echo "$@" >> "${argsFile}"`);
    const adapter = createGitSpiceAdapter({ gitSpice: { command: stub } });
    await adapter.restackStack(dir);
    const args = readFileSync(argsFile, 'utf8').trim();
    expect(args).toBe('stack restack');
  });

  it('upstackOnto invokes upstack onto <target>', async () => {
    const dir = makeTempDir();
    const argsFile = join(dir, 'args.txt');
    const stub = makeStub(dir, 'git-spice', `echo "$@" >> "${argsFile}"`);
    const adapter = createGitSpiceAdapter({ gitSpice: { command: stub } });
    await adapter.upstackOnto(dir, 'feature-a');
    const args = readFileSync(argsFile, 'utf8').trim();
    expect(args).toBe('upstack onto feature-a');
  });
});

// ---------------------------------------------------------------------------
// createProvider factory
// ---------------------------------------------------------------------------

describe('createProvider', () => {
  const makeTempDir = useTempDir('eforge-gs-prov-');

  it('returns an adapter that uses the configured git-spice command', async () => {
    const dir = makeTempDir();
    const stub = makeStub(dir, 'git-spice', 'echo "git-spice version 0.1.0"');
    const config = {
      enabled: true,
      provider: 'git-spice' as const,
      gitSpice: { command: stub },
    };
    const provider = createProvider(config);
    await expect(provider.requireAvailable(dir)).resolves.toBeUndefined();
  });

  it('provider throws GitSpiceNotAvailableError for missing command', async () => {
    const config = {
      enabled: true,
      provider: 'git-spice' as const,
      gitSpice: { command: '/nonexistent/path/git-spice' },
    };
    const provider = createProvider(config);
    await expect(provider.requireAvailable('/tmp')).rejects.toBeInstanceOf(GitSpiceNotAvailableError);
  });
});
