import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { QueueScheduler, type SchedulerInputEvent } from '@eforge-build/engine/queue/scheduler';
import { EforgeEngine } from '@eforge-build/engine/eforge';
import { AsyncEventQueue } from '@eforge-build/engine/concurrency';
import type { EforgeEvent } from '@eforge-build/engine/events';
import type { EforgeConfig } from '@eforge-build/engine/config';
import type { QueuedPrd } from '@eforge-build/engine/prd-queue';
import { upsertArtifact, loadCompletionRegistry } from '@eforge-build/engine/artifacts';
import { StubHarness } from './stub-harness.js';

const exec = promisify(execFile);

function prd(id: string, cwd: string, dependsOn: string[] = []): QueuedPrd {
  const filePath = join(cwd, '.eforge', 'queue', `${id}.md`);
  return {
    id,
    filePath,
    frontmatter: { title: id, ...(dependsOn.length > 0 && { depends_on: dependsOn }) },
    content: `---\ntitle: ${id}${dependsOn.length > 0 ? `\ndepends_on: [${dependsOn.join(', ')}]` : ''}\n---\n\n# ${id}`,
    lastCommitHash: '',
    lastCommitDate: '',
  };
}

async function writePrdFile(p: QueuedPrd): Promise<void> {
  await writeFile(p.filePath, p.content, 'utf-8');
}

async function recordArtifact(cwd: string, id: string): Promise<void> {
  const now = new Date().toISOString();
  await upsertArtifact(cwd, {
    prdId: id,
    artifactBranch: `eforge/${id}`,
    commitSha: 'abc123',
    resolvedBase: 'main',
    landingAction: 'pr',
    status: 'built',
    recordedAt: now,
    updatedAt: now,
  });
}

async function waitForCompletionRecord(cwd: string, prdId: string) {
  const deadline = Date.now() + 2_000;
  let lastRegistry = await loadCompletionRegistry(cwd);
  while (Date.now() < deadline) {
    const record = lastRegistry.completions[prdId];
    if (record !== undefined) return record;
    await new Promise((r) => setTimeout(r, 20));
    lastRegistry = await loadCompletionRegistry(cwd);
  }
  throw new Error(`Timed out waiting for completion record '${prdId}' in ${JSON.stringify(lastRegistry)}`);
}

async function env(stackingEnabled = true) {
  const cwd = await mkdtemp(join(tmpdir(), 'eforge-artifact-scheduler-'));
  await exec('git', ['init'], { cwd });
  await exec('git', ['config', 'user.email', 'test@test.com'], { cwd });
  await exec('git', ['config', 'user.name', 'Test'], { cwd });
  await mkdir(join(cwd, '.eforge', 'queue'), { recursive: true });
  const bus = new EventEmitter();
  const eventQueue = new AsyncEventQueue<EforgeEvent>();
  eventQueue.addProducer();
  const spawnPrdChild = vi.fn<[QueuedPrd, unknown, string], Promise<'completed' | 'failed' | 'skipped' | 'already-claimed'>>()
    .mockImplementation(() => new Promise(() => {}));
  const config = {
    maxConcurrentBuilds: 2,
    prdQueue: { dir: '.eforge/queue', watchPollIntervalMs: 0 },
    plugins: { enabled: false },
    extensions: { policyGateTimeoutMs: 5000, policyGateFailurePolicy: 'fail-closed' },
    stacking: { enabled: stackingEnabled, provider: 'git-spice', gitSpice: {} },
    build: { trunkBranch: 'main' },
  } as unknown as EforgeConfig;
  const makeScheduler = (initialPrds: QueuedPrd[]) => new QueueScheduler({
    bus,
    cwd,
    queueDir: '.eforge/queue',
    config,
    configProfile: { name: null, source: 'none', scope: null, config: null },
    parallelism: 2,
    abortController: new AbortController(),
    eventQueue,
    spawnPrdChild,
    options: { auto: true },
    initialPrds,
  });
  return { cwd, bus, eventQueue, spawnPrdChild, makeScheduler };
}

