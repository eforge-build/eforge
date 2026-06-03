/**
 * ActivityToolbar — filter controls for the Activity/Audit view.
 *
 * Renders:
 *  - Family count chips (all, daemon, scheduler, queue, session, agent, extension, stack, other)
 *  - Single search input (searches event type and identifiers)
 */
import * as React from 'react';
import { cn } from '@/lib/utils';
import type { ActivityFamily, ActivityFilterState, ActivityGroupCounts } from './selectors';

const FAMILY_LABELS: Array<{ family: ActivityFamily; label: string }> = [
  { family: 'all', label: 'All' },
  { family: 'daemon', label: 'Daemon' },
  { family: 'scheduler', label: 'Scheduler' },
  { family: 'queue', label: 'Queue' },
  { family: 'session', label: 'Session' },
  { family: 'agent', label: 'Agent' },
  { family: 'extension', label: 'Extension' },
  { family: 'stack', label: 'Stack' },
  { family: 'other', label: 'Other' },
];

interface ActivityToolbarProps {
  filters: ActivityFilterState;
  groupCounts: ActivityGroupCounts;
  onFiltersChange: (filters: ActivityFilterState) => void;
}

export function ActivityToolbar({ filters, groupCounts, onFiltersChange }: ActivityToolbarProps) {
  const handleFamilyClick = (family: ActivityFamily) => {
    onFiltersChange({ ...filters, family });
  };

  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onFiltersChange({ ...filters, query: e.target.value });
  };

  return (
    <div className="flex flex-col gap-2 pb-3 border-b border-border">
      {/* Family chips */}
      <div className="flex flex-wrap gap-1">
        {FAMILY_LABELS.map(({ family, label }) => {
          const count = groupCounts[family];
          const isActive = filters.family === family;
          return (
            <button
              key={family}
              onClick={() => handleFamilyClick(family)}
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors cursor-pointer',
                'border focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1',
                isActive
                  ? 'bg-primary text-primary-foreground border-transparent'
                  : 'bg-background text-muted-foreground border-border hover:bg-muted hover:text-foreground',
              )}
              aria-pressed={isActive}
            >
              {label}
              <span
                className={cn(
                  'rounded-full px-1 text-xs font-semibold tabular-nums',
                  isActive ? 'bg-primary-foreground/20 text-primary-foreground' : 'text-muted-foreground',
                )}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Search input */}
      <input
        type="text"
        value={filters.query}
        onChange={handleQueryChange}
        placeholder="Search event type or identifier…"
        className={cn(
          'h-7 w-full rounded-md border border-input bg-background px-2.5 py-1',
          'text-xs text-foreground placeholder:text-muted-foreground',
          'focus:outline-none focus:ring-1 focus:ring-ring',
        )}
        aria-label="Search activity"
      />
    </div>
  );
}
