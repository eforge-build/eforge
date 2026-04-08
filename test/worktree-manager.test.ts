import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { useTempDir } from './test-tmpdir.js';
import { WorktreeManager } from '@eforge-build/engine/worktree-manager';
import { createMergeWorktree } from '@eforge-build/engine/worktree-ops';

const exec = promisify(execFile);

/**
 * Initialize a git repo with an initial commit on `main`,
 * create a merge worktree on a feature branch, and return
 * everything needed to construct a WorktreeManager.
 */
async function setupRepoWithMergeWorktree(
  baseDir: string,
  setName: string = 'test-set',
): Promise<{
  repoRoot: string;
  baseBranch: string;
  featureBranch: string;
  worktreeBase: string;
  mergeWorktreePath: string;
}> {
  const repoRoot = join(baseDir, 'repo');
  const baseBranch = 'main';
  const featureBranch = `eforge/${setName}`;
  const worktreeBase = join(baseDir, 'worktrees');

  await exec('git', ['init', repoRoot]);
  await exec('git', ['config', 'user.email', 'test@test.com'], { cwd: repoRoot });
  await exec('git', ['config', 'user.name', 'Test'], { cwd: repoRoot });
  writeFileSync(join(repoRoot, 'README.md'), '# init\n');
  await exec('git', ['add', '.'], { cwd: repoRoot });
  await exec('git', ['commit', '-m', 'initial commit'], { cwd: repoRoot });
  await exec('git', ['branch', '-M', 'main'], { cwd: repoRoot });

  const mergeWorktreePath = await createMergeWorktree(
    repoRoot,
    worktreeBase,
    featureBranch,
    baseBranch,
  );

  return { repoRoot, baseBranch, featureBranch, worktreeBase, mergeWorktreePath };
}

