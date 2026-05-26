/**
 * ActivityToolbar — filter controls for the Activity/Audit view.
 *
 * Renders:
 *  - Family count chips (all, daemon, scheduler, queue, session, agent, extension, stack, other)
 *  - Attention-only toggle
 *  - Event type text search
 *  - Identifier text search
 */
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ActivityFamily, ActivityFilterState, ActivityGroupCounts } from '@/lib/selectors/activity';

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

  const handleAttentionToggle = (e: React.ChangeEvent<HTMLInputElement>) => {
    onFiltersChange({ ...filters, attentionOnly: e.target.checked });
  };

  const handleTypeQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onFiltersChange({ ...filters, typeQuery: e.target.value });
  };

  const handleIdentifierQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onFiltersChange({ ...filters, identifierQuery: e.target.value });
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
                  'rounded-full px-1 text-[10px] font-semibold tabular-nums',
                  isActive ? 'bg-primary-foreground/20 text-primary-foreground' : 'text-muted-foreground',
                )}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Filter controls */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Attention only toggle */}
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            checked={filters.attentionOnly}
            onChange={handleAttentionToggle}
            className="h-3.5 w-3.5 rounded border-border accent-primary cursor-pointer"
            aria-label="Attention only"
          />
          Attention only
        </label>

        {/* Event type search */}
        <input
          type="text"
          value={filters.typeQuery}
          onChange={handleTypeQueryChange}
          placeholder="Search event type…"
          className={cn(
            'h-7 min-w-[140px] flex-1 rounded-md border border-input bg-background px-2.5 py-1',
            'text-xs text-foreground placeholder:text-muted-foreground',
            'focus:outline-none focus:ring-1 focus:ring-ring',
          )}
          aria-label="Search event type"
        />

        {/* Identifier search */}
        <input
          type="text"
          value={filters.identifierQuery}
          onChange={handleIdentifierQueryChange}
          placeholder="Search session, plan, run…"
          className={cn(
            'h-7 min-w-[160px] flex-1 rounded-md border border-input bg-background px-2.5 py-1',
            'text-xs text-foreground placeholder:text-muted-foreground',
            'focus:outline-none focus:ring-1 focus:ring-ring',
          )}
          aria-label="Search identifiers"
        />
      </div>
    </div>
  );
}
