import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { API_ROUTES, buildPath } from '@eforge-build/client';
import { startControlRouteHarness, type ControlRouteHarness } from './routes-control-harness.js';

let harness: ControlRouteHarness | undefined;
afterEach(async () => { await harness?.close(); harness = undefined; });

function daemonState(reasons: string[]) {
  const snapshot = { enabled: true, desired: 'enabled', mode: 'running', watcher: { running: false, pid: null, sessionId: null }, scheduler: { alive: true, paused: false } };
  return { autoBuildController: { getSnapshot: () => snapshot, notifyQueueMutation: (reason: string) => { reasons.push(reason); return snapshot; } } } as never;
}

async function writePrd(sub: '' | 'waiting' | 'failed' | 'skipped', id: string, frontmatterExtra = ''): Promise<string> {
  const dir = sub ? join(harness!.cwd, '.eforge', 'queue', sub) : join(harness!.cwd, '.eforge', 'queue');
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, `${id}.md`);
  await writeFile(filePath, `---\ntitle: ${id}${frontmatterExtra}\n---\n\n# ${id}\n`);
  return filePath;
}

function holdPath(prdId: string): string { return buildPath(API_ROUTES.queueHold, { prdId }); }
function unholdPath(prdId: string): string { return buildPath(API_ROUTES.queueUnhold, { prdId }); }
function previewPath(prdId: string): string { return buildPath(API_ROUTES.queueCascadePreview, { prdId }); }
function applyPath(prdId: string): string { return buildPath(API_ROUTES.queueCascadeApply, { prdId }); }

