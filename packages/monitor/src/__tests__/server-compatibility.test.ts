import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { API_ROUTES } from '@eforge-build/client';
import { openDatabase } from '../db.js';
import {
  buildRunSummary,
  startServer,
  type DaemonState,
  type MonitorServer,
  type StartServerOptions,
  type WorkerTracker,
} from '../server.js';
import { buildRunSummary as buildRunSummaryProjection } from '../projections/run-summary.js';

void ({} as MonitorServer | WorkerTracker | DaemonState | StartServerOptions);

describe('server compatibility exports', () => {
  it('re-exports buildRunSummary from the projection module', () => {
    expect(buildRunSummary).toBe(buildRunSummaryProjection);
  });

  it('starts a compatible server handle', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'eforge-server-compat-'));
    const db = openDatabase(':memory:');
    const server = await startServer(db, 0, { cwd });
    try {
      expect(server.port).toBeGreaterThan(0);
      expect(server.url).toBe(`http://localhost:${server.port}`);
      expect(server.subscriberCount).toBe(0);
      expect(() => server.broadcast('test:event', '{}')).not.toThrow();

      let keepAliveCount = 0;
      server.onKeepAlive = () => { keepAliveCount += 1; };
      const res = await fetch(`${server.url}${API_ROUTES.keepAlive}`, { method: 'POST' });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: 'ok' });
      expect(keepAliveCount).toBe(1);
    } finally {
      await server.stop();
      db.close();
    }
  });

  it('retries incrementing ports when the preferred port is occupied', async () => {
    const first = await startTempServer();
    const secondDb = openDatabase(':memory:');
    let second: MonitorServer | undefined;
    try {
      second = await startServer(secondDb, first.server.port, { cwd: mkdtempSync(join(tmpdir(), 'eforge-server-retry-')) });
      expect(second.port).toBeGreaterThan(first.server.port);
      expect(second.port).toBeLessThanOrEqual(first.server.port + 10);
      expect(second.url).toBe(`http://localhost:${second.port}`);
    } finally {
      await second?.stop();
      secondDb.close();
      await first.server.stop();
      first.db.close();
    }
  });

  it('does not retry an occupied preferred port when strictPort is set', async () => {
    const first = await startTempServer();
    const secondDb = openDatabase(':memory:');
    try {
      await expect(startServer(secondDb, first.server.port, {
        cwd: mkdtempSync(join(tmpdir(), 'eforge-server-strict-')),
        strictPort: true,
      })).rejects.toMatchObject({ code: 'EADDRINUSE' });
    } finally {
      secondDb.close();
      await first.server.stop();
      first.db.close();
    }
  });
});

async function startTempServer(): Promise<{ server: MonitorServer; db: ReturnType<typeof openDatabase> }> {
  const db = openDatabase(':memory:');
  const server = await startServer(db, 0, { cwd: mkdtempSync(join(tmpdir(), 'eforge-server-port-')) });
  return { server, db };
}
