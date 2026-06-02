import type { IncomingMessage, ServerResponse } from 'node:http';
import { API_ROUTES } from '@eforge-build/client';
import type { MonitorContext } from '../context.js';
import type { MonitorStreamHub } from '../types.js';
import type { SecurityPolicy } from './security.js';
import { sendJsonError, sendText } from './response.js';
import { isHttpRouteError, MalformedRouteParameterError } from './route-errors.js';

export type HttpMethod = 'GET' | 'POST' | 'DELETE' | 'OPTIONS';
export type ApiRouteKey = keyof typeof API_ROUTES;

export interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  pathname: string;
  params: Record<string, string>;
  query: URLSearchParams;
  monitor: MonitorContext;
  streams: MonitorStreamHub;
}

export interface RouteDefinition<K extends ApiRouteKey = ApiRouteKey> {
  routeKey: K;
  method: HttpMethod;
  pattern: (typeof API_ROUTES)[K];
  security?: SecurityPolicy[];
  handler(ctx: RequestContext): void | Promise<void>;
}

export interface RouteMatch<K extends ApiRouteKey = ApiRouteKey> {
  route: RouteDefinition<K>;
  params: Record<string, string>;
}

export function defineRoute<K extends ApiRouteKey>(
  route: Omit<RouteDefinition<K>, 'pattern'> & { pattern?: (typeof API_ROUTES)[K] },
): RouteDefinition<K> {
  return { ...route, pattern: API_ROUTES[route.routeKey] } as RouteDefinition<K>;
}

export function matchRoute(
  routes: readonly RouteDefinition[],
  method: string | undefined,
  pathname: string,
): RouteMatch | null {
  for (const route of routes) {
    if (route.method !== method) continue;
    const params = matchPattern(route.pattern, pathname);
    if (params) return { route, params };
  }
  return null;
}

export function getRegisteredRouteKeys(routes: readonly RouteDefinition[]): ApiRouteKey[] {
  return routes.map((route) => route.routeKey);
}

export interface RouterOptions {
  monitor: MonitorContext;
  streams: MonitorStreamHub;
  routes: readonly RouteDefinition[];
  serveStatic?: (req: IncomingMessage, res: ServerResponse, pathname: string) => void | Promise<void>;
}

export function createRouter(options: RouterOptions): {
  handle(req: IncomingMessage, res: ServerResponse): Promise<void>;
  getRegisteredRouteKeys(): ApiRouteKey[];
} {
  const apiPrefix = API_ROUTES.keepAlive.slice(0, API_ROUTES.keepAlive.indexOf('/', 1));
  return {
    getRegisteredRouteKeys: () => getRegisteredRouteKeys(options.routes),
    async handle(req, res) {
      const rawUrl = req.url ?? '/';
      let url: URL;
      try {
        url = new URL(rawUrl, `http://${req.headers.host ?? 'localhost'}`);
      } catch {
        sendJsonError(res, 400, 'Malformed request URL');
        return;
      }
      const pathname = rawUrl.split('?')[0] || '/';

      if (req.method === 'OPTIONS' && pathname.startsWith(apiPrefix)) {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        });
        res.end();
        return;
      }

      try {
        const match = matchRoute(options.routes, req.method, pathname);
        if (match) {
          const ctx: RequestContext = {
            req,
            res,
            url,
            pathname,
            params: match.params,
            query: url.searchParams,
            monitor: options.monitor,
            streams: options.streams,
          };
          for (const policy of match.route.security ?? []) {
            if (await policy(ctx)) return;
          }
          await match.route.handler(ctx);
          return;
        }
      } catch (err) {
        if (isHttpRouteError(err)) {
          if (res.headersSent) {
            if (!res.writableEnded) res.destroy();
            return;
          }
          if (err.bodyKind === 'text') {
            sendText(res, err.status, err.message);
          } else {
            sendJsonError(res, err.status, err.message);
          }
          return;
        }
        console.error('Unhandled route error', err instanceof Error ? err.message : String(err));
        if (res.headersSent) {
          if (!res.writableEnded) res.destroy();
        } else if (!res.writableEnded) {
          sendJsonError(res, 500, 'Internal server error');
        }
        return;
      }

      if (isApiPath(pathname, apiPrefix)) {
        sendJsonError(res, 404, `Unknown route: ${req.method ?? 'GET'} ${pathname}`);
        return;
      }

      if (options.serveStatic) {
        await options.serveStatic(req, res, pathname);
      }
      if (!res.writableEnded) {
        sendText(res, 404, 'Not found');
      }
    },
  };
}

function isApiPath(pathname: string, apiPrefix: string): boolean {
  return pathname === apiPrefix || pathname.startsWith(`${apiPrefix}/`);
}

function matchPattern(pattern: string, pathname: string): Record<string, string> | null {
  const patternParts = splitPath(pattern);
  const pathParts = splitPath(pathname);
  if (patternParts.length !== pathParts.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i += 1) {
    const patternPart = patternParts[i];
    const pathPart = pathParts[i];
    if (!patternPart || !pathPart) return null;
    if (patternPart.startsWith(':')) {
      try {
        params[patternPart.slice(1)] = decodeURIComponent(pathPart);
      } catch {
        throw new MalformedRouteParameterError();
      }
      continue;
    }
    if (patternPart !== pathPart) return null;
  }
  return params;
}

function splitPath(pathname: string): string[] {
  return pathname.split('/').filter(Boolean);
}
