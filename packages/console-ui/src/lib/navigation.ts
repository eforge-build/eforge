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
  | { id: 'workstationDetail'; workstationId: string; subPath?: string };

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
  if (id.id === 'workstationDetail') {
    const base = `/console/workstations/${encodeURIComponent(id.workstationId)}`;
    if (!id.subPath) return base;
    // subPath is the workstation-internal location (path and optional ?query).
    // A leading `?` attaches directly; anything else is a nested path segment.
    return id.subPath.startsWith('?') ? `${base}${id.subPath}` : `${base}/${id.subPath}`;
  }
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
  // Split off hash, then query — the query is preserved for workstation
  // sub-routing (the embedded workstation owns its own filter/group state) but
  // stripped for every other route.
  const withoutHash = pathname.replace(/#.*$/, '');
  const queryIndex = withoutHash.indexOf('?');
  const search = queryIndex >= 0 ? withoutHash.slice(queryIndex) : '';
  const clean = (queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash).replace(/\/$/, '');
  if (clean === '/console' || clean === '') return 'now';
  const parts = clean.split('/').filter(Boolean);
  // parts: ['console', section?, detailId?, ...subPath?]
  const section = parts[1];
  // `runs` is the legacy path for build detail; it still resolves so old links
  // and bookmarks keep working (the shell canonicalizes the URL to `builds`).
  if ((section === 'builds' || section === 'runs') && parts.length >= 3 && parts[2]) {
    return { id: 'buildDetail', detailId: parts[2] };
  }
  if (section === 'workstations') {
    if (parts.length >= 3 && parts[2]) {
      const workstationId = decodeRouteSegment(parts[2]);
      const nested = parts.slice(3).join('/');
      const subPath = nested + search;
      return subPath ? { id: 'workstationDetail', workstationId, subPath } : { id: 'workstationDetail', workstationId };
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
