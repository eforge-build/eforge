import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  collectEvents,
  createFakeGhForStack,
  createGitSpiceAdapter,
  cwd,
  executeStackLanding,
  GitSpiceCommandError,
  GitSpiceNotAvailableError,
  initGitRepo,
  interruptedRestack,
  landingOptions,
  loadStackState,
  makeFakeGhForMetadata,
  makeResult,
  makeStackContext,
  makeStubProvider,
  recoverableRestack,
  recoveryLifecycleTypes,
  seedLayer,
  setupStackRepo,
  stackLanding,
  type EforgeEvent,
  type PhaseContext,
  type PullRequestMetadata,
  type StackBaseContext,
  type StackLandingOptions,
  type StackProviderAdapter,
} from './stack-runtime-landing-helpers.js';

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
