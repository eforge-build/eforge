// --- eforge:region console-shell ---

/** Base string ID for each top-level Console route (without parameters). */
export type ConsoleRouteBaseId = 'now' | 'runDetail' | 'system';

/**
 * Full route identifier — either a simple string for top-level routes
 * or a parameterised object for the run detail route.
 */
export type ConsoleRouteId = 'now' | 'system' | { id: 'runDetail'; detailId: string };

/** Metadata for a single Console navigation item. */
export interface ConsoleNavItem {
  id: ConsoleRouteBaseId;
  label: string;
  href: string;
}

/** Canonical route ordering by base ID. */
export const consoleRouteOrder: ConsoleRouteBaseId[] = ['now', 'runDetail', 'system'];

/** Route labels for all base route IDs. */
const ROUTE_LABELS: Record<ConsoleRouteBaseId, string> = {
  now: 'Now',
  runDetail: 'Build Detail',
  system: 'System',
};

/** Resolve the path for a Console route. */
export function toConsolePath(id: ConsoleRouteId): string {
  if (id === 'now') return '/console/';
  if (id === 'system') return '/console/system';
  return `/console/runs/${id.detailId}`;
}

/**
 * Parse the current pathname into a ConsoleRouteId.
 *
 * - `/console/runs/:detailId` → `{ id: 'runDetail', detailId }`
 * - `/console/system`        → `'system'`
 * - Deleted routes and unrecognized paths → `'now'`
 */
export function parseConsoleRoute(pathname: string): ConsoleRouteId {
  const clean = pathname.replace(/[?#].*$/, '').replace(/\/$/, '');
  if (clean === '/console' || clean === '') return 'now';
  const parts = clean.split('/').filter(Boolean);
  // parts: ['console', section?, detailId?]
  const section = parts[1];
  if (section === 'runs' && parts.length >= 3 && parts[2]) {
    return { id: 'runDetail', detailId: parts[2] };
  }
  if (section === 'system') return 'system';
  // queue, runs (no detail), activity all redirect to now
  return 'now';
}

/** Build the nav item list for directly-navigable top-level routes. */
export function buildNavItems(): ConsoleNavItem[] {
  const navRouteIds: ConsoleRouteBaseId[] = ['now', 'system'];
  return navRouteIds.map((id) => ({
    id,
    label: ROUTE_LABELS[id],
    href: id === 'now' ? '/console/' : `/console/${id}`,
  }));
}

// --- eforge:endregion console-shell ---
