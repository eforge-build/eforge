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
import { readFileSync, writeFileSync } from 'node:fs';
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
} from '@eforge-build/engine/stacking';
import { stackLanding } from '@eforge-build/engine/orchestrator/phases';
import type { PhaseContext } from '@eforge-build/engine/orchestrator/phases';
import type { EforgeEvent } from '@eforge-build/engine/events';
import type { StackBaseContext } from '@eforge-build/engine/stacking';
import { createGitSpiceAdapter } from '@eforge-build/engine/stacking/git-spice';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'eforge-stack-runtime-'));
});

function makeResult(command: string, args: string[], stdout = ''): ProviderCommandResult {
  return { command, args, stdout, stderr: '', exitCode: 0 };
}

function makeStubProvider(overrides?: Partial<StackProviderAdapter>): StackProviderAdapter {
  return {
    requireAvailable: async () => {},
    trackBranch: async (_cwd, base) =>
      makeResult('git-spice', ['branch', 'track', '--base', base]),
    retargetBranch: async (_cwd, branch, target) =>
      makeResult('git-spice', ['branch', 'onto', target, '--branch', branch]),
    submitBranch: async () =>
      makeResult(
        'git-spice',
        ['branch', 'submit'],
        'Created PR https://github.com/owner/repo/pull/42',
      ),
    submitStack: async () => makeResult('git-spice', ['stack', 'submit']),
    syncRepo: async () => makeResult('git-spice', ['repo', 'sync']),
    restackBranch: async () => makeResult('git-spice', ['branch', 'restack']),
    restackStack: async () => makeResult('git-spice', ['stack', 'restack']),
    upstackOnto: async (_cwd, target) => makeResult('git-spice', ['upstack', 'onto', target]),
    commandPreview: (argv) => ({ command: 'git-spice', args: argv }),
    syncRepoPreview: () => ({ command: 'git-spice', args: ['repo', 'sync'] }),
    restackStackPreview: () => ({ command: 'git-spice', args: ['stack', 'restack'] }),
    parsePrUrl: (stdout) => stdout.match(/https:\/\/github\.com\/[^\s]+\/pull\/\d+/)?.[0],
    isValidPrUrl: (url) => /^https:\/\/github\.com\/.+\/pull\/\d+$/.test(url),
    redactMessage: (message) => message,
    ...overrides,
  };
}

function makeStackContext(overrides?: Partial<StackBaseContext>): StackBaseContext {
  return {
    prdId: 'test-prd',
    stackId: 'test-stack',
    provider: 'git-spice',
    branch: 'eforge/test-prd',
    baseBranch: 'main',
    ...overrides,
  };
}

async function collectEvents(gen: AsyncGenerator<EforgeEvent>): Promise<EforgeEvent[]> {
  const events: EforgeEvent[] = [];
  for await (const event of gen) events.push(event);
  return events;
}

async function seedLayer(dir: string, prdId = 'test-prd'): Promise<void> {
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

function initGitRepo(dir: string): void {
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
}

// --- eforge:region plan-02-landing-preflight-and-observability ---
function git(args: string[], dir = cwd): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf-8' }).trim();
}

