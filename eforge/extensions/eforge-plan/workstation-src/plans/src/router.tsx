import * as React from 'react';
import { navigateWorkstation, onWorkstationRoute, readWorkstationBridgeContext } from '@eforge-build/client/browser';

// The workstation owns an internal route (a "wire path": nested path plus an
// optional ?query, no leading slash). How that route is persisted depends on the
// host: embedded in Console it syncs over the postMessage bridge, standalone on
// the Vite dev server it mirrors to the real address bar. Both implement the same
// adapter, exactly as `bridge.ts` abstracts mock vs live action transport.

export interface RouteAdapter {
  initialPath(): string;
  subscribe(callback: (path: string) => void): () => void;
  push(path: string): void;
}

function stripSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, '');
}

function splitPathQuery(raw: string): { path: string; search: string } {
  const index = raw.indexOf('?');
  if (index < 0) return { path: stripSlashes(raw), search: '' };
  return { path: stripSlashes(raw.slice(0, index)), search: raw.slice(index) };
}

function embeddedAdapter(): RouteAdapter {
  return {
    initialPath: () => readWorkstationBridgeContext().initialPath ?? '',
    subscribe: (callback) => onWorkstationRoute(callback),
    push: (path) => navigateWorkstation(path),
  };
}

function standaloneAdapter(): RouteAdapter {
  const locationPath = () => stripSlashes(window.location.pathname) + window.location.search;
  return {
    initialPath: locationPath,
    subscribe: (callback) => {
      const handler = () => callback(locationPath());
      window.addEventListener('popstate', handler);
      return () => window.removeEventListener('popstate', handler);
    },
    push: (path) => window.history.pushState(null, '', `/${path}`),
  };
}

export function getRouteAdapter(): RouteAdapter {
  const context = readWorkstationBridgeContext();
  if (context.bridgeToken && typeof window !== 'undefined' && window.parent !== window) return embeddedAdapter();
  return standaloneAdapter();
}

export interface RouterValue {
  /** Wire path without query, no leading slash (e.g. "backlog", "plans/plan:x"). */
  path: string;
  segments: string[];
  query: URLSearchParams;
  navigate: (to: string) => void;
  setQuery: (updater: (params: URLSearchParams) => void) => void;
}

const RouterContext = React.createContext<RouterValue | null>(null);

export function RouterProvider({ children }: { children: React.ReactNode }) {
  const adapterRef = React.useRef<RouteAdapter | null>(null);
  if (!adapterRef.current) adapterRef.current = getRouteAdapter();
  const adapter = adapterRef.current;
  const [raw, setRaw] = React.useState(() => adapter.initialPath());

  React.useEffect(() => adapter.subscribe((next) => setRaw(next)), [adapter]);

  const navigate = React.useCallback((to: string) => {
    setRaw(to);
    adapter.push(to);
  }, [adapter]);

  const { path, search } = splitPathQuery(raw);
  const query = React.useMemo(() => new URLSearchParams(search), [search]);

  const setQuery = React.useCallback((updater: (params: URLSearchParams) => void) => {
    const next = new URLSearchParams(search);
    updater(next);
    const queryString = next.toString();
    navigate(path + (queryString ? `?${queryString}` : ''));
  }, [navigate, path, search]);

  const value = React.useMemo<RouterValue>(
    () => ({ path, segments: path ? path.split('/') : [], query, navigate, setQuery }),
    [path, query, navigate, setQuery],
  );
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterValue {
  const context = React.useContext(RouterContext);
  if (!context) throw new Error('useRouter must be used within RouterProvider');
  return context;
}
