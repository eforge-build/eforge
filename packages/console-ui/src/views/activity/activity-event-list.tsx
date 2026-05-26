/**
 * ActivityEventList — scrollable event list with filtered-empty and empty states.
 */
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { ActivityEventRow } from './activity-event-row';
import type { ActivityEventRowModel } from '@/lib/selectors/activity';

interface ActivityEventListProps {
  /** Rows that have passed all active filters. */
  rows: ActivityEventRowModel[];
  /** Total rows before any filter is applied. */
  sourceCount: number;
  /** Called when the user clicks the reset-filters button. */
  onResetFilters: () => void;
  /** The id of the currently selected row, or null if none selected. */
  selectedRowId: string | null;
  /** Called when the user clicks a row to select it. */
  onRowSelect: (id: string) => void;
}

export function ActivityEventList({
  rows,
  sourceCount,
  onResetFilters,
  selectedRowId,
  onRowSelect,
}: ActivityEventListProps) {
  if (sourceCount === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-sm text-muted-foreground">
          No daemon activity has been received yet.
        </p>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <p className="text-sm text-muted-foreground">
          No activity matches the current filters.
        </p>
        <Button variant="outline" size="sm" onClick={onResetFilters}>
          Reset filters
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((row) => (
        <ActivityEventRow
          key={row.id}
          row={row}
          isSelected={row.id === selectedRowId}
          onSelect={onRowSelect}
        />
      ))}
    </div>
  );
}
