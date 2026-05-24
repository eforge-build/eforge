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

// --- eforge:region plan-03-stack-landing-lifecycle-cleanup ---

import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
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
        'Created PR https://github.com/owner/repo/pull/1',
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

// ---------------------------------------------------------------------------
// Cleanup before submit — ordering
// ---------------------------------------------------------------------------

describe('executeStackLanding — cleanup before submit', () => {
  it('emits a planning:progress cleanup event before the submitBranch provider:command event when shouldCleanup is true', async () => {
    // The temp dir is not a git repo, so git checkout inside runCleanup will fail.
    // runCleanup catches the error non-fatally and emits a planning:progress event.
    // That event must appear before the submit stack:provider:command.
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

    const progressIdx = events.findIndex((e) => e.type === 'planning:progress');
    const submitIdx = events.findIndex(
      (e) =>
        e.type === 'stack:provider:command' &&
        (e as Record<string, unknown>).args !== undefined &&
        ((e as Record<string, unknown>).args as string[]).includes('submit'),
    );

    expect(progressIdx).toBeGreaterThanOrEqual(0);
    expect(submitIdx).toBeGreaterThanOrEqual(0);
    expect(progressIdx).toBeLessThan(submitIdx);
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

// --- eforge:endregion plan-03-stack-landing-lifecycle-cleanup ---
