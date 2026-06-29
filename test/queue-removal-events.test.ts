import { afterEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { API_ROUTES, buildPath, safeParseEforgeEvent } from '@eforge-build/client';
import { startControlRouteHarness, type ControlRouteHarness } from '../packages/monitor/src/__tests__/routes-control-harness.js';

let harness: ControlRouteHarness | undefined;
afterEach(async () => { await harness?.close(); harness = undefined; });

async function writePrd(cwd: string, sub: '' | 'waiting' | 'failed' | 'skipped', id: string, frontmatterExtra = ''): Promise<void> {
  const dir = sub ? join(cwd, '.eforge', 'queue', sub) : join(cwd, '.eforge', 'queue');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${id}.md`), `---\ntitle: ${id}${frontmatterExtra}\n---\n\n# ${id}\n\nBody.\n`);
}

async function writeLock(cwd: string, id: string, content = String(process.pid)): Promise<void> {
  const lockDir = join(cwd, '.eforge', 'queue-locks');
  await mkdir(lockDir, { recursive: true });
  await writeFile(join(lockDir, `${id}.lock`), content);
}

function removePath(prdId: string): string {
  return buildPath(API_ROUTES.queueRemove, { prdId });
}

function removalEvents() {
  return harness!.db.getDaemonEventsAfter(0).filter((row) => row.type === 'queue:prd:removed');
}

async function removePrd(prdId: string): Promise<Response> {
  return fetch(`${harness!.url}${removePath(prdId)}`, { method: 'DELETE' });
}

describe('queue removal events', () => {
  it('safeParseEforgeEvent accepts queue:prd:removed with queue-control previous statuses', () => {
    for (const previousStatus of ['pending', 'waiting', 'failed', 'skipped'] as const) {
      const result = safeParseEforgeEvent({
        type: 'queue:prd:removed',
        timestamp: '2025-01-01T00:00:00.000Z',
        prdId: `${previousStatus}-prd`,
        previousStatus,
        removedSidecars: [],
      });
      expect(result.success, previousStatus).toBe(true);
    }
  });

  it('emits exactly one removal event after a failed item removal and preserves the response shape', async () => {
    harness = await startControlRouteHarness({ serverOptions: { daemonSessionId: 'daemon-test' } });
    await writePrd(harness.cwd, 'failed', 'failed-prd');
    const failedDir = join(harness.cwd, '.eforge', 'queue', 'failed');
    await writeFile(join(failedDir, 'failed-prd.recovery.json'), '{}');

    const res = await removePrd('failed-prd');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: 'failed-prd',
      previousStatus: 'failed',
      currentStatus: 'removed',
      removedSidecars: ['failed/failed-prd.recovery.json'],
    });
    expect(existsSync(join(failedDir, 'failed-prd.md'))).toBe(false);
    const rows = removalEvents();
    expect(rows).toHaveLength(1);
    const event = JSON.parse(rows[0].data) as Record<string, unknown>;
    expect(event).toMatchObject({
      type: 'queue:prd:removed',
      sessionId: 'daemon-test',
      prdId: 'failed-prd',
      previousStatus: 'failed',
      removedSidecars: ['failed/failed-prd.recovery.json'],
    });
    expect(typeof event.timestamp).toBe('string');
  });

  it('emits removal events with matching previousStatus for pending, waiting, and skipped items', async () => {
    harness = await startControlRouteHarness({ serverOptions: { daemonSessionId: 'daemon-test' } });
    await writePrd(harness.cwd, '', 'pending-prd');
    await writePrd(harness.cwd, 'waiting', 'waiting-prd');
    await writePrd(harness.cwd, 'skipped', 'skipped-prd');

    for (const [prdId, previousStatus] of [['pending-prd', 'pending'], ['waiting-prd', 'waiting'], ['skipped-prd', 'skipped']] as const) {
      const res = await removePrd(prdId);
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({ id: prdId, previousStatus, currentStatus: 'removed', removedSidecars: [] });
    }

    const events = removalEvents().map((row) => JSON.parse(row.data) as Record<string, unknown>);
    expect(events).toHaveLength(3);
    expect(events.map((event) => [event.prdId, event.previousStatus])).toEqual([
      ['pending-prd', 'pending'],
      ['waiting-prd', 'waiting'],
      ['skipped-prd', 'skipped'],
    ]);
  });

  it('dispatches queue:prd:removed to native extension event hooks', async () => {
    harness = await startControlRouteHarness({ serverOptions: { daemonSessionId: 'daemon-test' } });
    await writePrd(harness.cwd, '', 'hooked-prd');
    const extensionDir = join(harness.cwd, '.eforge', 'extensions');
    const hookFlag = join(harness.cwd, '.eforge', 'queue-removed-hook.json');
    await mkdir(extensionDir, { recursive: true });
    await writeFile(join(extensionDir, 'queue-removed-hook.mjs'), `
      import { writeFile } from 'node:fs/promises';
      export default function extension(eforge) {
        eforge.onEvent('queue:prd:removed', async (event) => {
          await writeFile(${JSON.stringify(hookFlag)}, JSON.stringify({ type: event.type, prdId: event.prdId, previousStatus: event.previousStatus }));
        });
      }
    `);

    const res = await removePrd('hooked-prd');

    expect(res.status).toBe(200);
    expect(existsSync(hookFlag)).toBe(true);
    expect(removalEvents()).toHaveLength(1);
  });

  it('emits no removal event for not-found attempts', async () => {
    harness = await startControlRouteHarness({ serverOptions: { daemonSessionId: 'daemon-test' } });
    await mkdir(join(harness.cwd, '.eforge', 'queue'), { recursive: true });

    expect((await removePrd('missing-prd')).status).toBe(404);
    expect(removalEvents()).toEqual([]);
  });

  it('emits no removal event for dependency conflicts', async () => {
    harness = await startControlRouteHarness({ serverOptions: { daemonSessionId: 'daemon-test' } });
    await writePrd(harness.cwd, '', 'base');
    await writePrd(harness.cwd, '', 'dependent', '\ndepends_on: [base]');

    expect((await removePrd('base')).status).toBe(409);
    expect(removalEvents()).toEqual([]);
  });

  it('emits no removal event for running-refusal attempts', async () => {
    harness = await startControlRouteHarness({ serverOptions: { daemonSessionId: 'daemon-test' } });
    await writePrd(harness.cwd, '', 'running-prd');
    await writeLock(harness.cwd, 'running-prd');

    expect((await removePrd('running-prd')).status).toBe(409);
    expect(removalEvents()).toEqual([]);
  });
});
