// --- eforge:region console-shell ---

/** Base string ID for each top-level Console route (without parameters). */
export type ConsoleRouteBaseId = 'now' | 'workstations' | 'buildDetail' | 'workstationDetail' | 'system';

/**
 * Full route identifier — either a simple string for top-level routes
 * or a parameterised object for detail routes.
 *
 * Note: `detailId` is a session id. Internally the daemon models a build as a
 * session of phase "runs"; the Console surfaces that session as one "build".
 */
export type ConsoleRouteId =
  | 'now'
  | 'workstations'
  | 'system'
  | { id: 'buildDetail'; detailId: string }
  | { id: 'workstationDetail'; workstationId: string };

/** Metadata for a single Console navigation item. */
export interface ConsoleNavItem {
  id: ConsoleRouteBaseId;
  label: string;
  href: string;
}

/** Canonical route ordering by base ID. */
export const consoleRouteOrder: ConsoleRouteBaseId[] = ['now', 'workstations', 'buildDetail', 'workstationDetail', 'system'];

/** Route labels for all base route IDs. */
const ROUTE_LABELS: Record<ConsoleRouteBaseId, string> = {
  now: 'Now',
  workstations: 'Workstations',
  buildDetail: 'Build Detail',
  workstationDetail: 'Workstation Detail',
  system: 'System',
};

/** Resolve the path for a Console route. */
export function toConsolePath(id: ConsoleRouteId): string {
  if (id === 'now') return '/console/';
  if (id === 'workstations') return '/console/workstations';
  if (id === 'system') return '/console/system';
  if (id.id === 'workstationDetail') return `/console/workstations/${encodeURIComponent(id.workstationId)}`;
  return `/console/builds/${id.detailId}`;
}

/**
 * Parse the current pathname into a ConsoleRouteId.
 *
 * - `/console/builds/:detailId` → `{ id: 'buildDetail', detailId }`
 * - `/console/runs/:detailId`   → `{ id: 'buildDetail', detailId }` (legacy alias)
 * - `/console/workstations`     → `'workstations'`
 * - `/console/workstations/:id` → `{ id: 'workstationDetail', workstationId }`
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
  if (section === 'workstations') {
    if (parts.length >= 3 && parts[2]) {
      return { id: 'workstationDetail', workstationId: decodeRouteSegment(parts[2]) };
    }
    return 'workstations';
  }
  if (section === 'system') return 'system';
  // queue, activity, and a detail-less builds/runs path all redirect to now
  return 'now';
}

/** Build the nav item list for directly-navigable top-level routes. */
export function buildNavItems(): ConsoleNavItem[] {
  const navRouteIds: ConsoleRouteBaseId[] = ['now', 'workstations', 'system'];
  return navRouteIds.map((id) => ({
    id,
    label: ROUTE_LABELS[id],
    href: id === 'now' ? '/console/' : `/console/${id}`,
  }));
}

function decodeRouteSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

// --- eforge:endregion console-shell ---
