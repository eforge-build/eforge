/**
 * Runtime tests for stack landing via executeStackLanding and stackLanding phase.
 *
 * These tests use stub providers to verify:
 *   1. Provider calls are made with the correct argv (trackBranch, submitBranch).
 *   2. stack:provider:command events are emitted for each provider call.
 *   3. stack:landing:update events are emitted for started, complete, skipped, failed outcomes.
 *   4. Durable landing state (action, status, prUrl, timestamps) is persisted.
 *   5. Missing provider causes the expected error (mentions 'git-spice' and 'stacking.gitSpice.command').
 *   6. Non-stacked builds do not instantiate or call the stack provider.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PullRequestMetadata } from '@eforge-build/engine/pr-metadata';
import {
  executeStackLanding,
  type StackLandingOptions,
  type StackProviderAdapter,
  type ProviderCommandResult,
  loadStackState,
  upsertStackLayer,
  GitSpiceNotAvailableError,
  GitSpiceCommandError,
  createGitSpiceAdapter,
} from '@eforge-build/engine/stacking';
import { stackLanding } from '@eforge-build/engine/orchestrator/phases';
import type { PhaseContext } from '@eforge-build/engine/orchestrator/phases';
import type { EforgeEvent } from '@eforge-build/engine/events';
import type { StackBaseContext } from '@eforge-build/engine/stacking';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export let cwd: string;

const gitSpiceCommand = 'git-spice';
const branchCommand = 'branch';
const stackCommand = 'stack';
const repoCommand = 'repo';
const submitCommand = 'submit';
const syncCommand = 'sync';
const restackCommand = 'restack';

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'eforge-stack-runtime-'));
});

export function makeResult(command: string, args: string[], stdout = ''): ProviderCommandResult {
  return { command, args, stdout, stderr: '', exitCode: 0 };
}

export function makeStubProvider(overrides?: Partial<StackProviderAdapter>): StackProviderAdapter {
  return {
    requireAvailable: async () => {},
    trackBranch: async (_cwd, base) =>
      makeResult(gitSpiceCommand, [branchCommand, 'track', '--base', base]),
    retargetBranch: async (_cwd, branch, target) =>
      makeResult(gitSpiceCommand, [branchCommand, 'onto', target, '--branch', branch]),
    submitBranch: async () =>
      makeResult(
        gitSpiceCommand,
        [branchCommand, submitCommand],
        'Created PR https://github.com/owner/repo/pull/42',
      ),
    submitStack: async () => makeResult(gitSpiceCommand, [stackCommand, submitCommand]),
    syncRepo: async () => makeResult(gitSpiceCommand, [repoCommand, syncCommand]),
    restackBranch: async () => makeResult(gitSpiceCommand, [branchCommand, restackCommand]),
    restackStack: async () => makeResult(gitSpiceCommand, [stackCommand, restackCommand]),
    upstackOnto: async (_cwd, target) => makeResult(gitSpiceCommand, ['upstack', 'onto', target]),
    commandPreview: (argv) => ({ command: gitSpiceCommand, args: argv }),
    syncRepoPreview: () => ({ command: gitSpiceCommand, args: [repoCommand, syncCommand] }),
    restackStackPreview: () => ({ command: gitSpiceCommand, args: [stackCommand, restackCommand] }),
    parsePrUrl: (stdout) => stdout.match(/https:\/\/github\.com\/[^\s]+\/pull\/\d+/)?.[0],
    isValidPrUrl: (url) => /^https:\/\/github\.com\/.+\/pull\/\d+$/.test(url),
    redactMessage: (message) => message,
    ...overrides,
  };
}

export function makeStackContext(overrides?: Partial<StackBaseContext>): StackBaseContext {
  return {
    prdId: 'test-prd',
    stackId: 'test-stack',
    provider: 'git-spice',
    branch: 'eforge/test-prd',
    baseBranch: 'main',
    ...overrides,
  };
}

export async function collectEvents(gen: AsyncGenerator<EforgeEvent>): Promise<EforgeEvent[]> {
  const events: EforgeEvent[] = [];
  for await (const event of gen) events.push(event);
  return events;
}

export async function seedLayer(dir: string, prdId = 'test-prd'): Promise<void> {
  if (dir === cwd && !existsSync(join(dir, '.git'))) setupRemoteBaseRepo({ branch: `eforge/${prdId}` });
  const now = new Date().toISOString();
  await upsertStackLayer(dir, {
    prdId,
    stackId: 'test-stack',
    provider: 'git-spice',
    branch: `eforge/${prdId}`,
    status: 'built',
    recordedAt: now,
    updatedAt: now,
  });
}

export function initGitRepo(dir: string): void {
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
}

export function git(args: string[], dir = cwd): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf-8' }).trim();
}

export function setupRemoteBaseRepo(opts: { baseBranch?: string; branch?: string } = {}): { baseSha: string; branchSha: string; remoteDir: string } {
  const baseBranch = opts.baseBranch ?? 'main';
  const branch = opts.branch ?? 'eforge/test-prd';
  if (existsSync(join(cwd, '.git'))) {
    return { baseSha: git(['rev-parse', baseBranch]), branchSha: git(['rev-parse', 'HEAD']), remoteDir: join(cwd, 'remote.git') };
  }
  initGitRepo(cwd);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test User']);
  writeFileSync(join(cwd, 'root.txt'), 'root\n');
  git(['add', 'root.txt']);
  git(['commit', '-m', 'root']);
  git(['branch', '-M', 'main']);
  const remoteDir = join(cwd, 'remote.git');
  execFileSync('git', ['init', '--bare', remoteDir], { stdio: 'ignore' });
  git(['remote', 'add', 'origin', remoteDir]);
  git(['push', '-u', 'origin', 'main']);
  if (baseBranch !== 'main') {
    git(['checkout', '-b', baseBranch, 'main']);
    writeFileSync(join(cwd, 'base.txt'), `${baseBranch}\n`);
    git(['add', 'base.txt']);
    git(['commit', '-m', `base ${baseBranch}`]);
    git(['push', '-u', 'origin', baseBranch]);
  }
  const baseSha = git(['rev-parse', baseBranch]);
  git(['checkout', '-b', branch, baseBranch]);
  writeFileSync(join(cwd, 'child.txt'), `${branch}\n`);
  git(['add', 'child.txt']);
  git(['commit', '-m', `child ${branch}`]);
  return { baseSha, branchSha: git(['rev-parse', 'HEAD']), remoteDir };
}

export function advanceRemoteBase(fileName = 'remote-main.txt'): string {
  const currentBranch = git(['branch', '--show-current']);
  git(['checkout', 'main']);
  writeFileSync(join(cwd, fileName), `${Date.now()}\n`);
  git(['add', fileName]);
  git(['commit', '-m', `advance ${fileName}`]);
  git(['push', 'origin', 'main']);
  const sha = git(['rev-parse', 'HEAD']);
  git(['checkout', currentBranch]);
  return sha;
}

export function setupStackRepo(opts: { parentIntegrated: boolean; deleteParentRemote: boolean }): { parentSha: string } {
  initGitRepo(cwd);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test User']);
  writeFileSync(join(cwd, 'root.txt'), 'root\n');
  git(['add', 'root.txt']);
  git(['commit', '-m', 'root']);
  git(['branch', '-M', 'main']);
  const remoteDir = join(cwd, 'remote.git');
  execFileSync('git', ['init', '--bare', remoteDir], { stdio: 'ignore' });
  git(['remote', 'add', 'origin', remoteDir]);
  git(['push', '-u', 'origin', 'main']);
  git(['checkout', '-b', 'eforge/parent-prd']);
  writeFileSync(join(cwd, 'parent.txt'), 'parent\n');
  git(['add', 'parent.txt']);
  git(['commit', '-m', 'parent']);
  const parentSha = git(['rev-parse', 'HEAD']);
  git(['push', '-u', 'origin', 'eforge/parent-prd']);
  if (opts.parentIntegrated) {
    git(['checkout', 'main']);
    git(['merge', '--ff-only', 'eforge/parent-prd']);
    git(['push', 'origin', 'main']);
  }
  if (opts.deleteParentRemote) git(['push', 'origin', '--delete', 'eforge/parent-prd']);
  git(['checkout', '-b', 'eforge/test-prd']);
  writeFileSync(join(cwd, 'child.txt'), 'child\n');
  git(['add', 'child.txt']);
  git(['commit', '-m', 'child']);
  return { parentSha };
}

export const recoverableRestack = {
  kind: 'recoverable-conflict',
  operation: 'branch-restack',
  conflictKind: 'git-rebase',
  message: 'restack conflict',
  recoverable: true,
} as const;

export const interruptedRestack = {
  operation: 'branch-restack',
  conflictKind: 'git-rebase',
  branch: 'eforge/test-prd',
  conflictedFiles: [],
  conflictDiff: '',
} as const;

export const recoveryLifecycleTypes = new Set([
  'stack:landing:conflict:detected',
  'stack:landing:conflict:recovery:start',
  'stack:landing:conflict:recovery:complete',
  'stack:landing:conflict:recovery:failed',
]);

export function landingOptions(provider: StackProviderAdapter, overrides: Partial<StackLandingOptions> = {}): StackLandingOptions {
  const stackContext = overrides.stackContext ?? makeStackContext();
  if (!existsSync(join(cwd, '.git'))) setupRemoteBaseRepo({ baseBranch: stackContext.baseBranch ?? 'main', branch: stackContext.branch });
  return { cwd, mergeWorktreePath: cwd, stackContext, landingAction: 'pr', provider, ...overrides };
}

// ---------------------------------------------------------------------------
// executeStackLanding — PR action, argv construction
// ---------------------------------------------------------------------------

/**
 * Create a fake `gh` binary in a temp bin dir.
 *
 * @param binDir  - Absolute path of the directory to create `gh` in.
 * @param behavior - 'merge-success' | 'merge-fail'
 */