function setupStackRepo(opts: { parentIntegrated: boolean; deleteParentRemote: boolean }): { parentSha: string } {
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
// --- eforge:endregion plan-02-landing-preflight-and-observability ---

const recoverableRestack = {
  kind: 'recoverable-conflict',
  operation: 'branch-restack',
  conflictKind: 'git-rebase',
  message: 'restack conflict',
  recoverable: true,
} as const;

const interruptedRestack = {
  operation: 'branch-restack',
  conflictKind: 'git-rebase',
  branch: 'eforge/test-prd',
  conflictedFiles: [],
  conflictDiff: '',
} as const;

const recoveryLifecycleTypes = new Set([
  'stack:landing:conflict:detected',
  'stack:landing:conflict:recovery:start',
  'stack:landing:conflict:recovery:complete',
  'stack:landing:conflict:recovery:failed',
]);

function landingOptions(provider: StackProviderAdapter, overrides: Partial<StackLandingOptions> = {}): StackLandingOptions {
  return { cwd, mergeWorktreePath: cwd, stackContext: makeStackContext(), landingAction: 'pr', provider, ...overrides };
}

// ---------------------------------------------------------------------------
// executeStackLanding — PR action, argv construction
// ---------------------------------------------------------------------------

describe('executeStackLanding — pr action argv construction', () => {
  it('calls trackBranch with the resolved base, then restackBranch, then submitBranch in the merge worktree', async () => {
    const invocations: Array<{ method: 'track'; cwd: string; base: string } | { method: 'restack'; cwd: string } | { method: 'submit'; cwd: string }> = [];

    const provider = makeStubProvider({
      trackBranch: async (worktreePath, base) => {
        invocations.push({ method: 'track', cwd: worktreePath, base });
        return makeResult('git-spice', ['branch', 'track', '--base', base]);
      },
      restackBranch: async (worktreePath) => {
        invocations.push({ method: 'restack', cwd: worktreePath });
        return makeResult('git-spice', ['branch', 'restack']);
      },
      submitBranch: async (worktreePath) => {
        invocations.push({ method: 'submit', cwd: worktreePath });
        return makeResult(
          'git-spice',
          ['branch', 'submit'],
          'https://github.com/owner/repo/pull/42',
        );
      },
    });

    const opts: StackLandingOptions = {
      cwd,
      mergeWorktreePath: cwd,
      stackContext: makeStackContext({ baseBranch: 'main' }),
      landingAction: 'pr',
      provider,
    };

    await collectEvents(executeStackLanding(opts));

    expect(invocations).toHaveLength(3);
    expect(invocations[0]).toEqual({ method: 'track', cwd, base: 'main' });
    expect(invocations[1]).toEqual({ method: 'restack', cwd });
    expect(invocations[2]).toEqual({ method: 'submit', cwd });
  });

  it('passes the full baseBranch (including slashes) verbatim to trackBranch', async () => {
    const trackArgs: string[] = [];
    const provider = makeStubProvider({
      trackBranch: async (_cwd, base) => {
        trackArgs.push(base);
        return makeResult('git-spice', ['branch', 'track', '--base', base]);
      },
    });

    const opts: StackLandingOptions = {
      cwd,
      mergeWorktreePath: cwd,
      stackContext: makeStackContext({ baseBranch: 'feat/parent-layer' }),
      landingAction: 'pr',
      provider,
    };

    await collectEvents(executeStackLanding(opts));
    expect(trackArgs).toEqual(['feat/parent-layer']);
  });

  it('falls back to "main" when baseBranch is undefined', async () => {
    const trackArgs: string[] = [];
    const provider = makeStubProvider({
      trackBranch: async (_cwd, base) => {
        trackArgs.push(base);
        return makeResult('git-spice', ['branch', 'track', '--base', base]);
      },
    });

    const opts: StackLandingOptions = {
      cwd,
      mergeWorktreePath: cwd,
      stackContext: makeStackContext({ baseBranch: undefined }),
      landingAction: 'pr',
      provider,
    };

    await collectEvents(executeStackLanding(opts));
    expect(trackArgs).toEqual(['main']);
  });
});

// ---------------------------------------------------------------------------
// executeStackLanding — PR action, event sequence
// ---------------------------------------------------------------------------

describe('executeStackLanding — pr action event sequence', () => {
  it('emits started, provider:command x3, complete events in order', async () => {
    const provider = makeStubProvider();
    const opts: StackLandingOptions = {
      cwd,
      mergeWorktreePath: cwd,
      stackContext: makeStackContext(),
      landingAction: 'pr',
      provider,
    };

    const events = await collectEvents(executeStackLanding(opts));

    const types = events.map((e) => e.type);
    // policy defaults to 'ask', no landingAutoMerge → emits skipped after complete
    expect(types).toEqual([
      'stack:landing:update',
      'stack:provider:command',
      'stack:provider:command',
      'stack:provider:command',
      'stack:landing:update',
      'landing:auto-merge:skipped',
    ]);
    expect((events[0] as Record<string, unknown>).status).toBe('started');
    expect((events[4] as Record<string, unknown>).status).toBe('complete');
  });

  it('first stack:provider:command has trackBranch args', async () => {
    const provider = makeStubProvider();
    const opts: StackLandingOptions = {
      cwd,
      mergeWorktreePath: cwd,
      stackContext: makeStackContext({ baseBranch: 'feat/parent-prd' }),
      landingAction: 'pr',
      provider,
    };

    const events = await collectEvents(executeStackLanding(opts));
    const providerCmds = events.filter((e) => e.type === 'stack:provider:command');
    expect(providerCmds[0]).toMatchObject({
      type: 'stack:provider:command',
      args: ['branch', 'track', '--base', 'feat/parent-prd'],
    });
  });

  it('second stack:provider:command has restackBranch args', async () => {
    const provider = makeStubProvider();
    const opts: StackLandingOptions = {
      cwd,
      mergeWorktreePath: cwd,
      stackContext: makeStackContext(),
      landingAction: 'pr',
      provider,
    };

    const events = await collectEvents(executeStackLanding(opts));
    const providerCmds = events.filter((e) => e.type === 'stack:provider:command');
    expect(providerCmds[1]).toMatchObject({
      type: 'stack:provider:command',
      args: ['branch', 'restack'],
    });
  });

  it('third stack:provider:command has submitBranch args', async () => {
    const provider = makeStubProvider();
    const opts: StackLandingOptions = {
      cwd,
      mergeWorktreePath: cwd,
      stackContext: makeStackContext(),
      landingAction: 'pr',
      provider,
    };

    const events = await collectEvents(executeStackLanding(opts));
    const providerCmds = events.filter((e) => e.type === 'stack:provider:command');
    expect(providerCmds[2]).toMatchObject({
      type: 'stack:provider:command',
      args: ['branch', 'submit'],
    });
  });

  it('stack:landing:update complete includes prdId, stackId, branch', async () => {
    const provider = makeStubProvider();
    const stackContext = makeStackContext({
      prdId: 'my-prd',
      stackId: 'my-stack',
      branch: 'eforge/my-prd',
    });
    const opts: StackLandingOptions = {
      cwd,
      mergeWorktreePath: cwd,
      stackContext,
      landingAction: 'pr',
      provider,
    };

    const events = await collectEvents(executeStackLanding(opts));
    const complete = events.find(
      (e) => e.type === 'stack:landing:update' && (e as Record<string, unknown>).status === 'complete',
    );
    expect(complete).toMatchObject({
      type: 'stack:landing:update',
      prdId: 'my-prd',
      stackId: 'my-stack',
      branch: 'eforge/my-prd',
      action: 'pr',
      status: 'complete',
    });
  });
});

// ---------------------------------------------------------------------------
// executeStackLanding — PR URL discovery and state persistence
// ---------------------------------------------------------------------------

describe('executeStackLanding — PR URL discovery and persistence', () => {
  it('extracts PR URL from submit stdout and includes it in the complete event', async () => {
    const prUrl = 'https://github.com/owner/repo/pull/42';
    const provider = makeStubProvider({
      submitBranch: async () =>
        makeResult('git-spice', ['branch', 'submit'], `Created PR ${prUrl}`),
    });
    await seedLayer(cwd);

    const opts: StackLandingOptions = {
      cwd,
      mergeWorktreePath: cwd,
      stackContext: makeStackContext(),
      landingAction: 'pr',
      provider,
    };

    const events = await collectEvents(executeStackLanding(opts));
    const complete = events.find(
      (e) => e.type === 'stack:landing:update' && (e as Record<string, unknown>).status === 'complete',
    );
    expect(complete).toMatchObject({
      type: 'stack:landing:update',
      status: 'complete',
      prUrl,
    });
  });

  it('persists landing state with action, status, prUrl, and timestamps', async () => {
    const prUrl = 'https://github.com/owner/repo/pull/42';
    const provider = makeStubProvider({
      submitBranch: async () =>
        makeResult('git-spice', ['branch', 'submit'], `Created PR ${prUrl}`),
    });
    await seedLayer(cwd);

    const opts: StackLandingOptions = {
      cwd,
      mergeWorktreePath: cwd,
      stackContext: makeStackContext(),
      landingAction: 'pr',
      provider,
    };

    await collectEvents(executeStackLanding(opts));

    const state = await loadStackState(cwd);
    const layer = state.layers.find((l) => l.prdId === 'test-prd');
    expect(layer?.landing?.action).toBe('pr');
    expect(layer?.landing?.status).toBe('complete');
    expect(layer?.landing?.prUrl).toBe(prUrl);
    expect(layer?.landing?.startedAt).toBeTruthy();
    expect(layer?.landing?.completedAt).toBeTruthy();
    // Layer status must transition to 'landed' on successful PR submission
    expect(layer?.status).toBe('landed');
  });

  it('persists landing state without prUrl when submit output has no URL', async () => {
    const provider = makeStubProvider({
      submitBranch: async () =>
        makeResult('git-spice', ['branch', 'submit'], 'Branch submitted successfully'),
    });
    await seedLayer(cwd);

    const opts: StackLandingOptions = {
      cwd,
      mergeWorktreePath: cwd,
      stackContext: makeStackContext(),
      landingAction: 'pr',
      provider,
    };

    await collectEvents(executeStackLanding(opts));

    const state = await loadStackState(cwd);
    const layer = state.layers.find((l) => l.prdId === 'test-prd');
    expect(layer?.landing?.status).toBe('complete');
    // prUrl absent when not parseable and gh fallback not available in test env
    expect(layer?.landing?.prUrl).toBeUndefined();
  });

  it('does not use restackBranch stdout as a source of PR URL discovery', async () => {
    // restackBranch emits a GitHub URL; submitBranch does not — prUrl must be absent
    const provider = makeStubProvider({
      restackBranch: async () =>
        makeResult('git-spice', ['branch', 'restack'], 'https://github.com/owner/repo/pull/99'),
      submitBranch: async () =>
        makeResult('git-spice', ['branch', 'submit'], 'Branch submitted successfully'),
    });
    await seedLayer(cwd);

    const origPath = process.env.PATH;
    // Disable gh fallback to prevent URL discovery via CLI
    process.env.PATH = '/nonexistent-path-for-test';

    try {
      const opts: StackLandingOptions = {
        cwd,
        mergeWorktreePath: cwd,
        stackContext: makeStackContext(),
        landingAction: 'pr',
        provider,
      };

      const events = await collectEvents(executeStackLanding(opts));

      const complete = events.find(
        (e) => e.type === 'stack:landing:update' && (e as Record<string, unknown>).status === 'complete',
      );
      expect(complete).toBeDefined();
      expect((complete as Record<string, unknown>).prUrl).toBeUndefined();

      const state = await loadStackState(cwd);
      const layer = state.layers.find((l) => l.prdId === 'test-prd');
      expect(layer?.landing?.status).toBe('complete');
      expect(layer?.landing?.prUrl).toBeUndefined();
    } finally {
      process.env.PATH = origPath;
    }
  });
});

// ---------------------------------------------------------------------------
// executeStackLanding — non-pr actions
// ---------------------------------------------------------------------------

describe('executeStackLanding — non-pr actions', () => {
  it('emits stack:landing:update skipped for merge action without calling provider', async () => {
    let providerCalled = false;
    const provider = makeStubProvider({
      trackBranch: async () => {
        providerCalled = true;
        return makeResult('git-spice', []);
      },
      restackBranch: async () => {
        providerCalled = true;
        return makeResult('git-spice', []);
      },
      submitBranch: async () => {
        providerCalled = true;
        return makeResult('git-spice', []);
      },
    });

    const opts: StackLandingOptions = {
      cwd,
      mergeWorktreePath: cwd,
      stackContext: makeStackContext(),
      landingAction: 'merge',
      provider,
    };

    const events = await collectEvents(executeStackLanding(opts));

    expect(providerCalled).toBe(false);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'stack:landing:update',
      status: 'skipped',
      action: 'merge',
    });
  });

  it('emits stack:landing:update skipped for leave action without calling provider', async () => {
    let providerCalled = false;
    const provider = makeStubProvider({
      trackBranch: async () => {
        providerCalled = true;
        return makeResult('git-spice', []);
      },
      restackBranch: async () => {
        providerCalled = true;
        return makeResult('git-spice', []);
      },
      submitBranch: async () => {
        providerCalled = true;
        return makeResult('git-spice', []);
      },
    });

    const opts: StackLandingOptions = {
      cwd,
      mergeWorktreePath: cwd,
      stackContext: makeStackContext(),
      landingAction: 'leave',
      provider,
    };

    const events = await collectEvents(executeStackLanding(opts));

    expect(providerCalled).toBe(false);
    expect(events[0]).toMatchObject({
      type: 'stack:landing:update',
      status: 'skipped',
      action: 'leave',
    });
  });

  it('persists layer status as merged when landingAction is merge', async () => {
    const provider = makeStubProvider();
    await seedLayer(cwd);

    const opts: StackLandingOptions = {
      cwd,
      mergeWorktreePath: cwd,
      stackContext: makeStackContext(),
      landingAction: 'merge',
      provider,
    };

    await collectEvents(executeStackLanding(opts));

    const state = await loadStackState(cwd);
    const layer = state.layers.find((l) => l.prdId === 'test-prd');
    expect(layer?.status).toBe('merged');
    expect(layer?.landing?.action).toBe('merge');
    expect(layer?.landing?.status).toBe('skipped');
  });

  it('persists layer status as landed when landingAction is leave', async () => {
    const provider = makeStubProvider();
    await seedLayer(cwd);

    const opts: StackLandingOptions = {
      cwd,
      mergeWorktreePath: cwd,
      stackContext: makeStackContext(),
      landingAction: 'leave',
      provider,
    };

    await collectEvents(executeStackLanding(opts));

    const state = await loadStackState(cwd);
    const layer = state.layers.find((l) => l.prdId === 'test-prd');
    expect(layer?.status).toBe('landed');
    expect(layer?.landing?.action).toBe('leave');
    expect(layer?.landing?.status).toBe('skipped');
  });
});

