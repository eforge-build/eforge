/**
 * Integration tests for executeLandingAction — all three onSuccess actions
 * exercised against a real git repo in a temp directory.
 *
 * For issue-pr, a fake `gh` shim is placed in a bin/ directory prepended to PATH
 * so no real GitHub credentials are needed.
 */


import { describe, it, expect } from 'vitest';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync, chmodSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useTempDir } from './test-tmpdir.js';

import { executeLandingAction, type LandingActionOptions } from '@eforge-build/engine/landing';
import { WorktreeManager } from '@eforge-build/engine/worktree-manager';
import { createMergeWorktree } from '@eforge-build/engine/worktree-ops';
import { ModelTracker } from '@eforge-build/engine/model-tracker';
import type { EforgeEvent, EforgeState, OrchestrationConfig } from '@eforge-build/engine/events';
import type { EforgeConfig } from '@eforge-build/engine/config';

export const exec = promisify(execFile);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const GIT_USER = ['git', '-c', 'user.email=test@test.com', '-c', 'user.name=Test'];

export async function initRepo(dir: string): Promise<string> {
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
export async function setupFeatureBranch(
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
export function setupRemote(dir: string): string {
  const remotePath = join(dir, 'remote.git');
  execFileSync('git', ['init', '--bare', remotePath]);
  return remotePath;
}

/** Add a remote named 'origin' to the repo. */
export function addRemote(repoRoot: string, remotePath: string): void {
  execFileSync('git', ['-C', repoRoot, 'remote', 'add', 'origin', remotePath]);
}

/**
 * Create a fake `gh` script in a temp bin dir and return the dir path.
 * The script is a Node.js script that simulates `gh pr create` behavior.
 *
 * Logs all `pr` subcommand args to `gh-args.log`.
 * Copies body-file content to `gh-body.log` when `--body-file` is present.
 *
 * @param behavior
 *   'create-new' — creates a new PR successfully
 *   'existing-pr' — fails on pr create (already exists), succeeds on pr view and pr edit
 */
export function createFakeGhBin(
  dir: string,
  behavior: 'create-new' | 'existing-pr',
): string {
  const binDir = join(dir, 'bin');
  execFileSync('mkdir', ['-p', binDir]);
  const scriptPath = join(binDir, 'gh');
  let scriptContent: string;

  // Shared preamble: log pr subcommand args and copy body-file content
  const preamble = `
const args = process.argv.slice(2);
const fs = require('fs');
const path = require('path');
if (args[0] === '--version') {
  process.stdout.write('gh version test\\n');
  process.exit(0);
}
// Log all pr subcommand invocations
if (args[0] === 'pr') {
  fs.appendFileSync(path.join(__dirname, 'gh-args.log'), JSON.stringify(args) + '\\n');
}
// Copy body-file content before engine deletes the temp file
const bodyFileIdx = args.indexOf('--body-file');
if (bodyFileIdx !== -1) {
  const bodyFile = args[bodyFileIdx + 1];
  if (bodyFile) {
    try {
      const body = fs.readFileSync(bodyFile, 'utf8');
      fs.appendFileSync(path.join(__dirname, 'gh-body.log'), '---' + args[1] + '---\\n' + body + '\\n---END---\\n');
    } catch {}
  }
}
`;

  if (behavior === 'create-new') {
    scriptContent = `#!/usr/bin/env node
${preamble}
if (args[0] === 'pr' && args[1] === 'create') {
  process.stdout.write('https://github.com/test/repo/pull/1\\n');
  process.exit(0);
}
if (args[0] === 'pr' && args[1] === 'edit') {
  process.exit(0);
}
process.exit(0);
`;
  } else {
    scriptContent = `#!/usr/bin/env node
${preamble}
if (args[0] === 'pr' && args[1] === 'create') {
  process.stderr.write('a pull request for branch "eforge/test-set" already exists:\\nhttps://github.com/test/repo/pull/42\\n');
  process.exit(1);
}
if (args[0] === 'pr' && args[1] === 'view') {
  if (args.includes('url,baseRefName')) {
    process.stdout.write(JSON.stringify({ url: 'https://github.com/test/repo/pull/42', baseRefName: 'main' }) + '\\n');
    process.exit(0);
  }
  process.stderr.write('missing base-aware PR lookup (--json url,baseRefName)\\n');
  process.exit(1);
}
if (args[0] === 'pr' && args[1] === 'edit') {
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

export function makeMinimalConfig(featureBranch: string): OrchestrationConfig {
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

export function makeMinimalState(featureBranch: string): EforgeState {
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
export function makeEngineConfig(trunkBranch: string, allowLocalMergeToTrunk = false): Pick<EforgeConfig, 'build'> {
  return {
    build: {
      worktreeDir: undefined,
      postMergeCommands: undefined,
      postMergeCommandTimeoutMs: undefined,
      maxValidationRetries: 2,
      cleanupPlanFiles: false,
      trunkBranch,
      allowLocalMergeToTrunk,
    },
  };
}

/** Drain the async generator and return all yielded events plus the return value. */
export async function drainLanding(
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
