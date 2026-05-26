/**
 * Tests for the pre-compile trunk sync gate helper.
 *
 * Uses real git repositories with a bare remote to prove fetch/compare/select
 * behavior and non-mutating guarantees.
 */

import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { useTempDir } from './test-tmpdir.js';
import { prepareTrunkSyncBase } from '@eforge-build/engine/trunk-sync';
import type { EforgeConfig } from '@eforge-build/engine/config';
import { DEFAULT_CONFIG } from '@eforge-build/engine/config';

const exec = promisify(execFile);

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/**
 * Build a minimal EforgeConfig stub with the given trunkSync overrides.
 */
function makeConfig(trunkSync?: Partial<EforgeConfig['build']['trunkSync']>): Pick<EforgeConfig, 'build'> {
  return {
    build: {
      ...DEFAULT_CONFIG.build,
      trunkSync: {
        ...DEFAULT_CONFIG.build.trunkSync,
        ...trunkSync,
      },
    },
  };
}

/**
 * Initialize a bare remote repo, clone it to a local repo, create an initial
 * commit on `main`, and push.
 *
 * Returns { remoteDir, repoRoot }.
 */
async function setupRepoWithRemote(baseDir: string): Promise<{ remoteDir: string; repoRoot: string }> {
  const remoteDir = join(baseDir, 'remote.git');
  const repoRoot = join(baseDir, 'local');

  // Create bare remote
  await exec('git', ['init', '--bare', remoteDir]);

  // Clone into local
  await exec('git', ['clone', remoteDir, repoRoot]);
  await exec('git', ['config', 'user.email', 'test@eforge.test'], { cwd: repoRoot });
  await exec('git', ['config', 'user.name', 'Eforge Test'], { cwd: repoRoot });

  // Initial commit on main
  writeFileSync(join(repoRoot, 'README.md'), '# init\n');
  await exec('git', ['add', '.'], { cwd: repoRoot });
  await exec('git', ['commit', '-m', 'initial commit'], { cwd: repoRoot });
  await exec('git', ['branch', '-M', 'main'], { cwd: repoRoot });
  await exec('git', ['push', 'origin', 'main'], { cwd: repoRoot });
  // Keep the bare remote's default branch aligned with the test trunk.
  // Some CI images still initialize bare repositories with HEAD pointing at
  // `master`; subsequent clones would then start from an unborn non-main
  // branch and `git push origin main` would fail with "src refspec main does
  // not match any".
  await exec('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: remoteDir });

  return { remoteDir, repoRoot };
}

/**
 * Push an additional commit to the remote (via a temp clone), simulating a
 * collaborator advancing the remote trunk.
 */
async function advanceRemote(baseDir: string, remoteDir: string): Promise<string> {
  const tempClone = join(baseDir, 'temp-pusher');
  await exec('git', ['clone', remoteDir, tempClone]);
  await exec('git', ['config', 'user.email', 'test@eforge.test'], { cwd: tempClone });
  await exec('git', ['config', 'user.name', 'Eforge Test'], { cwd: tempClone });
  writeFileSync(join(tempClone, 'remote-advance.txt'), 'remote commit\n');
  await exec('git', ['add', '.'], { cwd: tempClone });
  await exec('git', ['commit', '-m', 'remote advance'], { cwd: tempClone });
  await exec('git', ['push', 'origin', 'main'], { cwd: tempClone });
  const { stdout } = await exec('git', ['rev-parse', 'HEAD'], { cwd: tempClone });
  return stdout.trim();
}

/** Get the current HEAD SHA. */
async function getHead(cwd: string): Promise<string> {
  const { stdout } = await exec('git', ['rev-parse', 'HEAD'], { cwd });
  return stdout.trim();
}

/** Get the SHA that a branch ref points to locally. */
async function getLocalBranchSha(cwd: string, branch: string): Promise<string | undefined> {
  try {
    const { stdout } = await exec('git', ['rev-parse', `${branch}^{commit}`], { cwd });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Get the current checkout branch. */
async function getCurrentBranch(cwd: string): Promise<string> {
  const { stdout } = await exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });
  return stdout.trim();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('prepareTrunkSyncBase', () => {
  const makeTempDir = useTempDir('eforge-trunk-sync-');

  // --- eforge:region plan-01-pre-compile-trunk-sync-gate ---

  it('disabled config returns original base without fetching', async () => {
    const baseDir = makeTempDir();
    const { repoRoot } = await setupRepoWithRemote(baseDir);

    const initialLocalSha = await getLocalBranchSha(repoRoot, 'main');

    // Advance remote AFTER capturing initial SHA
    await advanceRemote(baseDir, join(baseDir, 'remote.git'));

    const config = makeConfig({ enabled: false });
    const result = await prepareTrunkSyncBase({ cwd: repoRoot, config, candidateBase: 'main' });

    expect(result.outcome).toBe('disabled');
    expect(result.baseRef).toBe('main');

    // Local SHA must be unchanged
    expect(await getLocalBranchSha(repoRoot, 'main')).toBe(initialLocalSha);
    // Current branch must be unchanged
    expect(await getCurrentBranch(repoRoot)).toBe('main');
  });

  it('returns the fetched remote SHA when remote is ahead of local', async () => {
    const baseDir = makeTempDir();
    const { repoRoot } = await setupRepoWithRemote(baseDir);

    const localShaBeforeSync = await getLocalBranchSha(repoRoot, 'main');

    // Advance remote so it's ahead of local
    const remoteSha = await advanceRemote(baseDir, join(baseDir, 'remote.git'));

    const config = makeConfig();
    const result = await prepareTrunkSyncBase({ cwd: repoRoot, config, candidateBase: 'main' });

    expect(result.outcome).toBe('remote-ahead');
    expect(result.baseRef).toBe(remoteSha);
    expect(result.remoteSha).toBe(remoteSha);

    // CRITICAL: local 'main' SHA must be unchanged after helper runs
    expect(await getLocalBranchSha(repoRoot, 'main')).toBe(localShaBeforeSync);
    // Current branch must be unchanged
    expect(await getCurrentBranch(repoRoot)).toBe('main');
  });

  it('uses the fetched SHA when local and remote are equal', async () => {
    const baseDir = makeTempDir();
    const { repoRoot } = await setupRepoWithRemote(baseDir);

    const headSha = await getHead(repoRoot);
    const config = makeConfig();
    const result = await prepareTrunkSyncBase({ cwd: repoRoot, config, candidateBase: 'main' });

    expect(result.outcome).toBe('remote-equal');
    expect(result.baseRef).toBe(headSha);
    expect(result.remoteSha).toBe(headSha);
    expect(result.localSha).toBe(headSha);
  });

  it('local-ahead: uses local trunk and emits a warning', async () => {
    const baseDir = makeTempDir();
    const { repoRoot } = await setupRepoWithRemote(baseDir);

    // Add a commit to local only (not pushed)
    writeFileSync(join(repoRoot, 'local-only.txt'), 'local only\n');
    await exec('git', ['add', '.'], { cwd: repoRoot });
    await exec('git', ['commit', '-m', 'local-only commit'], { cwd: repoRoot });

    const localSha = await getLocalBranchSha(repoRoot, 'main');

    const config = makeConfig();
    const result = await prepareTrunkSyncBase({ cwd: repoRoot, config, candidateBase: 'main' });

    expect(result.outcome).toBe('local-ahead');
    expect(result.baseRef).toBe('main');
    expect(result.localSha).toBe(localSha);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain("ahead of");
  });

  it('diverged + warn policy: returns local trunk with warning', async () => {
    const baseDir = makeTempDir();
    const { repoRoot } = await setupRepoWithRemote(baseDir);

    // Create divergence:
    // 1. Advance remote
    await advanceRemote(baseDir, join(baseDir, 'remote.git'));
    // 2. Add a different local commit (diverged from common ancestor)
    writeFileSync(join(repoRoot, 'local-diverged.txt'), 'local diverged\n');
    await exec('git', ['add', '.'], { cwd: repoRoot });
    await exec('git', ['commit', '-m', 'local diverged commit'], { cwd: repoRoot });

    const localSha = await getLocalBranchSha(repoRoot, 'main');

    const config = makeConfig({ onDiverged: 'warn' });
    const result = await prepareTrunkSyncBase({ cwd: repoRoot, config, candidateBase: 'main' });

    expect(result.outcome).toBe('diverged-use-local');
    expect(result.baseRef).toBe('main');
    expect(result.localSha).toBe(localSha);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain('diverged');
  });

  it('diverged + fail policy: returns failed outcome', async () => {
    const baseDir = makeTempDir();
    const { repoRoot } = await setupRepoWithRemote(baseDir);

    // Create divergence
    await advanceRemote(baseDir, join(baseDir, 'remote.git'));
    writeFileSync(join(repoRoot, 'local-diverged-fail.txt'), 'local diverged fail\n');
    await exec('git', ['add', '.'], { cwd: repoRoot });
    await exec('git', ['commit', '-m', 'local diverged fail'], { cwd: repoRoot });

    const config = makeConfig({ onDiverged: 'fail' });
    const result = await prepareTrunkSyncBase({ cwd: repoRoot, config, candidateBase: 'main' });

    expect(result.outcome).toBe('failed');
    expect(result.baseRef).toBe('main');
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain('diverged');
    expect(result.warnings[0]).toContain('fail');
  });

  it('diverged + use-remote policy: returns the fetched remote SHA with warning', async () => {
    const baseDir = makeTempDir();
    const { repoRoot } = await setupRepoWithRemote(baseDir);

    // Create divergence
    const remoteSha = await advanceRemote(baseDir, join(baseDir, 'remote.git'));
    writeFileSync(join(repoRoot, 'local-diverged-remote.txt'), 'local diverged use-remote\n');
    await exec('git', ['add', '.'], { cwd: repoRoot });
    await exec('git', ['commit', '-m', 'local diverged use-remote'], { cwd: repoRoot });

    const config = makeConfig({ onDiverged: 'use-remote' });
    const result = await prepareTrunkSyncBase({ cwd: repoRoot, config, candidateBase: 'main' });

    expect(result.outcome).toBe('diverged-use-remote');
    expect(result.baseRef).toBe(remoteSha);
    expect(result.remoteSha).toBe(remoteSha);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain('diverged');
  });

  it('missing remote returns skipped outcome with fallback diagnostic', async () => {
    const baseDir = makeTempDir();
    const { repoRoot } = await setupRepoWithRemote(baseDir);

    // Use a remote that does not exist
    const config = makeConfig({ remote: 'nonexistent-remote' });
    const result = await prepareTrunkSyncBase({ cwd: repoRoot, config, candidateBase: 'main' });

    expect(result.outcome).toBe('skipped');
    expect(result.baseRef).toBe('main');
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it('feature-branch candidate base is not retargeted to remote trunk', async () => {
    const baseDir = makeTempDir();
    const { repoRoot } = await setupRepoWithRemote(baseDir);

    // Advance remote ahead of local
    await advanceRemote(baseDir, join(baseDir, 'remote.git'));

    // candidateBase is a feature branch, not the trunk
    const config = makeConfig();
    const result = await prepareTrunkSyncBase({
      cwd: repoRoot,
      config,
      candidateBase: 'feature/my-feature',
    });

    expect(result.outcome).toBe('skipped');
    expect(result.baseRef).toBe('feature/my-feature');
    expect(result.diagnostics[0]).toContain("not the trunk branch");
  });

  it('child stacked PRD with parentPrdId is skipped', async () => {
    const baseDir = makeTempDir();
    const { repoRoot } = await setupRepoWithRemote(baseDir);

    // Advance remote so we'd normally get a new SHA
    await advanceRemote(baseDir, join(baseDir, 'remote.git'));

    const config = makeConfig();
    const result = await prepareTrunkSyncBase({
      cwd: repoRoot,
      config,
      candidateBase: 'eforge/parent-artifact',
      parentPrdId: 'parent-prd-id',
    });

    expect(result.outcome).toBe('skipped');
    expect(result.baseRef).toBe('eforge/parent-artifact');
    expect(result.diagnostics[0]).toContain('child stacked PRD');
  });

  it('does not mutate local trunk ref or checkout branch after remote-ahead sync', async () => {
    const baseDir = makeTempDir();
    const { repoRoot } = await setupRepoWithRemote(baseDir);

    // Record initial state
    const initialLocalMainSha = await getLocalBranchSha(repoRoot, 'main');
    const initialCurrentBranch = await getCurrentBranch(repoRoot);

    // Advance remote
    await advanceRemote(baseDir, join(baseDir, 'remote.git'));

    const config = makeConfig();
    const result = await prepareTrunkSyncBase({ cwd: repoRoot, config, candidateBase: 'main' });

    // Helper selected the remote SHA
    expect(result.outcome).toBe('remote-ahead');

    // Local 'main' ref must not have moved
    expect(await getLocalBranchSha(repoRoot, 'main')).toBe(initialLocalMainSha);
    // Checkout branch must not have changed
    expect(await getCurrentBranch(repoRoot)).toBe(initialCurrentBranch);
  });

  it('invalid remote name (leading dash) returns failed outcome without fetching', async () => {
    const baseDir = makeTempDir();
    const { repoRoot } = await setupRepoWithRemote(baseDir);

    const config = makeConfig({ remote: '-bad-remote' });
    const result = await prepareTrunkSyncBase({ cwd: repoRoot, config, candidateBase: 'main' });

    expect(result.outcome).toBe('failed');
    expect(result.warnings[0]).toContain("must not start with '-'");
  });

  it('eforge/config.yaml postMergeCommands regression: pnpm commands present, no eforge stack sync', () => {
    // Read the YAML file directly to avoid loadConfig's toolbelt validation,
    // which requires .mcp.json to exist in the cwd (absent in worktree builds).
    const configPath = resolve(process.cwd(), 'eforge', 'config.yaml');
    const raw = parseYaml(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    const build = (raw['build'] ?? {}) as Record<string, unknown>;
    const cmds = (build['postMergeCommands'] ?? []) as string[];

    expect(cmds).toContain('pnpm install');
    expect(cmds).toContain('pnpm build');
    expect(cmds).toContain('pnpm type-check');
    expect(cmds).toContain('pnpm test');
    expect(cmds.some((c) => c.includes('eforge stack sync'))).toBe(false);
  });

  // --- eforge:endregion plan-01-pre-compile-trunk-sync-gate ---
});
