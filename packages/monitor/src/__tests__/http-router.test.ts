import { createServer, request } from 'node:http';
import type { ServerResponse } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_ROUTES } from '@eforge-build/client';
import { openDatabase } from '../db.js';
import { createMonitorContext } from '../context.js';
import type { MonitorStreamHub } from '../types.js';
import { createRouter, defineRoute, getRegisteredRouteKeys, matchRoute } from '../http/router.js';
import { sendJson, sendJsonError } from '../http/response.js';
import { MalformedRouteParameterError } from '../http/route-errors.js';

let closeServer: (() => Promise<void>) | undefined;

afterEach(async () => {
  await closeServer?.();
  closeServer = undefined;
});

const streams: MonitorStreamHub = {
  attachSession() {},
  attachDaemon() {},
  broadcast() {},
  subscriberCount: () => 0,
  stop() {},
};

describe('route matching', () => {
  const routes = [
    defineRoute({ routeKey: 'health', method: 'GET', handler: ({ res }) => sendJson(res, { ok: true }) }),
    defineRoute({ routeKey: 'events', method: 'GET', handler: ({ res }) => sendJson(res, { ok: true }) }),
  ];

  it('matches exact routes with query stripped by callers', () => {
    expect(matchRoute(routes, 'GET', API_ROUTES.health)?.route.routeKey).toBe('health');
  });

  it('decodes parameterized matches once', () => {
    const match = matchRoute(routes, 'GET', '/api/events/run%201');
    expect(match?.params).toEqual({ runId: 'run 1' });
  });

  it('throws MalformedRouteParameterError for malformed percent encoding', () => {
    expect(() => matchRoute(routes, 'GET', '/api/events/%E0%A4%A')).toThrow(MalformedRouteParameterError);
  });

  it('does not match extra path segments', () => {
    expect(matchRoute(routes, 'GET', `${API_ROUTES.health}/extra`)).toBeNull();
  });

  it('returns registered route keys in order', () => {
    expect(getRegisteredRouteKeys(routes)).toEqual(['health', 'events']);
  });
});

describe('router dispatch shell', () => {
  async function hit(path: string, options: RequestInit = {}, handler?: (res: ServerResponse) => void): Promise<Response> {
    const db = openDatabase(':memory:');
    const monitor = await createMonitorContext(db);
    const routeHandler = vi.fn(({ res }) => {
      handler?.(res);
      if (!res.writableEnded) sendJson(res, { handled: true });
    });
    const router = createRouter({
      monitor,
      streams,
      routes: [
        defineRoute({ routeKey: 'health', method: 'GET', handler: routeHandler }),
        defineRoute({ routeKey: 'events', method: 'GET', handler: ({ res, params }) => sendJson(res, params) }),
        defineRoute({
          routeKey: 'enqueue',
          method: 'POST',
          security: [({ res }) => { sendJsonError(res, 403, 'blocked'); return true; }],
          handler: routeHandler,
        }),
      ],
    });
    const server = createServer((req, res) => void router.handle(req, res));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    closeServer = () => new Promise((resolve) => server.close(() => { db.close(); resolve(); }));
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('no address');
    return fetch(`http://127.0.0.1:${addr.port}${path}`, options);
  }

  it('returns 400 for malformed route params', async () => {
    const res = await hit('/api/events/%E0%A4%A');
    expect(res.status).toBe(400);
  });

  it('returns 400 for malformed URL bases', async () => {
    const db = openDatabase(':memory:');
    const monitor = await createMonitorContext(db);
    const routeHandler = vi.fn(({ res }) => sendJson(res, { handled: true }));
    const router = createRouter({
      monitor,
      streams,
      routes: [defineRoute({ routeKey: 'health', method: 'GET', handler: routeHandler })],
    });
    const server = createServer((req, res) => void router.handle(req, res));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    closeServer = () => new Promise((resolve) => server.close(() => { db.close(); resolve(); }));
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('no address');

    const res = await new Promise<{ status: number; body: unknown }>((resolve, reject) => {
      const clientReq = request({ host: '127.0.0.1', port: addr.port, path: API_ROUTES.health, headers: { Host: 'bad host' } }, (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { body += chunk; });
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body: JSON.parse(body) }));
      });
      clientReq.on('error', reject);
      clientReq.end();
    });

    expect(res.status).toBe(400);
    expect(routeHandler).not.toHaveBeenCalled();
  });

  it('falls method mismatches through to unknown API fallback', async () => {
    const res = await hit(API_ROUTES.health, { method: 'POST' });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: `Unknown route: POST ${API_ROUTES.health}` });
  });

  it('handles CORS preflight before route matching', async () => {
    const res = await hit('/api/not-registered', { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-methods')).toBe('GET, POST, OPTIONS');
  });

  it('runs security policies before handlers', async () => {
    const res = await hit(API_ROUTES.enqueue, { method: 'POST' });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'blocked' });
  });
});
