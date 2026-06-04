/**
 * Regression coverage for direct non-stacked PR base synchronization and
 * final PR freshness guards. Uses real temporary git repositories and fake gh
 * shims rather than mocking engine internals.
 */

import { describe, expect, it } from 'vitest';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  checkDirectPrBaseFreshness,
  DEFAULT_DIRECT_PR_FRESHNESS_RETRIES,
  syncDirectPrBase,
} from '@eforge-build/engine/direct-pr-base-sync';
import { executeLandingAction } from '@eforge-build/engine/landing';
import { finalize, isDirectPrBaseSyncApplicable, prdValidate, recordArtifact, syncDirectPrBaseBeforeValidation, validate, type PhaseContext } from '@eforge-build/engine/orchestrator/phases';
import { WorktreeManager } from '@eforge-build/engine/worktree-manager';
import type { EforgeEvent, EforgeState, OrchestrationConfig } from '@eforge-build/engine/events';
import type { EforgeConfig } from '@eforge-build/engine/config';
import type { MergeResolver } from '@eforge-build/engine/worktree-ops';
import { ModelTracker } from '@eforge-build/engine/model-tracker';
import { loadArtifactRegistry } from '@eforge-build/engine/artifacts/registry';
import { useTempDir } from './test-tmpdir.js';

const makeTempDir = useTempDir('eforge-direct-pr-base-sync-');
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' };

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: GIT_ENV }).trim();
}

function initOriginAndRepo(tmp: string): { origin: string; repo: string } {
  const origin = join(tmp, 'origin.git');
  const repo = join(tmp, 'repo');
  execFileSync('git', ['init', '--bare', origin]);
  execFileSync('git', ['clone', origin, repo], { env: GIT_ENV });
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'user.name', 'Test']);
  writeFileSync(join(repo, 'README.md'), '# repo\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-m', 'initial']);
  git(repo, ['branch', '-M', 'main']);
  git(repo, ['push', '-u', 'origin', 'main']);
  return { origin, repo };
}

function makeCommit(cwd: string, file: string, body: string, message: string): string {
  writeFileSync(join(cwd, file), body);
  git(cwd, ['add', file]);
  git(cwd, ['commit', '-m', message]);
  return git(cwd, ['rev-parse', 'HEAD']);
}

function advanceRemote(tmp: string, origin: string, branch: string, file: string, body: string): string {
  const clone = join(tmp, `advance-${branch.replace(/[^a-zA-Z0-9_-]/g, '-')}-${Date.now()}`);
  execFileSync('git', ['clone', origin, clone], { env: GIT_ENV });
  git(clone, ['config', 'user.email', 'test@example.com']);
  git(clone, ['config', 'user.name', 'Test']);
  git(clone, ['checkout', branch]);
  const sha = makeCommit(clone, file, body, `advance ${branch}`);
  git(clone, ['push', 'origin', `HEAD:${branch}`]);
  return sha;
}

function createFeature(repo: string, branch = 'eforge/test'): void {
  git(repo, ['checkout', 'main']);
  git(repo, ['checkout', '-b', branch]);
  makeCommit(repo, 'feature.txt', 'feature\n', 'feature commit');
}

function isAncestor(cwd: string, ancestor: string, descendant = 'HEAD'): boolean {
  try {
    git(cwd, ['merge-base', '--is-ancestor', ancestor, descendant]);
    return true;
  } catch {
    return false;
  }
}

function fakeGh(tmp: string, behavior: 'create' | 'existing' | 'auto-merge' = 'create'): { bin: string; log: string } {
  const bin = join(tmp, 'bin');
  mkdirSync(bin, { recursive: true });
  const log = join(bin, 'gh.log');
  const script = `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
if (args[0] === '--version') { process.stdout.write('gh version test\\n'); process.exit(0); }
if (args[0] === 'pr') fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
if (args[0] === 'pr' && args[1] === 'create') {
  ${behavior === 'existing' ? "process.stderr.write('a pull request already exists\\n'); process.exit(1);" : "process.stdout.write('https://github.com/test/repo/pull/1\\n'); process.exit(0);"}
}
if (args[0] === 'pr' && args[1] === 'view') { process.stdout.write(JSON.stringify({ url: 'https://github.com/test/repo/pull/42', baseRefName: 'main' }) + '\\n'); process.exit(0); }
if (args[0] === 'pr' && args[1] === 'edit') process.exit(0);
if (args[0] === 'pr' && args[1] === 'merge') process.exit(0);
process.exit(0);
`;
  const gh = join(bin, 'gh');
  writeFileSync(gh, script);
  chmodSync(gh, 0o755);
  return { bin, log };
}

