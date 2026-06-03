/**
 * Shared build-history primitives used by both the rail preview card
 * (`build-history-card.tsx`) and the full drawer (`build-history-drawer.tsx`):
 * the status/filter helpers, the `BuildRow` line item, and the `FilterBar`.
 *
 * A "build" is a session rolled up from its phase runs (see `NowBuildItem`);
 * the row presents that build as one cohesive unit rather than per-phase rows.
 */
import * as React from 'react';
import type { NowBuildItem } from '@/lib/selectors/now';
import { classifyBuildStatus } from '@/lib/selectors/now';
import { formatDuration, formatTimestamp } from '@/lib/format';
import { cn } from '@/lib/utils';
import { toConsolePath } from '@/lib/navigation';

// ---------------------------------------------------------------------------
// Filter types
// ---------------------------------------------------------------------------

export type StatusFilter = 'all' | 'running' | 'failed' | 'completed';

export interface FilterState {
  status: StatusFilter;
  search: string;
}

export const DEFAULT_FILTERS: FilterState = { status: 'all', search: '' };

// ---------------------------------------------------------------------------
// Status / phase helpers
// ---------------------------------------------------------------------------

/** CSS color token for a build's status dot. Failed reads red, finished builds
 *  read muted (settled), anything still in flight reads green/live. */
export function buildStatusColor(status: string): string {
  switch (classifyBuildStatus(status)) {
    case 'failed': return 'var(--color-red)';
    case 'completed': return 'var(--color-muted-foreground)';
    default: return 'var(--color-green)';
  }
}

export function isLiveStatus(status: string): boolean {
  return classifyBuildStatus(status) === 'running';
}

/** Present-tense phase label for a live build ("compile" → "compiling"). */
function phaseGerund(phase: string): string {
  switch (phase) {
    case 'compile': return 'compiling';
    case 'build': return 'building';
    case 'resume': return 'resuming';
    case 'enqueue': return 'queuing';
    case 'adopt': return 'adopting';
    default: return phase;
  }
}

/**
 * The phase qualifier appended after the status on line 2. Shown when a build is
 * live (where it is now) or failed (where it broke); hidden once completed.
 */
export function phaseSuffix(status: string, phase: string | null): string | null {
  if (!phase) return null;
  switch (classifyBuildStatus(status)) {
    case 'running': return phaseGerund(phase);
    case 'failed': return phase;
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

function matchesStatusFilter(status: string, filter: StatusFilter): boolean {
  if (filter === 'all') return true;
  return classifyBuildStatus(status) === filter;
}

export function filterBuilds(builds: NowBuildItem[], filters: FilterState): NowBuildItem[] {
  return builds.filter((build) => {
    if (!matchesStatusFilter(build.status, filters.status)) return false;
    if (filters.search) {
      const q = filters.search.toLowerCase();
      if (!build.planSet.toLowerCase().includes(q)) return false;
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// BuildRow
// ---------------------------------------------------------------------------

interface BuildRowProps {
  build: NowBuildItem;
  onNavigate?: (href: string) => void;
}

export function BuildRow({ build, onNavigate }: BuildRowProps) {
  const href = toConsolePath({ id: 'buildDetail', detailId: build.sessionId ?? build.id });
  const handleClick = () => onNavigate?.(href);
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') handleClick();
  };

  const suffix = phaseSuffix(build.status, build.phase);

  return (
    <li
      role={onNavigate ? 'button' : undefined}
      tabIndex={onNavigate ? 0 : undefined}
      onClick={onNavigate ? handleClick : undefined}
      onKeyDown={onNavigate ? handleKeyDown : undefined}
      className={cn(
        'flex items-start gap-2 rounded-md px-2 py-1.5 -mx-2 text-xs transition-colors',
        onNavigate && 'cursor-pointer hover:bg-muted/40 focus:outline-none focus:ring-1 focus:ring-ring',
      )}
      data-detail-id={build.sessionId ?? build.id}
    >
      <div className="min-w-0 flex-1">
        <p className="text-foreground truncate">{build.planSet}</p>
        <p className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
          <span
            className={cn(
              'h-1.5 w-1.5 shrink-0 rounded-full',
              isLiveStatus(build.status) && 'animate-pulse',
            )}
            style={{ backgroundColor: buildStatusColor(build.status) }}
            aria-hidden
          />
          <span className="shrink-0 lowercase">{build.status}</span>
          {suffix && (
            <>
              <span aria-hidden className="shrink-0 text-muted-foreground/60">·</span>
              <span className="truncate">{suffix}</span>
            </>
          )}
        </p>
      </div>
      <div className="shrink-0 text-right text-muted-foreground space-y-0.5">
        {build.durationMs != null && <p>{formatDuration(build.durationMs)}</p>}
        <p className="font-mono">{formatTimestamp(build.startedAt)}</p>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// FilterBar
// ---------------------------------------------------------------------------

interface FilterBarProps {
  filters: FilterState;
  onFiltersChange: (f: FilterState) => void;
}

const STATUS_OPTIONS: StatusFilter[] = ['all', 'running', 'failed', 'completed'];

const CHIP_CLASS =
  'rounded-full px-2.5 py-0.5 text-xs font-medium border transition-colors cursor-pointer focus:outline-none focus:ring-1 focus:ring-ring';

function chipClass(active: boolean): string {
  return cn(
    CHIP_CLASS,
    active
      ? 'bg-primary text-primary-foreground border-transparent'
      : 'bg-background text-muted-foreground border-border hover:bg-muted',
  );
}

export function FilterBar({ filters, onFiltersChange }: FilterBarProps) {
  return (
    <div className="flex flex-wrap gap-2 py-2 border-b border-border mb-2">
      <div className="flex gap-1 flex-wrap" aria-label="Filter by status">
        {STATUS_OPTIONS.map((s) => (
          <button
            key={s}
            onClick={() => onFiltersChange({ ...filters, status: s })}
            className={chipClass(filters.status === s)}
            aria-pressed={filters.status === s}
          >
            {s}
          </button>
        ))}
      </div>

      <input
        type="text"
        value={filters.search}
        onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
        placeholder="Search builds…"
        aria-label="search"
        className={cn(
          'h-6 min-w-[120px] flex-1 rounded-md border border-input bg-background px-2 py-0.5',
          'text-xs text-foreground placeholder:text-muted-foreground',
          'focus:outline-none focus:ring-1 focus:ring-ring',
        )}
      />
    </div>
  );
}