describe('QueueScheduler artifact-aware readiness', () => {
  it('spawns a dependent exactly once when the completed upstream has a recorded artifact', async () => {
    const { cwd, bus, eventQueue, spawnPrdChild, makeScheduler } = await env();
    const foundation = prd('foundation', cwd);
    const feature = prd('feature', cwd, ['foundation']);
    await writePrdFile(foundation);
    await writePrdFile(feature);

    const scheduler = makeScheduler([foundation, feature]);
    await scheduler.start();
    await new Promise((r) => setTimeout(r, 50));
    expect(spawnPrdChild).toHaveBeenCalledTimes(1);

    await recordArtifact(cwd, 'foundation');
    bus.emit('queue:prd:complete', { type: 'queue:prd:complete', prdId: 'foundation', status: 'completed', timestamp: new Date().toISOString() } satisfies SchedulerInputEvent);
    await new Promise((r) => setTimeout(r, 150));

    expect(spawnPrdChild.mock.calls.map((call) => call[0].id).filter((id) => id === 'feature')).toHaveLength(1);
    eventQueue.removeProducer();
  });

  it('does not spawn a dependent when the completed upstream has no recorded artifact', async () => {
    const { cwd, bus, eventQueue, spawnPrdChild, makeScheduler } = await env();
    const foundation = prd('foundation', cwd);
    const feature = prd('feature', cwd, ['foundation']);
    await writePrdFile(foundation);
    await writePrdFile(feature);

    const scheduler = makeScheduler([foundation, feature]);
    await scheduler.start();
    await new Promise((r) => setTimeout(r, 50));
    bus.emit('queue:prd:complete', { type: 'queue:prd:complete', prdId: 'foundation', status: 'completed', timestamp: new Date().toISOString() } satisfies SchedulerInputEvent);
    await new Promise((r) => setTimeout(r, 150));

    expect(spawnPrdChild).toHaveBeenCalledTimes(1);
    eventQueue.removeProducer();
  });

  it('requires registry artifacts even when stacking is disabled', async () => {
    const { cwd, bus, eventQueue, spawnPrdChild, makeScheduler } = await env(false);
    const foundation = prd('foundation', cwd);
    const feature = prd('feature', cwd, ['foundation']);
    await writePrdFile(foundation);
    await writePrdFile(feature);

    const scheduler = makeScheduler([foundation, feature]);
    await scheduler.start();
    await new Promise((r) => setTimeout(r, 50));
    expect(spawnPrdChild.mock.calls.map((call) => call[0].id)).toEqual(['foundation']);

    bus.emit('queue:prd:complete', { type: 'queue:prd:complete', prdId: 'foundation', status: 'completed', timestamp: new Date().toISOString() } satisfies SchedulerInputEvent);
    await new Promise((r) => setTimeout(r, 100));
    expect(spawnPrdChild.mock.calls.map((call) => call[0].id)).toEqual(['foundation']);

    await recordArtifact(cwd, 'foundation');
    bus.emit('queue:prd:complete', { type: 'queue:prd:complete', prdId: 'foundation', status: 'completed', timestamp: new Date().toISOString() } satisfies SchedulerInputEvent);
    await new Promise((r) => setTimeout(r, 150));

    expect(spawnPrdChild.mock.calls.map((call) => call[0].id)).toEqual(['foundation', 'feature']);
    eventQueue.removeProducer();
  });

  it('does not satisfy an active upstream from a stale pre-existing artifact', async () => {
    const { cwd, eventQueue, spawnPrdChild, makeScheduler } = await env();
    await recordArtifact(cwd, 'foundation');
    const foundation = prd('foundation', cwd);
    const feature = prd('feature', cwd, ['foundation']);
    await writePrdFile(foundation);
    await writePrdFile(feature);

    const scheduler = makeScheduler([foundation, feature]);
    await scheduler.start();
    await new Promise((r) => setTimeout(r, 150));

    expect(spawnPrdChild).toHaveBeenCalledTimes(1);
    expect(spawnPrdChild.mock.calls[0][0].id).toBe('foundation');
    eventQueue.removeProducer();
  });

  it('blocks dependents when an upstream fails', async () => {
    const { cwd, bus, eventQueue, spawnPrdChild, makeScheduler } = await env();
    const foundation = prd('foundation', cwd);
    const feature = prd('feature', cwd, ['foundation']);
    await writePrdFile(foundation);
    await writePrdFile(feature);

    const scheduler = makeScheduler([foundation, feature]);
    await scheduler.start();
    await new Promise((r) => setTimeout(r, 50));
    // In production the parent cleanup path moves failed PRDs out of the
    // queue root before the scheduler observes queue:prd:complete.
    await rm(foundation.filePath);
    bus.emit('queue:prd:complete', { type: 'queue:prd:complete', prdId: 'foundation', status: 'failed', timestamp: new Date().toISOString() } satisfies SchedulerInputEvent);
    await new Promise((r) => setTimeout(r, 150));

    expect(spawnPrdChild).toHaveBeenCalledTimes(1);
    scheduler.finalizeBlockedAsSkipped();
    expect(scheduler.skipped).toBe(1);
    eventQueue.removeProducer();
  });

  it('blocks a dependent when an upstream is present in the failed terminal queue', async () => {
    const { cwd, eventQueue, spawnPrdChild, makeScheduler } = await env();
    await mkdir(join(cwd, '.eforge', 'queue', 'failed'), { recursive: true });
    await writeFile(
      join(cwd, '.eforge', 'queue', 'failed', 'failed-upstream.md'),
      '---\ntitle: failed-upstream\n---\n\n# failed-upstream\n',
      'utf-8',
    );
    const feature = prd('feature', cwd, ['failed-upstream']);
    await writePrdFile(feature);

    const scheduler = makeScheduler([feature]);
    await scheduler.start();
    await new Promise((r) => setTimeout(r, 150));

    expect(spawnPrdChild).not.toHaveBeenCalled();
    expect(eventQueue.drainAvailable()).toContainEqual(expect.objectContaining({
      type: 'daemon:scheduler:dependency-blocked',
      prdId: 'feature',
      blockedBy: ['failed-upstream'],
    }));
    scheduler.finalizeBlockedAsSkipped();
    expect(scheduler.skipped).toBe(1);
    eventQueue.removeProducer();
  });

  it('infers and persists stack_parent for a single dependency before spawn', async () => {
    const { cwd, eventQueue, spawnPrdChild, makeScheduler } = await env();
    await recordArtifact(cwd, 'parent');
    const child = prd('child', cwd, ['parent']);
    await writePrdFile(child);

    const scheduler = makeScheduler([child]);
    await scheduler.start();
    await new Promise((r) => setTimeout(r, 150));

    expect(spawnPrdChild).toHaveBeenCalledOnce();
    expect(spawnPrdChild.mock.calls[0][0].frontmatter.stack_parent).toBe('parent');
    await expect(readFile(child.filePath, 'utf-8')).resolves.toContain('stack_parent: parent');
    eventQueue.removeProducer();
  });

  it('fails ambiguous stacked dispatch with multiple depends_on and no stack_parent', async () => {
    const { cwd, eventQueue, spawnPrdChild, makeScheduler } = await env();
    await recordArtifact(cwd, 'a');
    await recordArtifact(cwd, 'b');
    const child = prd('child', cwd, ['a', 'b']);
    await writePrdFile(child);

    const scheduler = makeScheduler([child]);
    await scheduler.start();
    await new Promise((r) => setTimeout(r, 150));

    expect(spawnPrdChild).not.toHaveBeenCalled();
    const events = eventQueue.drainAvailable();
    expect(events).toContainEqual(expect.objectContaining({ type: 'queue:prd:complete', prdId: 'child', status: 'failed' }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'plan:error:set', error: expect.stringContaining('multiple depends_on') }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'plan:error:set', error: expect.stringContaining('stack_parent') }));
    eventQueue.removeProducer();
  });

  it('dispatches multiple dependencies when stack_parent disambiguates the parent layer', async () => {
    const { cwd, eventQueue, spawnPrdChild, makeScheduler } = await env();
    await recordArtifact(cwd, 'a');
    await recordArtifact(cwd, 'b');
    const child = prd('child', cwd, ['a', 'b']);
    child.frontmatter.stack_parent = 'a';
    child.content = '---\ntitle: child\ndepends_on: [a, b]\nstack_parent: a\n---\n\n# child';
    await writePrdFile(child);

    const scheduler = makeScheduler([child]);
    await scheduler.start();
    await new Promise((r) => setTimeout(r, 150));

    expect(spawnPrdChild).toHaveBeenCalledOnce();
    expect(spawnPrdChild.mock.calls[0][0].id).toBe('child');
    expect(spawnPrdChild.mock.calls[0][0].frontmatter.stack_parent).toBe('a');
    eventQueue.removeProducer();
  });
});

