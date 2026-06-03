/**
 * RunHistoryCard — inline-expanding run history with filter bar.
 *
 * Default state: top 4 rows (status badge + label + timestamp + duration).
 * Expanded state: a filter bar (status, command, search) plus a scrollable
 * list of all runs. Each row is clickable and navigates to the run detail.
 */
import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { NowRecentRunItem } from '@/lib/selectors/now';
import { formatDuration, formatTimestamp } from '@/lib/format';
import { cn } from '@/lib/utils';
import { toConsolePath } from '@/lib/navigation';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_ROW_COUNT = 4;
const COMPACT_ROW_COUNT = 6;

type StatusFilter = 'all' | 'running' | 'failed' | 'completed';
type CommandFilter = 'all' | string;

interface FilterState {
  status: StatusFilter;
  command: CommandFilter;
  search: string;
}

const DEFAULT_FILTERS: FilterState = { status: 'all', command: 'all', search: '' };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function runBadgeVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  const s = status.toLowerCase();
  if (s === 'failed' || s === 'failure' || s === 'error') return 'destructive';
  if (s === 'completed' || s === 'complete' || s === 'success' || s === 'succeeded') return 'secondary';
  return 'default';
}

function matchesStatusFilter(status: string, filter: StatusFilter): boolean {
  if (filter === 'all') return true;
  const s = status.toLowerCase();
  if (filter === 'running') return !s.includes('complete') && !s.includes('fail') && !s.includes('success') && !s.includes('succeed') && !s.includes('error');
  if (filter === 'failed') return s.includes('fail') || s.includes('error');
  if (filter === 'completed') return s.includes('complete') || s.includes('success') || s.includes('succeed');
  return true;
}

function filterRuns(runs: NowRecentRunItem[], filters: FilterState): NowRecentRunItem[] {
  return runs.filter((run) => {
    if (!matchesStatusFilter(run.status, filters.status)) return false;
    if (filters.command !== 'all' && run.command !== filters.command) return false;
    if (filters.search) {
      const q = filters.search.toLowerCase();
      if (!run.planSet.toLowerCase().includes(q) && !run.command.toLowerCase().includes(q)) {
        return false;
      }
    }
    return true;
  });
}