describe('WorktreeManager', () => {
  const makeTempDir = useTempDir('eforge-wm-');

  it('acquireForPlan with needsPlanWorktrees=true creates a dedicated worktree', async () => {
    const baseDir = makeTempDir();
    const { repoRoot, featureBranch, worktreeBase, mergeWorktreePath } =
      await setupRepoWithMergeWorktree(baseDir);

    const wm = new WorktreeManager({ repoRoot, worktreeBase, featureBranch, mergeWorktreePath });
    const branch = 'eforge/plan-01';
    const path = await wm.acquireForPlan('plan-01', branch, true);

    expect(path).not.toBe(mergeWorktreePath);
    expect(existsSync(path)).toBe(true);

    const { stdout: currentBranch } = await exec('git', ['branch', '--show-current'], { cwd: path });
    expect(currentBranch.trim()).toBe(branch);
    expect(wm.isBuiltOnMerge('plan-01')).toBe(false);
  });

  it('acquireForPlan with needsPlanWorktrees=false returns merge worktree path', async () => {
    const baseDir = makeTempDir();
    const { repoRoot, featureBranch, worktreeBase, mergeWorktreePath } =
      await setupRepoWithMergeWorktree(baseDir);

    const wm = new WorktreeManager({ repoRoot, worktreeBase, featureBranch, mergeWorktreePath });
    const path = await wm.acquireForPlan('plan-01', 'eforge/plan-01', false);

    expect(path).toBe(mergeWorktreePath);
    expect(wm.isBuiltOnMerge('plan-01')).toBe(true);
  });

  it('releaseForPlan removes dedicated worktree but not merge worktree', async () => {
    const baseDir = makeTempDir();
    const { repoRoot, featureBranch, worktreeBase, mergeWorktreePath } =
      await setupRepoWithMergeWorktree(baseDir);

    const wm = new WorktreeManager({ repoRoot, worktreeBase, featureBranch, mergeWorktreePath });

    // Dedicated worktree
    const branch = 'eforge/plan-release';
    const path = await wm.acquireForPlan('plan-release', branch, true);
    expect(existsSync(path)).toBe(true);

    await wm.releaseForPlan('plan-release');
    expect(existsSync(path)).toBe(false);

    // Merge worktree plan - release should be a no-op
    await wm.acquireForPlan('plan-merge', 'eforge/plan-merge', false);
    await wm.releaseForPlan('plan-merge');
    expect(existsSync(mergeWorktreePath)).toBe(true);
  });

  it('mergePlan squash-merges a dedicated worktree plan', async () => {
    const baseDir = makeTempDir();
    const { repoRoot, featureBranch, worktreeBase, mergeWorktreePath } =
      await setupRepoWithMergeWorktree(baseDir);

    const wm = new WorktreeManager({ repoRoot, worktreeBase, featureBranch, mergeWorktreePath });
    const branch = 'eforge/plan-merge-test';
    const path = await wm.acquireForPlan('plan-merge-test', branch, true);

    // Commit on plan worktree
    writeFileSync(join(path, 'plan-file.txt'), 'plan changes\n');
    await exec('git', ['add', '.'], { cwd: path });
    await exec('git', ['commit', '-m', 'plan implementation'], { cwd: path });

    const commitSha = await wm.mergePlan(
      'plan-merge-test',
      { id: 'plan-merge-test', name: 'Merge Test', branch },
    );

    expect(commitSha).toBeTruthy();

    // Verify the file exists on the feature branch
    const { stdout: files } = await exec('git', ['ls-files'], { cwd: mergeWorktreePath });
    expect(files).toContain('plan-file.txt');
  });

  it('mergePlan handles builtOnMerge plan (drift recovery)', async () => {
    const baseDir = makeTempDir();
    const { repoRoot, featureBranch, worktreeBase, mergeWorktreePath } =
      await setupRepoWithMergeWorktree(baseDir);

    const wm = new WorktreeManager({ repoRoot, worktreeBase, featureBranch, mergeWorktreePath });
    const path = await wm.acquireForPlan('plan-on-merge', 'eforge/plan-on-merge', false);

    // Commit directly on the merge worktree (simulates building on merge)
    writeFileSync(join(path, 'direct-file.txt'), 'direct changes\n');
    await exec('git', ['add', '.'], { cwd: path });
    await exec('git', ['commit', '-m', 'direct commit'], { cwd: path });

    const commitSha = await wm.mergePlan(
      'plan-on-merge',
      { id: 'plan-on-merge', name: 'Direct Build', branch: 'eforge/plan-on-merge' },
    );

    expect(commitSha).toBeTruthy();

    // Verify file is present
    const { stdout: files } = await exec('git', ['ls-files'], { cwd: mergeWorktreePath });
    expect(files).toContain('direct-file.txt');
  });

  it('cleanupAll returns a structured CleanupReport', async () => {
    const baseDir = makeTempDir();
    const { repoRoot, featureBranch, worktreeBase, mergeWorktreePath } =
      await setupRepoWithMergeWorktree(baseDir);

    const wm = new WorktreeManager({ repoRoot, worktreeBase, featureBranch, mergeWorktreePath });

    // Create a dedicated worktree that stays active
    const branch = 'eforge/plan-cleanup';
    const path = await wm.acquireForPlan('plan-cleanup', branch, true);
    expect(existsSync(path)).toBe(true);

    const report = await wm.cleanupAll();

    expect(report.removed.length + report.fallback.length).toBeGreaterThanOrEqual(1);
    expect(report.failed).toHaveLength(0);

    // Verify worktree base directory is gone
    expect(existsSync(worktreeBase)).toBe(false);
  });

  it('cleanupAll has removed, fallback, and failed arrays', async () => {
    const baseDir = makeTempDir();
    const { repoRoot, featureBranch, worktreeBase, mergeWorktreePath } =
      await setupRepoWithMergeWorktree(baseDir);

    const wm = new WorktreeManager({ repoRoot, worktreeBase, featureBranch, mergeWorktreePath });

    const report = await wm.cleanupAll();

    // Verify the report has the expected shape
    expect(Array.isArray(report.removed)).toBe(true);
    expect(Array.isArray(report.fallback)).toBe(true);
    expect(Array.isArray(report.failed)).toBe(true);
  });
});
