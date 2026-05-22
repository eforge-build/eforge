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
import type { EforgeConfig } from '@eforge-build/engine/config';

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

/** Make a minimal engineConfig that locks trunk to a specific branch. */
function makeEngineConfig(trunkBranch: string, allowLocalMergeToTrunk = false): Pick<EforgeConfig, 'build'> {
  return {
    build: {
      worktreeDir: undefined,
      postMergeCommands: undefined,
      postMergeCommandTimeoutMs: undefined,
      maxValidationRetries: 2,
      cleanupPlanFiles: false,
      onSuccess: 'merge-to-base-branch',
      trunkBranch,
      allowLocalMergeToTrunk,
    },
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
      // Allow local merge to trunk so the action succeeds
      const engineConfig = makeEngineConfig('main', true);

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
      expect(landingStart.action).toBe('merge-to-base-branch');
      expect(landingStart.trunkBranch).toBe('main');
      expect(landingStart.workflow).toBe('trunk-local-merge');

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
      const engineConfig = makeEngineConfig('main', true);

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

    // --- eforge:region plan-03-branch-aware-landing ---
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
        action: 'merge-to-base-branch',
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
    // --- eforge:endregion plan-03-branch-aware-landing ---
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

      // --- eforge:region plan-03-branch-aware-landing ---
      const landingStart = events.find((e) => e.type === 'landing:start') as Extract<EforgeEvent, { type: 'landing:start' }>;
      expect(landingStart.workflow).toBe('leave-branch');
      // --- eforge:endregion plan-03-branch-aware-landing ---

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
        // Lock trunk to "main" for deterministic workflow classification
        const engineConfig = makeEngineConfig('main');

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
          engineConfig,
        }));

        const eventTypes = events.map((e) => e.type);
        expect(eventTypes).toContain('landing:start');
        expect(eventTypes).toContain('landing:complete');
        expect(eventTypes).not.toContain('merge:finalize:start');
        expect(eventTypes).not.toContain('merge:finalize:complete');
        expect(eventTypes).not.toContain('merge:finalize:skipped');
        expect(eventTypes).not.toContain('landing:skipped');

        const landingStart = events.find((e) => e.type === 'landing:start') as Extract<EforgeEvent, { type: 'landing:start' }>;
        // --- eforge:region plan-03-branch-aware-landing ---
        expect(landingStart.workflow).toBe('trunk-pr');
        // --- eforge:endregion plan-03-branch-aware-landing ---

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
