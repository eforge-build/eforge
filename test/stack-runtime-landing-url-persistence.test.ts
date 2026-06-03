import { describe, it, expect } from 'vitest';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

    const origPath = process.env.PATH;
    process.env.PATH = '/nonexistent-path-for-test';

    try {
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
      expect(layer?.landing?.prUrl).toBeUndefined();
    } finally {
      process.env.PATH = origPath;
    }
  });

  it('uses gh pr view fallback when submit output has no URL', async () => {
    const prUrl = 'https://github.com/owner/repo/pull/77';
    const provider = makeStubProvider({
      submitBranch: async () =>
        makeResult('git-spice', ['branch', 'submit'], 'Branch submitted successfully'),
    });
    await seedLayer(cwd);

    const binDir = join(cwd, 'bin-gh-view');
    mkdirSync(binDir, { recursive: true });
    const ghPath = join(binDir, 'gh');
    writeFileSync(ghPath, `#!/usr/bin/env node
const args = process.argv.slice(2);
const fs = require('fs');
const path = require('path');
if (args[0] === 'pr' && args[1] === 'view') {
  fs.appendFileSync(path.join(__dirname, 'gh-view-args.log'), JSON.stringify(args) + '\\n');
  if (args[2] === 'eforge/test-prd' && args.includes('--json') && args.includes('url') && args.includes('-q') && args.includes('.url')) {
    process.stdout.write('${prUrl}\\n');
    process.exit(0);
  }
  process.exit(1);
}
process.exit(0);
`, { mode: 0o755 });
    chmodSync(ghPath, 0o755);

    const origPath = process.env.PATH;
    process.env.PATH = `${binDir}:${origPath}`;

    try {
      const events = await collectEvents(executeStackLanding({
        cwd,
        mergeWorktreePath: cwd,
        stackContext: makeStackContext(),
        landingAction: 'pr',
        provider,
      }));

      const complete = events.find(
        (e) => e.type === 'stack:landing:update' && (e as Record<string, unknown>).status === 'complete',
      );
      expect(complete).toMatchObject({
        type: 'stack:landing:update',
        status: 'complete',
        prUrl,
      });

      const layer = (await loadStackState(cwd)).layers.find((l) => l.prdId === 'test-prd');
      expect(layer?.landing?.status).toBe('complete');
      expect(layer?.landing?.prUrl).toBe(prUrl);

      const ghViewArgsLog = readFileSync(join(binDir, 'gh-view-args.log'), 'utf-8').trim();
      const viewInvocation: string[] = JSON.parse(ghViewArgsLog.split('\n').at(-1)!);
      expect(viewInvocation).toEqual(['pr', 'view', 'eforge/test-prd', '--json', 'url', '-q', '.url']);
    } finally {
      process.env.PATH = origPath;
    }
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
