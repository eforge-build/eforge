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

// --- eforge:region issue-pr-setup ---
  describe('issue-pr', () => {
    it('emits the default PR landing event sequence and no merge:finalize:* events', async () => {
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
          action: 'pr',
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
        expect(eventTypes).toEqual([
          'landing:start',
          'landing:complete',
          'landing:auto-merge:skipped',
        ]);
        expect(eventTypes).not.toContain('merge:finalize:start');
        expect(eventTypes).not.toContain('merge:finalize:complete');
        expect(eventTypes).not.toContain('merge:finalize:skipped');
        expect(eventTypes).not.toContain('landing:skipped');

        const landingStart = events.find((e) => e.type === 'landing:start') as Extract<EforgeEvent, { type: 'landing:start' }>;
        expect(landingStart.workflow).toBe('trunk-pr');

        const landingComplete = events.find((e) => e.type === 'landing:complete') as Extract<EforgeEvent, { type: 'landing:complete' }>;
        expect(landingComplete.action).toBe('pr');
        expect(landingComplete.prUrl).toBe('https://github.com/test/repo/pull/1');

        const autoMergeSkipped = events.find((e) => e.type === 'landing:auto-merge:skipped') as Extract<EforgeEvent, { type: 'landing:auto-merge:skipped' }>;
        expect(autoMergeSkipped.reason).toBe('Auto-merge not requested (policy is "ask")');

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
          action: 'pr',
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

    it('non-trunk issue-pr: direct PR — pushes eforge artifact branch, opens PR targeting base feature branch', async () => {
      const dir = makeTempDir();
      const repoRoot = await initRepo(dir);
      const remotePath = setupRemote(dir);
      addRemote(repoRoot, remotePath);

      // Push initial main to remote
      execFileSync('git', ['-C', repoRoot, 'push', 'origin', 'main']);

      const worktreeBase = join(dir, 'worktrees');
      const featureBranch = 'eforge/test-set';

      // Create feature/parent from main, add a file, commit, push
      execFileSync('git', ['-C', repoRoot, 'checkout', '-b', 'feature/parent']);
      writeFileSync(join(repoRoot, 'parent.ts'), 'export const p = 1;\n');
      execFileSync('git', ['-C', repoRoot, 'add', '.']);
      execFileSync('git', ['-C', repoRoot, 'commit', '-m', 'feat: add parent.ts']);
      execFileSync('git', ['-C', repoRoot, 'push', 'origin', 'feature/parent']);

      // Create eforge work branch from feature/parent, add feature.ts, commit
      execFileSync('git', ['-C', repoRoot, 'checkout', '-b', featureBranch]);
      writeFileSync(join(repoRoot, 'feature.ts'), 'export const x = 1;\n');
      execFileSync('git', ['-C', repoRoot, 'add', '.']);
      execFileSync('git', ['-C', repoRoot, 'commit', '-m', 'feat: add feature.ts']);

      // Go back to feature/parent
      execFileSync('git', ['-C', repoRoot, 'checkout', 'feature/parent']);

      // Create merge worktree with eforge work branch
      const mergeWorktreePath = await createMergeWorktree(repoRoot, worktreeBase, featureBranch, 'feature/parent');

      const ghBinDir = createFakeGhBin(dir, 'create-new');
      const origPath = process.env.PATH;
      process.env.PATH = `${ghBinDir}:${origPath}`;

      try {
        const wm = new WorktreeManager({ repoRoot, worktreeBase, featureBranch, mergeWorktreePath });
        const state = makeMinimalState(featureBranch);
        const config = { ...makeMinimalConfig(featureBranch), baseBranch: 'feature/parent' };
        // Default trunk policy — trunk is main, baseBranch is non-trunk
        const engineConfig = makeEngineConfig('main', false);

        const { events, result } = await drainLanding(executeLandingAction({
          action: 'pr',
          featureBranch,
          baseBranch: 'feature/parent',
          repoRoot,
          mergeWorktreePath,
          worktreeManager: wm,
          modelTracker: new ModelTracker(),
          commitMessage: 'feat: merge eforge work into feature/parent',
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
        // Direct non-trunk PR: workflow is feature-pr, not feature-pr-after-local-merge
        expect(landingStart.workflow).toBe('feature-pr');
        expect(landingStart.trunkBranch).toBe('main');

        const landingComplete = events.find((e) => e.type === 'landing:complete') as Extract<EforgeEvent, { type: 'landing:complete' }>;
        expect(landingComplete.action).toBe('pr');
        expect(landingComplete.prUrl).toBe('https://github.com/test/repo/pull/1');

        expect(result.landingSucceeded).toBe(true);
        expect(result.prUrl).toBe('https://github.com/test/repo/pull/1');

        // Regression: feature/parent must NOT contain feature.ts — no local merge occurred
        const featureOnParent = await exec('git', ['cat-file', '-e', 'feature/parent:feature.ts'], { cwd: repoRoot })
          .then(() => 'exists' as const, () => 'missing' as const);
        expect(featureOnParent).toBe('missing');

        // Trunk (main) must NOT contain feature.ts
        const featureOnMain = await exec('git', ['cat-file', '-e', 'main:feature.ts'], { cwd: repoRoot })
          .then(() => 'exists' as const, () => 'missing' as const);
        expect(featureOnMain).toBe('missing');

        // eforge artifact branch (eforge/test-set) must have been pushed to origin
        const { stdout: localFeatureSha } = await exec('git', ['-C', repoRoot, 'rev-parse', featureBranch]);
        const { stdout: remoteFeatureSha } = await exec('git', ['--git-dir', remotePath, 'rev-parse', featureBranch]);
        expect(remoteFeatureSha.trim()).toBe(localFeatureSha.trim());

        // gh pr create must have been called with --base feature/parent --head eforge/test-set
        const ghArgsLog = readFileSync(join(ghBinDir, 'gh-args.log'), 'utf-8').trim();
        const lastInvocation: string[] = JSON.parse(ghArgsLog.split('\n').at(-1)!);
        const baseIdx = lastInvocation.indexOf('--base');
        const headIdx = lastInvocation.indexOf('--head');
        expect(baseIdx).toBeGreaterThan(-1);
        expect(headIdx).toBeGreaterThan(-1);
        expect(lastInvocation[baseIdx + 1]).toBe('feature/parent');
        expect(lastInvocation[headIdx + 1]).toBe('eforge/test-set');
      } finally {
        process.env.PATH = origPath;
      }
    });

// --- eforge:endregion issue-pr-setup ---

// --- eforge:region existing-pr-behavior ---
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
          action: 'pr',
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

        const ghArgsLog = readFileSync(join(ghBinDir, 'gh-args.log'), 'utf-8').trim();
        const invocations: string[][] = ghArgsLog.split('\n').map((line) => JSON.parse(line));
        const viewInvocation = invocations.find((args) => args[0] === 'pr' && args[1] === 'view');
        expect(viewInvocation).toBeDefined();
        expect(viewInvocation).toContain(featureBranch);
        expect(viewInvocation).toContain('--json');
        expect(viewInvocation).toContain('url,baseRefName');
      } finally {
        process.env.PATH = origPath;
      }
    });

// --- eforge:endregion existing-pr-behavior ---

// --- eforge:region pr-metadata ---
    it('direct PR create uses --title and --body-file, does not use --fill', async () => {
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
        const engineConfig = makeEngineConfig('main');

        await drainLanding(executeLandingAction({
          action: 'pr',
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

        const ghArgsLog = readFileSync(join(ghBinDir, 'gh-args.log'), 'utf-8').trim();
        const invocations: string[][] = ghArgsLog.split('\n').map((line) => JSON.parse(line));
        const createInvocation = invocations.find((args) => args[0] === 'pr' && args[1] === 'create');

        expect(createInvocation).toBeDefined();
        expect(createInvocation).toContain('--title');
        expect(createInvocation).toContain('--body-file');
        expect(createInvocation).not.toContain('--fill');
      } finally {
        process.env.PATH = origPath;
      }
    });

    it('direct PR create body-file content contains required fields and excludes raw trailers', async () => {
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
        const engineConfig = makeEngineConfig('main');
        // Record a model to verify Models used section appears
        const tracker = new ModelTracker();
        tracker.record('claude-opus-4-5');

        await drainLanding(executeLandingAction({
          action: 'pr',
          featureBranch,
          baseBranch: 'main',
          repoRoot,
          mergeWorktreePath,
          worktreeManager: wm,
          modelTracker: tracker,
          commitMessage: '',
          state,
          config,
          engineConfig,
        }));

        const body = readFileSync(join(ghBinDir, 'gh-body.log'), 'utf-8');

        // Required fields
        expect(body).toContain('Plan set:');
        expect(body).toContain('test-set');
        expect(body).toContain('Base branch:');
        expect(body).toContain('main');
        expect(body).toContain('Artifact branch:');
        expect(body).toContain('eforge/test-set');
        expect(body).toContain('plan-01');

        // Models used summary (no raw trailer label)
        expect(body).toContain('Models used');
        expect(body).toContain('claude-opus-4-5');

        // Must NOT contain raw commit trailer labels
        expect(body).not.toContain('Co-Authored-By:');
        expect(body).not.toContain('Models-Used:');
      } finally {
        process.env.PATH = origPath;
      }
    });

    it('existing PR fallback returns URL and attempts gh pr edit with deterministic metadata', async () => {
      const dir = makeTempDir();
      const repoRoot = await initRepo(dir);
      const remotePath = setupRemote(dir);
      addRemote(repoRoot, remotePath);
      execFileSync('git', ['-C', repoRoot, 'push', 'origin', 'main']);

      const worktreeBase = join(dir, 'worktrees');
      const featureBranch = 'eforge/test-set';
      const mergeWorktreePath = await setupFeatureBranch(repoRoot, worktreeBase, featureBranch);

      // Use the existing-pr gh shim (pr create fails, pr view returns URL, pr edit succeeds)
      const ghBinDir = createFakeGhBin(dir, 'existing-pr');
      const origPath = process.env.PATH;
      process.env.PATH = `${ghBinDir}:${origPath}`;

      try {
        const wm = new WorktreeManager({ repoRoot, worktreeBase, featureBranch, mergeWorktreePath });
        const state = makeMinimalState(featureBranch);
        const config = makeMinimalConfig(featureBranch);

        const { result } = await drainLanding(executeLandingAction({
          action: 'pr',
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

        // URL must be the discovered existing PR URL
        expect(result.prUrl).toBe('https://github.com/test/repo/pull/42');
        expect(result.landingSucceeded).toBe(true);

        // gh pr edit must have been called with the discovered URL
        const ghArgsLog = readFileSync(join(ghBinDir, 'gh-args.log'), 'utf-8').trim();
        const invocations: string[][] = ghArgsLog.split('\n').map((line) => JSON.parse(line));
        const viewInvocation = invocations.find((args) => args[0] === 'pr' && args[1] === 'view');
        expect(viewInvocation).toBeDefined();
        expect(viewInvocation).toContain(featureBranch);
        expect(viewInvocation).toContain('--json');
        expect(viewInvocation).toContain('url,baseRefName');

        const editInvocation = invocations.find((args) => args[0] === 'pr' && args[1] === 'edit');

        expect(editInvocation).toBeDefined();
        expect(editInvocation).toContain('https://github.com/test/repo/pull/42');
        const titleIdx = editInvocation!.indexOf('--title');
        expect(titleIdx).toBeGreaterThan(-1);
        expect(editInvocation![titleIdx + 1]).toBe('Test set');
        expect(editInvocation).toContain('--body-file');

        const bodyLog = readFileSync(join(ghBinDir, 'gh-body.log'), 'utf-8');
        const editBody = bodyLog.split('---edit---\n').at(1)?.split('\n---END---')[0];
        expect(editBody).toContain('Plan set:');
        expect(editBody).toContain('test-set');
        expect(editBody).toContain('Artifact branch:');
        expect(editBody).toContain('eforge/test-set');
      } finally {
        process.env.PATH = origPath;
      }
    });

// --- eforge:endregion pr-metadata ---

// --- eforge:region auto-merge ---
    it('pr with policy=always emits landing:auto-merge:start and landing:auto-merge:complete when gh pr merge succeeds', async () => {
      const dir = makeTempDir();
      const repoRoot = await initRepo(dir);
      const remotePath = setupRemote(dir);
      addRemote(repoRoot, remotePath);
      execFileSync('git', ['-C', repoRoot, 'push', 'origin', 'main']);

      const worktreeBase = join(dir, 'worktrees');
      const featureBranch = 'eforge/test-set';
      const mergeWorktreePath = await setupFeatureBranch(repoRoot, worktreeBase, featureBranch);

      // Fake gh that handles both pr create and pr merge
      const binDir = join(dir, 'bin-auto-merge-ok');
      execFileSync('mkdir', ['-p', binDir]);
      const scriptPath = join(binDir, 'gh');
      writeFileSync(scriptPath, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === '--version') { process.stdout.write('gh version test\\n'); process.exit(0); }
if (args[0] === 'pr' && args[1] === 'create') { process.stdout.write('https://github.com/test/repo/pull/1\\n'); process.exit(0); }
if (args[0] === 'pr' && args[1] === 'merge') { process.stdout.write('Auto-merge enabled\\n'); process.exit(0); }
process.exit(0);
`, { mode: 0o755 });
      try { chmodSync(scriptPath, 0o755); } catch { /* best-effort */ }

      const origPath = process.env.PATH;
      process.env.PATH = `${binDir}:${origPath}`;

      try {
        const wm = new WorktreeManager({ repoRoot, worktreeBase, featureBranch, mergeWorktreePath });
        const state = makeMinimalState(featureBranch);
        const config = makeMinimalConfig(featureBranch);
        const engineConfig = makeEngineConfig('main');

        const { events, result } = await drainLanding(executeLandingAction({
          action: 'pr',
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
          prAutoMergePolicy: 'always',
        }));

        const eventTypes = events.map((e) => e.type);
        expect(eventTypes).toContain('landing:complete');
        expect(eventTypes).toContain('landing:auto-merge:start');
        expect(eventTypes).toContain('landing:auto-merge:complete');
        expect(eventTypes).not.toContain('landing:auto-merge:skipped');
        expect(result.landingSucceeded).toBe(true);
      } finally {
        process.env.PATH = origPath;
      }
    });

    it('pr with policy=ask and landingAutoMerge=false emits landing:auto-merge:skipped', async () => {
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
        const engineConfig = makeEngineConfig('main');

        const { events, result } = await drainLanding(executeLandingAction({
          action: 'pr',
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
          prAutoMergePolicy: 'ask',
          landingAutoMerge: false,
        }));

        const eventTypes = events.map((e) => e.type);
        expect(eventTypes).toContain('landing:complete');
        expect(eventTypes).toContain('landing:auto-merge:skipped');
        expect(eventTypes).not.toContain('landing:auto-merge:start');
        expect(result.landingSucceeded).toBe(true);
      } finally {
        process.env.PATH = origPath;
      }
    });

    it('pr with policy=never emits landing:auto-merge:skipped even when landingAutoMerge=true', async () => {
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
        const engineConfig = makeEngineConfig('main');

        const { events, result } = await drainLanding(executeLandingAction({
          action: 'pr',
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
          prAutoMergePolicy: 'never',
          landingAutoMerge: true,
        }));

        const eventTypes = events.map((e) => e.type);
        expect(eventTypes).toContain('landing:complete');
        expect(eventTypes).toContain('landing:auto-merge:skipped');
        expect(eventTypes).not.toContain('landing:auto-merge:start');
        expect(result.landingSucceeded).toBe(true);

        const skippedEvent = events.find((e) => e.type === 'landing:auto-merge:skipped') as Extract<EforgeEvent, { type: 'landing:auto-merge:skipped' }>;
        expect(skippedEvent.reason).toMatch(/[Nn]ever/i);
      } finally {
        process.env.PATH = origPath;
      }
    });

    it('non-fatal: gh pr merge failure emits landing:auto-merge:skipped and landingSucceeded is true', async () => {
      const dir = makeTempDir();
      const repoRoot = await initRepo(dir);
      const remotePath = setupRemote(dir);
      addRemote(repoRoot, remotePath);
      execFileSync('git', ['-C', repoRoot, 'push', 'origin', 'main']);

      const worktreeBase = join(dir, 'worktrees');
      const featureBranch = 'eforge/test-set';
      const mergeWorktreePath = await setupFeatureBranch(repoRoot, worktreeBase, featureBranch);

      // Fake gh: pr create succeeds, pr merge fails
      const binDir = join(dir, 'bin-merge-fail');
      execFileSync('mkdir', ['-p', binDir]);
      const scriptPath = join(binDir, 'gh');
      writeFileSync(scriptPath, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === '--version') { process.stdout.write('gh version test\\n'); process.exit(0); }
if (args[0] === 'pr' && args[1] === 'create') { process.stdout.write('https://github.com/test/repo/pull/1\\n'); process.exit(0); }
if (args[0] === 'pr' && args[1] === 'merge') { process.stderr.write('auto-merge not allowed by branch protection\\n'); process.exit(1); }
process.exit(0);
`, { mode: 0o755 });
      try { chmodSync(scriptPath, 0o755); } catch { /* best-effort */ }

      const origPath = process.env.PATH;
      process.env.PATH = `${binDir}:${origPath}`;

      try {
        const wm = new WorktreeManager({ repoRoot, worktreeBase, featureBranch, mergeWorktreePath });
        const state = makeMinimalState(featureBranch);
        const config = makeMinimalConfig(featureBranch);
        const engineConfig = makeEngineConfig('main');

        const { events, result } = await drainLanding(executeLandingAction({
          action: 'pr',
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
          prAutoMergePolicy: 'always',
        }));

        const eventTypes = events.map((e) => e.type);
        // PR landing must succeed even though auto-merge failed
        expect(eventTypes).toContain('landing:complete');
        expect(eventTypes).toContain('landing:auto-merge:start');
        expect(eventTypes).toContain('landing:auto-merge:skipped');
        expect(eventTypes).not.toContain('landing:auto-merge:complete');
        expect(result.landingSucceeded).toBe(true);
        expect(result.prUrl).toBe('https://github.com/test/repo/pull/1');
      } finally {
        process.env.PATH = origPath;
      }
    });

    it('pr with policy=always and existing PR emits landing:auto-merge events with existing PR URL', async () => {
      const dir = makeTempDir();
      const repoRoot = await initRepo(dir);
      const remotePath = setupRemote(dir);
      addRemote(repoRoot, remotePath);
      execFileSync('git', ['-C', repoRoot, 'push', 'origin', 'main']);

      const worktreeBase = join(dir, 'worktrees');
      const featureBranch = 'eforge/test-set';
      const mergeWorktreePath = await setupFeatureBranch(repoRoot, worktreeBase, featureBranch);

      // Fake gh: pr create fails (existing), pr view succeeds, pr merge succeeds
      const binDir = join(dir, 'bin-existing-automerge');
      execFileSync('mkdir', ['-p', binDir]);
      const scriptPath = join(binDir, 'gh');
      writeFileSync(scriptPath, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === '--version') { process.stdout.write('gh version test\\n'); process.exit(0); }
if (args[0] === 'pr' && args[1] === 'create') {
  process.stderr.write('a pull request for branch "eforge/test-set" already exists:\\nhttps://github.com/test/repo/pull/42\\n');
  process.exit(1);
}
if (args[0] === 'pr' && args[1] === 'view') {
  if (args.includes('url,baseRefName')) {
    process.stdout.write(JSON.stringify({ url: 'https://github.com/test/repo/pull/42', baseRefName: 'main' }) + '\\n');
  } else {
    process.stdout.write('https://github.com/test/repo/pull/42\\n');
  }
  process.exit(0);
}
if (args[0] === 'pr' && args[1] === 'merge') { process.stdout.write('Auto-merge enabled\\n'); process.exit(0); }
process.exit(1);
`, { mode: 0o755 });
      try { chmodSync(scriptPath, 0o755); } catch { /* best-effort */ }

      const origPath = process.env.PATH;
      process.env.PATH = `${binDir}:${origPath}`;

      try {
        const wm = new WorktreeManager({ repoRoot, worktreeBase, featureBranch, mergeWorktreePath });
        const state = makeMinimalState(featureBranch);
        const config = makeMinimalConfig(featureBranch);
        const engineConfig = makeEngineConfig('main');

        const { events, result } = await drainLanding(executeLandingAction({
          action: 'pr',
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
          prAutoMergePolicy: 'always',
        }));

        const eventTypes = events.map((e) => e.type);
        expect(eventTypes).toContain('landing:complete');
        expect(eventTypes).toContain('landing:auto-merge:start');
        expect(eventTypes).toContain('landing:auto-merge:complete');
        expect(result.landingSucceeded).toBe(true);
        expect(result.prUrl).toBe('https://github.com/test/repo/pull/42');
      } finally {
        process.env.PATH = origPath;
      }
    });

  });
// --- eforge:endregion auto-merge ---
