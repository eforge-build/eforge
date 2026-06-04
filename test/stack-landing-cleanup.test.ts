/**
 * Tests for plan-03-stack-landing-lifecycle-cleanup: cleanup-before-submit behavior.
 *
 * Verifies:
 *   1. When shouldCleanup is true, cleanup runs before submitBranch:
 *      a planning:progress event (from the non-fatal cleanup failure in a non-git
 *      temp dir) appears before the submit stack:provider:command event.
 *   2. When shouldCleanup is false/omitted, no additional cleanup events appear
 *      and the standard provider:command sequence is preserved.
 *   3. Cleanup failure is non-fatal: submitBranch is still called and
 *      stack:landing:update complete is still emitted.
 *   4. Cleanup runs exactly once per executeStackLanding call.
 */


import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  executeStackLanding,
  type StackLandingOptions,
  type StackProviderAdapter,
  type ProviderCommandResult,
} from '@eforge-build/engine/stacking';
import type { EforgeEvent } from '@eforge-build/engine/events';
import type { StackBaseContext } from '@eforge-build/engine/stacking';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'eforge-stack-cleanup-'));
  setupRemoteBaseRepo();
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
        'Created PR https://github.com/owner/repo/pull/1',
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
    prdId: 'cleanup-prd',
    stackId: 'cleanup-stack',
    provider: 'git-spice',
    branch: 'eforge/cleanup-prd',
    baseBranch: 'main',
    ...overrides,
  };
}

async function collectEvents(gen: AsyncGenerator<EforgeEvent>): Promise<EforgeEvent[]> {
  const events: EforgeEvent[] = [];
  for await (const event of gen) events.push(event);
  return events;
}

function advanceRemoteBase(fileName = 'remote-main.txt'): void {
  const currentBranch = execFileSync('git', ['branch', '--show-current'], { cwd, encoding: 'utf-8' }).trim();
  execFileSync('git', ['checkout', 'main'], { cwd, stdio: 'ignore' });
  writeFileSync(join(cwd, fileName), `${Date.now()}\n`);
  execFileSync('git', ['add', fileName], { cwd });
  execFileSync('git', ['commit', '-m', `advance ${fileName}`], { cwd, stdio: 'ignore' });
  execFileSync('git', ['push', 'origin', 'main'], { cwd, stdio: 'ignore' });
  execFileSync('git', ['checkout', currentBranch], { cwd, stdio: 'ignore' });
}

function setupRemoteBaseRepo(): void {
  execFileSync('git', ['init'], { cwd, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd });
  writeFileSync(join(cwd, 'root.txt'), 'root\n');
  execFileSync('git', ['add', 'root.txt'], { cwd });
  execFileSync('git', ['commit', '-m', 'root'], { cwd, stdio: 'ignore' });
  execFileSync('git', ['branch', '-M', 'main'], { cwd });
  const remoteDir = join(cwd, 'remote.git');
  execFileSync('git', ['init', '--bare', remoteDir], { stdio: 'ignore' });
  execFileSync('git', ['remote', 'add', 'origin', remoteDir], { cwd });
  execFileSync('git', ['push', '-u', 'origin', 'main'], { cwd, stdio: 'ignore' });
  execFileSync('git', ['checkout', '-b', 'eforge/cleanup-prd'], { cwd, stdio: 'ignore' });
  writeFileSync(join(cwd, 'child.txt'), 'child\n');
  execFileSync('git', ['add', 'child.txt'], { cwd });
  execFileSync('git', ['commit', '-m', 'child'], { cwd, stdio: 'ignore' });
}

// ---------------------------------------------------------------------------
// Cleanup before submit — ordering
// ---------------------------------------------------------------------------

