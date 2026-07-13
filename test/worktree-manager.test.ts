import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { useTempDir } from './test-tmpdir.js';
import { WorktreeManager } from '@eforge-build/engine/worktree-manager';
import { createMergeWorktree } from '@eforge-build/engine/worktree-ops';
import { ModelTracker } from '@eforge-build/engine/model-tracker';

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

  it('captures direct-on-merge base SHA and computes plan diff statuses', async () => {
    const baseDir = makeTempDir();
    const { repoRoot, featureBranch, worktreeBase, mergeWorktreePath } =
      await setupRepoWithMergeWorktree(baseDir);

    writeFileSync(join(mergeWorktreePath, 'modified.txt'), 'before\n');
    writeFileSync(join(mergeWorktreePath, 'deleted.txt'), 'delete me\n');
    writeFileSync(join(mergeWorktreePath, 'old-name.txt'), 'rename me\n');
    await exec('git', ['add', '.'], { cwd: mergeWorktreePath });
    await exec('git', ['commit', '-m', 'feature base files'], { cwd: mergeWorktreePath });

    const wm = new WorktreeManager({ repoRoot, worktreeBase, featureBranch, mergeWorktreePath });
    await wm.acquireForPlan('plan-direct-diff', 'eforge/plan-direct-diff', false);

    writeFileSync(join(mergeWorktreePath, 'added.txt'), 'added\n');
    writeFileSync(join(mergeWorktreePath, 'modified.txt'), 'after\n');
    await exec('git', ['rm', 'deleted.txt'], { cwd: mergeWorktreePath });
    await exec('git', ['mv', 'old-name.txt', 'new-name.txt'], { cwd: mergeWorktreePath });
    await exec('git', ['add', '.'], { cwd: mergeWorktreePath });
    await exec('git', ['commit', '-m', 'direct plan changes'], { cwd: mergeWorktreePath });

    const diff = await wm.getPlanDiff('plan-direct-diff', { branch: 'eforge/plan-direct-diff' });
    expect([...diff.files].sort((a, b) => a.path.localeCompare(b.path))).toEqual([
      { path: 'added.txt', status: 'added' },
      { path: 'deleted.txt', status: 'deleted' },
      { path: 'modified.txt', status: 'modified' },
      { path: 'new-name.txt', status: 'renamed' },
    ]);
  });

  it('captures dedicated worktree base SHA and computes plan diffs before feature branch mutations', async () => {
    const baseDir = makeTempDir();
    const { repoRoot, featureBranch, worktreeBase, mergeWorktreePath } =
      await setupRepoWithMergeWorktree(baseDir);

    writeFileSync(join(mergeWorktreePath, 'base.txt'), 'base\n');
    await exec('git', ['add', '.'], { cwd: mergeWorktreePath });
    await exec('git', ['commit', '-m', 'feature base file'], { cwd: mergeWorktreePath });

    const wm = new WorktreeManager({ repoRoot, worktreeBase, featureBranch, mergeWorktreePath });
    const planBranch = 'eforge/plan-dedicated-diff';
    const planPath = await wm.acquireForPlan('plan-dedicated-diff', planBranch, true);

    writeFileSync(join(planPath, 'plan-only.txt'), 'plan change\n');
    await exec('git', ['add', '.'], { cwd: planPath });
    await exec('git', ['commit', '-m', 'dedicated plan changes'], { cwd: planPath });

    writeFileSync(join(mergeWorktreePath, 'feature-after-acquire.txt'), 'should not be in plan diff\n');
    await exec('git', ['add', '.'], { cwd: mergeWorktreePath });
    await exec('git', ['commit', '-m', 'feature branch after plan acquire'], { cwd: mergeWorktreePath });

    const diff = await wm.getPlanDiff('plan-dedicated-diff', { branch: planBranch });
    expect(diff.files).toEqual([{ path: 'plan-only.txt', status: 'added' }]);
  });

  it('computes final merge diffs from the merge base so base-only changes are not reported', async () => {
    const baseDir = makeTempDir();
    const { repoRoot, featureBranch, worktreeBase, mergeWorktreePath, baseBranch } =
      await setupRepoWithMergeWorktree(baseDir);

    const wm = new WorktreeManager({ repoRoot, worktreeBase, featureBranch, mergeWorktreePath });

    writeFileSync(join(mergeWorktreePath, 'feature-only.txt'), 'feature change\n');
    await exec('git', ['add', '.'], { cwd: mergeWorktreePath });
    await exec('git', ['commit', '-m', 'feature-only change'], { cwd: mergeWorktreePath });

    writeFileSync(join(repoRoot, 'base-only.txt'), 'base change\n');
    await exec('git', ['add', '.'], { cwd: repoRoot });
    await exec('git', ['commit', '-m', 'base-only change'], { cwd: repoRoot });

    const diff = await wm.getFinalMergeDiff(baseBranch);
    expect(diff.files).toEqual([{ path: 'feature-only.txt', status: 'added' }]);
  });

  it('keeps final evidence limited to child changes after parent integration, deletion, and trunk advancement', async () => {
    const baseDir = makeTempDir();
    const { repoRoot, featureBranch, worktreeBase, mergeWorktreePath } =
      await setupRepoWithMergeWorktree(baseDir, 'child');
    const wm = new WorktreeManager({ repoRoot, worktreeBase, featureBranch, mergeWorktreePath });

    await exec('git', ['switch', '-c', 'eforge/parent'], { cwd: repoRoot });
    writeFileSync(join(repoRoot, 'parent-only.txt'), 'parent\n');
    await exec('git', ['add', '.'], { cwd: repoRoot });
    await exec('git', ['commit', '-m', 'parent'], { cwd: repoRoot });
    const { stdout: pinOut } = await exec('git', ['rev-parse', 'HEAD'], { cwd: repoRoot });
    const pin = pinOut.trim();

    await exec('git', ['rebase', 'eforge/parent'], { cwd: mergeWorktreePath });
    writeFileSync(join(mergeWorktreePath, 'child-only.txt'), 'child\n');
    await exec('git', ['add', '.'], { cwd: mergeWorktreePath });
    await exec('git', ['commit', '-m', 'child'], { cwd: mergeWorktreePath });
    expect((await wm.getFinalMergeDiff('eforge/parent', pin)).files).toEqual([{ path: 'child-only.txt', status: 'added' }]);

    await exec('git', ['switch', 'main'], { cwd: repoRoot });
    await exec('git', ['merge', '--ff-only', 'eforge/parent'], { cwd: repoRoot });
    writeFileSync(join(repoRoot, 'trunk-only.txt'), 'trunk\n');
    await exec('git', ['add', '.'], { cwd: repoRoot });
    await exec('git', ['commit', '-m', 'unrelated trunk advancement'], { cwd: repoRoot });
    await exec('git', ['branch', '-D', 'eforge/parent'], { cwd: repoRoot });

    // The immutable pin, not the advanced trunk or deleted logical branch,
    // remains the divergence base used by final policy evidence.
    expect((await wm.getFinalMergeDiff('main', pin)).files).toEqual([{ path: 'child-only.txt', status: 'added' }]);
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

  it('mergePlan includes Models-Used: trailer when modelTracker is non-empty', async () => {
    const baseDir = makeTempDir();
    const { repoRoot, featureBranch, worktreeBase, mergeWorktreePath } =
      await setupRepoWithMergeWorktree(baseDir);

    const wm = new WorktreeManager({ repoRoot, worktreeBase, featureBranch, mergeWorktreePath });
    const branch = 'eforge/plan-models-used';
    const path = await wm.acquireForPlan('plan-models-used', branch, true);

    // Commit on plan worktree
    writeFileSync(join(path, 'impl.txt'), 'implementation\n');
    await exec('git', ['add', '.'], { cwd: path });
    await exec('git', ['commit', '-m', 'implement feature'], { cwd: path });

    // Create a non-empty ModelTracker
    const tracker = new ModelTracker();
    tracker.record('claude-opus-4-5');
    tracker.record('claude-sonnet-4-5');

    await wm.mergePlan(
      'plan-models-used',
      { id: 'plan-models-used', name: 'Models Used Test', branch },
      { modelTracker: tracker },
    );

    // Inspect the commit message on the merge worktree
    const { stdout: commitMsg } = await exec('git', ['log', '-1', '--format=%B'], { cwd: mergeWorktreePath });
    const msg = commitMsg.trim();

    // Models-Used: trailer should appear before Co-Authored-By: trailer
    const modelsUsedIdx = msg.indexOf('Models-Used:');
    const coAuthoredIdx = msg.indexOf('Co-Authored-By:');
    expect(modelsUsedIdx).toBeGreaterThan(-1);
    expect(coAuthoredIdx).toBeGreaterThan(-1);
    expect(modelsUsedIdx).toBeLessThan(coAuthoredIdx);

    // Models should be sorted lexicographically
    expect(msg).toContain('Models-Used: claude-opus-4-5, claude-sonnet-4-5');
  });

  it('mergePlan omits Models-Used: trailer when modelTracker is empty', async () => {
    const baseDir = makeTempDir();
    const { repoRoot, featureBranch, worktreeBase, mergeWorktreePath } =
      await setupRepoWithMergeWorktree(baseDir);

    const wm = new WorktreeManager({ repoRoot, worktreeBase, featureBranch, mergeWorktreePath });
    const branch = 'eforge/plan-no-models';
    const path = await wm.acquireForPlan('plan-no-models', branch, true);

    writeFileSync(join(path, 'impl.txt'), 'implementation\n');
    await exec('git', ['add', '.'], { cwd: path });
    await exec('git', ['commit', '-m', 'implement'], { cwd: path });

    // Empty tracker
    const emptyTracker = new ModelTracker();

    await wm.mergePlan(
      'plan-no-models',
      { id: 'plan-no-models', name: 'No Models Test', branch },
      { modelTracker: emptyTracker },
    );

    const { stdout: commitMsg } = await exec('git', ['log', '-1', '--format=%B'], { cwd: mergeWorktreePath });
    expect(commitMsg).not.toContain('Models-Used:');
  });

  it('mergePlan throws when builtOnMerge plan has uncommitted tracked changes', async () => {
    const baseDir = makeTempDir();
    const { repoRoot, featureBranch, worktreeBase, mergeWorktreePath } =
      await setupRepoWithMergeWorktree(baseDir);

    const wm = new WorktreeManager({ repoRoot, worktreeBase, featureBranch, mergeWorktreePath });
    await wm.acquireForPlan('plan-dirty-tracked', 'eforge/plan-dirty-tracked', false);

    // Write a file and stage it but do NOT commit it
    writeFileSync(join(mergeWorktreePath, 'dirty-tracked.ts'), 'uncommitted changes\n');
    await exec('git', ['add', 'dirty-tracked.ts'], { cwd: mergeWorktreePath });

    await expect(wm.mergePlan(
      'plan-dirty-tracked',
      { id: 'plan-dirty-tracked', name: 'Dirty Tracked Plan', branch: 'eforge/plan-dirty-tracked' },
    )).rejects.toThrow('dirty-tracked.ts');
  });

  it('mergePlan throws when builtOnMerge plan has untracked implementation files', async () => {
    const baseDir = makeTempDir();
    const { repoRoot, featureBranch, worktreeBase, mergeWorktreePath } =
      await setupRepoWithMergeWorktree(baseDir);

    const wm = new WorktreeManager({ repoRoot, worktreeBase, featureBranch, mergeWorktreePath });
    await wm.acquireForPlan('plan-untracked', 'eforge/plan-untracked', false);

    // Write a file but do NOT add or commit it (untracked)
    writeFileSync(join(mergeWorktreePath, 'untracked-impl.ts'), 'untracked content\n');

    await expect(wm.mergePlan(
      'plan-untracked',
      { id: 'plan-untracked', name: 'Untracked Plan', branch: 'eforge/plan-untracked' },
    )).rejects.toThrow('untracked-impl.ts');
  });

  it('mergePlan throws when builtOnMerge plan has an empty commit (HEAD advances but no file diff)', async () => {
    const baseDir = makeTempDir();
    const { repoRoot, featureBranch, worktreeBase, mergeWorktreePath } =
      await setupRepoWithMergeWorktree(baseDir);

    const wm = new WorktreeManager({ repoRoot, worktreeBase, featureBranch, mergeWorktreePath });
    await wm.acquireForPlan('plan-empty-commit', 'eforge/plan-empty-commit', false);

    // Create an empty commit — HEAD advances but the committed diff vs baseSha is empty
    await exec('git', ['commit', '--allow-empty', '-m', 'empty commit'], { cwd: mergeWorktreePath });

    await expect(wm.mergePlan(
      'plan-empty-commit',
      { id: 'plan-empty-commit', name: 'Empty Commit Plan', branch: 'eforge/plan-empty-commit' },
    )).rejects.toThrow('no committed changes since baseSha');
  });

  it('mergePlan succeeds with empty commit when allowNoCommittedChanges waiver is provided', async () => {
    const baseDir = makeTempDir();
    const { repoRoot, featureBranch, worktreeBase, mergeWorktreePath } =
      await setupRepoWithMergeWorktree(baseDir);

    const wm = new WorktreeManager({ repoRoot, worktreeBase, featureBranch, mergeWorktreePath });
    await wm.acquireForPlan('plan-empty-waiver', 'eforge/plan-empty-waiver', false);

    // Create an empty commit — HEAD advances but the committed diff vs baseSha is empty
    await exec('git', ['commit', '--allow-empty', '-m', 'empty commit'], { cwd: mergeWorktreePath });

    let waiverCalled = false;
    const sha = await wm.mergePlan(
      'plan-empty-waiver',
      { id: 'plan-empty-waiver', name: 'Empty Waiver Plan', branch: 'eforge/plan-empty-waiver' },
      {
        allowNoCommittedChanges: true,
        noCommittedChangesReason: 'Config-only change with no file modifications',
        onNoCommittedChangesWaiver: () => { waiverCalled = true; },
      },
    );

    expect(sha).toBeTruthy();
    expect(waiverCalled).toBe(true);
  });

  it('mergePlan throws when builtOnMerge plan has no commits at all (HEAD === baseSha)', async () => {
    const baseDir = makeTempDir();
    const { repoRoot, featureBranch, worktreeBase, mergeWorktreePath } =
      await setupRepoWithMergeWorktree(baseDir);

    const wm = new WorktreeManager({ repoRoot, worktreeBase, featureBranch, mergeWorktreePath });
    await wm.acquireForPlan('plan-no-commit', 'eforge/plan-no-commit', false);

    // Do NOT make any commit — HEAD === baseSha

    await expect(wm.mergePlan(
      'plan-no-commit',
      { id: 'plan-no-commit', name: 'No Commit Plan', branch: 'eforge/plan-no-commit' },
    )).rejects.toThrow('no committed changes since baseSha');
  });

  it('mergePlan succeeds with no commits when allowNoCommittedChanges waiver is provided', async () => {
    const baseDir = makeTempDir();
    const { repoRoot, featureBranch, worktreeBase, mergeWorktreePath } =
      await setupRepoWithMergeWorktree(baseDir);

    const wm = new WorktreeManager({ repoRoot, worktreeBase, featureBranch, mergeWorktreePath });
    await wm.acquireForPlan('plan-no-commit-waiver', 'eforge/plan-no-commit-waiver', false);

    // Do NOT make any commit — HEAD === baseSha

    let waiverCalled = false;
    const sha = await wm.mergePlan(
      'plan-no-commit-waiver',
      { id: 'plan-no-commit-waiver', name: 'No Commit Waiver Plan', branch: 'eforge/plan-no-commit-waiver' },
      {
        allowNoCommittedChanges: true,
        noCommittedChangesReason: 'No implementation changes needed for this plan',
        onNoCommittedChangesWaiver: () => { waiverCalled = true; },
      },
    );

    expect(sha).toBeTruthy();
    expect(waiverCalled).toBe(true);
  });

  it('mergePlan succeeds and returns HEAD SHA when builtOnMerge plan changes are committed', async () => {
    const baseDir = makeTempDir();
    const { repoRoot, featureBranch, worktreeBase, mergeWorktreePath } =
      await setupRepoWithMergeWorktree(baseDir);

    const wm = new WorktreeManager({ repoRoot, worktreeBase, featureBranch, mergeWorktreePath });
    await wm.acquireForPlan('plan-committed', 'eforge/plan-committed', false);

    // Commit changes properly
    writeFileSync(join(mergeWorktreePath, 'committed.ts'), 'implementation\n');
    await exec('git', ['add', 'committed.ts'], { cwd: mergeWorktreePath });
    await exec('git', ['commit', '-m', 'implementation'], { cwd: mergeWorktreePath });

    const { stdout: expectedShaRaw } = await exec('git', ['rev-parse', 'HEAD'], { cwd: mergeWorktreePath });
    const expectedSha = expectedShaRaw.trim();

    const sha = await wm.mergePlan(
      'plan-committed',
      { id: 'plan-committed', name: 'Committed Plan', branch: 'eforge/plan-committed' },
    );

    expect(sha).toBe(expectedSha);
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it('mergePlan omits Models-Used: trailer when no modelTracker provided', async () => {
    const baseDir = makeTempDir();
    const { repoRoot, featureBranch, worktreeBase, mergeWorktreePath } =
      await setupRepoWithMergeWorktree(baseDir);

    const wm = new WorktreeManager({ repoRoot, worktreeBase, featureBranch, mergeWorktreePath });
    const branch = 'eforge/plan-no-tracker';
    const path = await wm.acquireForPlan('plan-no-tracker', branch, true);

    writeFileSync(join(path, 'impl.txt'), 'implementation\n');
    await exec('git', ['add', '.'], { cwd: path });
    await exec('git', ['commit', '-m', 'implement'], { cwd: path });

    // No tracker passed — existing behavior preserved
    await wm.mergePlan(
      'plan-no-tracker',
      { id: 'plan-no-tracker', name: 'No Tracker Test', branch },
    );

    const { stdout: commitMsg } = await exec('git', ['log', '-1', '--format=%B'], { cwd: mergeWorktreePath });
    expect(commitMsg).not.toContain('Models-Used:');
    expect(commitMsg).toContain('Co-Authored-By: forged-by-eforge');
  });
});
