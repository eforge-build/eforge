import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync, existsSync, readFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { useTempDir } from './test-tmpdir.js';
import { executeLandingAction, type LandingActionOptions } from '@eforge-build/engine/landing';
import { WorktreeManager } from '@eforge-build/engine/worktree-manager';
import { createMergeWorktree } from '@eforge-build/engine/worktree-ops';
import { ModelTracker } from '@eforge-build/engine/model-tracker';
import type { EforgeEvent } from '@eforge-build/engine/events';
import {
  addRemote,
  createFakeGhBin,
  drainLanding,
  exec,
  initRepo,
  makeEngineConfig,
  makeMinimalConfig,
  makeMinimalState,
  setupFeatureBranch,
  setupRemote,
} from './landing-actions-helpers.js';

const makeTempDir = useTempDir('eforge-landing-');

// --- eforge:region merge-to-base-branch ---
  describe('merge-to-base-branch', () => {
    it('emits landing:start, merge:finalize:start, merge:finalize:complete, landing:complete', async () => {
      const dir = makeTempDir();
      const repoRoot = await initRepo(dir);
      const worktreeBase = join(dir, 'worktrees');
      const featureBranch = 'eforge/test-set';
      const mergeWorktreePath = await setupFeatureBranch(repoRoot, worktreeBase, featureBranch);

      const wm = new WorktreeManager({ repoRoot, worktreeBase, featureBranch, mergeWorktreePath });
      const state = makeMinimalState(featureBranch);
      const config = makeMinimalConfig(featureBranch);
      // Allow local merge to trunk so the action succeeds
      const engineConfig = makeEngineConfig('main', true);

      const opts: LandingActionOptions = {
        action: 'merge',
        featureBranch,
        baseBranch: 'main',
        repoRoot,
        mergeWorktreePath,
        worktreeManager: wm,
        modelTracker: new ModelTracker(),
        commitMessage: 'feat(test-set): merge feature',
        state,
        config,
        engineConfig,
      };

      const { events, result } = await drainLanding(executeLandingAction(opts));

      const eventTypes = events.map((e) => e.type);
      expect(eventTypes).toContain('landing:start');
      expect(eventTypes).toContain('merge:finalize:start');
      expect(eventTypes).toContain('merge:finalize:complete');
      expect(eventTypes).toContain('landing:complete');
      expect(eventTypes).not.toContain('landing:skipped');
      expect(eventTypes).not.toContain('merge:finalize:skipped');

      // Events contain action field
      const landingStart = events.find((e) => e.type === 'landing:start') as Extract<EforgeEvent, { type: 'landing:start' }>;
      expect(landingStart.action).toBe('merge');
      expect(landingStart.trunkBranch).toBe('main');
      expect(landingStart.workflow).toBe('trunk-local-merge');

      const landingComplete = events.find((e) => e.type === 'landing:complete') as Extract<EforgeEvent, { type: 'landing:complete' }>;
      expect(landingComplete.action).toBe('merge');
      expect(landingComplete.commitSha).toBeTruthy();

      expect(result.landingSucceeded).toBe(true);
      expect(result.commitSha).toBeTruthy();
    });

    it('feature branch is merged into base after merge-to-base-branch succeeds', async () => {
      const dir = makeTempDir();
      const repoRoot = await initRepo(dir);
      const worktreeBase = join(dir, 'worktrees');
      const featureBranch = 'eforge/test-set';
      const mergeWorktreePath = await setupFeatureBranch(repoRoot, worktreeBase, featureBranch);

      const wm = new WorktreeManager({ repoRoot, worktreeBase, featureBranch, mergeWorktreePath });
      const state = makeMinimalState(featureBranch);
      const config = makeMinimalConfig(featureBranch);
      const engineConfig = makeEngineConfig('main', true);

      await drainLanding(executeLandingAction({
        action: 'merge',
        featureBranch,
        baseBranch: 'main',
        repoRoot,
        mergeWorktreePath,
        worktreeManager: wm,
        modelTracker: new ModelTracker(),
        commitMessage: 'feat(test-set): merge feature',
        state,
        config,
        engineConfig,
      }));

      // Feature branch should now be on main (merged)
      const { stdout: currentBranch } = await exec('git', ['branch', '--show-current'], { cwd: repoRoot });
      expect(currentBranch.trim()).toBe('main');

      // feature.ts should exist on main after merge
      expect(existsSync(join(repoRoot, 'feature.ts'))).toBe(true);
    });

    it('emits merge:finalize:skipped and landing:skipped on merge failure', async () => {
      const dir = makeTempDir();
      const repoRoot = await initRepo(dir);
      const worktreeBase = join(dir, 'worktrees');
      const featureBranch = 'eforge/test-set';
      const mergeWorktreePath = await setupFeatureBranch(repoRoot, worktreeBase, featureBranch);

      // Create a conflicting change on main AFTER the feature branch was created
      writeFileSync(join(repoRoot, 'feature.ts'), 'export const x = 999; // conflict\n');
      execFileSync('git', ['-C', repoRoot, 'add', '.']);
      execFileSync('git', ['-C', repoRoot, 'commit', '-m', 'conflicting change on main']);

      const wm = new WorktreeManager({ repoRoot, worktreeBase, featureBranch, mergeWorktreePath });
      const state = makeMinimalState(featureBranch);
      const config = makeMinimalConfig(featureBranch);
      const engineConfig = makeEngineConfig('main', true);

      const { events, result } = await drainLanding(executeLandingAction({
        action: 'merge',
        featureBranch,
        baseBranch: 'main',
        repoRoot,
        mergeWorktreePath,
        worktreeManager: wm,
        modelTracker: new ModelTracker(),
        commitMessage: 'feat(test-set): merge feature',
        state,
        config,
        engineConfig,
      }));

      const eventTypes = events.map((e) => e.type);
      expect(eventTypes).toContain('landing:start');
      expect(eventTypes).toContain('merge:finalize:start');
      expect(eventTypes).toContain('merge:finalize:skipped');
      expect(eventTypes).toContain('landing:skipped');
      expect(eventTypes).not.toContain('merge:finalize:complete');
      expect(eventTypes).not.toContain('landing:complete');

      expect(result.landingSucceeded).toBe(false);
    });

    it('rejects merge-to-base-branch when baseBranch is trunk and allowLocalMergeToTrunk is false', async () => {
      const dir = makeTempDir();
      const repoRoot = await initRepo(dir);
      const worktreeBase = join(dir, 'worktrees');
      const featureBranch = 'eforge/test-set';
      const mergeWorktreePath = await setupFeatureBranch(repoRoot, worktreeBase, featureBranch);

      const wm = new WorktreeManager({ repoRoot, worktreeBase, featureBranch, mergeWorktreePath });
      const state = makeMinimalState(featureBranch);
      const config = makeMinimalConfig(featureBranch);
      // Trunk is "main" but allowLocalMergeToTrunk is false (default)
      const engineConfig = makeEngineConfig('main', false);

      const { events, result } = await drainLanding(executeLandingAction({
        action: 'merge',
        featureBranch,
        baseBranch: 'main',
        repoRoot,
        mergeWorktreePath,
        worktreeManager: wm,
        modelTracker: new ModelTracker(),
        commitMessage: 'feat(test-set): merge feature',
        state,
        config,
        engineConfig,
      }));

      const eventTypes = events.map((e) => e.type);
      expect(eventTypes).toContain('landing:start');
      expect(eventTypes).toContain('merge:finalize:skipped');
      expect(eventTypes).toContain('landing:skipped');
      expect(eventTypes).not.toContain('merge:finalize:start');
      expect(eventTypes).not.toContain('landing:complete');

      const landingStart = events.find((e) => e.type === 'landing:start') as Extract<EforgeEvent, { type: 'landing:start' }>;
      expect(landingStart.workflow).toBe('trunk-local-merge');

      const landingSkipped = events.find((e) => e.type === 'landing:skipped') as Extract<EforgeEvent, { type: 'landing:skipped' }>;
      // Reason must mention the rejected workflow AND the opt-in escape hatch, not
      // just one or the other (loose `/allowLocalMergeToTrunk/` matches any unrelated
      // message that happens to name the flag).
      expect(landingSkipped.reason).toMatch(/[Ll]ocal merge to trunk/);
      expect(landingSkipped.reason).toMatch(/allowLocalMergeToTrunk/);
      // mergeToBase must NOT have run — feature.ts from the eforge work branch
      // must be absent from main's tree.
      const featureOnMain = await exec('git', ['cat-file', '-e', 'main:feature.ts'], { cwd: repoRoot })
        .then(() => 'exists' as const, () => 'missing' as const);
      expect(featureOnMain).toBe('missing');

      expect(result.landingSucceeded).toBe(false);
    });

    it('WF3: trunk local merge succeeds and does not push trunk to remote', async () => {
      const dir = makeTempDir();
      const repoRoot = await initRepo(dir);
      const remotePath = setupRemote(dir);
      addRemote(repoRoot, remotePath);

      // Push initial main to remote so the remote has the branch
      execFileSync('git', ['-C', repoRoot, 'push', 'origin', 'main']);

      // Capture remote main SHA before any merge
      const { stdout: remoteMainShaBefore } = await exec('git', ['--git-dir', remotePath, 'rev-parse', 'main']);
      const remoteMainShaBefore_ = remoteMainShaBefore.trim();

      const worktreeBase = join(dir, 'worktrees');
      const featureBranch = 'eforge/test-set';
      const mergeWorktreePath = await setupFeatureBranch(repoRoot, worktreeBase, featureBranch);

      const wm = new WorktreeManager({ repoRoot, worktreeBase, featureBranch, mergeWorktreePath });
      const state = makeMinimalState(featureBranch);
      const config = makeMinimalConfig(featureBranch);
      // Allow local merge to trunk (WF3 opt-in)
      const engineConfig = makeEngineConfig('main', true);

      const { events, result } = await drainLanding(executeLandingAction({
        action: 'merge',
        featureBranch,
        baseBranch: 'main',
        repoRoot,
        mergeWorktreePath,
        worktreeManager: wm,
        modelTracker: new ModelTracker(),
        commitMessage: 'feat(test-set): merge feature',
        state,
        config,
        engineConfig,
      }));

      const eventTypes = events.map((e) => e.type);
      expect(eventTypes).toContain('landing:start');
      expect(eventTypes).toContain('merge:finalize:start');
      expect(eventTypes).toContain('merge:finalize:complete');
      expect(eventTypes).toContain('landing:complete');
      expect(eventTypes).not.toContain('landing:skipped');

      const landingStart = events.find((e) => e.type === 'landing:start') as Extract<EforgeEvent, { type: 'landing:start' }>;
      expect(landingStart.workflow).toBe('trunk-local-merge');
      expect(landingStart.trunkBranch).toBe('main');

      expect(result.landingSucceeded).toBe(true);
      expect(result.commitSha).toBeTruthy();

      // Local main must contain feature.ts (merge actually happened)
      execFileSync('git', ['-C', repoRoot, 'checkout', 'main']);
      expect(existsSync(join(repoRoot, 'feature.ts'))).toBe(true);

      // Remote main SHA must be unchanged — trunk was NOT pushed
      const { stdout: remoteMainShaAfter } = await exec('git', ['--git-dir', remotePath, 'rev-parse', 'main']);
      expect(remoteMainShaAfter.trim()).toBe(remoteMainShaBefore_);
    });

    it('allows merge-to-base-branch for non-trunk feature branch regardless of allowLocalMergeToTrunk', async () => {
      const dir = makeTempDir();
      const repoRoot = await initRepo(dir);
      const worktreeBase = join(dir, 'worktrees');
      const featureBranch = 'eforge/test-set';

      // Create a feature branch "feature/parent" as the target base branch
      execFileSync('git', ['-C', repoRoot, 'checkout', '-b', 'feature/parent']);
      writeFileSync(join(repoRoot, 'parent.ts'), 'export const p = 1;\n');
      execFileSync('git', ['-C', repoRoot, 'add', '.']);
      execFileSync('git', ['-C', repoRoot, 'commit', '-m', 'feat: add parent.ts']);

      // Create eforge feature branch from feature/parent
      execFileSync('git', ['-C', repoRoot, 'checkout', '-b', featureBranch]);
      writeFileSync(join(repoRoot, 'feature.ts'), 'export const x = 1;\n');
      execFileSync('git', ['-C', repoRoot, 'add', '.']);
      execFileSync('git', ['-C', repoRoot, 'commit', '-m', 'feat: add feature.ts']);
      // Go back to feature/parent for the merge worktree
      execFileSync('git', ['-C', repoRoot, 'checkout', 'feature/parent']);

      const mergeWorktreePath = await createMergeWorktree(repoRoot, worktreeBase, featureBranch, 'feature/parent');

      const wm = new WorktreeManager({ repoRoot, worktreeBase, featureBranch, mergeWorktreePath });
      const state = makeMinimalState(featureBranch);
      const config = { ...makeMinimalConfig(featureBranch), baseBranch: 'feature/parent' };
      // Trunk is "main", allowLocalMergeToTrunk is false — but baseBranch is not trunk
      const engineConfig = makeEngineConfig('main', false);

      const { events, result } = await drainLanding(executeLandingAction({
        action: 'merge',
        featureBranch,
        baseBranch: 'feature/parent',
        repoRoot,
        mergeWorktreePath,
        worktreeManager: wm,
        modelTracker: new ModelTracker(),
        commitMessage: 'feat(test-set): merge feature',
        state,
        config,
        engineConfig,
      }));

      const eventTypes = events.map((e) => e.type);
      expect(eventTypes).toContain('landing:start');
      expect(eventTypes).toContain('merge:finalize:start');
      expect(eventTypes).toContain('merge:finalize:complete');
      expect(eventTypes).toContain('landing:complete');
      expect(eventTypes).not.toContain('landing:skipped');

      const landingStart = events.find((e) => e.type === 'landing:start') as Extract<EforgeEvent, { type: 'landing:start' }>;
      expect(landingStart.workflow).toBe('feature-local-merge');
      expect(landingStart.trunkBranch).toBe('main');

      expect(result.landingSucceeded).toBe(true);

      // The eforge work branch's file must be present on feature/parent (the merge
      // target), and absent from main (which must be untouched).
      const { stdout: currentBranch } = await exec('git', ['branch', '--show-current'], { cwd: repoRoot });
      expect(currentBranch.trim()).toBe('feature/parent');
      expect(existsSync(join(repoRoot, 'feature.ts'))).toBe(true);

      const featureOnMain = await exec('git', ['cat-file', '-e', 'main:feature.ts'], { cwd: repoRoot })
        .then(() => 'exists' as const, () => 'missing' as const);
      expect(featureOnMain).toBe('missing');
    });
  });
// --- eforge:endregion merge-to-base-branch ---
