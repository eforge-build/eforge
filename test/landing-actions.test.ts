/**
 * Integration tests for executeLandingAction — all three onSuccess actions
 * exercised against a real git repo in a temp directory.
 *
 * For issue-pr, a fake `gh` shim is placed in a bin/ directory prepended to PATH
 * so no real GitHub credentials are needed.
 */

// --- eforge:region plan-01-engine-config-and-landing ---

import { describe, it, expect } from 'vitest';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync, chmodSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { useTempDir } from './test-tmpdir.js';

import { executeLandingAction, type LandingActionOptions } from '@eforge-build/engine/landing';
import { WorktreeManager } from '@eforge-build/engine/worktree-manager';
import { createMergeWorktree } from '@eforge-build/engine/worktree-ops';
import { ModelTracker } from '@eforge-build/engine/model-tracker';
import type { EforgeEvent, EforgeState, OrchestrationConfig } from '@eforge-build/engine/events';

const exec = promisify(execFile);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const GIT_USER = ['git', '-c', 'user.email=test@test.com', '-c', 'user.name=Test'];

async function initRepo(dir: string): Promise<string> {
  const repoRoot = join(dir, 'repo');
  execFileSync('git', ['init', repoRoot]);
  execFileSync('git', ['-C', repoRoot, 'config', 'user.email', 'test@test.com']);
  execFileSync('git', ['-C', repoRoot, 'config', 'user.name', 'Test']);
  writeFileSync(join(repoRoot, 'README.md'), '# test\n');
  execFileSync('git', ['-C', repoRoot, 'add', '.']);
  execFileSync('git', ['-C', repoRoot, 'commit', '-m', 'initial commit']);
  execFileSync('git', ['-C', repoRoot, 'branch', '-M', 'main']);
  return repoRoot;
}

/**
 * Create the feature branch and merge worktree, make a commit on the feature branch,
 * then return cwd=mergeWorktreePath with featureBranch checked out.
 */
async function setupFeatureBranch(
  repoRoot: string,
  worktreeBase: string,
  featureBranch: string,
): Promise<string> {
  // Create feature branch from main
  execFileSync('git', ['-C', repoRoot, 'checkout', '-b', featureBranch]);
  writeFileSync(join(repoRoot, 'feature.ts'), 'export const x = 1;\n');
  execFileSync('git', ['-C', repoRoot, 'add', '.']);
  execFileSync('git', ['-C', repoRoot, 'commit', '-m', 'feat: add feature.ts']);
  // Go back to main
  execFileSync('git', ['-C', repoRoot, 'checkout', 'main']);
  // Create merge worktree
  const mergeWorktreePath = await createMergeWorktree(repoRoot, worktreeBase, featureBranch, 'main');
  return mergeWorktreePath;
}

/** Create a bare git repo to serve as a remote for push tests. */
function setupRemote(dir: string): string {
  const remotePath = join(dir, 'remote.git');
  execFileSync('git', ['init', '--bare', remotePath]);
  return remotePath;
}

/** Add a remote named 'origin' to the repo. */
function addRemote(repoRoot: string, remotePath: string): void {
  execFileSync('git', ['-C', repoRoot, 'remote', 'add', 'origin', remotePath]);
}

/**
 * Create a fake `gh` script in a temp bin dir and return the dir path.
 * The script is a Node.js script that simulates `gh pr create` behavior.
 *
 * @param behavior
 *   'create-new' — creates a new PR successfully
 *   'existing-pr' — fails on pr create (already exists), succeeds on pr view
 */
