// --- eforge:region console-shell ---

/** Base string ID for each top-level Console route (without parameters). */
export type ConsoleRouteBaseId = 'now' | 'plans' | 'buildDetail' | 'system';

/**
 * Full route identifier — either a simple string for top-level routes
 * or a parameterised object for the build detail route.
 *
 * Note: `detailId` is a session id. Internally the daemon models a build as a
 * session of phase "runs"; the Console surfaces that session as one "build".
 */
export type ConsoleRouteId = 'now' | 'plans' | 'system' | { id: 'buildDetail'; detailId: string };

/** Metadata for a single Console navigation item. */
export interface ConsoleNavItem {
  id: ConsoleRouteBaseId;
  label: string;
  href: string;
}

/** Canonical route ordering by base ID. */
export const consoleRouteOrder: ConsoleRouteBaseId[] = ['now', 'plans', 'buildDetail', 'system'];

/** Route labels for all base route IDs. */
const ROUTE_LABELS: Record<ConsoleRouteBaseId, string> = {
  now: 'Now',
  plans: 'Plans',
  buildDetail: 'Build Detail',
  system: 'System',
};

/** Resolve the path for a Console route. */
export function toConsolePath(id: ConsoleRouteId): string {
  if (id === 'now') return '/console/';
  if (id === 'plans') return '/console/plans';
  if (id === 'system') return '/console/system';
  return `/console/builds/${id.detailId}`;
}

/**
 * Parse the current pathname into a ConsoleRouteId.
 *
 * - `/console/builds/:detailId` → `{ id: 'buildDetail', detailId }`
 * - `/console/runs/:detailId`   → `{ id: 'buildDetail', detailId }` (legacy alias)
 * - `/console/plans`            → `'plans'`
 * - `/console/system`           → `'system'`
 * - Deleted routes and unrecognized paths → `'now'`
 */
export function parseConsoleRoute(pathname: string): ConsoleRouteId {
  const clean = pathname.replace(/[?#].*$/, '').replace(/\/$/, '');
  if (clean === '/console' || clean === '') return 'now';
  const parts = clean.split('/').filter(Boolean);
  // parts: ['console', section?, detailId?]
  const section = parts[1];
  // `runs` is the legacy path for build detail; it still resolves so old links
  // and bookmarks keep working (the shell canonicalizes the URL to `builds`).
  if ((section === 'builds' || section === 'runs') && parts.length >= 3 && parts[2]) {
    return { id: 'buildDetail', detailId: parts[2] };
  }
  if (section === 'plans') return 'plans';
  if (section === 'system') return 'system';
  // queue, activity, and a detail-less builds/runs path all redirect to now
  return 'now';
}

/** Build the nav item list for directly-navigable top-level routes. */
export function buildNavItems(): ConsoleNavItem[] {
  const navRouteIds: ConsoleRouteBaseId[] = ['now', 'plans', 'system'];
  return navRouteIds.map((id) => ({
    id,
    label: ROUTE_LABELS[id],
    href: id === 'now' ? '/console/' : `/console/${id}`,
  }));
}

// --- eforge:endregion console-shell ---