// --- eforge:region plan-01-runtime-artifact-diagnostics ---

describe('QueueScheduler — completion index recording', () => {
  it('records a completed entry in the completion index when upstream completes with artifact', async () => {
    const { cwd, bus, eventQueue, makeScheduler } = await env();
    const foundation = prd('ci-foundation-complete', cwd);
    await writePrdFile(foundation);

    const scheduler = makeScheduler([foundation]);
    await scheduler.start();

    await recordArtifact(cwd, 'ci-foundation-complete');
    bus.emit('queue:prd:complete', {
      type: 'queue:prd:complete',
      prdId: 'ci-foundation-complete',
      status: 'completed',
      timestamp: new Date().toISOString(),
    } satisfies SchedulerInputEvent);

    const record = await waitForCompletionRecord(cwd, 'ci-foundation-complete');
    expect(record).toBeDefined();
    expect(record?.status).toBe('completed');
    expect(record?.artifactAvailable).toBe(true);
    expect(record?.artifactBranch).toBe('eforge/ci-foundation-complete');
    eventQueue.removeProducer();
  });

  it('records a failed entry with artifactAvailable: false when upstream fails', async () => {
    const { cwd, bus, eventQueue, makeScheduler } = await env();
    const foundation = prd('ci-foundation-fail', cwd);
    await writePrdFile(foundation);

    const scheduler = makeScheduler([foundation]);
    await scheduler.start();

    // Remove the PRD file to simulate cleanup before event, then emit failed
    await rm(foundation.filePath, { force: true });
    bus.emit('queue:prd:complete', {
      type: 'queue:prd:complete',
      prdId: 'ci-foundation-fail',
      status: 'failed',
      timestamp: new Date().toISOString(),
    } satisfies SchedulerInputEvent);

    const record = await waitForCompletionRecord(cwd, 'ci-foundation-fail');
    expect(record).toBeDefined();
    expect(record?.status).toBe('failed');
    expect(record?.artifactAvailable).toBe(false);
    eventQueue.removeProducer();
  });

  it('records a skipped entry with artifactAvailable: false when upstream is skipped', async () => {
    const { cwd, bus, eventQueue, makeScheduler } = await env();
    const foundation = prd('ci-foundation-skip', cwd);
    await writePrdFile(foundation);

    const scheduler = makeScheduler([foundation]);
    await scheduler.start();

    await rm(foundation.filePath, { force: true });
    bus.emit('queue:prd:complete', {
      type: 'queue:prd:complete',
      prdId: 'ci-foundation-skip',
      status: 'skipped',
      timestamp: new Date().toISOString(),
    } satisfies SchedulerInputEvent);

    const record = await waitForCompletionRecord(cwd, 'ci-foundation-skip');
    expect(record).toBeDefined();
    expect(record?.status).toBe('skipped');
    expect(record?.artifactAvailable).toBe(false);
    eventQueue.removeProducer();
  });

  it('blocks a dependent when completion index says upstream failed (even with stale artifact)', async () => {
    const { cwd, eventQueue, spawnPrdChild, makeScheduler } = await env();
    // Stale artifact exists from a prior run
    await recordArtifact(cwd, 'ci-stale-failed');
    // Completion index supersedes stale artifact — upstream failed this run
    const now = new Date().toISOString();
    const { upsertCompletion } = await import('@eforge-build/engine/artifacts');
    await upsertCompletion(cwd, {
      prdId: 'ci-stale-failed',
      status: 'failed',
      artifactAvailable: false,
      completedAt: now,
      updatedAt: now,
    });

    const feature = prd('ci-feature-blocked', cwd, ['ci-stale-failed']);
    await writePrdFile(feature);

    const scheduler = makeScheduler([feature]);
    await scheduler.start();
    await new Promise((r) => setTimeout(r, 150));

    // Dependent must not be spawned — completion index blocked it.
    expect(spawnPrdChild).not.toHaveBeenCalled();
    expect(eventQueue.drainAvailable()).toContainEqual(expect.objectContaining({
      type: 'daemon:scheduler:dependency-blocked',
      prdId: 'ci-feature-blocked',
      blockedBy: ['ci-stale-failed'],
    }));
    scheduler.finalizeBlockedAsSkipped();
    expect(scheduler.skipped).toBe(1);
    eventQueue.removeProducer();
  });

  it('blocks a dependent when completion index says upstream skipped (even with stale artifact)', async () => {
    const { cwd, eventQueue, spawnPrdChild, makeScheduler } = await env();
    await recordArtifact(cwd, 'ci-stale-skipped');
    const now = new Date().toISOString();
    const { upsertCompletion } = await import('@eforge-build/engine/artifacts');
    await upsertCompletion(cwd, {
      prdId: 'ci-stale-skipped',
      status: 'skipped',
      artifactAvailable: false,
      completedAt: now,
      updatedAt: now,
    });

    const feature = prd('ci-feature-blocked-skip', cwd, ['ci-stale-skipped']);
    await writePrdFile(feature);

    const scheduler = makeScheduler([feature]);
    await scheduler.start();
    await new Promise((r) => setTimeout(r, 150));

    expect(spawnPrdChild).not.toHaveBeenCalled();
    scheduler.finalizeBlockedAsSkipped();
    expect(scheduler.skipped).toBe(1);
    eventQueue.removeProducer();
  });
});