function createFakeGhBin(
  dir: string,
  behavior: 'create-new' | 'existing-pr',
): string {
  const binDir = join(dir, 'bin');
  execFileSync('mkdir', ['-p', binDir]);
  const scriptPath = join(binDir, 'gh');
  let scriptContent: string;

  if (behavior === 'create-new') {
    scriptContent = `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === '--version') {
  process.stdout.write('gh version test\\n');
  process.exit(0);
}
if (args[0] === 'pr' && args[1] === 'create') {
  process.stdout.write('https://github.com/test/repo/pull/1\\n');
  process.exit(0);
}
process.exit(0);
`;
  } else {
    scriptContent = `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === '--version') {
  process.stdout.write('gh version test\\n');
  process.exit(0);
}
if (args[0] === 'pr' && args[1] === 'create') {
  process.stderr.write('a pull request for branch "eforge/test-set" already exists:\\nhttps://github.com/test/repo/pull/42\\n');
  process.exit(1);
}
if (args[0] === 'pr' && args[1] === 'view') {
  process.stdout.write('https://github.com/test/repo/pull/42\\n');
  process.exit(0);
}
process.exit(1);
`;
  }

  writeFileSync(scriptPath, scriptContent, { mode: 0o755 });
  // On some systems node scripts need explicit chmod
  try { chmodSync(scriptPath, 0o755); } catch { /* best-effort */ }
  return binDir;
}

function makeMinimalConfig(featureBranch: string): OrchestrationConfig {
  return {
    name: 'test-set',
    description: 'Test set',
    created: '2026-01-01T00:00:00Z',
    mode: 'excursion',
    baseBranch: 'main',
    pipeline: {
      scope: 'excursion',
      compile: ['planner'],
      defaultBuild: ['builder'],
      defaultReview: { strategy: 'auto', perspectives: ['code'], maxRounds: 1, evaluatorStrictness: 'standard' },
      rationale: 'test',
    },
    plans: [{ id: 'plan-01', name: 'Plan 01', dependsOn: [], branch: `feature/plan-01`, build: ['builder'], review: { strategy: 'auto', perspectives: ['code'], maxRounds: 1, evaluatorStrictness: 'standard' } }],
  };
}

function makeMinimalState(featureBranch: string): EforgeState {
  return {
    setName: 'test-set',
    status: 'running',
    startedAt: new Date().toISOString(),
    baseBranch: 'main',
    featureBranch,
    worktreeBase: '/tmp/worktrees',
    plans: { 'plan-01': { status: 'merged', branch: 'feature/plan-01', dependsOn: [], merged: true } },
    completedPlans: ['plan-01'],
  };
}

