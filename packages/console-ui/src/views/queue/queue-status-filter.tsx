import * as React from 'react';
import { cn } from '@/lib/utils';

export type QueueStatusFilter = 'all' | 'running' | 'pending' | 'failed' | 'waiting';

const FILTER_OPTIONS: Array<{ value: QueueStatusFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'running', label: 'Running' },
  { value: 'pending', label: 'Pending' },
  { value: 'waiting', label: 'Waiting' },
  { value: 'failed', label: 'Failed' },
];

interface QueueStatusFilterProps {
  activeFilter: QueueStatusFilter;
  onFilterChange: (filter: QueueStatusFilter) => void;
}

/**
 * Local status filter buttons for the Queue view. Uses aria-pressed for
 * accessible toggle state.
 */
export function QueueStatusFilterBar({ activeFilter, onFilterChange }: QueueStatusFilterProps) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by status">
      {FILTER_OPTIONS.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          aria-pressed={activeFilter === value}
          onClick={() => onFilterChange(value)}
          className={cn(
            'rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors',
            activeFilter === value
              ? 'border-foreground bg-foreground text-background'
              : 'border-muted-foreground/30 text-muted-foreground hover:border-foreground/50 hover:text-foreground',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
