import { execFile } from 'node:child_process';
import { describe, it, expect } from 'vitest';
import { writeFileSync, chmodSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { useTempDir } from './test-tmpdir.js';
import {
  createGitSpiceAdapter,
  GitSpiceCommandError,
  GitSpiceNotAvailableError,
  parseGitSpicePrUrl,
  redactProviderMessage,
} from '@eforge-build/engine/stacking/git-spice';
import { createProvider } from '@eforge-build/engine/stacking/provider';

const exec = promisify(execFile);

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

async function initRepo(dir: string): Promise<void> {
  await exec('git', ['init', '-b', 'main'], { cwd: dir });
  await exec('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  await exec('git', ['config', 'user.name', 'Test User'], { cwd: dir });
  writeFileSync(join(dir, 'file.txt'), 'base\n');
  await exec('git', ['add', 'file.txt'], { cwd: dir });
  await exec('git', ['commit', '-m', 'base'], { cwd: dir });
}

async function createUnmergedRepo(dir: string): Promise<void> {
  await initRepo(dir);
  await exec('git', ['checkout', '-b', 'ours'], { cwd: dir });
  writeFileSync(join(dir, 'file.txt'), 'ours\n');
  await exec('git', ['commit', '-am', 'ours'], { cwd: dir });
  await exec('git', ['checkout', 'main'], { cwd: dir });
  await exec('git', ['checkout', '-b', 'theirs'], { cwd: dir });
  writeFileSync(join(dir, 'file.txt'), 'theirs\n');
  await exec('git', ['commit', '-am', 'theirs'], { cwd: dir });
  await exec('git', ['checkout', 'ours'], { cwd: dir });
  await exec('git', ['merge', 'theirs'], { cwd: dir }).catch(() => undefined);
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

  it('trackBranch returns command metadata with correct args array', async () => {
    const dir = makeTempDir();
    const stub = makeStub(dir, 'git-spice', 'echo "ok"');
    const adapter = createGitSpiceAdapter({ gitSpice: { command: stub } });
    const result = await adapter.trackBranch(dir, 'main');
    expect(result.command).toBe(stub);
    expect(result.args).toEqual(['branch', 'track', '--base', 'main']);
    expect(result.exitCode).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Argv construction — submit and sync
  // ---------------------------------------------------------------------------

  it('submitBranch invokes branch submit non-interactively', async () => {
    const dir = makeTempDir();
    const argsFile = join(dir, 'args.txt');
    const stub = makeStub(dir, 'git-spice', `echo "$@" >> "${argsFile}"`);
    const adapter = createGitSpiceAdapter({ gitSpice: { command: stub } });
    await adapter.submitBranch(dir);
    const args = readFileSync(argsFile, 'utf8').trim();
    expect(args).toBe('branch submit --fill --no-web --no-prompt');
  });

  it('submitBranch returns command metadata with stdout captured', async () => {
    const dir = makeTempDir();
    const stub = makeStub(dir, 'git-spice', 'echo "PR created: https://github.com/owner/repo/pull/7"');
    const adapter = createGitSpiceAdapter({ gitSpice: { command: stub } });
    const result = await adapter.submitBranch(dir);
    expect(result.command).toBe(stub);
    expect(result.args).toEqual(['branch', 'submit', '--fill', '--no-web', '--no-prompt']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('github.com');
  });

  it('submitStack invokes stack submit non-interactively', async () => {
    const dir = makeTempDir();
    const argsFile = join(dir, 'args.txt');
    const stub = makeStub(dir, 'git-spice', `echo "$@" >> "${argsFile}"`);
    const adapter = createGitSpiceAdapter({ gitSpice: { command: stub } });
    await adapter.submitStack(dir);
    const args = readFileSync(argsFile, 'utf8').trim();
    expect(args).toBe('stack submit --fill --no-web --no-prompt');
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

  it('classifies branch restack conflict diagnostics as recoverable-conflict', async () => {
    const dir = makeTempDir();
    const adapter = createGitSpiceAdapter({});
    const err = new GitSpiceCommandError(
      'git-spice',
      ['branch', 'restack'],
      1,
      'CONFLICT (content): resolve conflicts then run git rebase --continue',
    );
    const classification = await adapter.classifyError(dir, err);
    expect(classification.kind).toBe('recoverable-conflict');
    expect(classification.operation).toBe('branch-restack');
    expect(classification.recoverable).toBe(true);
  });

  it('classifies branch restack conflict filenames that look like auth or network words as recoverable-conflict', async () => {
    const dir = makeTempDir();
    const adapter = createGitSpiceAdapter({});
    for (const filename of ['src/token.ts', 'src/ssl.ts', 'src/timeout.ts']) {
      const err = new GitSpiceCommandError(
        'git-spice',
        ['branch', 'restack'],
        1,
        `Merge conflict in ${filename}`,
      );
      const classification = await adapter.classifyError(dir, err);
      expect(classification.kind).toBe('recoverable-conflict');
      expect(classification.operation).toBe('branch-restack');
    }
  });

  it('classifies branch restack as recoverable-conflict when unmerged files exist', async () => {
    const dir = makeTempDir();
    await createUnmergedRepo(dir);
    const adapter = createGitSpiceAdapter({});
    const err = new GitSpiceCommandError('git-spice', ['branch', 'restack'], 1, 'restack stopped');
    const classification = await adapter.classifyError(dir, err);
    expect(classification.kind).toBe('recoverable-conflict');
    expect(classification.recoverable).toBe(true);
  });

  it('does not classify generic branch restack failures with no unmerged paths as recoverable', async () => {
    const dir = makeTempDir();
    await initRepo(dir);
    const adapter = createGitSpiceAdapter({});
    const err = new GitSpiceCommandError('git-spice', ['branch', 'restack'], 1, 'restack failed for unknown reason');
    const classification = await adapter.classifyError(dir, err);
    expect(classification.kind).toBe('provider-failure');
    expect(classification.recoverable).toBe(false);
  });

  it('discovers interrupted branch restack details from git state', async () => {
    const dir = makeTempDir();
    await createUnmergedRepo(dir);
    const adapter = createGitSpiceAdapter({});
    const operation = await adapter.getInterruptedOperation(dir, {
      kind: 'recoverable-conflict',
      operation: 'branch-restack',
      conflictKind: 'git-rebase',
      message: 'conflict',
      recoverable: true,
    });
    expect(operation?.branch).toBe('ours');
    expect(operation?.conflictedFiles).toEqual(['file.txt']);
    expect(operation?.conflictDiff).toContain('diff --cc file.txt');
  });

  it('continueInterruptedOperation returns rebase continue argv', async () => {
    const dir = makeTempDir();
    const argsFile = join(dir, 'args.txt');
    const stub = makeStub(dir, 'git-spice', `echo "$@" >> "${argsFile}"`);
    const adapter = createGitSpiceAdapter({ gitSpice: { command: stub } });
    const result = await adapter.continueInterruptedOperation(dir, {
      operation: 'branch-restack', conflictKind: 'git-rebase', conflictedFiles: [], conflictDiff: '',
    });
    expect(result.args).toEqual(['rebase', 'continue']);
    expect(readFileSync(argsFile, 'utf8').trim()).toBe('rebase continue');
  });

  it('abortInterruptedOperation returns rebase abort argv', async () => {
    const dir = makeTempDir();
    const argsFile = join(dir, 'args.txt');
    const stub = makeStub(dir, 'git-spice', `echo "$@" >> "${argsFile}"`);
    const adapter = createGitSpiceAdapter({ gitSpice: { command: stub } });
    const result = await adapter.abortInterruptedOperation(dir, {
      operation: 'branch-restack', conflictKind: 'git-rebase', conflictedFiles: [], conflictDiff: '',
    });
    expect(result.args).toEqual(['rebase', 'abort']);
    expect(readFileSync(argsFile, 'utf8').trim()).toBe('rebase abort');
  });
});

// ---------------------------------------------------------------------------
// parseGitSpicePrUrl
// ---------------------------------------------------------------------------

describe('parseGitSpicePrUrl', () => {
  it('extracts a GitHub PR URL from git-spice output', () => {
    const stdout = 'Created pull request https://github.com/owner/repo/pull/42\n';
    expect(parseGitSpicePrUrl(stdout)).toBe('https://github.com/owner/repo/pull/42');
  });

  it('returns undefined when stdout contains no PR URL', () => {
    expect(parseGitSpicePrUrl('branch tracked against main\n')).toBeUndefined();
  });

  it('returns undefined for empty stdout', () => {
    expect(parseGitSpicePrUrl('')).toBeUndefined();
  });

  it('extracts a PR URL from multi-line output', () => {
    const stdout = 'Tracking branch...\nSubmitting PR...\nhttps://github.com/my-org/my-repo/pull/123\nDone.\n';
    expect(parseGitSpicePrUrl(stdout)).toBe('https://github.com/my-org/my-repo/pull/123');
  });

  it('does not extract malformed GitHub PR URL strings', () => {
    const stdout = 'Created https://github.com/owner/repo\"><script>/pull/42';
    expect(parseGitSpicePrUrl(stdout)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// redactProviderMessage
// ---------------------------------------------------------------------------

describe('redactProviderMessage', () => {
  it('redacts common token shapes from provider diagnostics', () => {
    const message = 'remote https://ghp_abcdef@github.com/o/r failed token=secret Bearer sk-123456789012345678901234';
    const redacted = redactProviderMessage(message);
    expect(redacted).not.toContain('ghp_abcdef');
    expect(redacted).not.toContain('token=secret');
    expect(redacted).not.toContain('sk-123456789012345678901234');
    expect(redacted).toContain('[redacted]');
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
