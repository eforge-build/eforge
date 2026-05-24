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
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

// ---------------------------------------------------------------------------
// executeStackLanding — PR action, argv construction
// ---------------------------------------------------------------------------

describe('executeStackLanding — pr action argv construction', () => {
  it('calls trackBranch with the resolved base then submitBranch in the merge worktree', async () => {
    const trackCalls: [string, string][] = [];
    const submitCalls: string[] = [];

    const provider = makeStubProvider({
      trackBranch: async (worktreePath, base) => {
        trackCalls.push([worktreePath, base]);
        return makeResult('git-spice', ['branch', 'track', '--base', base]);
      },
      submitBranch: async (worktreePath) => {
        submitCalls.push(worktreePath);
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

    expect(trackCalls).toHaveLength(1);
    expect(trackCalls[0]).toEqual([cwd, 'main']);
    expect(submitCalls).toHaveLength(1);
    expect(submitCalls[0]).toBe(cwd);
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
  it('emits started, provider:command x2, complete events in order', async () => {
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
    expect(types).toEqual([
      'stack:landing:update',
      'stack:provider:command',
      'stack:provider:command',
      'stack:landing:update',
    ]);
    expect((events[0] as Record<string, unknown>).status).toBe('started');
    expect((events[3] as Record<string, unknown>).status).toBe('complete');
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

  it('second stack:provider:command has submitBranch args', async () => {
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
});

// ---------------------------------------------------------------------------
// executeStackLanding — failure handling
// ---------------------------------------------------------------------------

describe('executeStackLanding — failure handling', () => {
  it('emits stack:landing:update failed when trackBranch throws', async () => {
    const provider = makeStubProvider({
      trackBranch: async () => {
        throw new Error('git-spice: branch track failed');
      },
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
    const failEvent = events.find(
      (e) =>
        e.type === 'stack:landing:update' &&
        (e as Record<string, unknown>).status === 'failed',
    );
    expect(failEvent).toMatchObject({
      type: 'stack:landing:update',
      status: 'failed',
      reason: expect.stringContaining('git-spice: branch track failed'),
    });
  });

  it('emits a provider command event with the failing exit code when trackBranch invokes git-spice and fails', async () => {
    const provider = makeStubProvider({
      trackBranch: async () => {
        throw new GitSpiceCommandError('git-spice', ['branch', 'track', '--base', 'main'], 2, 'fatal');
      },
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
    const commandEvent = events.find((event) => event.type === 'stack:provider:command');
    expect(commandEvent).toMatchObject({
      type: 'stack:provider:command',
      command: 'git-spice',
      args: ['branch', 'track', '--base', 'main'],
      exitCode: 2,
    });
    expect(events.at(-1)).toMatchObject({
      type: 'stack:landing:update',
      status: 'failed',
    });
  });

  it('does not call submitBranch when trackBranch fails', async () => {
    let submitCalled = false;
    const provider = makeStubProvider({
      trackBranch: async () => {
        throw new Error('track failed');
      },
      submitBranch: async () => {
        submitCalled = true;
        return makeResult('git-spice', ['branch', 'submit']);
      },
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
    expect(submitCalled).toBe(false);
  });

  it('emits stack:landing:update failed when submitBranch throws', async () => {
    const provider = makeStubProvider({
      submitBranch: async () => {
        throw new Error('git-spice: submit failed');
      },
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
    const failEvent = events.find(
      (e) =>
        e.type === 'stack:landing:update' &&
        (e as Record<string, unknown>).status === 'failed',
    );
    expect(failEvent).toMatchObject({
      type: 'stack:landing:update',
      status: 'failed',
      reason: expect.stringContaining('git-spice: submit failed'),
    });
  });

  it('persists failed landing state when trackBranch throws', async () => {
    const provider = makeStubProvider({
      trackBranch: async () => {
        throw new Error('track error');
      },
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
    expect(layer?.landing?.status).toBe('failed');
    expect(layer?.landing?.reason).toContain('track error');
    expect(layer?.landing?.completedAt).toBeTruthy();
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
