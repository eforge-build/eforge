/**
 * Tests for the session-plan list client helper.
 *
 * Covers:
 * - Default call omits includeSubmitted from the request URL.
 * - includeSubmitted: true adds includeSubmitted=true to the request URL.
 * - SessionPlanListRequest type is exported from @eforge-build/client.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  apiSessionPlanList,
  apiSessionPlanListIfRunning,
  writeLockfile,
  DAEMON_API_VERSION,
  clearApiVersionCache,
  API_ROUTES,
  type SessionPlanListRequest,
} from '@eforge-build/client';
import type { SessionPlanListRequest as BrowserSessionPlanListRequest } from '@eforge-build/client/browser';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface RecordedRequest {
  method: string;
  url: string;
}

interface TestServer {
  server: Server;
  port: number;
  requests: RecordedRequest[];
}

function startTestServer(): Promise<TestServer> {
  return new Promise((resolve, reject) => {
    const state: TestServer = {
      server: null as unknown as Server,
      port: 0,
      requests: [],
    };

    const server = createServer((req: IncomingMessage, res) => {
      const url = req.url ?? '/';
      const method = req.method ?? 'GET';
      state.requests.push({ method, url });

      if (url === '/api/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        return;
      }

      if (url === API_ROUTES.version) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ version: DAEMON_API_VERSION }));
        return;
      }

      if (url === API_ROUTES.sessionPlanList || url.startsWith(`${API_ROUTES.sessionPlanList}?`)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ plans: [] }));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    });

    state.server = server;

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Unexpected server address'));
        return;
      }
      state.port = addr.port;
      resolve(state);
    });

    server.on('error', reject);
  });
}

function stopTestServer(state: TestServer): Promise<void> {
  return new Promise((resolve, reject) => {
    state.server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let tmpDir: string;
let testServer: TestServer;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'eforge-list-client-test-'));
  testServer = await startTestServer();
  clearApiVersionCache();
  // Write a lockfile pointing at the test server
  await writeLockfile(tmpDir, { port: testServer.port, pid: process.pid, startedAt: new Date().toISOString() });
});

afterEach(async () => {
  await stopTestServer(testServer);
  clearApiVersionCache();
  await rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Type check: SessionPlanListRequest is exported
// ---------------------------------------------------------------------------

// This compile-time check ensures the type is reachable from @eforge-build/client.
const _typeCheck: SessionPlanListRequest = {};
void _typeCheck;

// Compile-time check: SessionPlanListRequest is also reachable from the browser export.
const _browserTypeCheck: BrowserSessionPlanListRequest = {};
void _browserTypeCheck;

// ---------------------------------------------------------------------------
// apiSessionPlanListIfRunning — URL construction
// ---------------------------------------------------------------------------

describe('apiSessionPlanListIfRunning URL construction', () => {
  it('default call omits includeSubmitted from query string', async () => {
    await apiSessionPlanListIfRunning({ cwd: tmpDir });

    const listRequests = testServer.requests.filter(
      (r) => r.url === API_ROUTES.sessionPlanList || r.url.startsWith(`${API_ROUTES.sessionPlanList}?`),
    );
    expect(listRequests.length).toBeGreaterThanOrEqual(1);
    const listUrl = listRequests[listRequests.length - 1].url;
    expect(listUrl).toBe(API_ROUTES.sessionPlanList);
    expect(listUrl).not.toContain('includeSubmitted');
  });

  it('includeSubmitted: true appends includeSubmitted=true to the query', async () => {
    await apiSessionPlanListIfRunning({ cwd: tmpDir, includeSubmitted: true });

    const listRequests = testServer.requests.filter(
      (r) => r.url.startsWith(API_ROUTES.sessionPlanList),
    );
    expect(listRequests.length).toBeGreaterThanOrEqual(1);
    const listUrl = listRequests[listRequests.length - 1].url;
    expect(listUrl).toContain('includeSubmitted=true');
  });

  it('includeSubmitted: false omits includeSubmitted from query string', async () => {
    await apiSessionPlanListIfRunning({ cwd: tmpDir, includeSubmitted: false });

    const listRequests = testServer.requests.filter(
      (r) => r.url === API_ROUTES.sessionPlanList || r.url.startsWith(`${API_ROUTES.sessionPlanList}?`),
    );
    expect(listRequests.length).toBeGreaterThanOrEqual(1);
    const listUrl = listRequests[listRequests.length - 1].url;
    expect(listUrl).toBe(API_ROUTES.sessionPlanList);
    expect(listUrl).not.toContain('includeSubmitted');
  });

  it('omitting includeSubmitted entirely produces the same URL as includeSubmitted: false', async () => {
    clearApiVersionCache();
    testServer.requests.length = 0;
    await apiSessionPlanListIfRunning({ cwd: tmpDir });
    const withoutOpt = testServer.requests.filter((r) => r.url.startsWith(API_ROUTES.sessionPlanList));
    const urlWithout = withoutOpt[withoutOpt.length - 1]?.url ?? '';

    clearApiVersionCache();
    testServer.requests.length = 0;
    await apiSessionPlanListIfRunning({ cwd: tmpDir, includeSubmitted: false });
    const withFalse = testServer.requests.filter((r) => r.url.startsWith(API_ROUTES.sessionPlanList));
    const urlWithFalse = withFalse[withFalse.length - 1]?.url ?? '';

    expect(urlWithout).toBe(urlWithFalse);
  });
});

// ---------------------------------------------------------------------------
// apiSessionPlanList — URL construction
// ---------------------------------------------------------------------------

describe('apiSessionPlanList URL construction', () => {
  it('default call omits includeSubmitted from query string', async () => {
    await apiSessionPlanList({ cwd: tmpDir });

    const listRequests = testServer.requests.filter(
      (r) => r.url === API_ROUTES.sessionPlanList || r.url.startsWith(`${API_ROUTES.sessionPlanList}?`),
    );
    expect(listRequests.length).toBeGreaterThanOrEqual(1);
    const listUrl = listRequests[listRequests.length - 1].url;
    expect(listUrl).toBe(API_ROUTES.sessionPlanList);
    expect(listUrl).not.toContain('includeSubmitted');
  });

  it('includeSubmitted: true appends includeSubmitted=true to the query', async () => {
    await apiSessionPlanList({ cwd: tmpDir, includeSubmitted: true });

    const listRequests = testServer.requests.filter(
      (r) => r.url.startsWith(API_ROUTES.sessionPlanList),
    );
    expect(listRequests.length).toBeGreaterThanOrEqual(1);
    const listUrl = listRequests[listRequests.length - 1].url;
    expect(listUrl).toContain('includeSubmitted=true');
  });

  it('includeSubmitted: false omits includeSubmitted from query string', async () => {
    await apiSessionPlanList({ cwd: tmpDir, includeSubmitted: false });

    const listRequests = testServer.requests.filter(
      (r) => r.url === API_ROUTES.sessionPlanList || r.url.startsWith(`${API_ROUTES.sessionPlanList}?`),
    );
    expect(listRequests.length).toBeGreaterThanOrEqual(1);
    const listUrl = listRequests[listRequests.length - 1].url;
    expect(listUrl).toBe(API_ROUTES.sessionPlanList);
    expect(listUrl).not.toContain('includeSubmitted');
  });
});