// ---------------------------------------------------------------------------
// executeStackLanding — failure handling
// ---------------------------------------------------------------------------

describe('executeStackLanding — failure handling', () => {
  it('emits a provider command event with the failing exit code when trackBranch invokes git-spice and fails', async () => {
    const provider = makeStubProvider({
      trackBranch: async () => {
        throw new GitSpiceCommandError('git-spice', ['branch', 'track', '--base', 'main'], 2, 'fatal');
      },
    });
    await seedLayer(cwd);

    const events = await collectEvents(executeStackLanding(landingOptions(provider)));
    expect(events.find((event) => event.type === 'stack:provider:command')).toMatchObject({
      command: 'git-spice',
      args: ['branch', 'track', '--base', 'main'],
      exitCode: 2,
    });
    expect(events.at(-1)).toMatchObject({ type: 'stack:landing:update', status: 'failed' });
  });

  it('keeps the existing failed path for non-recoverable restack failures', async () => {
    let submitCalled = false;
    const provider = makeStubProvider({
      restackBranch: async () => {
        throw new GitSpiceCommandError('git-spice', ['branch', 'restack'], 2, 'restack failed');
      },
      classifyError: async () => ({ kind: 'provider-failure', operation: 'branch-restack', message: 'restack failed', recoverable: false }),
      submitBranch: async () => {
        submitCalled = true;
        return makeResult('git-spice', ['branch', 'submit']);
      },
    });
    await seedLayer(cwd);

    const events = await collectEvents(executeStackLanding(landingOptions(provider)));
    expect(submitCalled).toBe(false);
    expect(events.some((event) => recoveryLifecycleTypes.has(event.type))).toBe(false);
    expect(events.filter((event) => event.type === 'stack:provider:command')).toHaveLength(2);
    expect(events.at(-1)).toMatchObject({ type: 'stack:landing:update', status: 'failed', reason: expect.stringContaining('restack failed') });
  });

  it('recovers a recoverable restack conflict, submits the branch, and completes landing', async () => {
    initGitRepo(cwd);
    let submitCalled = false;
    const provider = makeStubProvider({
      restackBranch: async () => {
        throw new GitSpiceCommandError('git-spice', ['branch', 'restack'], 2, 'conflict');
      },
      classifyError: async () => recoverableRestack,
      getInterruptedOperation: async () => interruptedRestack,
      continueInterruptedOperation: async () => makeResult('git-spice', ['rebase', 'continue']),
      submitBranch: async () => {
        submitCalled = true;
        return makeResult('git-spice', ['branch', 'submit'], 'https://github.com/owner/repo/pull/42');
      },
    });
    await seedLayer(cwd);

    const events = await collectEvents(executeStackLanding(landingOptions(provider)));
    const types = events.map((event) => event.type);
    expect(submitCalled).toBe(true);
    expect(types).toContain('stack:landing:conflict:recovery:complete');
    expect(events.find((event) => event.type === 'stack:landing:update' && (event as Record<string, unknown>).status === 'complete')).toBeDefined();
    const restackCommandIndex = events.findIndex((event) =>
      event.type === 'stack:provider:command' && ((event as { args?: string[] }).args ?? []).includes('restack'));
    expect(types.indexOf('stack:landing:conflict:detected')).toBeGreaterThan(restackCommandIndex);
  });

  it('persists failed state and skips submit when restack conflict recovery fails', async () => {
    initGitRepo(cwd);
    let submitCalled = false;
    const provider = makeStubProvider({
      restackBranch: async () => {
        throw new GitSpiceCommandError('git-spice', ['branch', 'restack'], 2, 'conflict');
      },
      classifyError: async (_cwd, err) => err instanceof Error && err.message.includes('continue')
        ? { kind: 'provider-failure', operation: 'branch-restack', message: 'continue failed', recoverable: false }
        : recoverableRestack,
      getInterruptedOperation: async () => interruptedRestack,
      continueInterruptedOperation: async () => { throw new Error('continue failed'); },
      abortInterruptedOperation: async () => makeResult('git-spice', ['rebase', 'abort']),
      submitBranch: async () => {
        submitCalled = true;
        return makeResult('git-spice', ['branch', 'submit']);
      },
    });
    await seedLayer(cwd);

    const events = await collectEvents(executeStackLanding(landingOptions(provider)));
    const state = await loadStackState(cwd);
    const layer = state.layers.find((l) => l.prdId === 'test-prd');
    expect(submitCalled).toBe(false);
    expect(events.map((event) => event.type)).toContain('stack:landing:conflict:recovery:failed');
    expect(layer?.status).toBe('failed');
    expect(layer?.landing?.status).toBe('failed');
    expect(layer?.landing?.reason).toMatch(/^Restack conflict recovery failed:.*abort succeeded/);
  });

  it('prevents submit and persists failed state when post-recovery validation fails', async () => {
    initGitRepo(cwd);
    let submitCalled = false;
    const provider = makeStubProvider({
      restackBranch: async () => { throw new Error('restack conflict'); },
      classifyError: async () => recoverableRestack,
      getInterruptedOperation: async () => interruptedRestack,
      continueInterruptedOperation: async () => makeResult('git-spice', ['rebase', 'continue']),
      submitBranch: async () => {
        submitCalled = true;
        return makeResult('git-spice', ['branch', 'submit']);
      },
    });
    await seedLayer(cwd);

    const events = await collectEvents(executeStackLanding(landingOptions(provider, {
      postRecoveryValidationCommands: ['node -e "process.exit(7)"'],
    })));
    const layer = (await loadStackState(cwd)).layers.find((l) => l.prdId === 'test-prd');
    expect(submitCalled).toBe(false);
    expect(events).toContainEqual(expect.objectContaining({ type: 'validation:complete', passed: false }));
    expect(layer?.landing?.status).toBe('failed');
    expect(layer?.landing?.reason).toMatch(/^Restack conflict recovery failed:/);
  });

  it('emits stack:landing:update failed when submitBranch throws', async () => {
    const provider = makeStubProvider({ submitBranch: async () => { throw new Error('git-spice: submit failed'); } });
    await seedLayer(cwd);

    const events = await collectEvents(executeStackLanding(landingOptions(provider)));
    expect(events.find((e) => e.type === 'stack:landing:update' && (e as Record<string, unknown>).status === 'failed')).toMatchObject({
      reason: expect.stringContaining('git-spice: submit failed'),
    });
  });
});