describe('EforgeEngine.runQueue — completion index recording', () => {
  it('records a failed completion entry from the legacy runQueue event path', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'eforge-runqueue-completion-'));
    await mkdir(join(cwd, 'eforge', 'queue'), { recursive: true });
    await writeFile(
      join(cwd, 'eforge', 'queue', 'legacy-failure.md'),
      '---\ntitle: Legacy Failure\n---\n\n# Legacy Failure\n',
      'utf-8',
    );
    const engine = await EforgeEngine.create({
      cwd,
      agentRuntimes: new StubHarness([]),
      config: {
        maxConcurrentBuilds: 1,
        prdQueue: { dir: 'eforge/queue', watchPollIntervalMs: 0 },
        plugins: { enabled: false },
      },
    });

    for await (const _event of engine.runQueue()) {
      // Exhaust the generator so the parent-side queue:prd:complete handler runs.
    }

    const registry = await loadCompletionRegistry(cwd);
    expect(registry.completions['legacy-failure']).toEqual(expect.objectContaining({
      prdId: 'legacy-failure',
      status: 'failed',
      artifactAvailable: false,
    }));
  });

  it('records a failed completion entry when legacy runQueue dispatch validation fails before spawning', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'eforge-runqueue-direct-failure-'));
    await mkdir(join(cwd, 'eforge', 'queue'), { recursive: true });
    await recordArtifact(cwd, 'parent-a');
    await recordArtifact(cwd, 'parent-b');
    await writeFile(
      join(cwd, 'eforge', 'queue', 'ambiguous-child.md'),
      '---\ntitle: Ambiguous Child\ndepends_on: [parent-a, parent-b]\n---\n\n# Ambiguous Child\n',
      'utf-8',
    );
    const engine = await EforgeEngine.create({
      cwd,
      agentRuntimes: new StubHarness([]),
      config: {
        maxConcurrentBuilds: 1,
        prdQueue: { dir: 'eforge/queue', watchPollIntervalMs: 0 },
        plugins: { enabled: false },
        stacking: { enabled: true, provider: 'git-spice', gitSpice: {} },
      },
    });

    const events: EforgeEvent[] = [];
    for await (const event of engine.runQueue()) events.push(event);

    expect(events).toContainEqual(expect.objectContaining({
      type: 'plan:error:set',
      planId: 'ambiguous-child',
      error: expect.stringContaining('multiple depends_on'),
    }));
    const registry = await loadCompletionRegistry(cwd);
    expect(registry.completions['ambiguous-child']).toEqual(expect.objectContaining({
      prdId: 'ambiguous-child',
      status: 'failed',
      artifactAvailable: false,
    }));
  });
});

// --- eforge:endregion plan-01-runtime-artifact-diagnostics ---