describe('advanced queue control routes', () => {
  it('rejects cross-site hold, unhold, preview, and apply requests', async () => {
    harness = await startControlRouteHarness();
    const headers = { host: 'evil.example', 'content-type': 'application/json' };

    expect((await harness.rawPost(holdPath('prd-1'), '{}', headers)).status).toBe(403);
    expect((await harness.rawPost(unholdPath('prd-1'), '{}', headers)).status).toBe(403);
    expect((await harness.rawPost(previewPath('prd-1'), JSON.stringify({ operation: 'remove' }), headers)).status).toBe(403);
    expect((await harness.rawPost(applyPath('prd-1'), '{}', headers)).status).toBe(403);
  });

  it('validates route ids and JSON bodies', async () => {
    harness = await startControlRouteHarness();

    expect((await harness.postJson(holdPath('../bad'), {})).status).toBe(400);
    expect((await harness.rawPost(holdPath('prd-1'), '{bad', { 'content-type': 'application/json' })).status).toBe(400);
    expect((await harness.postJson(holdPath('prd-1'), { reason: 'line\nbreak' })).status).toBe(400);
    expect((await harness.postJson(unholdPath('prd-1'), 1)).status).toBe(400);
    expect((await harness.postJson(unholdPath('prd-1'), { reason: 'ignored' })).status).toBe(400);
    expect((await harness.postJson(previewPath('prd-1'), { operation: 'rename' })).status).toBe(400);
    expect((await harness.postJson(applyPath('prd-1'), { operation: 'remove' })).status).toBe(400);
    expect((await harness.postJson(previewPath('missing'), { operation: 'remove' })).status).toBe(404);
    expect((await harness.postJson(applyPath('missing'), { operation: 'remove', strategy: 'target-only', expectedAffected: { token: 'missing', prdIds: ['missing'] }, confirmDependents: false })).status).toBe(404);
  });

  it('holds and unholds pending queue items, returning capabilities and notifying only for mutations', async () => {
    const reasons: string[] = [];
    harness = await startControlRouteHarness({ serverOptions: { daemonState: daemonState(reasons) } });
    const filePath = await writePrd('', 'prd-1');

    const held = await harness.postJson(holdPath('prd-1'), { reason: 'operator pause' });
    expect(held.status).toBe(200);
    await expect(held.json()).resolves.toMatchObject({
      status: 'held',
      item: { id: 'prd-1', hold: { held: true, reason: 'operator pause' }, capabilities: { priority: { allowed: true }, unhold: { allowed: true } } },
      queue: [{ id: 'prd-1', capabilities: { hold: { allowed: false } } }],
      autoBuild: { desired: 'enabled' },
    });
    expect(readFileSync(filePath, 'utf-8')).toContain('held: true');
    expect(reasons).toEqual(['external']);

    const heldAgain = await harness.postJson(holdPath('prd-1'), { reason: 'operator pause' });
    expect(heldAgain.status).toBe(200);
    await expect(heldAgain.json()).resolves.toMatchObject({ status: 'already-held' });
    expect(reasons).toEqual(['external']);

    const unheld = await harness.postJson(unholdPath('prd-1'), {});
    expect(unheld.status).toBe(200);
    await expect(unheld.json()).resolves.toMatchObject({ status: 'unheld', item: { id: 'prd-1', capabilities: { hold: { allowed: true } } } });
    expect(readFileSync(filePath, 'utf-8')).not.toMatch(/held|hold_reason|held_at/);
    expect(reasons).toEqual(['external', 'external']);
  });

  it('previews cascade dependents without mutating files and refuses target-only apply without notification', async () => {
    const reasons: string[] = [];
    harness = await startControlRouteHarness({ serverOptions: { daemonState: daemonState(reasons) } });
    const parentPath = await writePrd('', 'parent');
    const childPath = await writePrd('waiting', 'child', '\ndepends_on: [parent]');

    const preview = await harness.postJson(previewPath('parent'), { operation: 'remove' });
    expect(preview.status).toBe(200);
    const previewBody = await preview.json();
    expect(previewBody).toMatchObject({
      target: { prdId: 'parent', effect: 'target-remove' },
      dependents: [{ prdId: 'child', depth: 1, effect: 'dependent-remove' }],
      defaultRefusalReason: expect.any(String),
      expectedAffected: { token: expect.any(String), prdIds: ['parent', 'child'] },
    });
    expect(existsSync(parentPath)).toBe(true);
    expect(existsSync(childPath)).toBe(true);

    const apply = await harness.postJson(applyPath('parent'), { operation: 'remove', strategy: 'target-only', expectedAffected: previewBody.expectedAffected, confirmDependents: false });
    expect(apply.status).toBe(200);
    await expect(apply.json()).resolves.toMatchObject({ applied: false, queue: expect.any(Array), autoBuild: { desired: 'enabled' } });
    expect(existsSync(parentPath)).toBe(true);
    expect(existsSync(childPath)).toBe(true);
    expect(reasons).toEqual([]);
  });

  it('applies confirmed cascade remove and notifies exactly once', async () => {
    const reasons: string[] = [];
    harness = await startControlRouteHarness({ serverOptions: { daemonState: daemonState(reasons) } });
    await writePrd('', 'parent');
    await writePrd('waiting', 'child', '\ndepends_on: [parent]');

    const previewBody = await (await harness.postJson(previewPath('parent'), { operation: 'remove' })).json();
    const apply = await harness.postJson(applyPath('parent'), { operation: 'remove', strategy: 'cascade-dependents', expectedAffected: previewBody.expectedAffected, confirmDependents: true });

    expect(apply.status).toBe(200);
    await expect(apply.json()).resolves.toMatchObject({ applied: true, target: { prdId: 'parent', status: 'removed' }, dependents: [{ prdId: 'child', status: 'removed' }], queue: [], autoBuild: { desired: 'enabled' } });
    expect(existsSync(join(harness.cwd, '.eforge', 'queue', 'parent.md'))).toBe(false);
    expect(existsSync(join(harness.cwd, '.eforge', 'queue', 'waiting', 'child.md'))).toBe(false);
    expect(reasons).toEqual(['external']);
  });
});
