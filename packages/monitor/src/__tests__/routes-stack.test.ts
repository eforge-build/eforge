import { createServer, request } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { API_ROUTES } from '@eforge-build/client';
import { completeCurrentSyncStatus, setCurrentSyncStatus } from '@eforge-build/engine/stacking/sync-state';
import { createMonitorContext } from '../context.js';
import { openDatabase } from '../db.js';
import type { MonitorStreamHub } from '../types.js';
import { createRouter } from '../http/router.js';
import { stackLayersToWire } from '../projections/stack-layers.js';
import { createStackRoutes } from '../routes/stack.js';

const streams: MonitorStreamHub = { attachSession() {}, attachDaemon() {}, broadcast() {}, subscriberCount: () => 0, stop() {} };
let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => { await cleanup?.(); cleanup = undefined; });

async function start(cwd?: string) {
  const db = openDatabase(':memory:');
  const context = await createMonitorContext(db, 0, { cwd });
  const router = createRouter({ monitor: context, streams, routes: createStackRoutes(context) });
  const server = createServer((req, res) => void router.handle(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanup = () => new Promise((resolve) => server.close(() => { db.close(); resolve(); }));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no address');
  return { baseUrl: `http://127.0.0.1:${addr.port}`, port: addr.port };
}

function postWithHeaders(port: number, headers: Record<string, string>, body = '{}'): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: API_ROUTES.stackSync, method: 'POST', headers }, (res) => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { responseBody += chunk; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, json: responseBody ? JSON.parse(responseBody) : null }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

async function fixture() {
  const cwd = await mkdtemp(join(tmpdir(), 'eforge-stack-route-'));
  await mkdir(join(cwd, '.eforge', 'stacks'), { recursive: true });
  await mkdir(join(cwd, 'eforge'), { recursive: true });
  await writeFile(join(cwd, 'eforge', 'config.yaml'), 'stacking:\n  enabled: false\n', 'utf-8');
  const layer = { prdId: 'p1', stackId: 's1', provider: 'git-spice', branch: 'feature/p1', status: 'pending', recordedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
  await writeFile(join(cwd, '.eforge', 'stacks', 'layers.json'), JSON.stringify({ version: 1, layers: [layer] }), 'utf-8');
  return cwd;
}

describe('stack routes', () => {
  it('serves stack layers and sync status', async () => {
    const { baseUrl: noneUrl } = await start();
    expect(await fetch(`${noneUrl}${API_ROUTES.stackSyncStatus}`).then((res) => res.json())).toEqual({});
    await cleanup?.(); cleanup = undefined;
    const cwd = await fixture();
    await setCurrentSyncStatus(cwd, { id: 'cur', startedAt: '2026-01-01T00:00:00.000Z', dryRun: false, restackCandidates: [] });
    await completeCurrentSyncStatus(cwd, { id: 'last', startedAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-01T00:00:01.000Z', outcome: 'complete', dryRun: false, restackCandidates: [] });
    await setCurrentSyncStatus(cwd, { id: 'cur', startedAt: '2026-01-01T00:00:02.000Z', dryRun: true, restackCandidates: [] });
    const { baseUrl: url } = await start(cwd);
    expect(await fetch(`${url}${API_ROUTES.stackLayers}`).then((res) => res.json())).toEqual({ layers: stackLayersToWire(cwd) });
    const status = await fetch(`${url}${API_ROUTES.stackSyncStatus}`).then((res) => res.json()) as { last: { id: string }; current: { id: string } };
    expect(status.last.id).toBe('last');
    expect(status.current.id).toBe('cur');
    await rm(cwd, { recursive: true, force: true });
  });

  it('enforces stack sync security and request validation', async () => {
    const cwd = await fixture();
    const { baseUrl: url, port } = await start(cwd);
    expect((await postWithHeaders(port, { Host: 'example.com' })).status).toBe(403);
    expect((await fetch(`${url}${API_ROUTES.stackSync}`, { method: 'POST', headers: { Origin: 'http://evil.test' }, body: '{}' })).status).toBe(403);
    const cases = ['{', '[]', '{"dryRun":"no"}', '{"trigger":"bad"}', '{"activeBuildPolicy":"bad"}'];
    for (const body of cases) expect((await fetch(`${url}${API_ROUTES.stackSync}`, { method: 'POST', body })).status).toBe(400);
    const skipped = await fetch(`${url}${API_ROUTES.stackSync}`, { method: 'POST', body: '{}' });
    expect(skipped.status).toBe(200);
    expect(await skipped.json()).toMatchObject({ outcome: 'skipped', stackingActive: false, restackCandidates: [], activeBuildSkips: [], providerCommands: [] });
    await rm(cwd, { recursive: true, force: true });
  });
});
