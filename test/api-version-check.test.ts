/**
 * Unit tests for `verifyApiVersion` in `packages/client/src/api-version.ts`.
 *
 * Follows AGENTS.md conventions:
 *  - No mocks. Real ephemeral HTTP server bound to 127.0.0.1:0.
 *  - Real lockfile written to a tmpdir.
 *  - Cleanup in afterEach.
 *
 * Cases covered:
 *  1. Happy path: daemon reports matching version → no throw.
 *  2. Mismatch: daemon reports different version → throws with `version mismatch`
 *     substring, classifies to `kind: 'version-mismatch'`, exit code 2.
 *  3. Cache hit: second call for the same port:pid key does not re-issue a fetch.
 *  4. No-lockfile bail-out: missing lockfile → no throw and no HTTP request.
 *  5. Recursion guard: `daemonRequest(cwd, 'GET', API_ROUTES.version)` skips
 *     `verifyApiVersion` — version request counter stays at 1.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  verifyApiVersion,
  clearApiVersionCache,
  DAEMON_API_VERSION,
  API_ROUTES,
  daemonRequest,
  writeLockfile,
} from '@eforge-build/client';
import { classifyDaemonError, formatCliError } from '../packages/eforge/src/cli/errors.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface TestServer {
  server: Server;
  port: number;
  versionRequestCount: number;
  /** Override the version returned by the server (defaults to DAEMON_API_VERSION). */
  reportedVersion: number;
}

function startTestServer(): Promise<TestServer> {
  return new Promise((resolve, reject) => {
    const state: TestServer = {
      server: null as unknown as Server,
      port: 0,
      versionRequestCount: 0,
      reportedVersion: DAEMON_API_VERSION,
    };

    const server = createServer((req, res) => {
      const url = req.url ?? '/';

      if (url === '/api/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        return;
      }

      if (url === API_ROUTES.version) {
        state.versionRequestCount++;
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ version: state.reportedVersion }));
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
// Tests
// ---------------------------------------------------------------------------

let tmpDir: string;
let testServer: TestServer;

beforeEach(async () => {
  clearApiVersionCache();
  tmpDir = await mkdtemp(join(tmpdir(), 'eforge-api-version-test-'));
  testServer = await startTestServer();
});

afterEach(async () => {
  await stopTestServer(testServer);
  await rm(tmpDir, { recursive: true, force: true });
  clearApiVersionCache();
});

describe('verifyApiVersion', () => {
  it('(1) happy path: resolves without throwing when versions match', async () => {
    writeLockfile(tmpDir, { pid: process.pid, port: testServer.port, startedAt: new Date().toISOString() });

    await expect(verifyApiVersion(tmpDir)).resolves.toBeUndefined();
    expect(testServer.versionRequestCount).toBe(1);
  });

  it('(2) mismatch: throws with version mismatch message, classifies correctly, exit code 2', async () => {
    testServer.reportedVersion = DAEMON_API_VERSION + 1;
    writeLockfile(tmpDir, { pid: process.pid, port: testServer.port, startedAt: new Date().toISOString() });

    let thrown: unknown;
    try {
      await verifyApiVersion(tmpDir);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(Error);
    const msg = (thrown as Error).message;
    // The message contains 'version-mismatch' (hyphen) — matches classifyDaemonError's
    // 'version-mismatch' pattern as well as the 'api version' substring branch.
    expect(msg.toLowerCase()).toMatch(/version.mismatch/);

    const classified = classifyDaemonError(thrown);
    expect(classified.kind).toBe('version-mismatch');

    const formatted = formatCliError(thrown);
    expect(formatted.exitCode).toBe(2);
  });

  it('(3) cache hit: second call for the same port:pid does not re-issue a fetch', async () => {
    writeLockfile(tmpDir, { pid: process.pid, port: testServer.port, startedAt: new Date().toISOString() });

    await verifyApiVersion(tmpDir);
    expect(testServer.versionRequestCount).toBe(1);

    // Second call — should hit the cache and NOT issue another fetch
    await verifyApiVersion(tmpDir);
    expect(testServer.versionRequestCount).toBe(1);
  });

  it('(4) no-lockfile bail-out: missing lockfile resolves without throwing and without fetching', async () => {
    // tmpDir has no lockfile written
    await expect(verifyApiVersion(tmpDir)).resolves.toBeUndefined();
    expect(testServer.versionRequestCount).toBe(0);
  });

  it('(5) recursion guard: daemonRequest for the version route skips verifyApiVersion', async () => {
    writeLockfile(tmpDir, { pid: process.pid, port: testServer.port, startedAt: new Date().toISOString() });

    // Call daemonRequest against the version route itself.
    // Because path === API_ROUTES.version, verifyApiVersion is skipped.
    // The only version request should be the one daemonRequest makes directly.
    const result = await daemonRequest<{ version: number }>(tmpDir, 'GET', API_ROUTES.version);

    expect(result.data.version).toBe(DAEMON_API_VERSION);
    // Exactly 1 request: the direct GET from daemonRequest, not a pre-check from verifyApiVersion
    expect(testServer.versionRequestCount).toBe(1);
  });
});
