import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { API_ROUTES } from '@eforge-build/client';
import { createMonitorContext } from '../context.js';
import { openDatabase } from '../db.js';
import type { MonitorStreamHub } from '../types.js';
import { createRouter } from '../http/router.js';
import { createConfigContextRoutes } from '../routes/config-context.js';

const streams: MonitorStreamHub = { attachSession() {}, attachDaemon() {}, broadcast() {}, subscriberCount: () => 0, stop() {} };
let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => { await cleanup?.(); cleanup = undefined; });

async function start(cwd?: string) {
  const db = openDatabase(':memory:');
  const context = await createMonitorContext(db, 0, { cwd }, { daemonApiVersion: 123, eforgeVersion: 'test-version', pid: 987 });
  context.cachedGitRemote = 'https://user:secret@example.com/org/repo.git';
  const router = createRouter({ monitor: context, streams, routes: createConfigContextRoutes(context) });
  const server = createServer((req, res) => void router.handle(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanup = () => new Promise((resolve) => server.close(() => { db.close(); resolve(); }));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no address');
  return `http://127.0.0.1:${addr.port}`;
}

describe('config/context routes', () => {
  it('serves health, version, and redacted project context', async () => {
    const url = await start();
    await expect(fetch(`${url}${API_ROUTES.health}`).then((res) => res.json())).resolves.toEqual({ status: 'ok', pid: 987 });
    await expect(fetch(`${url}${API_ROUTES.version}`).then((res) => res.json())).resolves.toEqual({ version: 123, eforgeVersion: 'test-version' });
    await expect(fetch(`${url}${API_ROUTES.projectContext}`).then((res) => res.json())).resolves.toEqual({ cwd: null, gitRemote: 'https://example.com/org/repo.git' });
  });

  it('redacts config show and returns verbose source provenance', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'eforge-config-route-'));
    await mkdir(join(cwd, 'eforge'), { recursive: true });
    await writeFile(join(cwd, 'eforge', 'config.yaml'), `langfuse:
  enabled: true
  publicKey: public
  secretKey: shh
agents:
  tiers:
    planning:
      harness: pi
      pi:
        provider: anthropic
        apiKey: pi-secret
      model: claude-opus-4-7
      effort: high
`, 'utf-8');
    const url = await start(cwd);
    const shown = await fetch(`${url}${API_ROUTES.configShow}`).then((res) => res.json()) as Record<string, unknown>;
    const serialized = JSON.stringify(shown);
    expect(serialized).toContain('[redacted]');
    for (const sensitiveValue of ['shh', 'pi-secret']) {
      expect(serialized).not.toContain(`:"${sensitiveValue}"`);
    }
    const verbose = await fetch(`${url}${API_ROUTES.configShow}?verbose=true`).then((res) => res.json()) as { resolved: unknown; sources: Record<string, { path: string | null; found: boolean }> };
    expect(verbose.sources.local).toBeDefined();
    expect(verbose.sources.project).toMatchObject({ path: join(cwd, 'eforge', 'config.yaml'), found: true });
    expect(verbose.sources.user).toBeDefined();
    const validation = await fetch(`${url}${API_ROUTES.configValidate}`).then((res) => res.json()) as { configFound: boolean };
    expect(validation.configFound).toBe(true);
    await rm(cwd, { recursive: true, force: true });
  });
});
