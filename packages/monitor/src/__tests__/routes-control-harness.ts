import { createServer, request, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMonitorContext, type MonitorContext } from '../context.js';
import { openDatabase, type MonitorDB } from '../db.js';
import { createRouter } from '../http/router.js';
import type { MonitorStreamHub, StartServerOptions } from '../types.js';
import { createStreamHub } from '../streams/stream-hub.js';
import { createControlMonitorRoutes } from '../routes/control-monitor.js';
import { createControlMonitorRuntime, type ControlMonitorRuntime } from '../routes/control-runtime.js';

export interface ControlRouteHarness {
  cwd: string;
  db: MonitorDB;
  context: MonitorContext;
  runtime: ControlMonitorRuntime;
  url: string;
  get(path: string, init?: RequestInit): Promise<Response>;
  postJson(path: string, body: unknown, init?: RequestInit): Promise<Response>;
  rawGet(path: string, headers?: Record<string, string>): Promise<{ status: number; body: string }>;
  rawPost(path: string, body?: string, headers?: Record<string, string>): Promise<{ status: number; body: string }>;
  close(): Promise<void>;
}

export async function startControlRouteHarness(options: { cwd?: string; startStreams?: boolean; serverOptions?: StartServerOptions } = {}): Promise<ControlRouteHarness> {
  const cwd = options.cwd ?? await mkdtemp(join(tmpdir(), 'eforge-control-routes-'));
  const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
  const context = await createMonitorContext(db, 0, { cwd, ...options.serverOptions });
  const runtime = createControlMonitorRuntime();
  const inert: MonitorStreamHub = { attachSession() {}, attachDaemon() {}, broadcast() {}, subscriberCount: () => 0, stop() {} };
  const streams = options.startStreams ? createStreamHub(context, { pollIntervalMs: 20, heartbeatIntervalMs: 1000 }) : inert;
  const router = createRouter({ monitor: context, streams, routes: createControlMonitorRoutes(context, runtime) });
  const server = createServer((req, res) => void router.handle(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing port');
  const base = `http://127.0.0.1:${address.port}`;
  return {
    cwd, db, context, runtime, url: base,
    get: (path, init) => fetch(`${base}${path}`, init),
    postJson: (path, body, init) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(init?.headers as Record<string, string> | undefined) }, body: JSON.stringify(body), ...init }),
    rawGet: (path, headers) => rawRequest(address.port, 'GET', path, undefined, headers),
    rawPost: (path, body, headers) => rawRequest(address.port, 'POST', path, body, headers),
    async close() { streams.stop(); await new Promise<void>((resolve) => (server as Server).close(() => resolve())); db.close(); if (!options.cwd) await rm(cwd, { recursive: true, force: true }); },
  };
}

function rawRequest(port: number, method: string, path: string, body?: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
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
