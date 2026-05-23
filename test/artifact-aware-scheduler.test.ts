import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { QueueScheduler, type SchedulerInputEvent } from '@eforge-build/engine/queue/scheduler';
import { AsyncEventQueue } from '@eforge-build/engine/concurrency';
import type { EforgeEvent } from '@eforge-build/engine/events';
import type { EforgeConfig } from '@eforge-build/engine/config';
import type { QueuedPrd } from '@eforge-build/engine/prd-queue';
import { upsertStackLayer } from '@eforge-build/engine/stacking';

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
  await upsertStackLayer(cwd, {
    prdId: id,
    stackId: 'stack',
    provider: 'git-spice',
    branch: `eforge/${id}`,
    baseBranch: 'main',
    artifact: { branch: `eforge/${id}`, commitSha: 'abc123' },
    status: 'built',
    recordedAt: now,
    updatedAt: now,
  });
}

async function recordFailedLayer(cwd: string, id: string): Promise<void> {
  const now = new Date().toISOString();
  await upsertStackLayer(cwd, {
    prdId: id,
    stackId: 'stack',
    provider: 'git-spice',
    branch: `eforge/${id}`,
    baseBranch: 'main',
    status: 'failed',
    recordedAt: now,
    updatedAt: now,
  });
}

async function env() {
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
    stacking: { enabled: true, provider: 'git-spice', gitSpice: {} },
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

  it('blocks a dependent when an upstream is only present as a failed stack layer', async () => {
    const { cwd, eventQueue, spawnPrdChild, makeScheduler } = await env();
    await recordFailedLayer(cwd, 'failed-upstream');
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
