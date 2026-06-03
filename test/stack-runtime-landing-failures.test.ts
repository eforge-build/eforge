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

// --- eforge:region non-pr-actions ---
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
// --- eforge:endregion non-pr-actions ---

// --- eforge:region failure-handling ---
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
// --- eforge:endregion failure-handling ---

// --- eforge:region missing-provider ---
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
// --- eforge:endregion missing-provider ---

// --- eforge:region stack-landing-phase ---
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
    await seedLayer(cwd);
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
    const layer = (await loadStackState(cwd)).layers.find((l) => l.prdId === 'test-prd');
    expect(layer?.status).toBe('failed');
    expect(layer?.landing?.status).toBe('skipped');
    expect(layer?.landing?.action).toBe('pr');
    expect(layer?.landing?.reason).toBe('Build failed before landing could be attempted');
    expect(layer?.landing?.startedAt).toBeTruthy();
    expect(layer?.landing?.completedAt).toBeTruthy();
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
    await seedLayer(cwd);
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
    const layer = (await loadStackState(cwd)).layers.find((l) => l.prdId === 'test-prd');
    expect(layer?.status).toBe('failed');
    expect(layer?.landing?.status).toBe('skipped');
    expect(layer?.landing?.action).toBe('pr');
    expect(layer?.landing?.reason).toBe('Build aborted before landing could be attempted');
    expect(layer?.landing?.startedAt).toBeTruthy();
    expect(layer?.landing?.completedAt).toBeTruthy();
  });
});
// --- eforge:endregion stack-landing-phase ---

