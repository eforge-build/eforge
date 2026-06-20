import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { API_ROUTES } from '@eforge-build/client';
import { startControlRouteHarness, type ControlRouteHarness } from './routes-control-harness.js';

let harness: ControlRouteHarness | undefined;
afterEach(async () => { await harness?.close(); harness = undefined; });

async function writePrd(sub: '' | 'waiting' | 'failed' | 'skipped', id: string, frontmatterExtra = ''): Promise<void> {
  const dir = sub ? join(harness!.cwd, '.eforge', 'queue', sub) : join(harness!.cwd, '.eforge', 'queue');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${id}.md`), `---\ntitle: ${id}${frontmatterExtra}\n---\n\n# ${id}\n`);
}

describe('queue capability projection', () => {
  it('returns hold state and every capability key for queue REST projections', async () => {
    harness = await startControlRouteHarness();
    await writePrd('', 'pending-held', '\npriority: 1\nheld: true\nhold_reason: operator\nheld_at: 2026-06-19T10:00:00.000Z');
    await writePrd('waiting', 'waiting-child', '\ndepends_on: [pending-held]');
    await writePrd('failed', 'failed-prd');
    await writePrd('skipped', 'skipped-prd');

    const res = await harness.get(API_ROUTES.queue);
    expect(res.status).toBe(200);
    const queue = await res.json() as Array<{ id: string; hold?: unknown; capabilities?: Record<string, { allowed: boolean; reason?: string }>; recoveryVerdict?: unknown; dispatchFailure?: unknown }>;

    expect(queue.map((item) => item.id).sort()).toEqual(['failed-prd', 'pending-held', 'skipped-prd', 'waiting-child']);
    for (const item of queue) {
      expect(Object.keys(item.capabilities ?? {}).sort()).toEqual(['cancel', 'cascadeCancel', 'cascadeRemove', 'dependencyOverride', 'hold', 'priority', 'remove', 'unhold'].sort());
      for (const capability of Object.values(item.capabilities ?? {})) expect(typeof capability.allowed).toBe('boolean');
    }
    expect(queue.find((item) => item.id === 'pending-held')).toMatchObject({
      hold: { held: true, reason: 'operator', heldAt: '2026-06-19T10:00:00.000Z' },
      capabilities: { hold: { allowed: false }, unhold: { allowed: true }, priority: { allowed: true } },
    });
    expect(queue.find((item) => item.id === 'waiting-child')).toMatchObject({
      capabilities: { dependencyOverride: { allowed: true }, hold: { allowed: true } },
    });
    expect(queue.find((item) => item.id === 'failed-prd')).toMatchObject({
      capabilities: { priority: { allowed: false }, cancel: { allowed: false } },
    });
  });
});
