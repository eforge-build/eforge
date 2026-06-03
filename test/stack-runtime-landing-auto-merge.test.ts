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
  }, 15_000);

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