describe('executeStackLanding — cleanup before submit', () => {
  it('emits cleanup progress after track, restack after cleanup, and submit after restack when shouldCleanup is true', async () => {
    // The temp dir is not a git repo, so git checkout inside runCleanup will fail.
    // runCleanup catches the error non-fatally and emits a planning:progress event.
    // Order must be: trackBranch provider:command → planning:progress → restackBranch provider:command → submitBranch provider:command
    const provider = makeStubProvider();
    const opts: StackLandingOptions = {
      cwd,
      mergeWorktreePath: cwd,
      stackContext: makeStackContext(),
      landingAction: 'pr',
      provider,
      shouldCleanup: true,
      cleanupPlanSet: 'my-set',
      cleanupOutputDir: '.eforge/output',
    };

    const events = await collectEvents(executeStackLanding(opts));

    const trackIdx = events.findIndex(
      (e) =>
        e.type === 'stack:provider:command' &&
        ((e as Record<string, unknown>).args as string[]).includes('track'),
    );
    const progressIdx = events.findIndex((e) => e.type === 'planning:progress');
    const restackIdx = events.findIndex(
      (e) =>
        e.type === 'stack:provider:command' &&
        ((e as Record<string, unknown>).args as string[]).includes('restack'),
    );
    const submitIdx = events.findIndex(
      (e) =>
        e.type === 'stack:provider:command' &&
        (e as Record<string, unknown>).args !== undefined &&
        ((e as Record<string, unknown>).args as string[]).includes('submit'),
    );

    expect(trackIdx).toBeGreaterThanOrEqual(0);
    expect(progressIdx).toBeGreaterThanOrEqual(0);
    expect(restackIdx).toBeGreaterThanOrEqual(0);
    expect(submitIdx).toBeGreaterThanOrEqual(0);
    // Ordering: track → cleanup(progress) → restack → submit
    expect(trackIdx).toBeLessThan(progressIdx);
    expect(progressIdx).toBeLessThan(restackIdx);
    expect(restackIdx).toBeLessThan(submitIdx);
  });

  it('does not emit planning:progress cleanup events when shouldCleanup is false', async () => {
    const provider = makeStubProvider();
    const opts: StackLandingOptions = {
      cwd,
      mergeWorktreePath: cwd,
      stackContext: makeStackContext(),
      landingAction: 'pr',
      provider,
      shouldCleanup: false,
    };

    const events = await collectEvents(executeStackLanding(opts));
    const progressEvents = events.filter((e) => e.type === 'planning:progress');
    expect(progressEvents).toHaveLength(0);
  });

  it('does not emit planning:progress cleanup events when shouldCleanup is omitted', async () => {
    const provider = makeStubProvider();
    const opts: StackLandingOptions = {
      cwd,
      mergeWorktreePath: cwd,
      stackContext: makeStackContext(),
      landingAction: 'pr',
      provider,
    };

    const events = await collectEvents(executeStackLanding(opts));
    const progressEvents = events.filter((e) => e.type === 'planning:progress');
    expect(progressEvents).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Cleanup is non-fatal — submitBranch still runs
// ---------------------------------------------------------------------------

describe('executeStackLanding — cleanup failure is non-fatal', () => {
  it('calls submitBranch even when cleanup fails (non-fatal)', async () => {
    let submitCalled = false;
    const provider = makeStubProvider({
      submitBranch: async () => {
        submitCalled = true;
        return makeResult('git-spice', ['branch', 'submit']);
      },
    });
    const opts: StackLandingOptions = {
      cwd,
      mergeWorktreePath: cwd,
      stackContext: makeStackContext(),
      landingAction: 'pr',
      provider,
      shouldCleanup: true,
      cleanupPlanSet: 'my-set',
      cleanupOutputDir: '.eforge/output',
    };

    await collectEvents(executeStackLanding(opts));
    expect(submitCalled).toBe(true);
  });

  it('emits stack:landing:update complete even when cleanup fails', async () => {
    const provider = makeStubProvider();
    const opts: StackLandingOptions = {
      cwd,
      mergeWorktreePath: cwd,
      stackContext: makeStackContext(),
      landingAction: 'pr',
      provider,
      shouldCleanup: true,
      cleanupPlanSet: 'my-set',
      cleanupOutputDir: '.eforge/output',
    };

    const events = await collectEvents(executeStackLanding(opts));
    const completeEvent = events.find(
      (e) =>
        e.type === 'stack:landing:update' &&
        (e as Record<string, unknown>).status === 'complete',
    );
    expect(completeEvent).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Cleanup runs exactly once
// ---------------------------------------------------------------------------

describe('executeStackLanding — cleanup runs exactly once', () => {
  it('emits exactly one planning:progress cleanup event per call when shouldCleanup is true', async () => {
    const provider = makeStubProvider();
    const opts: StackLandingOptions = {
      cwd,
      mergeWorktreePath: cwd,
      stackContext: makeStackContext(),
      landingAction: 'pr',
      provider,
      shouldCleanup: true,
      cleanupPlanSet: 'my-set',
      cleanupOutputDir: '.eforge/output',
    };

    const events = await collectEvents(executeStackLanding(opts));
    const progressEvents = events.filter((e) => e.type === 'planning:progress');
    // runCleanup emits one planning:progress per failure (git checkout fails in non-git tempdir)
    expect(progressEvents).toHaveLength(1);
  });

  it('emits cleanup once before the first restack during a stale-base retry', async () => {
    let restackCalls = 0;
    const provider = makeStubProvider({
      restackBranch: async () => {
        restackCalls += 1;
        if (restackCalls === 1) {
          advanceRemoteBase();
        } else {
          execFileSync('git', ['fetch', 'origin', 'main'], { cwd, stdio: 'ignore' });
          execFileSync('git', ['merge', '--no-edit', 'FETCH_HEAD'], { cwd, stdio: 'ignore' });
        }
        return makeResult('git-spice', ['branch', 'restack']);
      },
    });
    const opts: StackLandingOptions = {
      cwd,
      mergeWorktreePath: cwd,
      stackContext: makeStackContext(),
      landingAction: 'pr',
      provider,
      shouldCleanup: true,
      cleanupPlanSet: 'my-set',
      cleanupOutputDir: '.eforge/output',
    };

    const events = await collectEvents(executeStackLanding(opts));
    const cleanupIndexes = events
      .map((event, index) => ({ event, index }))
      .filter(({ event }) => event.type === 'planning:progress')
      .map(({ index }) => index);
    const commandIndexes = events
      .map((event, index) => ({ event, index }))
      .filter(({ event }) => event.type === 'stack:provider:command')
      .map(({ event, index }) => ({ args: (event as { args: string[] }).args, index }));
    const syncIndexes = commandIndexes.filter(({ args }) => args.includes('sync')).map(({ index }) => index);
    const restackIndexes = commandIndexes.filter(({ args }) => args.includes('restack')).map(({ index }) => index);

    expect(cleanupIndexes).toHaveLength(1);
    expect(restackIndexes).toHaveLength(2);
    expect(syncIndexes).toHaveLength(2);
    expect(cleanupIndexes[0]).toBeLessThan(restackIndexes[0]);
    expect(events.slice(syncIndexes[1] + 1, restackIndexes[1]).filter((event) => event.type === 'planning:progress')).toHaveLength(0);
  });

  it('does not emit cleanup events for non-pr actions', async () => {
    const provider = makeStubProvider();
    const opts: StackLandingOptions = {
      cwd,
      mergeWorktreePath: cwd,
      stackContext: makeStackContext(),
      landingAction: 'merge',
      provider,
      shouldCleanup: true,
      cleanupPlanSet: 'my-set',
      cleanupOutputDir: '.eforge/output',
    };

    const events = await collectEvents(executeStackLanding(opts));
    const progressEvents = events.filter((e) => e.type === 'planning:progress');
    expect(progressEvents).toHaveLength(0);
  });
});


// ---------------------------------------------------------------------------
// Stack landing exposes PR URL and status for artifact finalization
// ---------------------------------------------------------------------------


describe('executeStackLanding — PR URL and status in stack:landing:update events', () => {
  it('emits stack:landing:update complete with prUrl from submit output', async () => {
    const prUrl = 'https://github.com/owner/repo/pull/42';
    const provider = makeStubProvider({
      submitBranch: async () =>
        makeResult('git-spice', ['branch', 'submit'], `Created PR ${prUrl}`),
    });
    const opts: StackLandingOptions = {
      cwd,
      mergeWorktreePath: cwd,
      stackContext: makeStackContext(),
      landingAction: 'pr',
      provider,
    };

    const events = await collectEvents(executeStackLanding(opts));
    const completeEvent = events.find(
      (e) =>
        e.type === 'stack:landing:update' &&
        (e as Record<string, unknown>).status === 'complete',
    ) as (Record<string, unknown> & { type: string }) | undefined;

    expect(completeEvent).toBeDefined();
    // prUrl should be surfaced in the complete event so stackLanding() can finalize artifact.
    expect(completeEvent?.prUrl).toBe(prUrl);
  });

  it('emits stack:landing:update failed with reason when trackBranch throws', async () => {
    const provider = makeStubProvider({
      trackBranch: async () => {
        const err = new Error('git-spice: branch track failed');
        (err as NodeJS.ErrnoException & { command?: string; args?: string[]; exitCode?: number }).command = 'git-spice';
        (err as NodeJS.ErrnoException & { command?: string; args?: string[]; exitCode?: number }).args = ['branch', 'track', '--base', 'main'];
        (err as NodeJS.ErrnoException & { command?: string; args?: string[]; exitCode?: number }).exitCode = 1;
        throw err;
      },
    });
    const opts: StackLandingOptions = {
      cwd,
      mergeWorktreePath: cwd,
      stackContext: makeStackContext(),
      landingAction: 'pr',
      provider,
    };

    const events = await collectEvents(executeStackLanding(opts));
    const failedEvent = events.find(
      (e) =>
        e.type === 'stack:landing:update' &&
        (e as Record<string, unknown>).status === 'failed',
    ) as (Record<string, unknown> & { type: string }) | undefined;

    expect(failedEvent).toBeDefined();
    expect(typeof failedEvent?.reason).toBe('string');
    expect(String(failedEvent?.reason).length).toBeGreaterThan(0);
  });

  it('emits stack:landing:update skipped with reason for non-pr actions', async () => {
    const provider = makeStubProvider();
    const opts: StackLandingOptions = {
      cwd,
      mergeWorktreePath: cwd,
      stackContext: makeStackContext(),
      landingAction: 'merge',
      provider,
    };

    const events = await collectEvents(executeStackLanding(opts));
    const skippedEvent = events.find(
      (e) =>
        e.type === 'stack:landing:update' &&
        (e as Record<string, unknown>).status === 'skipped',
    ) as (Record<string, unknown> & { type: string }) | undefined;

    expect(skippedEvent).toBeDefined();
    expect(typeof skippedEvent?.reason).toBe('string');
  });
});