/** Drain the async generator and return all yielded events plus the return value. */
async function drainLanding(
  gen: ReturnType<typeof executeLandingAction>,
): Promise<{ events: EforgeEvent[]; result: Awaited<ReturnType<typeof executeLandingAction>> extends AsyncGenerator<EforgeEvent, infer R> ? R : never }> {
  const events: EforgeEvent[] = [];
  while (true) {
    const next = await gen.next();
    if (next.done) {
      return { events, result: next.value as any };
    }
    events.push(next.value as EforgeEvent);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('executeLandingAction', () => {
  const makeTempDir = useTempDir('eforge-landing-');

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

      const opts: LandingActionOptions = {
        action: 'merge-to-base-branch',
        featureBranch,
        baseBranch: 'main',
        repoRoot,
        mergeWorktreePath,
        worktreeManager: wm,
        modelTracker: new ModelTracker(),
        commitMessage: 'feat(test-set): merge feature',
        state,
        config,
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
      expect(landingStart.action).toBe('merge-to-base-branch');

      const landingComplete = events.find((e) => e.type === 'landing:complete') as Extract<EforgeEvent, { type: 'landing:complete' }>;
      expect(landingComplete.action).toBe('merge-to-base-branch');
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

      await drainLanding(executeLandingAction({
        action: 'merge-to-base-branch',
        featureBranch,
        baseBranch: 'main',
        repoRoot,
        mergeWorktreePath,
        worktreeManager: wm,
        modelTracker: new ModelTracker(),
        commitMessage: 'feat(test-set): merge feature',
        state,
        config,
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

      const { events, result } = await drainLanding(executeLandingAction({
        action: 'merge-to-base-branch',
        featureBranch,
        baseBranch: 'main',
        repoRoot,
        mergeWorktreePath,
        worktreeManager: wm,
        modelTracker: new ModelTracker(),
        commitMessage: 'feat(test-set): merge feature',
        state,
        config,
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
  });

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
        action: 'leave-branch',
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
      expect(landingComplete.action).toBe('leave-branch');

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
        action: 'leave-branch',
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

  describe('issue-pr', () => {
    it('emits only landing:start and landing:complete (no merge:finalize:* events)', async () => {
      const dir = makeTempDir();
      const repoRoot = await initRepo(dir);
      const remotePath = setupRemote(dir);
      addRemote(repoRoot, remotePath);

      // Push initial commit to remote
      execFileSync('git', ['-C', repoRoot, 'push', 'origin', 'main']);

      const worktreeBase = join(dir, 'worktrees');
      const featureBranch = 'eforge/test-set';
      const mergeWorktreePath = await setupFeatureBranch(repoRoot, worktreeBase, featureBranch);

      const ghBinDir = createFakeGhBin(dir, 'create-new');
      const origPath = process.env.PATH;
      process.env.PATH = `${ghBinDir}:${origPath}`;

      try {
        const wm = new WorktreeManager({ repoRoot, worktreeBase, featureBranch, mergeWorktreePath });
        const state = makeMinimalState(featureBranch);
        const config = makeMinimalConfig(featureBranch);

        const { events, result } = await drainLanding(executeLandingAction({
          action: 'issue-pr',
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
        expect(landingComplete.action).toBe('issue-pr');
        expect(landingComplete.prUrl).toBe('https://github.com/test/repo/pull/1');

        expect(result.landingSucceeded).toBe(true);
        expect(result.prUrl).toBe('https://github.com/test/repo/pull/1');
      } finally {
        process.env.PATH = origPath;
      }
    });

    it('feature branch is preserved after issue-pr', async () => {
      const dir = makeTempDir();
      const repoRoot = await initRepo(dir);
      const remotePath = setupRemote(dir);
      addRemote(repoRoot, remotePath);
      execFileSync('git', ['-C', repoRoot, 'push', 'origin', 'main']);

      const worktreeBase = join(dir, 'worktrees');
      const featureBranch = 'eforge/test-set';
      const mergeWorktreePath = await setupFeatureBranch(repoRoot, worktreeBase, featureBranch);

      const ghBinDir = createFakeGhBin(dir, 'create-new');
      const origPath = process.env.PATH;
      process.env.PATH = `${ghBinDir}:${origPath}`;

      try {
        const wm = new WorktreeManager({ repoRoot, worktreeBase, featureBranch, mergeWorktreePath });
        const state = makeMinimalState(featureBranch);
        const config = makeMinimalConfig(featureBranch);

        await drainLanding(executeLandingAction({
          action: 'issue-pr',
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
      } finally {
        process.env.PATH = origPath;
      }
    });

    it('detects existing PR via stubbed gh and reports URL on landing:complete', async () => {
      const dir = makeTempDir();
      const repoRoot = await initRepo(dir);
      const remotePath = setupRemote(dir);
      addRemote(repoRoot, remotePath);
      execFileSync('git', ['-C', repoRoot, 'push', 'origin', 'main']);

      const worktreeBase = join(dir, 'worktrees');
      const featureBranch = 'eforge/test-set';
      const mergeWorktreePath = await setupFeatureBranch(repoRoot, worktreeBase, featureBranch);

      // Use the existing-pr gh shim
      const ghBinDir = createFakeGhBin(dir, 'existing-pr');
      const origPath = process.env.PATH;
      process.env.PATH = `${ghBinDir}:${origPath}`;

      try {
        const wm = new WorktreeManager({ repoRoot, worktreeBase, featureBranch, mergeWorktreePath });
        const state = makeMinimalState(featureBranch);
        const config = makeMinimalConfig(featureBranch);

        const { events, result } = await drainLanding(executeLandingAction({
          action: 'issue-pr',
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

        const landingComplete = events.find((e) => e.type === 'landing:complete') as Extract<EforgeEvent, { type: 'landing:complete' }> | undefined;
        expect(landingComplete).toBeDefined();
        expect(landingComplete?.prUrl).toBe('https://github.com/test/repo/pull/42');

        expect(result.landingSucceeded).toBe(true);
        expect(result.prUrl).toBe('https://github.com/test/repo/pull/42');
      } finally {
        process.env.PATH = origPath;
      }
    });
  });
});

// --- eforge:endregion plan-01-engine-config-and-landing ---
