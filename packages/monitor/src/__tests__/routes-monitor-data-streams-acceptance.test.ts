import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { API_ROUTES, buildPath } from '@eforge-build/client';
import { projectQueueForContext } from '../projections/monitor-state.js';
import { startControlRouteHarness, type ControlRouteHarness } from './routes-control-harness.js';

let harness: ControlRouteHarness | undefined;
afterEach(async () => { await harness?.close(); harness = undefined; });

async function readFirstSseBlock(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1_000);
  const res = await fetch(url, { signal: controller.signal });
  const reader = res.body?.getReader();
  if (!reader) throw new Error('missing SSE body');
  let text = '';
  try {
    while (!text.includes('\n\n')) {
      const next = await reader.read();
      if (next.done) break;
      text += new TextDecoder().decode(next.value);
    }
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
  return text.slice(0, text.indexOf('\n\n'));
}

async function seedQueue(cwd: string): Promise<void> {
  const queueDir = join(cwd, '.eforge', 'queue');
  await mkdir(join(queueDir, 'failed'), { recursive: true });
  await mkdir(join(queueDir, 'skipped'), { recursive: true });
  await mkdir(join(queueDir, 'waiting'), { recursive: true });
  await mkdir(join(cwd, '.eforge', 'queue-locks'), { recursive: true });
  await writeFile(join(queueDir, 'pending.md'), '---\ntitle: Pending\ndepends_on: [running, failed]\n---\n');
  await writeFile(join(queueDir, 'running.md'), '---\ntitle: Running\n---\n');
  await writeFile(join(cwd, '.eforge', 'queue-locks', 'running.lock'), '');
  await writeFile(join(queueDir, 'failed', 'failed.md'), '---\ntitle: Failed\ndepends_on: [pending]\n---\n');
  await writeFile(join(queueDir, 'failed', 'failed.recovery.json'), JSON.stringify({ verdict: { verdict: 'retry', confidence: 'medium', rationale: 'Retry', completedWork: [], remainingWork: [], risks: [] } }));
  await writeFile(join(queueDir, 'skipped', 'skipped.md'), '---\ntitle: Skipped\ndepends_on: [pending]\n---\n');
  await writeFile(join(queueDir, 'waiting', 'waiting.md'), '---\ntitle: Waiting\ndepends_on: [pending, skipped]\n---\n');
}

describe('monitor data and stream attach acceptance coverage', () => {
  it('serves queue items through the shared queue projection', async () => {
    harness = await startControlRouteHarness();
    await seedQueue(harness.cwd);

    const res = await harness.get(API_ROUTES.queue);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(await projectQueueForContext(harness.context));
  });

  it('delegates session stream attachment and writes stream:hello as the first block', async () => {
    harness = await startControlRouteHarness({ startStreams: true });
    const timestamp = new Date(0).toISOString();
    harness.db.insertRun({ id: 'run-1', sessionId: 'session-1', planSet: 'set', command: 'build', status: 'running', startedAt: timestamp, cwd: harness.cwd });
    harness.db.insertEvent({ runId: 'run-1', type: 'phase:start', data: JSON.stringify({ type: 'phase:start', timestamp, runId: 'run-1', planSet: 'set', command: 'build' }), timestamp });

    const block = await readFirstSseBlock(`${harness.url}${buildPath(API_ROUTES.events, { runId: 'run-1' })}`);
    expect(block).toContain('event: stream:hello');
    expect(JSON.parse(block.split('data: ')[1])).toMatchObject({ cursor: 1, status: 'running' });
  });

  it('delegates daemon stream attachment and writes stream:hello as the first block', async () => {
    harness = await startControlRouteHarness({ startStreams: true });
    const block = await readFirstSseBlock(`${harness.url}${API_ROUTES.daemonEvents}`);
    expect(block).toContain('event: stream:hello');
    expect(JSON.parse(block.split('data: ')[1])).toMatchObject({ cursor: 0, recentActivity: [] });
  });
});
