import { afterEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { API_ROUTES, buildPath } from '@eforge-build/client';
import { startControlRouteHarness, type ControlRouteHarness } from './routes-control-harness.js';

let harness: ControlRouteHarness | undefined;
afterEach(async () => { await harness?.close(); harness = undefined; });

function recordingDaemonState(reasons: string[]) {
  return {
    autoBuildController: {
      getSnapshot: () => ({ enabled: false, watcher: { running: false, pid: null, sessionId: null }, desired: 'disabled', mode: 'disabled', scheduler: { alive: false, paused: false } }),
      notifyQueueMutation: (reason: string) => { reasons.push(reason); },
    },
  } as never;
}

async function writePrd(cwd: string, sub: '' | 'waiting' | 'failed' | 'skipped', id: string, frontmatterExtra = ''): Promise<void> {
  const dir = sub ? join(cwd, '.eforge', 'queue', sub) : join(cwd, '.eforge', 'queue');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${id}.md`), `---\ntitle: ${id}${frontmatterExtra}\n---\n\n# ${id}\n\nBody.\n`);
}

async function writeLock(cwd: string, id: string, content: string): Promise<void> {
  const lockDir = join(cwd, '.eforge', 'queue-locks');
  await mkdir(lockDir, { recursive: true });
  await writeFile(join(lockDir, `${id}.lock`), content);
}

function priorityPath(id: string): string {
  return buildPath(API_ROUTES.queuePriority, { prdId: id });
}

function removePath(id: string): string {
  return buildPath(API_ROUTES.queueRemove, { prdId: id });
}

function overridePath(id: string): string {
  return buildPath(API_ROUTES.queueDependencyOverride, { prdId: id });
}

function del(base: string, path: string): Promise<Response> {
  return fetch(`${base}${path}`, { method: 'DELETE' });
}

describe('queue control routes', () => {
  it('rejects cross-site priority mutations', async () => {
    harness = await startControlRouteHarness();
    const res = await harness.rawPost(priorityPath('prd-1'), JSON.stringify({ priority: 1 }), { host: 'evil.example', 'content-type': 'application/json' });
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid ids and invalid priority bodies', async () => {
    harness = await startControlRouteHarness();
    expect((await harness.postJson(priorityPath('a..b'), { priority: 1 })).status).toBe(400);
    expect((await harness.postJson(priorityPath('prd-1'), {})).status).toBe(400);
    expect((await harness.postJson(priorityPath('prd-1'), { priority: 'x' })).status).toBe(400);
    expect((await harness.postJson(priorityPath('prd-1'), { priority: 1.5 })).status).toBe(400);
    expect((await harness.postJson(priorityPath('prd-1'), 42)).status).toBe(400);
    expect((await del(harness.url, removePath('a..b'))).status).toBe(400);
    expect((await harness.postJson(overridePath('a..b'), { dependencyId: 'base' })).status).toBe(400);
    expect((await harness.postJson(overridePath('prd-1'), {})).status).toBe(400);
    expect((await harness.postJson(overridePath('prd-1'), { dependencyId: '../base' })).status).toBe(400);
    expect((await harness.postJson(overridePath('prd-1'), { dependencyId: 'base', reason: 123 })).status).toBe(400);
  });

  it('returns 404 for unknown ids on priority, removal, and dependency override', async () => {
    harness = await startControlRouteHarness();
    await mkdir(join(harness.cwd, '.eforge', 'queue'), { recursive: true });
    expect((await harness.postJson(priorityPath('nope'), { priority: 1 })).status).toBe(404);
    expect((await del(harness.url, removePath('nope'))).status).toBe(404);
    expect((await harness.postJson(overridePath('nope'), { dependencyId: 'base' })).status).toBe(404);
  });

  it('returns 409 for running priority, terminal priority, and dependency removal conflicts', async () => {
    harness = await startControlRouteHarness();
    await writePrd(harness.cwd, '', 'running-prd');
    await writeLock(harness.cwd, 'running-prd', String(process.pid));
    expect((await harness.postJson(priorityPath('running-prd'), { priority: 1 })).status).toBe(409);

    await writePrd(harness.cwd, 'failed', 'failed-prd');
    expect((await harness.postJson(priorityPath('failed-prd'), { priority: 1 })).status).toBe(409);

    await writePrd(harness.cwd, '', 'base');
    await writePrd(harness.cwd, '', 'dependent', '\ndepends_on: [base]');
    const res = await del(harness.url, removePath('base'));
    expect(res.status).toBe(409);
    expect(await res.text()).toContain('dependent');

    expect((await harness.postJson(overridePath('running-prd'), { dependencyId: 'base' })).status).toBe(409);
    expect((await harness.postJson(overridePath('failed-prd'), { dependencyId: 'base' })).status).toBe(409);
    expect((await harness.postJson(overridePath('dependent'), { dependencyId: 'missing' })).status).toBe(409);
  });

  it('records mutation:external only for successful priority mutations', async () => {
    const reasons: string[] = [];
    harness = await startControlRouteHarness({ serverOptions: { daemonState: recordingDaemonState(reasons) } });
    await writePrd(harness.cwd, '', 'prd-1');

    const ok = await harness.postJson(priorityPath('prd-1'), { priority: 7 });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ id: 'prd-1', previousStatus: 'pending', currentStatus: 'pending', priority: 7 });
    expect(reasons).toEqual(['external']);

    // Unknown id must not record a mutation.
    expect((await harness.postJson(priorityPath('missing'), { priority: 3 })).status).toBe(404);
    expect(reasons).toEqual(['external']);
  });

  it('records mutation:external and deletes the file only for successful removals', async () => {
    const reasons: string[] = [];
    harness = await startControlRouteHarness({ serverOptions: { daemonState: recordingDaemonState(reasons) } });
    await writePrd(harness.cwd, 'failed', 'gone');
    const failedDir = join(harness.cwd, '.eforge', 'queue', 'failed');
    await writeFile(join(failedDir, 'gone.recovery.json'), '{}');

    const res = await del(harness.url, removePath('gone'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 'gone', previousStatus: 'failed', currentStatus: 'removed', removedSidecars: ['failed/gone.recovery.json'] });
    expect(existsSync(join(failedDir, 'gone.md'))).toBe(false);
    expect(existsSync(join(failedDir, 'gone.recovery.json'))).toBe(false);
    expect(reasons).toEqual(['external']);
  });

  // --- eforge:region plan-02-daemon-dependency-override ---
  it('does not notify or audit failed dependency override attempts', async () => {
    const reasons: string[] = [];
    harness = await startControlRouteHarness({ serverOptions: { daemonState: recordingDaemonState(reasons), daemonSessionId: 'daemon-test' } });
    await writePrd(harness.cwd, '', 'child', '\ndepends_on: [parent]');

    expect((await harness.postJson(overridePath('child'), { dependencyId: 'missing' })).status).toBe(409);
    expect(reasons).toEqual([]);
    expect(harness.db.getDaemonEventsAfter(0).filter((row) => row.type === 'queue:prd:dependency-overridden')).toEqual([]);
  });

  it('overrides dependencies, notifies once, moves waiting PRDs, and persists an audit event', async () => {
    const reasons: string[] = [];
    harness = await startControlRouteHarness({ serverOptions: { daemonState: recordingDaemonState(reasons), daemonSessionId: 'daemon-test' } });
    await writePrd(harness.cwd, 'waiting', 'child', '\ndepends_on: [parent]');

    const res = await harness.postJson(overridePath('child'), { dependencyId: 'parent', reason: 'operator approved' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: 'child',
      previousStatus: 'waiting',
      currentStatus: 'pending',
      removedDependency: 'parent',
      previousDependsOn: ['parent'],
      currentDependsOn: [],
      movedToQueueRoot: true,
    });
    expect(reasons).toEqual(['external']);
    expect(existsSync(join(harness.cwd, '.eforge', 'queue', 'waiting', 'child.md'))).toBe(false);
    expect(existsSync(join(harness.cwd, '.eforge', 'queue', 'child.md'))).toBe(true);

    const auditRows = harness.db.getDaemonEventsAfter(0).filter((row) => row.type === 'queue:prd:dependency-overridden');
    expect(auditRows).toHaveLength(1);
    const audit = JSON.parse(auditRows[0].data) as Record<string, unknown>;
    expect(audit).toMatchObject({
      type: 'queue:prd:dependency-overridden',
      sessionId: 'daemon-test',
      prdId: 'child',
      title: 'child',
      removedDependency: 'parent',
      previousDependsOn: ['parent'],
      currentDependsOn: [],
      reason: 'operator approved',
    });
    expect(typeof audit.timestamp).toBe('string');
  });
  // --- eforge:endregion plan-02-daemon-dependency-override ---
});