// ---------------------------------------------------------------------------
// Missing provider early failure
// ---------------------------------------------------------------------------

describe('missing provider early failure', () => {
  it('requireAvailable throws GitSpiceNotAvailableError for a missing command', async () => {
    const adapter = createGitSpiceAdapter({ gitSpice: { command: '/nonexistent/git-spice' } });
    const err = await adapter.requireAvailable('/tmp').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GitSpiceNotAvailableError);
  });

  it('error message mentions "git-spice" (the canonical command name)', async () => {
    const adapter = createGitSpiceAdapter({ gitSpice: { command: '/nonexistent/git-spice' } });
    const err = await adapter.requireAvailable('/tmp').catch((e: unknown) => e);
    expect((err as Error).message).toContain('git-spice');
  });

  it('error message mentions "stacking.gitSpice.command" (the config key)', async () => {
    const adapter = createGitSpiceAdapter({ gitSpice: { command: '/nonexistent/git-spice' } });
    const err = await adapter.requireAvailable('/tmp').catch((e: unknown) => e);
    expect((err as Error).message).toContain('stacking.gitSpice.command');
  });

  it('error message includes an actionable install URL', async () => {
    const adapter = createGitSpiceAdapter({ gitSpice: { command: '/nonexistent/git-spice' } });
    const err = await adapter.requireAvailable('/tmp').catch((e: unknown) => e);
    expect((err as Error).message).toContain('https://');
  });
});