function withPath<T>(bin: string, fn: () => Promise<T>): Promise<T> {
  const prev = process.env.PATH;
  process.env.PATH = `${bin}:${prev ?? ''}`;
  return fn().finally(() => { process.env.PATH = prev; });
}

function minimalConfig(baseBranch = 'main'): OrchestrationConfig {
  return {
    name: 'test-set', description: 'test', created: new Date().toISOString(), mode: 'excursion', baseBranch,
    pipeline: { scope: 'excursion', compile: ['planner'], defaultBuild: ['builder'], defaultReview: { strategy: 'auto', perspectives: ['code'], maxRounds: 1, evaluatorStrictness: 'standard' }, rationale: 'test' },
    plans: [{ id: 'plan-01', name: 'Plan 01', branch: 'plan-01', dependsOn: [], build: ['builder'], review: { strategy: 'auto', perspectives: ['code'], maxRounds: 1, evaluatorStrictness: 'standard' } }],
  };
}

function minimalState(featureBranch: string, baseBranch = 'main'): EforgeState {
  return { setName: 'test-set', status: 'running', startedAt: new Date().toISOString(), baseBranch, featureBranch, worktreeBase: '/tmp', plans: {}, completedPlans: [] };
}

function phaseCtx(overrides: Partial<PhaseContext>): PhaseContext {
  const featureBranch = overrides.featureBranch ?? 'eforge/test';
  const config = overrides.config ?? minimalConfig();
  const state = overrides.state ?? minimalState(featureBranch, config.baseBranch);
  return {
    repoRoot: overrides.repoRoot ?? overrides.mergeWorktreePath ?? '', mergeWorktreePath: overrides.mergeWorktreePath ?? overrides.repoRoot ?? '',
    worktreeManager: overrides.worktreeManager ?? ({} as WorktreeManager), featureBranch, config, state,
    engineConfig: overrides.engineConfig ?? ({ build: { maxValidationRetries: 0, cleanupPlanFiles: false } } as Pick<EforgeConfig, 'build'>),
    maxConcurrency: 1, maxValidationRetries: 0, landingAction: overrides.landingAction ?? 'pr', modelTracker: new ModelTracker(),
    ...overrides,
  } as PhaseContext;
}

async function drain<T>(gen: AsyncGenerator<EforgeEvent, T>): Promise<{ events: EforgeEvent[]; result: T }> {
  const events: EforgeEvent[] = [];
  while (true) {
    const next = await gen.next();
    if (next.done) return { events, result: next.value };
    events.push(next.value);
  }
}

async function drainEvents(gen: AsyncGenerator<EforgeEvent>): Promise<EforgeEvent[]> {
  return (await drain(gen)).events;
}

