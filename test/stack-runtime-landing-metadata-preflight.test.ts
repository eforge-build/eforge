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
  git,
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
      expect(providerCmds).toHaveLength(4);
      expect(providerCmds[0]).toMatchObject({ args: ['repo', 'sync'] });
      expect(providerCmds[1]).toMatchObject({ args: expect.arrayContaining(['track']) });
      expect(providerCmds[2]).toMatchObject({ args: expect.arrayContaining(['restack']) });
      expect(providerCmds[3]).toMatchObject({ args: expect.arrayContaining(['submit']) });

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
      const titleIdx = editInvocation!.indexOf('--title');
      expect(titleIdx).toBeGreaterThan(-1);
      expect(editInvocation![titleIdx + 1]).toBe(metadata.title);
      expect(editInvocation).toContain('--body-file');
      const body = readFileSync(join(cwd, 'gh-pr-body.log'), 'utf-8').split('\n---END---')[0];
      expect(body).toBe(metadata.body);
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

describe('executeStackLanding — landing-time base preflight and repair', () => {
  function childContext(parentSha: string, overrides: Partial<StackBaseContext> = {}): StackBaseContext {
    const trunkBranch = overrides.trunkBranch ?? 'main';
    return makeStackContext({
      parentPrdId: 'parent-prd', baseBranch: 'eforge/parent-prd', originalBaseBranch: 'eforge/parent-prd', effectiveBaseBranch: 'eforge/parent-prd',
      parentArtifactRef: 'eforge/parent-prd', parentArtifactCommit: parentSha, trunkBranch, trunkRemote: 'origin', trunkIntegrationRef: `refs/remotes/origin/${trunkBranch}`,
      ...overrides,
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

  it('repairs a parent base that disappears during landing and submits against trunk', async () => {
    const { parentSha } = setupStackRepo({ parentIntegrated: false, deleteParentRemote: false });
    const calls: string[] = [];
    const provider = makeStubProvider({
      retargetBranch: async (_cwd, branch, target) => { calls.push(`retarget:${branch}:${target}`); return makeResult('git-spice', ['branch', 'onto', target, '--branch', branch]); },
      syncRepo: async () => { calls.push('sync'); return makeResult('git-spice', ['repo', 'sync']); },
      trackBranch: async (_cwd, base) => { calls.push(`track:${base}`); return makeResult('git-spice', ['branch', 'track', '--base', base]); },
      restackBranch: async () => {
        calls.push('restack');
        if (calls.filter((call) => call === 'restack').length === 1) {
          const currentBranch = git(['branch', '--show-current']);
          git(['checkout', 'main']);
          git(['merge', '--ff-only', 'eforge/parent-prd']);
          git(['push', 'origin', 'main']);
          git(['push', 'origin', '--delete', 'eforge/parent-prd']);
          git(['checkout', currentBranch]);
        }
        return makeResult('git-spice', ['branch', 'restack']);
      },
      submitBranch: async () => { calls.push('submit'); return makeResult('git-spice', ['branch', 'submit']); },
    });
    await seedLayer(cwd);

    const events = await collectEvents(executeStackLanding(landingOptions(provider, { stackContext: childContext(parentSha) })));
    const retargetIdx = events.findIndex((e) => e.type === 'stack:provider:command' && e.args.includes('onto'));
    const trackIdx = events.findIndex((e) => e.type === 'stack:provider:command' && e.args.includes('track'));
    const restackIndexes = events
      .map((event, index) => ({ event, index }))
      .filter(({ event }) => event.type === 'stack:provider:command' && event.args.includes('restack'))
      .map(({ index }) => index);
    const submitIdx = events.findIndex((e) => e.type === 'stack:provider:command' && e.args.includes('submit'));

    expect(calls).toEqual(['sync', 'track:eforge/parent-prd', 'restack', 'retarget:eforge/test-prd:main', 'restack', 'submit']);
    expect(events).toContainEqual(expect.objectContaining({ type: 'stack:provider:command', args: ['branch', 'onto', 'main', '--branch', 'eforge/test-prd'] }));
    expect(restackIndexes).toHaveLength(2);
    expect(retargetIdx).toBeGreaterThan(trackIdx);
    expect(retargetIdx).toBeGreaterThan(restackIndexes[0]);
    expect(restackIndexes[1]).toBeGreaterThan(retargetIdx);
    expect(submitIdx).toBeGreaterThan(restackIndexes[1]);
    expect(events).toContainEqual(expect.objectContaining({ type: 'stack:landing:update', status: 'complete', effectiveBaseBranch: 'main', baseRepairReason: 'parent-artifact-already-integrated' }));
  });

  it.each(['main', 'develop'])('repairs a missing integrated parent base by tracking against %s before restacking', async (trunkBranch) => {
    const { parentSha } = setupStackRepo({ parentIntegrated: true, deleteParentRemote: true });
    if (trunkBranch !== 'main') {
      const currentBranch = git(['branch', '--show-current']);
      git(['checkout', '-b', trunkBranch, 'main']);
      git(['push', '-u', 'origin', trunkBranch]);
      git(['checkout', currentBranch]);
    }
    const binDir = join(cwd, `bin-stack-repair-${trunkBranch}`);
    makeFakeGhForMetadata(binDir, 'success');
    const origPath = process.env.PATH;
    process.env.PATH = `${binDir}:${origPath}`;
    const calls: string[] = [];
    const trackBases: string[] = [];
    let tracked = false;
    const provider = makeStubProvider({
      retargetBranch: async (_cwd, branch, target) => {
        if (!tracked) throw new Error(`branch not tracked: ${branch}`);
        calls.push(`retarget:${branch}:${target}`);
        return makeResult('git-spice', ['branch', 'onto', target, '--branch', branch]);
      },
      syncRepo: async () => { calls.push('sync'); return makeResult('git-spice', ['repo', 'sync']); },
      trackBranch: async (_cwd, base) => { calls.push(`track:${base}`); trackBases.push(base); tracked = true; return makeResult('git-spice', ['branch', 'track', '--base', base]); },
      restackBranch: async () => { calls.push('restack'); return makeResult('git-spice', ['branch', 'restack']); },
      submitBranch: async () => { calls.push('submit'); return makeResult('git-spice', ['branch', 'submit'], 'https://github.com/owner/repo/pull/42'); },
    });
    await seedLayer(cwd);
    try {
      const events = await collectEvents(executeStackLanding(landingOptions(provider, {
        stackContext: childContext(parentSha, { trunkBranch }), prAutoMergePolicy: 'always',
        metadataFactory: async ({ effectiveBaseBranch }) => ({ title: 't', body: `## Build metadata\n- Base branch: \`${effectiveBaseBranch}\`` }),
      })));
      const providerEvents = events.filter((e) => e.type === 'stack:provider:command');
      const syncIdx = providerEvents.findIndex((e) => e.args.join(' ') === 'repo sync');
      const trackIdx = providerEvents.findIndex((e) => e.args.join(' ') === `branch track --base ${trunkBranch}`);
      const restackIdx = providerEvents.findIndex((e) => e.args.includes('restack'));
      const ontoIdx = providerEvents.findIndex((e) => e.args.join(' ') === `branch onto ${trunkBranch} --branch eforge/test-prd`);
      const complete = events.find((e) => e.type === 'stack:landing:update' && (e as { status?: string }).status === 'complete');
      const landing = (await loadStackState(cwd)).layers.find((l) => l.prdId === 'test-prd')?.landing;
      const body = readFileSync(join(cwd, 'gh-pr-body.log'), 'utf-8');
      expect(trackBases).toEqual([trunkBranch]);
      expect(calls).toEqual(['sync', `track:${trunkBranch}`, 'restack', 'submit']);
      expect(syncIdx).toBeGreaterThanOrEqual(0);
      expect(trackIdx).toBeGreaterThan(syncIdx);
      expect(restackIdx).toBeGreaterThan(trackIdx);
      expect(ontoIdx).toBe(-1);
      expect(complete).toMatchObject({ originalBaseBranch: 'eforge/parent-prd', effectiveBaseBranch: trunkBranch, baseRepairReason: 'parent-artifact-already-integrated' });
      expect(landing).toMatchObject({ originalBaseBranch: 'eforge/parent-prd', effectiveBaseBranch: trunkBranch, baseRepairReason: 'parent-artifact-already-integrated' });
      expect(body).toContain(`Base branch: \`${trunkBranch}\``);
      expect(body.split('\n').find((line) => line.includes('Base branch:'))).not.toContain('eforge/parent-prd');
      expect(events).toContainEqual(expect.objectContaining({ type: 'landing:auto-merge:start', baseBranch: trunkBranch }));
      expect(events).toContainEqual(expect.objectContaining({ type: 'landing:auto-merge:complete', baseBranch: trunkBranch }));
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