// ---------------------------------------------------------------------------
// Non-stacked no-provider behavior — stackLanding phase
// ---------------------------------------------------------------------------

describe('stackLanding phase — non-stacked builds', () => {
  it('is a no-op when no stackContext is provided', async () => {
    const ctx = {
      stackContext: undefined,
      stackProvider: undefined,
    } as unknown as PhaseContext;

    const events = await collectEvents(stackLanding(ctx));
    expect(events).toHaveLength(0);
  });

  it('is a no-op when stackContext is present but no stackProvider is provided', async () => {
    const ctx = {
      stackContext: makeStackContext(),
      stackProvider: undefined,
    } as unknown as PhaseContext;

    const events = await collectEvents(stackLanding(ctx));
    expect(events).toHaveLength(0);
  });

  it('emits skipped landing when build failed before stack landing could be attempted', async () => {
    const provider = makeStubProvider();
    const state = {
      status: 'failed',
      plans: {},
      completedPlans: [],
      setName: 'test',
      startedAt: new Date().toISOString(),
      baseBranch: 'main',
      featureBranch: 'eforge/test-prd',
      worktreeBase: cwd,
    };
    const ctx = {
      stackContext: makeStackContext(),
      stackProvider: provider,
      landingAction: 'pr',
      repoRoot: cwd,
      state,
    } as unknown as PhaseContext;

    const events = await collectEvents(stackLanding(ctx));
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'stack:landing:update',
        status: 'skipped',
        action: 'pr',
      }),
    );
  });

  it('emits skipped landing without calling the provider when the build was aborted before landing', async () => {
    let providerCalled = false;
    const provider = makeStubProvider({
      trackBranch: async (_cwd, base) => {
        providerCalled = true;
        return makeResult('git-spice', ['branch', 'track', '--base', base]);
      },
      restackBranch: async () => {
        providerCalled = true;
        return makeResult('git-spice', ['branch', 'restack']);
      },
      submitBranch: async () => {
        providerCalled = true;
        return makeResult('git-spice', ['branch', 'submit']);
      },
    });
    const controller = new AbortController();
    controller.abort();
    const state = {
      status: 'running',
      plans: {},
      completedPlans: [],
      setName: 'test',
      startedAt: new Date().toISOString(),
      baseBranch: 'main',
      featureBranch: 'eforge/test-prd',
      worktreeBase: cwd,
    };
    const ctx = {
      stackContext: makeStackContext(),
      stackProvider: provider,
      landingAction: 'pr',
      repoRoot: cwd,
      state,
      signal: controller.signal,
    } as unknown as PhaseContext;

    const events = await collectEvents(stackLanding(ctx));

    expect(providerCalled).toBe(false);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'stack:landing:update',
        status: 'skipped',
        reason: 'Build aborted before landing could be attempted',
      }),
    );
  });
});


