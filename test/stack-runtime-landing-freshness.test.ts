import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import {
  advanceRemoteBase,
  collectEvents,
  cwd,
  executeStackLanding,
  GitSpiceCommandError,
  git,
  landingOptions,
  loadStackState,
  makeResult,
  makeStackContext,
  makeStubProvider,
  seedLayer,
  setupRemoteBaseRepo,
} from './stack-runtime-landing-helpers.js';

describe('executeStackLanding — remote-base freshness proof', () => {
  it('emits fetch command metadata, persists failed landing, and skips submit when freshness proof fetch fails', async () => {
    setupRemoteBaseRepo();
    git(['remote', 'set-url', 'origin', join(cwd, 'missing-remote.git')]);
    let syncCalls = 0;
    let restackCalls = 0;
    let submitCalls = 0;
    const provider = makeStubProvider({
      syncRepo: async () => {
        syncCalls += 1;
        return makeResult('git-spice', ['repo', 'sync']);
      },
      restackBranch: async () => {
        restackCalls += 1;
        return makeResult('git-spice', ['branch', 'restack']);
      },
      submitBranch: async () => {
        submitCalls += 1;
        return makeResult('git-spice', ['branch', 'submit']);
      },
    });
    await seedLayer(cwd);

    const events = await collectEvents(executeStackLanding(landingOptions(provider)));
    const layer = (await loadStackState(cwd)).layers.find((item) => item.prdId === 'test-prd');
    const fetchIdx = events.findIndex((event) => event.type === 'stack:provider:command' && event.command === 'git' && event.args[0] === 'fetch');
    const failedIdx = events.findIndex((event) => event.type === 'stack:landing:update' && (event as { status?: string }).status === 'failed');

    expect(syncCalls).toBe(1);
    expect(restackCalls).toBe(1);
    expect(submitCalls).toBe(0);
    expect(fetchIdx).toBeGreaterThanOrEqual(0);
    expect(failedIdx).toBeGreaterThan(fetchIdx);
    expect(events.filter((event) => event.type === 'stack:provider:command' && event.args.join(' ') === 'repo sync')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'stack:provider:command' && event.args.join(' ') === 'branch restack')).toHaveLength(1);
    expect(events[fetchIdx]).toMatchObject({ type: 'stack:provider:command', args: ['fetch', '--no-tags', '--no-recurse-submodules', 'origin', 'main'], exitCode: expect.any(Number) });
    expect(events[failedIdx]).toMatchObject({ type: 'stack:landing:update', status: 'failed', reason: expect.stringContaining("could not be fetched") });
    expect(layer?.status).toBe('failed');
    expect(layer?.landing?.status).toBe('failed');
  });

  it('uses stackContext.trunkRemote for the freshness fetch', async () => {
    setupRemoteBaseRepo();
    git(['remote', 'add', 'upstream', join(cwd, 'missing-upstream.git')]);
    let submitCalls = 0;
    const provider = makeStubProvider({
      submitBranch: async () => {
        submitCalls += 1;
        return makeResult('git-spice', ['branch', 'submit']);
      },
    });
    await seedLayer(cwd);

    const events = await collectEvents(executeStackLanding(landingOptions(provider, {
      stackContext: makeStackContext({ trunkRemote: 'upstream' }),
    })));

    expect(submitCalls).toBe(0);
    expect(events).toContainEqual(expect.objectContaining({
      type: 'stack:provider:command',
      command: 'git',
      args: ['fetch', '--no-tags', '--no-recurse-submodules', 'upstream', 'main'],
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: 'stack:landing:update',
      status: 'failed',
      reason: expect.stringContaining('upstream/main'),
    }));
    expect(events).not.toContainEqual(expect.objectContaining({
      type: 'stack:provider:command',
      command: 'git',
      args: ['fetch', '--no-tags', '--no-recurse-submodules', 'origin', 'main'],
    }));
  });

  it('fails closed, persists failed landing, and skips submit when repo sync fails', async () => {
    setupRemoteBaseRepo();
    let submitCalls = 0;
    const provider = makeStubProvider({
      syncRepo: async () => {
        throw new GitSpiceCommandError('git-spice', ['repo', 'sync'], 2, 'sync failed');
      },
      submitBranch: async () => {
        submitCalls += 1;
        return makeResult('git-spice', ['branch', 'submit']);
      },
    });
    await seedLayer(cwd);

    const events = await collectEvents(executeStackLanding(landingOptions(provider)));
    const layer = (await loadStackState(cwd)).layers.find((item) => item.prdId === 'test-prd');

    expect(submitCalls).toBe(0);
    expect(events).toContainEqual(expect.objectContaining({ type: 'stack:provider:command', args: ['repo', 'sync'], exitCode: 2 }));
    expect(events.at(-1)).toMatchObject({ type: 'stack:landing:update', status: 'failed' });
    expect(layer?.landing?.status).toBe('failed');
  });

  it('retries sync and branch restack once when the first freshness proof is stale', async () => {
    setupRemoteBaseRepo();
    await seedLayer(cwd);
    let syncCalls = 0;
    let restackCalls = 0;
    let submitCalls = 0;
    let advancedMain = '';
    const provider = makeStubProvider({
      syncRepo: async () => {
        syncCalls += 1;
        return makeResult('git-spice', ['repo', 'sync']);
      },
      restackBranch: async () => {
        restackCalls += 1;
        if (restackCalls === 1) {
          advancedMain = advanceRemoteBase();
        } else {
          git(['fetch', 'origin', 'main']);
          git(['merge', '--no-edit', 'FETCH_HEAD']);
        }
        return makeResult('git-spice', ['branch', 'restack']);
      },
      submitBranch: async () => {
        submitCalls += 1;
        return makeResult('git-spice', ['branch', 'submit']);
      },
    });

    const events = await collectEvents(executeStackLanding(landingOptions(provider)));

    const restackEventIndexes = events
      .map((event, index) => ({ event, index }))
      .filter(({ event }) => event.type === 'stack:provider:command' && event.args.includes('restack'))
      .map(({ index }) => index);
    const submitEventIndex = events.findIndex((event) => event.type === 'stack:provider:command' && event.args.includes('submit'));

    execFileSync('git', ['merge-base', '--is-ancestor', advancedMain, 'HEAD'], { cwd });
    expect(syncCalls).toBe(2);
    expect(restackCalls).toBe(2);
    expect(submitCalls).toBe(1);
    expect(restackEventIndexes).toHaveLength(2);
    expect(submitEventIndex).toBeGreaterThan(restackEventIndexes[1]);
    expect(events).toContainEqual(expect.objectContaining({ type: 'stack:landing:update', status: 'complete' }));
  });

  it('fails without submitting when the remote base remains ahead after the retry', async () => {
    setupRemoteBaseRepo();
    await seedLayer(cwd);
    let syncCalls = 0;
    let restackCalls = 0;
    let submitCalls = 0;
    const provider = makeStubProvider({
      syncRepo: async () => {
        syncCalls += 1;
        return makeResult('git-spice', ['repo', 'sync']);
      },
      restackBranch: async () => {
        restackCalls += 1;
        if (restackCalls === 1) advanceRemoteBase();
        return makeResult('git-spice', ['branch', 'restack']);
      },
      submitBranch: async () => {
        submitCalls += 1;
        return makeResult('git-spice', ['branch', 'submit']);
      },
    });

    const events = await collectEvents(executeStackLanding(landingOptions(provider)));

    const layer = (await loadStackState(cwd)).layers.find((item) => item.prdId === 'test-prd');

    expect(syncCalls).toBe(2);
    expect(restackCalls).toBe(2);
    expect(submitCalls).toBe(0);
    expect(events.at(-1)).toMatchObject({ type: 'stack:landing:update', status: 'failed', reason: expect.stringContaining('not an ancestor') });
    expect(layer?.status).toBe('failed');
    expect(layer?.landing?.status).toBe('failed');
    expect(layer?.landing?.reason).toContain('not an ancestor');
  });
});
