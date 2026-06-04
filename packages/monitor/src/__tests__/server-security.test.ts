import { describe, expect, it } from 'vitest';
import { request } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { API_ROUTES } from '@eforge-build/client';
import { openDatabase } from '../db.js';
import { startServer, type MonitorServer } from '../server.js';

describe('startServer route security', () => {
  it('rejects sensitive reads for non-local or cross-site requests', async () => {
    const { server, db } = await start();
    try {
      const paths = [`${API_ROUTES.readRecoverySidecar}?prdId=missing`, API_ROUTES.extensionContributionManifest];
      for (const path of paths) {
        await expectForbidden(server, 'GET', path, { Host: 'example.com' });
        await expectForbidden(server, 'GET', path, { Host: `localhost:${server.port}`, Origin: 'http://evil.example' });
        await expectForbidden(server, 'GET', path, { Host: `localhost:${server.port}`, 'Sec-Fetch-Site': 'cross-site' });
      }
    } finally {
      await server.stop();
      db.close();
    }
  });

  it('rejects local mutations for a non-loopback Host before body validation', async () => {
    const { server, db } = await start();
    try {
      await expectForbidden(server, 'POST', API_ROUTES.stackSync, { Host: 'example.com' }, '{');
      await expectForbidden(server, 'POST', API_ROUTES.extensionActionInvoke, { Host: 'example.com' }, '{');
      await expectForbidden(server, 'POST', API_ROUTES.extensionActionInvoke, { Host: `localhost:${server.port}`, 'Sec-Fetch-Site': 'cross-site' }, '{');
    } finally {
      await server.stop();
      db.close();
    }
  });

  it('rejects keep-alive mutations for non-local or cross-site requests', async () => {
    const { server, db } = await start();
    try {
      await expectForbidden(server, 'POST', API_ROUTES.keepAlive, { Host: 'example.com' }, '{}');
      await expectForbidden(server, 'POST', API_ROUTES.keepAlive, { Host: `localhost:${server.port}`, 'Sec-Fetch-Site': 'cross-site' }, '{}');
    } finally {
      await server.stop();
      db.close();
    }
  });

  it('rejects auto-build reads for non-local or cross-site requests', async () => {
    const { server, db } = await start();
    try {
      await expectForbidden(server, 'GET', API_ROUTES.autoBuildGet, { Host: 'example.com' });
      await expectForbidden(server, 'GET', API_ROUTES.autoBuildGet, { Host: `localhost:${server.port}`, Origin: 'http://evil.example' });
      await expectForbidden(server, 'GET', API_ROUTES.autoBuildGet, { Host: `localhost:${server.port}`, 'Sec-Fetch-Site': 'cross-site' });
    } finally {
      await server.stop();
      db.close();
    }
  });
});

async function start(): Promise<{ server: MonitorServer; db: ReturnType<typeof openDatabase> }> {
  const cwd = mkdtempSync(join(tmpdir(), 'eforge-server-security-'));
  const db = openDatabase(':memory:');
  const server = await startServer(db, 0, { cwd });
  return { server, db };
}

async function expectForbidden(
  server: MonitorServer,
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: string,
): Promise<void> {
  const result = await rawRequest(server.port, method, path, headers, body);
  expect(result.status).toBe(403);
  expect(JSON.parse(result.body)).toHaveProperty('error');
}

function rawRequest(
  port: number,
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { responseBody += chunk; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: responseBody }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}
