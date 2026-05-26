// --- eforge:region console-shell ---

/** Identifiers for the top-level Console routes. */
export type ConsoleRouteId = 'now' | 'queue' | 'runs' | 'system' | 'activity';

/** Metadata for a single Console navigation item. */
export interface ConsoleNavItem {
  id: ConsoleRouteId;
  label: string;
  href: string;
}

/** Canonical route ordering for the sidebar. */
export const consoleRouteOrder: ConsoleRouteId[] = [
  'now',
  'queue',
  'runs',
  'system',
  'activity',
];

/** Route labels shown in the sidebar. */
const ROUTE_LABELS: Record<ConsoleRouteId, string> = {
  now: 'Now',
  queue: 'Queue',
  runs: 'Runs',
  system: 'System',
  activity: 'Activity',
};

/** Resolve the path for a Console route. */
export function toConsolePath(id: ConsoleRouteId): string {
  if (id === 'now') return '/console/';
  return `/console/${id}`;
}

/**
 * Parse the current pathname into a ConsoleRouteId.
 * Falls back to 'now' for unrecognized paths.
 */
export function parseConsoleRoute(pathname: string): ConsoleRouteId {
  // Strip query/hash and trailing slash for comparison
  const clean = pathname.replace(/[?#].*$/, '').replace(/\/$/, '');
  if (clean === '/console' || clean === '') return 'now';
  const segment = clean.split('/').pop() ?? '';
  if (segment === 'queue') return 'queue';
  if (segment === 'runs') return 'runs';
  if (segment === 'system') return 'system';
  if (segment === 'activity') return 'activity';
  return 'now';
}

/** Build the full nav item list in route order. */
export function buildNavItems(): ConsoleNavItem[] {
  return consoleRouteOrder.map((id) => ({
    id,
    label: ROUTE_LABELS[id],
    href: toConsolePath(id),
  }));
}

// --- eforge:endregion console-shell ---

// --- eforge:region runs-build-entrypoints ---
/**
 * Concise description for the Runs route, consumed by route headers and
 * any navigation tooltip rendered alongside the sidebar link.
 */
export const RUNS_NAV_DESCRIPTION =
  'Recent build sessions and detail entry points';
// --- eforge:endregion runs-build-entrypoints ---

// --- eforge:region activity-audit-view ---
/** Human-readable description for the Activity route used in placeholder text. */
export const ACTIVITY_ROUTE_DESCRIPTION = 'Live daemon event log and audit details';
// --- eforge:endregion activity-audit-view ---

// --- eforge:region plan-02-queue-view ---
/** Human-readable description for the Queue route used in placeholder text and headers. */
export const QUEUE_ROUTE_DESCRIPTION = 'Read-only view of the daemon build queue';
// --- eforge:endregion plan-02-queue-view ---
