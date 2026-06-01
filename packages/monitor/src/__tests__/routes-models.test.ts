import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { API_ROUTES } from '@eforge-build/client';
import { createMonitorContext } from '../context.js';
import { openDatabase } from '../db.js';
import type { MonitorStreamHub } from '../types.js';
import { createRouter } from '../http/router.js';
import { createModelRoutes } from '../routes/models.js';

const streams: MonitorStreamHub = { attachSession() {}, attachDaemon() {}, broadcast() {}, subscriberCount: () => 0, stop() {} };
let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => { await cleanup?.(); cleanup = undefined; });

async function start() {
  const db = openDatabase(':memory:');
  const context = await createMonitorContext(db);
  const router = createRouter({ monitor: context, streams, routes: createModelRoutes(context) });
  const server = createServer((req, res) => void router.handle(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanup = () => new Promise((resolve) => server.close(() => { db.close(); resolve(); }));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no address');
  return `http://127.0.0.1:${addr.port}`;
}

describe('model routes', () => {
  it('validates harness query params', async () => {
    const url = await start();
    for (const path of [API_ROUTES.modelProviders, API_ROUTES.modelList]) {
      const missing = await fetch(`${url}${path}`);
      expect(missing.status).toBe(400);
      expect(await missing.json()).toEqual({ error: 'Missing or invalid query param: harness (must be "pi" or "claude-sdk")' });
      const invalid = await fetch(`${url}${path}?harness=nope`);
      expect(invalid.status).toBe(400);
    }
  });

  it('returns claude-sdk providers', async () => {
    const url = await start();
    const res = await fetch(`${url}${API_ROUTES.modelProviders}?harness=claude-sdk`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ providers: [] });
  });
});
