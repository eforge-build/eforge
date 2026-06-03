import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync, existsSync, readFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { useTempDir } from './test-tmpdir.js';
import { executeLandingAction } from '@eforge-build/engine/landing';
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

  describe('leave-branch', () => {
    it('emits only landing:start and landing:complete (no merge:finalize:* events)', async () => {
      const dir = makeTempDir();
      const repoRoot = await initRepo(dir);
      const worktreeBase = join(dir, 'worktrees');
      const featureBranch = 'eforge/test-set';
      const mergeWorktreePath = await setupFeatureBranch(repoRoot, worktreeBase, featureBranch);

      const wm = new WorktreeManager({ repoRoot, worktreeBase, featureBranch, mergeWorktreePath });
      const state = makeMinimalState(featureBranch);
      const config = makeMinimalConfig(featureBranch);

      const { events, result } = await drainLanding(executeLandingAction({
        action: 'leave',
        featureBranch,
        baseBranch: 'main',
        repoRoot,
        mergeWorktreePath,
        worktreeManager: wm,
        modelTracker: new ModelTracker(),
        commitMessage: '',
        state,
        config,
      }));

      const eventTypes = events.map((e) => e.type);
      expect(eventTypes).toContain('landing:start');
      expect(eventTypes).toContain('landing:complete');
      expect(eventTypes).not.toContain('merge:finalize:start');
      expect(eventTypes).not.toContain('merge:finalize:complete');
      expect(eventTypes).not.toContain('merge:finalize:skipped');
      expect(eventTypes).not.toContain('landing:skipped');

      const landingComplete = events.find((e) => e.type === 'landing:complete') as Extract<EforgeEvent, { type: 'landing:complete' }>;
      expect(landingComplete.action).toBe('leave');

      const landingStart = events.find((e) => e.type === 'landing:start') as Extract<EforgeEvent, { type: 'landing:start' }>;
      expect(landingStart.workflow).toBe('leave-branch');

      expect(result.landingSucceeded).toBe(true);
    });

    it('feature branch is preserved after leave-branch', async () => {
      const dir = makeTempDir();
      const repoRoot = await initRepo(dir);
      const worktreeBase = join(dir, 'worktrees');
      const featureBranch = 'eforge/test-set';
      const mergeWorktreePath = await setupFeatureBranch(repoRoot, worktreeBase, featureBranch);

      const wm = new WorktreeManager({ repoRoot, worktreeBase, featureBranch, mergeWorktreePath });
      const state = makeMinimalState(featureBranch);
      const config = makeMinimalConfig(featureBranch);

      await drainLanding(executeLandingAction({
        action: 'leave',
        featureBranch,
        baseBranch: 'main',
        repoRoot,
        mergeWorktreePath,
        worktreeManager: wm,
        modelTracker: new ModelTracker(),
        commitMessage: '',
        state,
        config,
      }));

      // Feature branch should still exist
      const { stdout: branches } = await exec('git', ['branch', '--list', featureBranch], { cwd: repoRoot });
      expect(branches.trim()).toContain(featureBranch);

      // Main should NOT have feature.ts (no merge happened)
      const { stdout: currentBranch } = await exec('git', ['branch', '--show-current'], { cwd: repoRoot });
      expect(currentBranch.trim()).toBe('main');
      expect(existsSync(join(repoRoot, 'feature.ts'))).toBe(false);
    });
  });