describe('direct PR base sync', () => {
  it('rebases a trunk direct PR feature branch onto an advanced origin/main before validation observes the tree', async () => {
    const tmp = makeTempDir();
    const { origin, repo } = initOriginAndRepo(tmp);
    createFeature(repo);
    const advancedSha = advanceRemote(tmp, origin, 'main', 'base-observed.txt', 'advanced base\n');

    const result = await syncDirectPrBase({ cwd: repo, featureBranch: 'eforge/test', baseBranch: 'main' });

    expect(result.ok).toBe(true);
    expect(readFileSync(join(repo, 'base-observed.txt'), 'utf8')).toBe('advanced base\n');
    expect(isAncestor(repo, advancedSha)).toBe(true);
    if (result.ok) expect(result.point.baseSha).toBe(advancedSha);
  });

  it('rebases a non-trunk direct PR feature branch onto an advanced origin feature parent', async () => {
    const tmp = makeTempDir();
    const { origin, repo } = initOriginAndRepo(tmp);
    git(repo, ['checkout', '-b', 'feature/parent']);
    makeCommit(repo, 'parent.txt', 'parent v1\n', 'parent branch');
    git(repo, ['push', '-u', 'origin', 'feature/parent']);
    git(repo, ['checkout', '-b', 'eforge/child']);
    makeCommit(repo, 'child.txt', 'child\n', 'child branch');
    const advancedSha = advanceRemote(tmp, origin, 'feature/parent', 'parent-advanced.txt', 'parent advanced\n');

    const result = await syncDirectPrBase({ cwd: repo, featureBranch: 'eforge/child', baseBranch: 'feature/parent' });

    expect(result.ok).toBe(true);
    expect(readFileSync(join(repo, 'parent-advanced.txt'), 'utf8')).toBe('parent advanced\n');
    expect(isAncestor(repo, advancedSha)).toBe(true);
  });

  it('runs direct PR base sync as a pre-validation phase so validation observes the rebased base tree', async () => {
    const tmp = makeTempDir();
    const { origin, repo } = initOriginAndRepo(tmp);
    createFeature(repo);
    advanceRemote(tmp, origin, 'main', 'base-observed.txt', 'advanced base\n');
    const state = minimalState('eforge/test');
    const ctx = phaseCtx({
      repoRoot: repo,
      mergeWorktreePath: repo,
      featureBranch: 'eforge/test',
      state,
      validateCommands: ['test -f base-observed.txt'],
    });

    const syncEvents = await drainEvents(syncDirectPrBaseBeforeValidation(ctx));
    const validationEvents = await drainEvents(validate(ctx));

    expect(ctx.directPrBaseSync?.baseBranch).toBe('main');
    expect(syncEvents.some((event) => event.type === 'planning:progress' && event.message.includes("Direct PR base sync") && event.message.includes("origin/main"))).toBe(true);
    expect(validationEvents.some((event) => event.type === 'validation:complete' && event.passed)).toBe(true);
    expect(state.status).toBe('running');
  });

  it('invokes the merge resolver for a rebase conflict and can publish the resolved PR after the freshness guard passes', async () => {
    const tmp = makeTempDir();
    const { origin, repo } = initOriginAndRepo(tmp);
    makeCommit(repo, 'conflict.txt', 'base\n', 'base file');
    git(repo, ['push', 'origin', 'main']);
    git(repo, ['checkout', '-b', 'eforge/conflict']);
    makeCommit(repo, 'conflict.txt', 'feature\n', 'feature side');
    const advancedSha = advanceRemote(tmp, origin, 'main', 'conflict.txt', 'remote\n');
    const resolver: MergeResolver = async (cwd, info) => {
      expect(info.conflictedFiles).toContain('conflict.txt');
      writeFileSync(join(cwd, 'conflict.txt'), 'resolved\n');
      git(cwd, ['add', 'conflict.txt']);
      return true;
    };

    const sync = await syncDirectPrBase({ cwd: repo, featureBranch: 'eforge/conflict', baseBranch: 'main', mergeResolver: resolver });

    expect(sync.ok).toBe(true);
    expect(readFileSync(join(repo, 'conflict.txt'), 'utf8')).toBe('resolved\n');
    expect(isAncestor(repo, advancedSha)).toBe(true);
    if (!sync.ok) throw new Error('sync unexpectedly failed');

    const { bin, log } = fakeGh(tmp, 'create');
    const manager = new WorktreeManager({ repoRoot: repo, worktreeBase: join(tmp, 'worktrees'), featureBranch: 'eforge/conflict', mergeWorktreePath: repo });
    await withPath(bin, async () => {
      const pr = await manager.issuePr({ baseBranch: 'main', forceWithLease: true, beforeCreateFreshnessGuard: async () => ({ ok: true }) });
      expect(pr.url).toBe('https://github.com/test/repo/pull/1');
    });
    expect(readFileSync(log, 'utf8')).toContain('"create"');
  }, 10_000);

  it('aborts an unresolved rebase conflict and leaves no opportunity to call gh pr create', async () => {
    const tmp = makeTempDir();
    const { origin, repo } = initOriginAndRepo(tmp);
    makeCommit(repo, 'conflict.txt', 'base\n', 'base file');
    git(repo, ['push', 'origin', 'main']);
    git(repo, ['checkout', '-b', 'eforge/conflict-fail']);
    makeCommit(repo, 'conflict.txt', 'feature\n', 'feature side');
    advanceRemote(tmp, origin, 'main', 'conflict.txt', 'remote\n');

    const { bin, log } = fakeGh(tmp, 'create');
    const state = minimalState('eforge/conflict-fail');
    const ctx = phaseCtx({
      repoRoot: repo,
      mergeWorktreePath: repo,
      featureBranch: 'eforge/conflict-fail',
      state,
      mergeResolver: async () => false,
    });

    const events = await withPath(bin, async () => drainEvents(syncDirectPrBaseBeforeValidation(ctx)));

    const skipped = events.find((event) => event.type === 'landing:skipped');
    expect(skipped?.type).toBe('landing:skipped');
    if (skipped?.type === 'landing:skipped') expect(skipped.reason).toContain('conflict resolver failed');
    expect(state.status).toBe('failed');
    expect(existsSync(join(repo, '.git', 'rebase-merge')) || existsSync(join(repo, '.git', 'rebase-apply'))).toBe(false);
    const ghLog = existsSync(log) ? readFileSync(log, 'utf8') : '';
    expect(ghLog).not.toContain('"create"');
  });

  it('exhausts a bounded rebase conflict-resolution budget and aborts without creating a PR', async () => {
    const tmp = makeTempDir();
    const { origin, repo } = initOriginAndRepo(tmp);
    makeCommit(repo, 'conflict.txt', 'base\n', 'base file');
    git(repo, ['push', 'origin', 'main']);
    git(repo, ['checkout', '-b', 'eforge/conflict-budget']);
    makeCommit(repo, 'conflict.txt', 'feature one\n', 'feature side one');
    makeCommit(repo, 'conflict.txt', 'feature two\n', 'feature side two');
    makeCommit(repo, 'conflict.txt', 'feature three\n', 'feature side three');
    makeCommit(repo, 'conflict.txt', 'feature four\n', 'feature side four');
    advanceRemote(tmp, origin, 'main', 'conflict.txt', 'remote\n');
    const { bin, log } = fakeGh(tmp, 'create');
    let resolverCalls = 0;
    const resolver: MergeResolver = async (cwd, info) => {
      resolverCalls += 1;
      expect(info.conflictedFiles).toContain('conflict.txt');
      writeFileSync(join(cwd, 'conflict.txt'), `resolved ${resolverCalls}\n`);
      git(cwd, ['add', 'conflict.txt']);
      return true;
    };

    const sync = await withPath(bin, async () => syncDirectPrBase({
      cwd: repo,
      featureBranch: 'eforge/conflict-budget',
      baseBranch: 'main',
      mergeResolver: resolver,
      conflictAttempts: 1,
    }));

    expect(sync.ok).toBe(false);
    if (!sync.ok) expect(sync.reason).toBe('conflict-attempts-exhausted');
    expect(resolverCalls).toBe(1);
    expect(existsSync(join(repo, '.git', 'rebase-merge')) || existsSync(join(repo, '.git', 'rebase-apply'))).toBe(false);

    resolverCalls = 0;
    const state = minimalState('eforge/conflict-budget');
    const ctx = phaseCtx({
      repoRoot: repo,
      mergeWorktreePath: repo,
      featureBranch: 'eforge/conflict-budget',
      state,
      mergeResolver: resolver,
    });
    const events = await withPath(bin, async () => drainEvents(syncDirectPrBaseBeforeValidation(ctx)));
    const skipped = events.find((event) => event.type === 'landing:skipped');
    expect(skipped?.type).toBe('landing:skipped');
    if (skipped?.type === 'landing:skipped') expect(skipped.reason).toContain('conflict-resolution attempt');
    expect(state.status).toBe('failed');
    expect(existsSync(join(repo, '.git', 'rebase-merge')) || existsSync(join(repo, '.git', 'rebase-apply'))).toBe(false);
    const ghLog = existsSync(log) ? readFileSync(log, 'utf8') : '';
    expect(ghLog).not.toContain('"create"');
  }, 10_000);

  it('reruns sync, validation, PRD validation, artifact recording, and PR creation after a final freshness retry', async () => {
    const tmp = makeTempDir();
    const { origin, repo } = initOriginAndRepo(tmp);
    writeFileSync(join(repo, '.gitignore'), '.eforge/\n');
    git(repo, ['add', '.gitignore']);
    git(repo, ['commit', '-m', 'ignore eforge runtime state']);
    git(repo, ['push', 'origin', 'main']);
    createFeature(repo);
    const validationCounter = join(tmp, 'validation-count.txt');
    const validationScript = join(tmp, 'count-validation.js');
    writeFileSync(validationScript, `const fs = require('fs');\nconst p = ${JSON.stringify(validationCounter)};\nconst n = fs.existsSync(p) ? Number(fs.readFileSync(p, 'utf8')) : 0;\nfs.writeFileSync(p, String(n + 1));\n`);
    let prdValidationCount = 0;
    const ctx = phaseCtx({
      repoRoot: repo,
      mergeWorktreePath: repo,
      featureBranch: 'eforge/test',
      state: minimalState('eforge/test'),
      worktreeManager: new WorktreeManager({ repoRoot: repo, worktreeBase: join(tmp, 'worktrees'), featureBranch: 'eforge/test', mergeWorktreePath: repo }),
      validateCommands: [`node ${validationScript}`],
      prdId: 'prd-1',
      prdValidator: async function* () {
        prdValidationCount += 1;
        yield { timestamp: new Date().toISOString(), type: 'prd_validation:start' } as EforgeEvent;
        yield { timestamp: new Date().toISOString(), type: 'prd_validation:complete', passed: true, gaps: [], completionPercent: 100 } as EforgeEvent;
        yield { timestamp: new Date().toISOString(), type: 'acceptance_validation:complete', passed: true, verdicts: [{ criterion: 'criterion', verdict: 'pass', evidence: 'ok' }], source: 'prd' } as EforgeEvent;
      },
    });

    await drainEvents(syncDirectPrBaseBeforeValidation(ctx));
    await drainEvents(validate(ctx));
    await drainEvents(prdValidate(ctx));
    await drainEvents(recordArtifact(ctx));
    advanceRemote(tmp, origin, 'main', 'late.txt', 'late base\n');

    const { bin, log } = fakeGh(tmp, 'create');
    const events = await withPath(bin, async () => drainEvents(finalize(ctx)));

    expect(events.some((event) => event.type === 'planning:progress' && event.message.includes('retrying base sync and validation (1/'))).toBe(true);
    expect(readFileSync(validationCounter, 'utf8')).toBe('2');
    expect(prdValidationCount).toBe(2);
    const registry = await loadArtifactRegistry(repo);
    expect(registry.builds.find((build) => build.prdId === 'prd-1')?.landingStatus).toBe('complete');
    expect(readFileSync(log, 'utf8')).toContain('"create"');
    expect(ctx.state.status).toBe('completed');
  }, 10_000);

  it('exhausts final freshness retries without creating a PR when the base keeps advancing', async () => {
    const tmp = makeTempDir();
    const { origin, repo } = initOriginAndRepo(tmp);
    createFeature(repo);
    const validationScript = join(tmp, 'advance-on-validation.js');
    const validationClone = join(tmp, 'validation-advance-main');
    execFileSync('git', ['clone', origin, validationClone], { env: GIT_ENV });
    git(validationClone, ['config', 'user.email', 'test@example.com']);
    git(validationClone, ['config', 'user.name', 'Test']);
    writeFileSync(validationScript, `
const { execFileSync } = require('child_process');
const { writeFileSync } = require('fs');
const { join } = require('path');
const env = { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' };
const clone = ${JSON.stringify(validationClone)};
execFileSync('git', ['-C', clone, 'fetch', 'origin', 'main'], { env });
execFileSync('git', ['-C', clone, 'checkout', 'main'], { env });
execFileSync('git', ['-C', clone, 'reset', '--hard', 'origin/main'], { env });
writeFileSync(join(clone, 'advance-' + Date.now() + '.txt'), 'advanced\\n');
execFileSync('git', ['-C', clone, 'add', '.'], { env });
execFileSync('git', ['-C', clone, 'commit', '-m', 'advance main'], { env });
execFileSync('git', ['-C', clone, 'push', 'origin', 'HEAD:main'], { env });
`);
    const ctx = phaseCtx({
      repoRoot: repo,
      mergeWorktreePath: repo,
      featureBranch: 'eforge/test',
      state: minimalState('eforge/test'),
      worktreeManager: new WorktreeManager({ repoRoot: repo, worktreeBase: join(tmp, 'worktrees'), featureBranch: 'eforge/test', mergeWorktreePath: repo }),
      validateCommands: [`node ${validationScript}`],
    });

    await drainEvents(syncDirectPrBaseBeforeValidation(ctx));
    advanceRemote(tmp, origin, 'main', 'late-0.txt', 'late base\n');
    const { bin, log } = fakeGh(tmp, 'create');
    const events = await withPath(bin, async () => drainEvents(finalize(ctx)));

    const terminalSkips = events.filter((event) => event.type === 'landing:skipped' && event.reason.includes('retry budget exhausted'));
    expect(terminalSkips).toHaveLength(1);
    const skipped = terminalSkips[0];
    if (skipped.type === 'landing:skipped') {
      expect(skipped.reason).toContain("Direct PR base 'main'");
      expect(skipped.reason).toContain(`${DEFAULT_DIRECT_PR_FRESHNESS_RETRIES} retry(s)`);
    }
    expect(ctx.state.status).toBe('failed');
    const ghLog = existsSync(log) ? readFileSync(log, 'utf8') : '';
    expect(ghLog).not.toContain('"create"');
  }, 10_000);

  it('detects final pre-PR base advancement by comparing the fetched SHA to the validated sync point', async () => {
    const tmp = makeTempDir();
    const { origin, repo } = initOriginAndRepo(tmp);
    createFeature(repo);
    const sync = await syncDirectPrBase({ cwd: repo, featureBranch: 'eforge/test', baseBranch: 'main' });
    if (!sync.ok) throw new Error(sync.message);
    const advancedSha = advanceRemote(tmp, origin, 'main', 'late.txt', 'late base\n');

    const freshness = await checkDirectPrBaseFreshness({ cwd: repo, syncPoint: sync.point });

    expect(freshness.kind).toBe('base-advanced');
    if (freshness.kind === 'base-advanced') {
      expect(freshness.validatedBaseSha).toBe(sync.point.baseSha);
      expect(freshness.fetchedBaseSha).toBe(advancedSha);
    }
  });

  it('does not call gh pr create when the final freshness guard requests a retryable stop', async () => {
    const tmp = makeTempDir();
    const { repo } = initOriginAndRepo(tmp);
    createFeature(repo);
    const { bin, log } = fakeGh(tmp, 'create');
    const manager = new WorktreeManager({ repoRoot: repo, worktreeBase: join(tmp, 'worktrees'), featureBranch: 'eforge/test', mergeWorktreePath: repo });

    await withPath(bin, async () => {
      await expect(manager.issuePr({
        baseBranch: 'main',
        beforeCreateFreshnessGuard: async () => ({ ok: false, retryable: true, reason: 'base advanced', fetchedBaseSha: 'abc123' }),
      })).rejects.toThrow('base advanced');
    });

    const ghLog = existsSync(log) ? readFileSync(log, 'utf8') : '';
    expect(ghLog).not.toContain('"create"');
    expect(DEFAULT_DIRECT_PR_FRESHNESS_RETRIES).toBeGreaterThan(0);
  });

  it('fails closed in finalize when the final freshness check cannot fetch the validated base', async () => {
    const tmp = makeTempDir();
    const { repo } = initOriginAndRepo(tmp);
    createFeature(repo);
    const state = minimalState('eforge/test');
    const ctx = phaseCtx({
      repoRoot: repo,
      mergeWorktreePath: repo,
      featureBranch: 'eforge/test',
      state,
      worktreeManager: new WorktreeManager({ repoRoot: repo, worktreeBase: join(tmp, 'worktrees'), featureBranch: 'eforge/test', mergeWorktreePath: repo }),
    });
    await drainEvents(syncDirectPrBaseBeforeValidation(ctx));
    git(repo, ['remote', 'set-url', 'origin', join(tmp, 'missing-origin.git')]);
    const { bin, log } = fakeGh(tmp, 'create');

    const events = await withPath(bin, async () => drainEvents(finalize(ctx)));

    const skipped = events.find((event) => event.type === 'landing:skipped');
    expect(skipped?.type).toBe('landing:skipped');
    if (skipped?.type === 'landing:skipped') {
      expect(skipped.reason).toContain('freshness guard failed');
      expect(skipped.reason).toContain('main');
    }
    expect(events.some((event) => event.type === 'planning:progress' && event.message.includes('retrying base sync and validation'))).toBe(false);
    expect(ctx.state.status).toBe('failed');
    const ghLog = existsSync(log) ? readFileSync(log, 'utf8') : '';
    expect(ghLog).not.toContain('"create"');
  }, 15_000);

  it('fails closed in finalize for direct PRs missing the pre-validation sync point', async () => {
    const tmp = makeTempDir();
    const { repo } = initOriginAndRepo(tmp);
    createFeature(repo);
    const { bin, log } = fakeGh(tmp, 'create');
    const ctx = phaseCtx({
      repoRoot: repo,
      mergeWorktreePath: repo,
      featureBranch: 'eforge/test',
      state: minimalState('eforge/test'),
      worktreeManager: new WorktreeManager({ repoRoot: repo, worktreeBase: join(tmp, 'worktrees'), featureBranch: 'eforge/test', mergeWorktreePath: repo }),
    });

    const events = await withPath(bin, async () => drainEvents(finalize(ctx)));

    expect(events.some((event) => event.type === 'landing:skipped' && event.reason.includes('missing prior base sync'))).toBe(true);
    expect(ctx.state.status).toBe('failed');
    const ghLog = existsSync(log) ? readFileSync(log, 'utf8') : '';
    expect(ghLog).not.toContain('"create"');
  });

  it('preserves existing PR fallback and metadata edit after the final freshness guard passes', async () => {
    const tmp = makeTempDir();
    const { repo } = initOriginAndRepo(tmp);
    createFeature(repo);
    const { bin, log } = fakeGh(tmp, 'existing');
    const manager = new WorktreeManager({ repoRoot: repo, worktreeBase: join(tmp, 'worktrees'), featureBranch: 'eforge/test', mergeWorktreePath: repo });

    await withPath(bin, async () => {
      const pr = await manager.issuePr({
        baseBranch: 'main',
        metadata: { title: 'Title', body: 'Body' },
        beforeCreateFreshnessGuard: async () => ({ ok: true }),
      });
      expect(pr.url).toBe('https://github.com/test/repo/pull/42');
    });

    const ghLog = readFileSync(log, 'utf8');
    expect(ghLog).toContain('"create"');
    expect(ghLog).toContain('"view"');
    expect(ghLog).toContain('"edit"');
  });

  it('blocks existing PR fallback when the second freshness guard fails after create reports an existing PR', async () => {
    const tmp = makeTempDir();
    const { repo } = initOriginAndRepo(tmp);
    createFeature(repo);
    const { bin, log } = fakeGh(tmp, 'existing');
    const manager = new WorktreeManager({ repoRoot: repo, worktreeBase: join(tmp, 'worktrees'), featureBranch: 'eforge/test', mergeWorktreePath: repo });
    let guardCalls = 0;

    await withPath(bin, async () => {
      await expect(manager.issuePr({
        baseBranch: 'main',
        metadata: { title: 'Title', body: 'Body' },
        beforeCreateFreshnessGuard: async () => {
          guardCalls += 1;
          return guardCalls === 1 ? { ok: true } : { ok: false, retryable: true, reason: 'base advanced before fallback' };
        },
      })).rejects.toThrow('base advanced before fallback');
    });

    const ghLog = readFileSync(log, 'utf8');
    expect(ghLog).toContain('"create"');
    expect(ghLog).not.toContain('"view"');
    expect(ghLog).not.toContain('"edit"');
  });

  it('does not push or create a PR when the before-push freshness guard fails', async () => {
    const tmp = makeTempDir();
    const { repo } = initOriginAndRepo(tmp);
    createFeature(repo);
    git(repo, ['push', '-u', 'origin', 'eforge/test']);
    const previousRemoteSha = git(repo, ['rev-parse', 'origin/eforge/test']);
    makeCommit(repo, 'feature.txt', 'feature after guard failure\n', 'feature after guard failure');
    const { bin, log } = fakeGh(tmp, 'create');
    const manager = new WorktreeManager({ repoRoot: repo, worktreeBase: join(tmp, 'worktrees'), featureBranch: 'eforge/test', mergeWorktreePath: repo });

    await withPath(bin, async () => {
      await expect(manager.issuePr({
        baseBranch: 'main',
        forceWithLease: true,
        beforePushFreshnessGuard: async () => ({ ok: false, retryable: true, reason: 'base advanced before push' }),
        beforeCreateFreshnessGuard: async () => ({ ok: true }),
      })).rejects.toThrow('base advanced before push');
    });

    const ghLog = existsSync(log) ? readFileSync(log, 'utf8') : '';
    expect(ghLog).not.toContain('"create"');
    expect(git(repo, ['rev-parse', 'origin/eforge/test'])).toBe(previousRemoteSha);
  });

  it('uses force-with-lease so a direct PR can replace a stale pushed artifact branch', async () => {
    const tmp = makeTempDir();
    const { origin, repo } = initOriginAndRepo(tmp);
    createFeature(repo);
    git(repo, ['push', '-u', 'origin', 'eforge/test']);
    advanceRemote(tmp, origin, 'main', 'new-base.txt', 'new base\n');
    const sync = await syncDirectPrBase({ cwd: repo, featureBranch: 'eforge/test', baseBranch: 'main' });
    if (!sync.ok) throw new Error(sync.message);
    const { bin } = fakeGh(tmp, 'create');
    const manager = new WorktreeManager({ repoRoot: repo, worktreeBase: join(tmp, 'worktrees'), featureBranch: 'eforge/test', mergeWorktreePath: repo });

    await withPath(bin, async () => {
      await manager.issuePr({ baseBranch: 'main', forceWithLease: true, beforeCreateFreshnessGuard: async () => ({ ok: true }) });
    });

    expect(git(repo, ['rev-parse', 'origin/eforge/test'])).toBe(git(repo, ['rev-parse', 'HEAD']));
  });

  it('preserves PR auto-merge after guarded PR creation succeeds', async () => {
    const tmp = makeTempDir();
    const { repo } = initOriginAndRepo(tmp);
    createFeature(repo);
    const { bin, log } = fakeGh(tmp, 'auto-merge');
    const manager = new WorktreeManager({ repoRoot: repo, worktreeBase: join(tmp, 'worktrees'), featureBranch: 'eforge/test', mergeWorktreePath: repo });
    const state = minimalState('eforge/test');

    const { events, result } = await withPath(bin, async () => drain(executeLandingAction({
      action: 'pr', featureBranch: 'eforge/test', baseBranch: 'main', repoRoot: repo, mergeWorktreePath: repo,
      worktreeManager: manager, commitMessage: 'commit', rawCommitBody: 'commit', state, config: minimalConfig(),
      engineConfig: { build: { maxValidationRetries: 0, cleanupPlanFiles: false } } as Pick<EforgeConfig, 'build'>,
      prAutoMergePolicy: 'always', beforeCreateFreshnessGuard: async () => ({ ok: true }), beforePushFreshnessGuard: async () => ({ ok: true }), forceWithLease: true,
    })));

    expect(result.landingSucceeded).toBe(true);
    expect(events.some((event) => event.type === 'landing:auto-merge:complete')).toBe(true);
    expect(readFileSync(log, 'utf8')).toContain('"merge"');
  });

  it('skips direct PR base sync for stacked PR, merge, and leave landing contexts', async () => {
    const tmp = makeTempDir();
    const { repo } = initOriginAndRepo(tmp);
    createFeature(repo);
    git(repo, ['remote', 'remove', 'origin']);
    const contexts = [
      phaseCtx({ repoRoot: repo, mergeWorktreePath: repo, landingAction: 'pr', stackContext: { planId: 'plan-01', stackIndex: 0, stackSize: 1, stackParent: undefined, stackParentBranch: undefined, artifactBranch: 'eforge/test' } as any }),
      phaseCtx({ repoRoot: repo, mergeWorktreePath: repo, landingAction: 'merge' }),
      phaseCtx({ repoRoot: repo, mergeWorktreePath: repo, landingAction: 'leave' }),
    ];

    for (const ctx of contexts) {
      expect(isDirectPrBaseSyncApplicable(ctx)).toBe(false);
      const events = await drainEvents(syncDirectPrBaseBeforeValidation(ctx));
      expect(events.some((event) => event.type === 'planning:progress' && event.message.includes('Direct PR base'))).toBe(false);
      expect(events.some((event) => event.type === 'landing:skipped')).toBe(false);
      expect(ctx.state.status).toBe('running');
    }
  });

  it('fails invalid base branches and unregistered remotes before fetch, then reports unavailable remote bases with landing:skipped', async () => {
    const tmp = makeTempDir();
    const { repo } = initOriginAndRepo(tmp);
    createFeature(repo);
    const trace = join(tmp, 'trace2.jsonl');
    const prevTrace = process.env.GIT_TRACE2_EVENT;
    process.env.GIT_TRACE2_EVENT = trace;
    try {
      const invalid = await syncDirectPrBase({ cwd: repo, featureBranch: 'eforge/test', baseBranch: '-bad' });
      expect(invalid.ok).toBe(false);
      if (!invalid.ok) expect(invalid.reason).toBe('invalid-branch');

      const unregistered = await syncDirectPrBase({ cwd: repo, featureBranch: 'eforge/test', baseBranch: 'main', remote: 'upstream' });
      expect(unregistered.ok).toBe(false);
      if (!unregistered.ok) expect(unregistered.reason).toBe('invalid-remote');
    } finally {
      if (prevTrace === undefined) delete process.env.GIT_TRACE2_EVENT;
      else process.env.GIT_TRACE2_EVENT = prevTrace;
    }
    const traceLog = existsSync(trace) ? readFileSync(trace, 'utf8') : '';
    expect(traceLog).not.toContain('"argv":["git","fetch"');

    const state = minimalState('eforge/test', 'missing/base');
    const events = await drainEvents(syncDirectPrBaseBeforeValidation(phaseCtx({ repoRoot: repo, mergeWorktreePath: repo, featureBranch: 'eforge/test', config: minimalConfig('missing/base'), state })));
    const skipped = events.find((event) => event.type === 'landing:skipped');
    expect(skipped?.type).toBe('landing:skipped');
    if (skipped?.type === 'landing:skipped') expect(skipped.reason).toContain('missing/base');
    expect(state.status).toBe('failed');
  });
});