export function createFakeGhForStack(binDir: string, behavior: 'merge-success' | 'merge-fail'): void {
  execFileSync('mkdir', ['-p', binDir]);
  const scriptPath = join(binDir, 'gh');
  const exitCode = behavior === 'merge-success' ? 0 : 1;
  writeFileSync(scriptPath, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'pr' && args[1] === 'merge') {
  if (${exitCode} !== 0) { process.stderr.write('auto-merge not allowed\\n'); }
  else { process.stdout.write('auto-merge enabled\\n'); }
  process.exit(${exitCode});
}
process.exit(0);
`, { mode: 0o755 });
}

export function makeFakeGhForMetadata(binDir: string, editBehavior: 'success' | 'fail'): void {
  execFileSync('mkdir', ['-p', binDir]);
  const scriptPath = join(binDir, 'gh');
  const exitCode = editBehavior === 'success' ? 0 : 1;
  writeFileSync(scriptPath, `#!/usr/bin/env node
const args = process.argv.slice(2);
const fs = require('fs');
const path = require('path');
// Log pr subcommand invocations
if (args[0] === 'pr') {
  fs.appendFileSync(path.join(__dirname, '..', 'gh-pr-args.log'), JSON.stringify(args) + '\\n');
}
// Copy body-file content
const bodyFileIdx = args.indexOf('--body-file');
if (bodyFileIdx !== -1) {
  const bodyFile = args[bodyFileIdx + 1];
  if (bodyFile) {
    try {
      const body = fs.readFileSync(bodyFile, 'utf8');
      fs.appendFileSync(path.join(__dirname, '..', 'gh-pr-body.log'), body + '\\n---END---\\n');
    } catch {}
  }
}
if (args[0] === 'pr' && args[1] === 'merge') { process.exit(0); }
if (args[0] === 'pr' && args[1] === 'edit') {
  if (${exitCode} !== 0) { process.stderr.write('edit failed\\n'); }
  process.exit(${exitCode});
}
process.exit(0);
`, { mode: 0o755 });
}
export {
  executeStackLanding,
  loadStackState,
  upsertStackLayer,
  GitSpiceNotAvailableError,
  GitSpiceCommandError,
  stackLanding,
  createGitSpiceAdapter,
};
export type {
  PullRequestMetadata,
  StackLandingOptions,
  StackProviderAdapter,
  ProviderCommandResult,
  PhaseContext,
  EforgeEvent,
  StackBaseContext,
};