/**
 * Create a fake `gh` binary in a temp bin dir.
 *
 * @param binDir  - Absolute path of the directory to create `gh` in.
 * @param behavior - 'merge-success' | 'merge-fail'
 */
function createFakeGhForStack(binDir: string, behavior: 'merge-success' | 'merge-fail'): void {
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

describe('executeStackLanding — PR auto-merge', () => {
  it('emits landing:auto-merge:start and landing:auto-merge:complete when policy=always and PR URL is discovered', async () => {
    await seedLayer(cwd);

    const binDir = join(cwd, 'bin-stack-am-ok');
    createFakeGhForStack(binDir, 'merge-success');

    const origPath = process.env.PATH;
    process.env.PATH = `${binDir}:${origPath}`;

    try {
      const provider = makeStubProvider({
        submitBranch: async () =>
          makeResult('git-spice', ['branch', 'submit'], 'Created PR https://github.com/owner/repo/pull/55'),
      });

      const opts: StackLandingOptions = {
        cwd,
        mergeWorktreePath: cwd,
        stackContext: makeStackContext(),
        landingAction: 'pr',
        provider,
        prAutoMergePolicy: 'always',
      };

      const events = await collectEvents(executeStackLanding(opts));

      const eventTypes = events.map((e) => e.type);
      expect(eventTypes).toContain('landing:auto-merge:start');
      expect(eventTypes).toContain('landing:auto-merge:complete');
      expect(eventTypes).not.toContain('landing:auto-merge:skipped');

      const startEvent = events.find((e) => e.type === 'landing:auto-merge:start') as Extract<EforgeEvent, { type: 'landing:auto-merge:start' }>;
      expect(startEvent.featureBranch).toBe('eforge/test-prd');
    } finally {
      process.env.PATH = origPath;
    }
  });

  it('emits landing:auto-merge:skipped (non-fatal) when gh pr merge fails and stack landing still completes', async () => {
    await seedLayer(cwd);

    const binDir = join(cwd, 'bin-stack-am-fail');
    createFakeGhForStack(binDir, 'merge-fail');

    const origPath = process.env.PATH;
    process.env.PATH = `${binDir}:${origPath}`;

    try {
      const provider = makeStubProvider({
        submitBranch: async () =>
          makeResult('git-spice', ['branch', 'submit'], 'Created PR https://github.com/owner/repo/pull/56'),
      });

      const opts: StackLandingOptions = {
        cwd,
        mergeWorktreePath: cwd,
        stackContext: makeStackContext(),
        landingAction: 'pr',
        provider,
        prAutoMergePolicy: 'always',
      };

      const events = await collectEvents(executeStackLanding(opts));

      const eventTypes = events.map((e) => e.type);
      // Stack landing must succeed even though auto-merge failed
      expect(eventTypes).toContain('stack:landing:update');
      expect(eventTypes).toContain('landing:auto-merge:start');
      expect(eventTypes).toContain('landing:auto-merge:skipped');
      expect(eventTypes).not.toContain('landing:auto-merge:complete');

      const update = events.find(
        (e) => e.type === 'stack:landing:update' && (e as Extract<EforgeEvent, { type: 'stack:landing:update' }>).status === 'complete',
      );
      expect(update).toBeDefined();
    } finally {
      process.env.PATH = origPath;
    }
  });

  it('emits landing:auto-merge:skipped with reason mentioning PR URL when no PR URL is discovered', async () => {
    await seedLayer(cwd);

    const origPath = process.env.PATH;

    try {
      // submitBranch returns no parseable PR URL
      const provider = makeStubProvider({
        submitBranch: async () =>
          makeResult('git-spice', ['branch', 'submit'], 'branch submitted'),
      });

      const opts: StackLandingOptions = {
        cwd,
        mergeWorktreePath: cwd,
        stackContext: makeStackContext(),
        landingAction: 'pr',
        provider,
        prAutoMergePolicy: 'always',
      };

      // Ensure no real gh binary interferes
      process.env.PATH = '/nonexistent-path-for-test';

      const events = await collectEvents(executeStackLanding(opts));

      const eventTypes = events.map((e) => e.type);
      expect(eventTypes).toContain('landing:auto-merge:skipped');
      expect(eventTypes).not.toContain('landing:auto-merge:start');

      const skippedEvent = events.find((e) => e.type === 'landing:auto-merge:skipped') as Extract<EforgeEvent, { type: 'landing:auto-merge:skipped' }> | undefined;
      expect(skippedEvent).toBeDefined();
      expect(skippedEvent?.reason).toMatch(/PR URL/i);
    } finally {
      process.env.PATH = origPath;
    }
  });

  it('emits landing:auto-merge:skipped when policy=ask and landingAutoMerge is not set', async () => {
    await seedLayer(cwd);

    const binDir = join(cwd, 'bin-stack-ask');
    createFakeGhForStack(binDir, 'merge-success');

    const origPath = process.env.PATH;
    process.env.PATH = `${binDir}:${origPath}`;

    try {
      const provider = makeStubProvider({
        submitBranch: async () =>
          makeResult('git-spice', ['branch', 'submit'], 'https://github.com/owner/repo/pull/57'),
      });

      const opts: StackLandingOptions = {
        cwd,
        mergeWorktreePath: cwd,
        stackContext: makeStackContext(),
        landingAction: 'pr',
        provider,
        prAutoMergePolicy: 'ask',
        // landingAutoMerge not set → policy=ask → disabled
      };

      const events = await collectEvents(executeStackLanding(opts));

      const eventTypes = events.map((e) => e.type);
      expect(eventTypes).toContain('landing:auto-merge:skipped');
      expect(eventTypes).not.toContain('landing:auto-merge:start');
    } finally {
      process.env.PATH = origPath;
    }
  });
});



function makeFakeGhForMetadata(binDir: string, editBehavior: 'success' | 'fail'): void {
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

describe('executeStackLanding — PR metadata editing', () => {
  it('calls gh pr edit with the discovered PR URL when metadata is provided', async () => {
    await seedLayer(cwd);

    const binDir = join(cwd, 'bin-stack-meta-ok');
    makeFakeGhForMetadata(binDir, 'success');
    const argsLog = join(cwd, 'gh-pr-args.log');

    const origPath = process.env.PATH;
    process.env.PATH = `${binDir}:${origPath}`;

    try {
      const prUrl = 'https://github.com/owner/repo/pull/42';
      const provider = makeStubProvider({
        submitBranch: async () =>
          makeResult('git-spice', ['branch', 'submit'], `Created PR ${prUrl}`),
      });

      const metadata: PullRequestMetadata = {
        title: 'Test PR title',
        body: '## Summary\nTest PR body\n\n## Build metadata\n- Plan set: `test-set`\n- Base branch: `main`\n- Artifact branch: `eforge/test-prd`',
      };

      const opts: StackLandingOptions = {
        cwd,
        mergeWorktreePath: cwd,
        stackContext: makeStackContext(),
        landingAction: 'pr',
        provider,
        metadata,
      };

      const events = await collectEvents(executeStackLanding(opts));

      // Provider calls must still happen in order
      const providerCmds = events.filter((e) => e.type === 'stack:provider:command');
      expect(providerCmds).toHaveLength(3);
      expect(providerCmds[0]).toMatchObject({ args: expect.arrayContaining(['track']) });
      expect(providerCmds[1]).toMatchObject({ args: expect.arrayContaining(['restack']) });
      expect(providerCmds[2]).toMatchObject({ args: expect.arrayContaining(['submit']) });

      // stack:landing:update with status complete must be emitted
      const completeEvent = events.find(
        (e) => e.type === 'stack:landing:update' && (e as Record<string, unknown>).status === 'complete',
      );
      expect(completeEvent).toBeDefined();

      // gh pr edit must have been called with the discovered URL
      const ghArgsRaw = readFileSync(argsLog, 'utf-8').trim();
      const invocations: string[][] = ghArgsRaw.split('\n').map((line) => JSON.parse(line));
      const editInvocation = invocations.find((args) => args[0] === 'pr' && args[1] === 'edit');
      expect(editInvocation).toBeDefined();
      expect(editInvocation).toContain(prUrl);
      expect(editInvocation).toContain('--title');
      expect(editInvocation).toContain('--body-file');
    } finally {
      process.env.PATH = origPath;
    }
  });

  it('emits planning:progress diagnostic and still emits stack:landing:update complete when gh pr edit fails', async () => {
    await seedLayer(cwd);

    const binDir = join(cwd, 'bin-stack-meta-fail');
    makeFakeGhForMetadata(binDir, 'fail');

    const origPath = process.env.PATH;
    process.env.PATH = `${binDir}:${origPath}`;

    try {
      const prUrl = 'https://github.com/owner/repo/pull/99';
      const provider = makeStubProvider({
        submitBranch: async () =>
          makeResult('git-spice', ['branch', 'submit'], `Created PR ${prUrl}`),
      });

      const metadata: PullRequestMetadata = {
        title: 'Test PR title',
        body: '## Summary\nTest PR body',
      };

      const opts: StackLandingOptions = {
        cwd,
        mergeWorktreePath: cwd,
        stackContext: makeStackContext(),
        landingAction: 'pr',
        provider,
        metadata,
      };

      const events = await collectEvents(executeStackLanding(opts));

      // stack:landing:update must still reach complete status (edit failure is non-fatal)
      const completeEvent = events.find(
        (e) => e.type === 'stack:landing:update' && (e as Record<string, unknown>).status === 'complete',
      );
      expect(completeEvent).toBeDefined();

      // A planning:progress diagnostic must have been emitted for the edit failure
      const progressEvent = events.find(
        (e) => e.type === 'planning:progress',
      ) as Extract<EforgeEvent, { type: 'planning:progress' }> | undefined;
      expect(progressEvent).toBeDefined();
      expect(progressEvent?.message).toMatch(/PR metadata|metadata update/i);
    } finally {
      process.env.PATH = origPath;
    }
  });
});

// --- eforge:region plan-02-landing-preflight-and-observability ---
describe('executeStackLanding — landing-time base preflight and repair', () => {
  function childContext(parentSha: string): StackBaseContext {
    return makeStackContext({
      parentPrdId: 'parent-prd', baseBranch: 'eforge/parent-prd', originalBaseBranch: 'eforge/parent-prd', effectiveBaseBranch: 'eforge/parent-prd',
      parentArtifactRef: 'eforge/parent-prd', parentArtifactCommit: parentSha, trunkBranch: 'main', trunkRemote: 'origin', trunkIntegrationRef: 'refs/remotes/origin/main',
    });
  }

  it('tracks an existing remote parent base without retargeting', async () => {
    const { parentSha } = setupStackRepo({ parentIntegrated: false, deleteParentRemote: false });
    const trackBases: string[] = [];
    let retargetCalled = false;
    const provider = makeStubProvider({
      trackBranch: async (_cwd, base) => { trackBases.push(base); return makeResult('git-spice', ['branch', 'track', '--base', base]); },
      retargetBranch: async (_cwd, branch, target) => { retargetCalled = true; return makeResult('git-spice', ['branch', 'onto', target, '--branch', branch]); },
    });
    await seedLayer(cwd);
    await collectEvents(executeStackLanding(landingOptions(provider, { stackContext: childContext(parentSha) })));
    expect(trackBases).toEqual(['eforge/parent-prd']);
    expect(retargetCalled).toBe(false);
  });

  it('repairs a missing integrated parent base and reports effective trunk metadata', async () => {
    const { parentSha } = setupStackRepo({ parentIntegrated: true, deleteParentRemote: true });
    const binDir = join(cwd, 'bin-stack-repair');
    makeFakeGhForMetadata(binDir, 'success');
    const origPath = process.env.PATH;
    process.env.PATH = `${binDir}:${origPath}`;
    const calls: string[] = [];
    const provider = makeStubProvider({
      retargetBranch: async (_cwd, branch, target) => { calls.push(`${branch}:${target}`); return makeResult('git-spice', ['branch', 'onto', target, '--branch', branch]); },
      submitBranch: async () => makeResult('git-spice', ['branch', 'submit'], 'https://github.com/owner/repo/pull/42'),
    });
    await seedLayer(cwd);
    try {
      const events = await collectEvents(executeStackLanding(landingOptions(provider, {
        stackContext: childContext(parentSha), prAutoMergePolicy: 'always',
        metadataFactory: async ({ effectiveBaseBranch }) => ({ title: 't', body: `## Build metadata\n- Base branch: \`${effectiveBaseBranch}\`` }),
      })));
      const complete = events.find((e) => e.type === 'stack:landing:update' && (e as { status?: string }).status === 'complete');
      const landing = (await loadStackState(cwd)).layers.find((l) => l.prdId === 'test-prd')?.landing;
      const body = readFileSync(join(cwd, 'gh-pr-body.log'), 'utf-8');
      expect(calls).toEqual(['eforge/test-prd:main']);
      expect(events).toContainEqual(expect.objectContaining({ type: 'stack:provider:command', args: ['branch', 'onto', 'main', '--branch', 'eforge/test-prd'] }));
      expect(complete).toMatchObject({ originalBaseBranch: 'eforge/parent-prd', effectiveBaseBranch: 'main', baseRepairReason: 'parent-artifact-already-integrated' });
      expect(landing).toMatchObject({ originalBaseBranch: 'eforge/parent-prd', effectiveBaseBranch: 'main', baseRepairReason: 'parent-artifact-already-integrated' });
      expect(body).toContain('Base branch: `main`');
      expect(body.split('\n').find((line) => line.includes('Base branch:'))).not.toContain('eforge/parent-prd');
      expect(events).toContainEqual(expect.objectContaining({ type: 'landing:auto-merge:start', baseBranch: 'main' }));
      expect(events).toContainEqual(expect.objectContaining({ type: 'landing:auto-merge:complete', baseBranch: 'main' }));
    } finally {
      process.env.PATH = origPath;
    }
  });

  it('fails closed and skips submit when a missing parent base is not proven integrated', async () => {
    const { parentSha } = setupStackRepo({ parentIntegrated: false, deleteParentRemote: true });
    let submitCalled = false;
    const provider = makeStubProvider({ submitBranch: async () => { submitCalled = true; return makeResult('git-spice', ['branch', 'submit']); } });
    await seedLayer(cwd);
    const events = await collectEvents(executeStackLanding(landingOptions(provider, { stackContext: childContext(parentSha) })));
    const layer = (await loadStackState(cwd)).layers.find((l) => l.prdId === 'test-prd');
    expect(submitCalled).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: 'stack:landing:update', status: 'failed', reason: expect.stringContaining('not an ancestor') });
    expect(layer?.status).toBe('failed');
    expect(layer?.landing?.status).toBe('failed');
  });
});
// --- eforge:endregion plan-02-landing-preflight-and-observability ---