function uniqueCommands(runs: NowRecentRunItem[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const run of runs) {
    if (!seen.has(run.command)) {
      seen.add(run.command);
      result.push(run.command);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// RunRow
// ---------------------------------------------------------------------------

interface RunRowProps {
  run: NowRecentRunItem;
  onNavigate?: (href: string) => void;
}

function RunRow({ run, onNavigate }: RunRowProps) {
  const href = toConsolePath({ id: 'runDetail', detailId: run.sessionId ?? run.id });
  const handleClick = () => onNavigate?.(href);
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') handleClick();
  };

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
      data-detail-id={run.sessionId ?? run.id}
    >
      <Badge
        variant={runBadgeVariant(run.status)}
        className="shrink-0 capitalize text-xs mt-0.5"
      >
        {run.status}
      </Badge>
      <div className="min-w-0 flex-1">
        <p className="text-foreground truncate">{run.planSet}</p>
        <p className="text-muted-foreground truncate">{run.command}</p>
      </div>
      <div className="shrink-0 text-right text-muted-foreground space-y-0.5">
        {run.durationMs != null && <p>{formatDuration(run.durationMs)}</p>}
        <p className="font-mono">{formatTimestamp(run.startedAt)}</p>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// FilterBar
// ---------------------------------------------------------------------------

interface FilterBarProps {
  filters: FilterState;
  commands: string[];
  onFiltersChange: (f: FilterState) => void;
  /** Rail mode: show only the status chips (drop command chips + search) so the
   *  bar stays a single row in a ~360px column. */
  compact?: boolean;
}

function FilterBar({ filters, commands, onFiltersChange, compact = false }: FilterBarProps) {
  const STATUS_OPTIONS: StatusFilter[] = ['all', 'running', 'failed', 'completed'];

  return (
    <div className="flex flex-wrap gap-2 py-2 border-b border-border mb-2">
      {/* Status chips */}
      <div className="flex gap-1 flex-wrap" aria-label="Filter by status">
        {STATUS_OPTIONS.map((s) => (
          <button
            key={s}
            onClick={() => onFiltersChange({ ...filters, status: s })}
            className={cn(
              'rounded-full px-2.5 py-0.5 text-xs font-medium border transition-colors cursor-pointer',
              'focus:outline-none focus:ring-1 focus:ring-ring',
              filters.status === s
                ? 'bg-primary text-primary-foreground border-transparent'
                : 'bg-background text-muted-foreground border-border hover:bg-muted',
            )}
            aria-pressed={filters.status === s}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Command chips */}
      {!compact && commands.length > 0 && (
        <div className="flex gap-1 flex-wrap" aria-label="Filter by command">
          <button
            onClick={() => onFiltersChange({ ...filters, command: 'all' })}
            className={cn(
              'rounded-full px-2.5 py-0.5 text-xs font-medium border transition-colors cursor-pointer',
              'focus:outline-none focus:ring-1 focus:ring-ring',
              filters.command === 'all'
                ? 'bg-primary text-primary-foreground border-transparent'
                : 'bg-background text-muted-foreground border-border hover:bg-muted',
            )}
            aria-pressed={filters.command === 'all'}
          >
            all commands
          </button>
          {commands.map((cmd) => (
            <button
              key={cmd}
              onClick={() => onFiltersChange({ ...filters, command: cmd })}
              className={cn(
                'rounded-full px-2.5 py-0.5 text-xs font-medium border transition-colors cursor-pointer',
                'focus:outline-none focus:ring-1 focus:ring-ring',
                filters.command === cmd
                  ? 'bg-primary text-primary-foreground border-transparent'
                  : 'bg-background text-muted-foreground border-border hover:bg-muted',
              )}
              aria-pressed={filters.command === cmd}
            >
              {cmd}
            </button>
          ))}
        </div>
      )}

      {/* Search input */}
      {!compact && (
        <input
          type="text"
          value={filters.search}
          onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
          placeholder="Search runs…"
          aria-label="search"
          className={cn(
            'h-6 min-w-[120px] flex-1 rounded-md border border-input bg-background px-2 py-0.5',
            'text-xs text-foreground placeholder:text-muted-foreground',
            'focus:outline-none focus:ring-1 focus:ring-ring',
          )}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// RunHistoryCard
// ---------------------------------------------------------------------------

interface RunHistoryCardProps {
  runs: NowRecentRunItem[];
  onNavigate?: (href: string) => void;
  /** Rail mode: status-only filter bar and a slightly taller default list so the
   *  card reads well in the narrow sidebar column. */
  compact?: boolean;
}

export function RunHistoryCard({ runs, onNavigate, compact = false }: RunHistoryCardProps) {
  const [expanded, setExpanded] = React.useState(false);
  const [filters, setFilters] = React.useState<FilterState>(DEFAULT_FILTERS);

  const commands = React.useMemo(() => uniqueCommands(runs), [runs]);
  const filteredRuns = React.useMemo(
    () => filterRuns(runs, filters),
    [runs, filters],
  );

  const defaultRowCount = compact ? COMPACT_ROW_COUNT : DEFAULT_ROW_COUNT;
  const visibleRuns = expanded ? filteredRuns : runs.slice(0, defaultRowCount);

  return (
    <Card className="bg-card/50 border-border/60">
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold text-muted-foreground">Run history</CardTitle>
          {runs.length > defaultRowCount && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs text-muted-foreground"
              onClick={() => setExpanded((e) => !e)}
            >
              {expanded ? 'Hide ▲' : 'Show all ▼'}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recent runs</p>
        ) : (
          <>
            {expanded && (
              <FilterBar
                filters={filters}
                commands={commands}
                onFiltersChange={setFilters}
                compact={compact}
              />
            )}
            <ul className={cn('space-y-1', expanded && 'max-h-96 overflow-y-auto')}>
              {visibleRuns.map((run) => (
                <RunRow key={run.id} run={run} onNavigate={onNavigate} />
              ))}
            </ul>
            {!expanded && runs.length > defaultRowCount && (
              <p className="text-xs text-muted-foreground mt-2">
                + {runs.length - defaultRowCount} more — click Show all
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
