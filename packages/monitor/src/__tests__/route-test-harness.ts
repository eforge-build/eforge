import { createServer, request, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ApiRouteKey, RouteDefinition } from '../http/router.js';
import { createRouter } from '../http/router.js';
import { createMonitorContext, type MonitorContext } from '../context.js';
import { openDatabase, type MonitorDB } from '../db.js';
import type { MonitorStreamHub, StartServerOptions } from '../types.js';
import { createExtensionContentRoutes } from '../routes/extension-content.js';

export interface RouteHarness {
  cwd: string;
  db: MonitorDB;
  context: MonitorContext;
  url: string;
  routes: RouteDefinition[];
  get(path: string, init?: RequestInit): Promise<Response>;
  postJson(path: string, body: unknown, init?: RequestInit): Promise<Response>;
  rawGet(path: string, headers?: Record<string, string>): Promise<{ status: number; body: string }>;
  rawPostJson(path: string, body: unknown, headers?: Record<string, string>): Promise<{ status: number; body: string }>;
  close(): Promise<void>;
}

export async function startContentRouteHarness(options: { cwd?: string; routes?: (context: MonitorContext) => RouteDefinition[]; serverOptions?: StartServerOptions } = {}): Promise<RouteHarness> {
  const cwd = options.cwd ?? await mkdtemp(join(tmpdir(), 'eforge-routes-'));
  const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
  const context = await createMonitorContext(db, 0, { cwd, ...options.serverOptions });
  const streams: MonitorStreamHub = { attachSession() {}, attachDaemon() {}, broadcast() {}, subscriberCount: () => 0, stop() {} };
  const routes = (options.routes ?? createExtensionContentRoutes)(context);
  const router = createRouter({ monitor: context, streams, routes });
  const server = createServer((req, res) => { void router.handle(req, res); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const base = `http://127.0.0.1:${port}`;
  return {
    cwd, db, context, routes, url: base,
    get: (path, init) => fetch(`${base}${path}`, init),
    postJson: (path, body, init) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(init?.headers as Record<string, string> | undefined) }, body: JSON.stringify(body), ...init }),
    rawGet: (path, headers) => rawRequest(port, 'GET', path, undefined, headers),
    rawPostJson: (path, body, headers) => rawRequest(port, 'POST', path, JSON.stringify(body), { 'content-type': 'application/json', ...headers }),
    async close() { await new Promise<void>((resolve) => (server as Server).close(() => resolve())); db.close(); if (!options.cwd) await rm(cwd, { recursive: true, force: true }); },
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

export function routeMethodsByKey(routes: RouteDefinition[]): Map<ApiRouteKey, string> {
  return new Map(routes.map((route) => [route.routeKey, route.method]));
}
