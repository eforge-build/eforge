/**
 * Tests for the GitHub CLI PR auto-merge helper and WorktreeManager wrapper.
 *
 * Uses a fake `gh` script to avoid real GitHub CLI calls.
 */


import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { useTempDir } from './test-tmpdir.js';
import { enablePullRequestAutoMerge } from '@eforge-build/engine/worktree-ops';
import { WorktreeManager } from '@eforge-build/engine/worktree-manager';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a fake `gh` script in a temp bin dir.
 *
 * @param dir       - Parent directory to create the bin/ inside.
 * @param behavior  - 'success' | 'failure'
 * @returns Path to the bin directory (prepend to PATH).
 */
function createFakeGhMerge(dir: string, behavior: 'success' | 'failure'): string {
  const binDir = join(dir, 'bin');
  execFileSync('mkdir', ['-p', binDir]);
  const scriptPath = join(binDir, 'gh');
  const content = behavior === 'success'
    ? `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'pr' && args[1] === 'merge') {
  process.stdout.write('auto-merge enabled\\n');
  process.exit(0);
}
process.exit(0);
`
    : `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'pr' && args[1] === 'merge') {
  process.stderr.write('auto-merge not allowed by branch protection\\n');
  process.exit(1);
}
process.exit(0);
`;
  writeFileSync(scriptPath, content, { mode: 0o755 });
  return binDir;
}

// ---------------------------------------------------------------------------
// enablePullRequestAutoMerge — worktree-ops helper
// ---------------------------------------------------------------------------

describe('enablePullRequestAutoMerge', () => {
  const makeTempDir = useTempDir('eforge-pr-auto-merge-');

  it('resolves when gh pr merge exits 0', async () => {
    const dir = makeTempDir();
    const binDir = createFakeGhMerge(dir, 'success');
    const origPath = process.env.PATH;
    process.env.PATH = `${binDir}:${origPath}`;

    try {
      // Should not throw
      await expect(enablePullRequestAutoMerge(dir, 'https://github.com/owner/repo/pull/1')).resolves.toBeUndefined();
    } finally {
      process.env.PATH = origPath;
    }
  });

  it('throws when gh pr merge exits non-zero', async () => {
    const dir = makeTempDir();
    const binDir = createFakeGhMerge(dir, 'failure');
    const origPath = process.env.PATH;
    process.env.PATH = `${binDir}:${origPath}`;

    try {
      await expect(enablePullRequestAutoMerge(dir, 'https://github.com/owner/repo/pull/1')).rejects.toThrow();
    } finally {
      process.env.PATH = origPath;
    }
  });

  it('passes the selector (PR URL) to gh pr merge', async () => {
    const dir = makeTempDir();
    const binDir = join(dir, 'bin-capture');
    execFileSync('mkdir', ['-p', binDir]);
    const scriptPath = join(binDir, 'gh');
    const logPath = join(binDir, 'gh-args.log');
    writeFileSync(scriptPath, `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(logPath)}, JSON.stringify(args) + '\\n');
process.exit(0);
`, { mode: 0o755 });

    const origPath = process.env.PATH;
    process.env.PATH = `${binDir}:${origPath}`;

    try {
      await enablePullRequestAutoMerge(dir, 'https://github.com/owner/repo/pull/99');
      const { readFileSync } = await import('node:fs');
      const logged: string[] = JSON.parse(readFileSync(logPath, 'utf-8').trim().split('\n').at(-1)!);
      expect(logged).toContain('pr');
      expect(logged).toContain('merge');
      expect(logged).toContain('https://github.com/owner/repo/pull/99');
      expect(logged).toContain('--auto');
      expect(logged).toContain('--merge');
    } finally {
      process.env.PATH = origPath;
    }
  });
});

// ---------------------------------------------------------------------------
// WorktreeManager.enablePrAutoMerge — wrapper
// ---------------------------------------------------------------------------

describe('WorktreeManager.enablePrAutoMerge', () => {
  const makeTempDir = useTempDir('eforge-wm-auto-merge-');

  it('delegates to enablePullRequestAutoMerge with mergeWorktreePath', async () => {
    const dir = makeTempDir();

    // Create a minimal git repo so WorktreeManager has a valid cwd
    execFileSync('git', ['init', dir]);
    execFileSync('git', ['-C', dir, 'config', 'user.email', 'test@test.com']);
    execFileSync('git', ['-C', dir, 'config', 'user.name', 'Test']);

    const binDir = join(dir, 'bin-wm');
    execFileSync('mkdir', ['-p', binDir]);
    const scriptPath = join(binDir, 'gh');
    const logPath = join(binDir, 'cwd.log');
    writeFileSync(scriptPath, `#!/usr/bin/env node
const fs = require('fs');
fs.appendFileSync(${JSON.stringify(logPath)}, process.cwd() + '\\n');
process.exit(0);
`, { mode: 0o755 });

    const origPath = process.env.PATH;
    process.env.PATH = `${binDir}:${origPath}`;

    try {
      const mergeWorktreePath = dir;
      const wm = new WorktreeManager({
        repoRoot: dir,
        worktreeBase: join(dir, '__worktrees__'),
        featureBranch: 'eforge/test',
        mergeWorktreePath,
      });

      await wm.enablePrAutoMerge('https://github.com/owner/repo/pull/7');

      const { readFileSync, realpathSync } = await import('node:fs');
      const loggedCwd = readFileSync(logPath, 'utf-8').trim();
      // gh was invoked with cwd = mergeWorktreePath (normalize for macOS /private symlink)
      expect(loggedCwd).toBe(realpathSync(mergeWorktreePath));
    } finally {
      process.env.PATH = origPath;
    }
  });
});

