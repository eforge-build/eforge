/**
 * Tests for non-starting daemon client helpers.
 *
 * Validates:
 *   1. daemonRequestIfRunning returns null when no lockfile exists and does not spawn.
 *   2. daemonRequestIfRunning returns null with a stale lockfile (dead port) and does not spawn.
 *   3. apiGetQueueIfRunning returns null with no live daemon.
 *   4. daemonRequestIfRunning verifies API version when a live daemon is found.
 *   5. daemonRequestIfRunning skips version verification for the /api/version path itself.
 *   6. Pi-facing *IfRunning helpers are exported and passive when no daemon is live.
 *
 * Follows AGENTS.md conventions:
 *  - No mocks. Real ephemeral HTTP server bound to 127.0.0.1:0.
 *  - Real lockfile written to a tmpdir.
 *  - Cleanup in afterEach.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile, chmod, mkdir } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { tmpdir } from 'node:os';
import * as client from '@eforge-build/client';
import {
  daemonRequestIfRunning,
  writeLockfile,
  API_ROUTES,
  DAEMON_API_VERSION,
  clearApiVersionCache,
  apiCancelIfRunning,
  apiEnqueueIfRunning,
  apiGetQueueIfRunning,
  apiShowConfigVerboseIfRunning,
  apiStackSyncIfRunning,
} from '@eforge-build/client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface RecordedRequest {
  method: string;
  url: string;
  bodyText: string;
}

interface TestServer {
  server: Server;
  port: number;
  versionRequestCount: number;
  healthRequestCount: number;
  reportedVersion: number;
  requests: RecordedRequest[];
}

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function startTestServer(): Promise<TestServer> {
  return new Promise((resolve, reject) => {
    const state: TestServer = {
      server: null as unknown as Server,
      port: 0,
      versionRequestCount: 0,
      healthRequestCount: 0,
      reportedVersion: DAEMON_API_VERSION,
      requests: [],
    };

    const server = createServer(async (req, res) => {
      const url = req.url ?? '/';
      const method = req.method ?? 'GET';
      const bodyText = await readRequestBody(req);
      state.requests.push({ method, url, bodyText });

      if (url === '/api/health') {
        state.healthRequestCount++;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        return;
      }

      if (url === API_ROUTES.version) {
        state.versionRequestCount++;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ version: state.reportedVersion }));
        return;
      }

      if (url === API_ROUTES.queue) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([]));
        return;
      }

      if (url === `${API_ROUTES.configShow}?verbose=true`) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          resolved: { build: { maxValidationRetries: 2 } },
          sources: { project: { path: '/project/eforge/config.yaml', found: true } },
        }));
        return;
      }

      if (url === API_ROUTES.enqueue) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      if (url === '/api/cancel/session-1') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      if (url === API_ROUTES.stackSync) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          outcome: 'skipped',
          reason: 'Stacking is not enabled.',
          stackingActive: false,
          dryRun: true,
          activeBuildSkips: [],
          providerCommands: [],
        }));
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

type RouteHelperCase = {
  name: string;
  opts: (cwd: string) => Record<string, unknown>;
};

const noStartRouteHelperCases: RouteHelperCase[] = [
  { name: 'apiEnqueueIfRunning', opts: (cwd) => ({ cwd, body: { prompt: 'Build the thing' } }) },
  { name: 'apiCancelIfRunning', opts: (cwd) => ({ cwd, sessionId: 'session-1' }) },
  { name: 'apiGetQueueIfRunning', opts: (cwd) => ({ cwd }) },
  { name: 'apiGetRunsIfRunning', opts: (cwd) => ({ cwd }) },
  { name: 'apiGetLatestRunFromRunsIfRunning', opts: (cwd) => ({ cwd }) },
  { name: 'apiGetRunningRunsIfRunning', opts: (cwd) => ({ cwd }) },
  { name: 'apiGetRunningSessionSummariesIfRunning', opts: (cwd) => ({ cwd }) },
  { name: 'apiGetRunSummaryIfRunning', opts: (cwd) => ({ cwd, id: 'session-1' }) },
  { name: 'apiGetRunStateIfRunning', opts: (cwd) => ({ cwd, id: 'session-1' }) },
  { name: 'apiGetPlansIfRunning', opts: (cwd) => ({ cwd, runId: 'session-1' }) },
  { name: 'apiGetDiffIfRunning', opts: (cwd) => ({ cwd, sessionId: 'session-1', planId: 'plan-1', file: 'src/a.ts' }) },
  { name: 'apiGetSessionMetadataIfRunning', opts: (cwd) => ({ cwd }) },
  { name: 'apiShowConfigIfRunning', opts: (cwd) => ({ cwd }) },
  { name: 'apiShowConfigVerboseIfRunning', opts: (cwd) => ({ cwd }) },
  { name: 'apiValidateConfigIfRunning', opts: (cwd) => ({ cwd }) },
  { name: 'apiListProfilesIfRunning', opts: (cwd) => ({ cwd, query: { scope: 'project-local' } }) },
  { name: 'apiShowProfileIfRunning', opts: (cwd) => ({ cwd }) },
  { name: 'apiUseProfileIfRunning', opts: (cwd) => ({ cwd, body: { name: 'default' } }) },
  { name: 'apiCreateProfileIfRunning', opts: (cwd) => ({ cwd, body: { name: 'default' } }) },
  { name: 'apiDeleteProfileIfRunning', opts: (cwd) => ({ cwd, name: 'default', body: {} }) },
  { name: 'apiListModelProvidersIfRunning', opts: (cwd) => ({ cwd, harness: 'pi' }) },
  { name: 'apiListModelsIfRunning', opts: (cwd) => ({ cwd, harness: 'pi', provider: 'openai' }) },
  { name: 'apiHealthIfRunning', opts: (cwd) => ({ cwd }) },
  { name: 'apiKeepAliveIfRunning', opts: (cwd) => ({ cwd }) },
  { name: 'apiGetProjectContextIfRunning', opts: (cwd) => ({ cwd }) },
  { name: 'apiGetAutoBuildIfRunning', opts: (cwd) => ({ cwd }) },
  { name: 'apiSetAutoBuildIfRunning', opts: (cwd) => ({ cwd, body: { desired: 'enabled' } }) },
  { name: 'apiListExtensionsIfRunning', opts: (cwd) => ({ cwd }) },
  { name: 'apiShowExtensionIfRunning', opts: (cwd) => ({ cwd, name: 'example' }) },
  { name: 'apiValidateExtensionsIfRunning', opts: (cwd) => ({ cwd, name: 'example', path: 'eforge/extensions/example' }) },
  { name: 'apiNewExtensionIfRunning', opts: (cwd) => ({ cwd, body: { name: 'example' } }) },
  { name: 'apiReloadExtensionsIfRunning', opts: (cwd) => ({ cwd }) },
  { name: 'apiTestExtensionIfRunning', opts: (cwd) => ({ cwd, body: { name: 'example' } }) },
  { name: 'apiTrustExtensionIfRunning', opts: (cwd) => ({ cwd, body: { name: 'example' } }) },
  { name: 'apiUntrustExtensionIfRunning', opts: (cwd) => ({ cwd, body: { name: 'example' } }) },
  { name: 'apiGetExtensionContributionManifestIfRunning', opts: (cwd) => ({ cwd }) },
  { name: 'apiInvokeExtensionActionIfRunning', opts: (cwd) => ({ cwd, body: { actionId: 'example.action', input: {}, requestedBy: { host: 'cli' } } }) },
  { name: 'apiPlaybookListIfRunning', opts: (cwd) => ({ cwd }) },
  { name: 'apiPlaybookShowIfRunning', opts: (cwd) => ({ cwd, name: 'ship-it' }) },
  { name: 'apiPlaybookSaveIfRunning', opts: (cwd) => ({ cwd, body: { scope: 'project-local', playbook: {} } }) },
  { name: 'apiPlaybookRunIfRunning', opts: (cwd) => ({ cwd, body: { name: 'ship-it' } }) },
  { name: 'apiPlaybookPromoteIfRunning', opts: (cwd) => ({ cwd, body: { name: 'ship-it' } }) },
  { name: 'apiPlaybookDemoteIfRunning', opts: (cwd) => ({ cwd, body: { name: 'ship-it' } }) },
  { name: 'apiPlaybookValidateIfRunning', opts: (cwd) => ({ cwd, body: { raw: '---\nname: ship-it\n---\n' } }) },
  { name: 'apiPlaybookCopyIfRunning', opts: (cwd) => ({ cwd, body: { name: 'ship-it', targetScope: 'project-local' } }) },
  { name: 'apiSessionPlanListIfRunning', opts: (cwd) => ({ cwd }) },
  { name: 'apiSessionPlanShowIfRunning', opts: (cwd) => ({ cwd, session: 'session-1' }) },
  { name: 'apiSessionPlanCreateIfRunning', opts: (cwd) => ({ cwd, body: { session: 'session-1' } }) },
  { name: 'apiSessionPlanSetSectionIfRunning', opts: (cwd) => ({ cwd, body: { session: 'session-1', section: 'goal', content: 'goal' } }) },
  { name: 'apiSessionPlanSkipDimensionIfRunning', opts: (cwd) => ({ cwd, body: { session: 'session-1', dimension: 'tests' } }) },
  { name: 'apiSessionPlanSetStatusIfRunning', opts: (cwd) => ({ cwd, body: { session: 'session-1', status: 'ready' } }) },
  { name: 'apiSessionPlanSelectDimensionsIfRunning', opts: (cwd) => ({ cwd, body: { session: 'session-1', dimensions: [] } }) },
  { name: 'apiSessionPlanReadinessIfRunning', opts: (cwd) => ({ cwd, session: 'session-1' }) },
  { name: 'apiSessionPlanMigrateLegacyIfRunning', opts: (cwd) => ({ cwd, body: { session: 'session-1' } }) },
  { name: 'apiSessionPlanSetListIfRunning', opts: (cwd) => ({ cwd }) },
  { name: 'apiSessionPlanSetShowIfRunning', opts: (cwd) => ({ cwd, planSetId: 'set-1' }) },
  { name: 'apiSessionPlanSetValidateIfRunning', opts: (cwd) => ({ cwd, planSetId: 'set-1' }) },
  { name: 'apiRecoverIfRunning', opts: (cwd) => ({ cwd, body: { prdId: 'prd-1' } }) },
  { name: 'apiReadRecoverySidecarIfRunning', opts: (cwd) => ({ cwd, prdId: 'prd-1' }) },
  { name: 'apiApplyRecoveryIfRunning', opts: (cwd) => ({ cwd, body: { prdId: 'prd-1' } }) },
  { name: 'apiStopDaemonIfRunning', opts: (cwd) => ({ cwd, body: {} }) },
  { name: 'apiStackSyncIfRunning', opts: (cwd) => ({ cwd, body: { dryRun: true } }) },
];

function invokeClientHelper(name: string, opts: Record<string, unknown>): Promise<unknown> {
  const helper = (client as Record<string, unknown>)[name];
  expect(helper, `${name} should be exported`).toEqual(expect.any(Function));
  return (helper as (opts: Record<string, unknown>) => Promise<unknown>)(opts);
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let tmpDir: string;
let fakeBinDir: string;
let testServer: TestServer;
let originalPath: string;

beforeEach(async () => {
  clearApiVersionCache();
  originalPath = process.env.PATH ?? '';
  tmpDir = await mkdtemp(join(tmpdir(), 'eforge-no-start-test-'));
  fakeBinDir = join(tmpDir, 'fake-bin');
  await mkdir(fakeBinDir, { recursive: true });

  // Create a fake "eforge" executable that writes a sentinel file when invoked.
  // If daemonRequestIfRunning incorrectly calls spawn('eforge', ...), the
  // sentinel file will exist and the test can detect it.
  const sentinelPath = join(tmpDir, 'eforge-spawned');
  const fakeEforge = join(fakeBinDir, 'eforge');
  await writeFile(fakeEforge, `#!/bin/sh\ntouch "${sentinelPath}"\n`, 'utf-8');
  await chmod(fakeEforge, 0o755);

  // Prepend fake bin dir so our fake eforge is found first
  process.env.PATH = `${fakeBinDir}${delimiter}${originalPath}`;

  testServer = await startTestServer();
});

afterEach(async () => {
  process.env.PATH = originalPath;
  await stopTestServer(testServer);
  await rm(tmpDir, { recursive: true, force: true });
  clearApiVersionCache();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('daemonRequestIfRunning — no lockfile', () => {
  it('(1) returns null and does not spawn when no lockfile exists', async () => {
    // No lockfile written — daemon is not running
    const result = await daemonRequestIfRunning(tmpDir, 'GET', API_ROUTES.health);

    expect(result).toBeNull();

    // The fake eforge sentinel must NOT exist
    const { existsSync } = await import('node:fs');
    expect(existsSync(join(tmpDir, 'eforge-spawned'))).toBe(false);
  });
});

describe('daemonRequestIfRunning — stale lockfile', () => {
  it('(2) returns null and does not spawn with a stale lockfile (dead port)', async () => {
    // Write a lockfile pointing at a port with no listener. Port 0 is reserved
    // for server-side ephemeral allocation and cannot be connected to as a
    // client destination, so this avoids racing another process that might bind
    // a just-released ephemeral port.
    writeLockfile(tmpDir, {
      pid: process.pid,
      port: 0,
      startedAt: new Date().toISOString(),
    });

    const result = await daemonRequestIfRunning(tmpDir, 'GET', API_ROUTES.health);

    expect(result).toBeNull();

    const { existsSync } = await import('node:fs');
    expect(existsSync(join(tmpDir, 'eforge-spawned'))).toBe(false);
  });
});

describe('apiGetQueueIfRunning — no live daemon', () => {
  it('(3) returns null when no live daemon is present', async () => {
    // No lockfile — daemon not running
    const result = await apiGetQueueIfRunning({ cwd: tmpDir });
    expect(result).toBeNull();
  });

  it('(3b) returns data envelope when daemon is running', async () => {
    writeLockfile(tmpDir, {
      pid: process.pid,
      port: testServer.port,
      startedAt: new Date().toISOString(),
    });

    const result = await apiGetQueueIfRunning({ cwd: tmpDir });
    expect(result).not.toBeNull();
    expect(result?.data).toEqual([]);
    expect(result?.port).toBe(testServer.port);
  });
});

describe('daemonRequestIfRunning — API version verification', () => {
  it('(4) verifies API version for non-version paths when daemon is live', async () => {
    writeLockfile(tmpDir, {
      pid: process.pid,
      port: testServer.port,
      startedAt: new Date().toISOString(),
    });

    // /api/queue is a non-version path — should trigger version check
    await daemonRequestIfRunning(tmpDir, 'GET', API_ROUTES.queue);

    expect(testServer.versionRequestCount).toBe(1);
  });

  it('(4b) throws on version mismatch for non-version paths', async () => {
    testServer.reportedVersion = DAEMON_API_VERSION + 1;
    writeLockfile(tmpDir, {
      pid: process.pid,
      port: testServer.port,
      startedAt: new Date().toISOString(),
    });

    await expect(
      daemonRequestIfRunning(tmpDir, 'GET', API_ROUTES.queue),
    ).rejects.toThrow(/version.mismatch/i);
  });

  it('(5) skips version verification for the /api/version path itself', async () => {
    writeLockfile(tmpDir, {
      pid: process.pid,
      port: testServer.port,
      startedAt: new Date().toISOString(),
    });

    // Request the version route directly — should not trigger verifyApiVersion
    const result = await daemonRequestIfRunning<{ version: number }>(
      tmpDir,
      'GET',
      API_ROUTES.version,
    );

    expect(result).not.toBeNull();
    expect(result?.data.version).toBe(DAEMON_API_VERSION);
    // Only 1 version request: the direct GET, not a pre-check from verifyApiVersion
    expect(testServer.versionRequestCount).toBe(1);
  });
});

describe('helper import discipline', () => {
  it('(6) exports all Pi-facing *IfRunning route helpers and they are passive with no lockfile', async () => {
    for (const { name, opts } of noStartRouteHelperCases) {
      const result = await invokeClientHelper(name, opts(tmpDir));
      expect(result, `${name} should return null when no daemon lockfile exists`).toBeNull();
    }

    expect(existsSync(join(tmpDir, 'eforge-spawned'))).toBe(false);
  });

  it('(6b) representative *IfRunning helper resolves to the daemon envelope when live', async () => {
    writeLockfile(tmpDir, {
      pid: process.pid,
      port: testServer.port,
      startedAt: new Date().toISOString(),
    });

    const result = await apiGetQueueIfRunning({ cwd: tmpDir });
    expect(result).toEqual({ data: [], port: testServer.port });
  });

  it('(6c) representative live helpers send the expected method, path, and JSON body', async () => {
    writeLockfile(tmpDir, {
      pid: process.pid,
      port: testServer.port,
      startedAt: new Date().toISOString(),
    });

    const enqueueBody = { source: 'Build the thing' };
    const enqueueResult = await apiEnqueueIfRunning({ cwd: tmpDir, body: enqueueBody });
    expect(enqueueResult).toEqual({ data: { ok: true }, port: testServer.port });
    expect(testServer.requests.at(-1)).toEqual({
      method: 'POST',
      url: API_ROUTES.enqueue,
      bodyText: JSON.stringify(enqueueBody),
    });

    const cancelResult = await apiCancelIfRunning({ cwd: tmpDir, sessionId: 'session-1' });
    expect(cancelResult).toEqual({ data: { ok: true }, port: testServer.port });
    expect(testServer.requests.at(-1)).toEqual({
      method: 'POST',
      url: '/api/cancel/session-1',
      bodyText: '',
    });
  });

  it('(6d) apiShowConfigVerboseIfRunning requests the config show route with verbose=true', async () => {
    writeLockfile(tmpDir, {
      pid: process.pid,
      port: testServer.port,
      startedAt: new Date().toISOString(),
    });

    const result = await apiShowConfigVerboseIfRunning({ cwd: tmpDir });

    expect(result).toEqual({
      data: {
        resolved: { build: { maxValidationRetries: 2 } },
        sources: { project: { path: '/project/eforge/config.yaml', found: true } },
      },
      port: testServer.port,
    });
    expect(testServer.requests.at(-1)).toEqual({
      method: 'GET',
      url: `${API_ROUTES.configShow}?verbose=true`,
      bodyText: '',
    });
  });

  it('(6e) apiStackSyncIfRunning sends POST to API_ROUTES.stackSync with JSON body when live', async () => {
    writeLockfile(tmpDir, {
      pid: process.pid,
      port: testServer.port,
      startedAt: new Date().toISOString(),
    });

    const syncBody = { dryRun: true };
    const result = await apiStackSyncIfRunning({ cwd: tmpDir, body: syncBody });
    expect(result).not.toBeNull();
    expect(result?.data.outcome).toBe('skipped');
    expect(testServer.requests.at(-1)).toEqual({
      method: 'POST',
      url: API_ROUTES.stackSync,
      bodyText: JSON.stringify(syncBody),
    });
  });
});
