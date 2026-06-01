/**
 * Tests for the read-only session plan-set client helpers in @eforge-build/client.
 *
 * Validates:
 *  - URL construction for list (with/without includeSubmitted), show, and validate.
 *  - Passive *IfRunning variants return null when no daemon lockfile exists.
 *  - Node and browser-safe wire types are reachable from the package entrypoints.
 *
 * Follows AGENTS.md conventions: no mocks, real ephemeral HTTP server bound to
 * 127.0.0.1:0, real lockfile in a tmpdir, cleanup in afterEach.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  apiSessionPlanSetList,
  apiSessionPlanSetListIfRunning,
  apiSessionPlanSetShow,
  apiSessionPlanSetShowIfRunning,
  apiSessionPlanSetValidate,
  apiSessionPlanSetValidateIfRunning,
  writeLockfile,
  clearApiVersionCache,
  DAEMON_API_VERSION,
  API_ROUTES,
} from '@eforge-build/client';
import type {
  SessionPlanSetListResponse,
  SessionPlanSetShowResponse,
  SessionPlanSetValidateResponse,
} from '@eforge-build/client';
import type {
  SessionPlanSetSummaryWire,
  SessionPlanSetListEntryWire,
} from '@eforge-build/client/browser';

// ---------------------------------------------------------------------------
// Type reachability (compile-time): values typed against the wire shapes prove
// the types are exported from both the Node and browser entrypoints.
// ---------------------------------------------------------------------------

const SAMPLE_ENTRY: SessionPlanSetListEntryWire = {
  id: 'add-search',
  planSetId: 'add-search',
  title: 'Add Search',
  status: 'planning',
  strategy: 'dag',
  dir: '/project/.eforge/session-plans/add-search',
  manifestPath: '/project/.eforge/session-plans/add-search/plan-set.yaml',
  childCount: 1,
};

const SAMPLE_SUMMARY: SessionPlanSetSummaryWire = {
  id: 'add-search',
  title: 'Add Search',
  status: 'planning',
  strategy: 'dag',
  children: [],
  diagnostics: [],
  externalRefs: [],
};

const LIST_RESPONSE: SessionPlanSetListResponse = { planSets: [SAMPLE_ENTRY] };
const SHOW_RESPONSE: SessionPlanSetShowResponse = {
  planSet: SAMPLE_SUMMARY,
  validation: { ok: true, diagnostics: [], summary: SAMPLE_SUMMARY },
  dir: SAMPLE_ENTRY.dir,
  manifestPath: SAMPLE_ENTRY.manifestPath,
};
const VALIDATE_RESPONSE: SessionPlanSetValidateResponse = {
  ok: true,
  diagnostics: [],
  summary: SAMPLE_SUMMARY,
};

// ---------------------------------------------------------------------------
// Test HTTP server
// ---------------------------------------------------------------------------

interface TestServer {
  server: Server;
  port: number;
  requests: string[];
}

function startTestServer(): Promise<TestServer> {
  return new Promise((resolve, reject) => {
    const state: TestServer = { server: null as unknown as Server, port: 0, requests: [] };

    const server = createServer((req, res) => {
      const url = req.url ?? '/';
      state.requests.push(url);
      const pathname = new URL(url, 'http://localhost').pathname;

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
      if (pathname === API_ROUTES.sessionPlanSetList) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(LIST_RESPONSE));
        return;
      }
      if (pathname === API_ROUTES.sessionPlanSetShow) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(SHOW_RESPONSE));
        return;
      }
      if (pathname === API_ROUTES.sessionPlanSetValidate) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(VALIDATE_RESPONSE));
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
    state.server.close((err) => (err ? reject(err) : resolve()));
  });
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let tmpDir: string;
let testServer: TestServer;

beforeEach(async () => {
  clearApiVersionCache();
  tmpDir = await mkdtemp(join(tmpdir(), 'eforge-plan-set-client-'));
  testServer = await startTestServer();
});

afterEach(async () => {
  await stopTestServer(testServer);
  await rm(tmpDir, { recursive: true, force: true });
  clearApiVersionCache();
});

function writeLiveLockfile(): void {
  writeLockfile(tmpDir, {
    pid: process.pid,
    port: testServer.port,
    startedAt: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('session plan-set client helpers — URL construction', () => {
  it('list without includeSubmitted requests the bare list route', async () => {
    writeLiveLockfile();
    const result = await apiSessionPlanSetList({ cwd: tmpDir });
    expect(result.data.planSets[0].id).toBe('add-search');
    expect(testServer.requests).toContain(API_ROUTES.sessionPlanSetList);
  });

  it('list with includeSubmitted appends includeSubmitted=true', async () => {
    writeLiveLockfile();
    await apiSessionPlanSetList({ cwd: tmpDir, includeSubmitted: true });
    expect(testServer.requests).toContain(`${API_ROUTES.sessionPlanSetList}?includeSubmitted=true`);
  });

  it('show requests the show route with an encoded planSetId', async () => {
    writeLiveLockfile();
    const result = await apiSessionPlanSetShow({ cwd: tmpDir, planSetId: 'add-search' });
    expect(result.data.dir).toBe(SAMPLE_ENTRY.dir);
    expect(testServer.requests).toContain(`${API_ROUTES.sessionPlanSetShow}?planSetId=add-search`);
  });

  it('validate requests the validate route with an encoded planSetId', async () => {
    writeLiveLockfile();
    const result = await apiSessionPlanSetValidate({ cwd: tmpDir, planSetId: 'add-search' });
    expect(result.data.ok).toBe(true);
    expect(testServer.requests).toContain(`${API_ROUTES.sessionPlanSetValidate}?planSetId=add-search`);
  });
});

describe('session plan-set client helpers — passive variants', () => {
  it('all three *IfRunning helpers return null with no daemon lockfile', async () => {
    expect(await apiSessionPlanSetListIfRunning({ cwd: tmpDir })).toBeNull();
    expect(await apiSessionPlanSetShowIfRunning({ cwd: tmpDir, planSetId: 'add-search' })).toBeNull();
    expect(await apiSessionPlanSetValidateIfRunning({ cwd: tmpDir, planSetId: 'add-search' })).toBeNull();
  });

  it('*IfRunning helpers resolve to the daemon envelope when live', async () => {
    writeLiveLockfile();
    const list = await apiSessionPlanSetListIfRunning({ cwd: tmpDir });
    expect(list?.port).toBe(testServer.port);
    expect(list?.data.planSets[0].id).toBe('add-search');
  });
});

describe('session plan-set client helpers — exports', () => {
  it('exposes all six helpers as functions', () => {
    for (const fn of [
      apiSessionPlanSetList,
      apiSessionPlanSetListIfRunning,
      apiSessionPlanSetShow,
      apiSessionPlanSetShowIfRunning,
      apiSessionPlanSetValidate,
      apiSessionPlanSetValidateIfRunning,
    ]) {
      expect(fn).toEqual(expect.any(Function));
    }
  });
});
