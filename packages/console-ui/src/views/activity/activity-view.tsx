/**
 * ActivityAuditView — top-level route component for /console/activity.
 *
 * Consumes the shared Console project state from the shell; does not open a
 * second daemon SSE stream. All filtering and grouping is client-side.
 *
 * Rendering regions:
 *   1. Header — route title, total count, visible count, last-event timestamp.
 *   2. State panels — connecting, disconnected-error, disconnected-with-data.
 *   3. Toolbar — family chips, attention toggle, text search inputs.
 *   4. Event list — newest-first rows with raw JSON disclosure.
 */
import * as React from 'react';
import { useState } from 'react';
import { ActivityToolbar } from './activity-toolbar';
import { ActivityEventList } from './activity-event-list';
import {
  selectActivityRows,
  filterActivityRows,
  groupActivityRows,
  defaultActivityFilters,
} from '@/lib/selectors/activity';
import type { ActivityFilterState } from '@/lib/selectors/activity';
import type { ConsoleProjectState } from '@/lib/project-state';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ActivityAuditViewProps {
  projectState: Pick<
    ConsoleProjectState,
    'recentActivity' | 'connectionStatus' | 'error' | 'lastSnapshotAt' | 'lastEventAt'
  >;
  /**
   * Wall-clock timestamp used for relative age labels. Defaults to Date.now().
   * Pass a fixed value in tests for deterministic output.
   */
  now?: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ActivityAuditView({ projectState, now }: ActivityAuditViewProps) {
  const [filters, setFilters] = useState<ActivityFilterState>(defaultActivityFilters);

  const effectiveNow = now ?? Date.now();
  const rows = selectActivityRows(projectState.recentActivity, effectiveNow);
  const visibleRows = filterActivityRows(rows, filters);
  const groupCounts = groupActivityRows(rows);

  const { connectionStatus, error, lastSnapshotAt } = projectState;

  const isConnecting = connectionStatus === 'connecting' && lastSnapshotAt === null;
  const isDisconnectedError = connectionStatus === 'disconnected' && !!error && rows.length === 0;
  const isDisconnectedWithData = connectionStatus === 'disconnected' && rows.length > 0;

  const handleResetFilters = () => setFilters(defaultActivityFilters);

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Header */}
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-lg font-semibold text-foreground">Activity</h1>
        <span className="text-xs text-muted-foreground">
          {rows.length} total
        </span>
        {rows.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {visibleRows.length} visible
          </span>
        )}
        <span className="ml-auto text-[10px] text-muted-foreground">
          daemon stream backed
        </span>
      </div>

      {/* Connecting state */}
      {isConnecting && (
        <div className="flex flex-1 flex-col items-center justify-center py-16 text-center">
          <p className="text-sm text-muted-foreground">
            Connecting to daemon activity stream…
          </p>
        </div>
      )}

      {/* Disconnected error state (no existing rows) */}
      {!isConnecting && isDisconnectedError && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-center">
          <p className="text-sm font-medium text-destructive">
            Daemon activity unavailable
          </p>
          <p className="text-xs text-muted-foreground max-w-sm">{error}</p>
        </div>
      )}

      {/* Normal content area */}
      {!isConnecting && !isDisconnectedError && (
        <>
          {/* Disconnected-with-data banner */}
          {isDisconnectedWithData && (
            <div className="rounded-md border border-yellow/50 bg-yellow/10 px-3 py-2 text-xs text-yellow">
              Stream disconnected; showing last received activity.
            </div>
          )}

          {/* Toolbar (only shown when there is source data) */}
          {rows.length > 0 && (
            <ActivityToolbar
              filters={filters}
              groupCounts={groupCounts}
              onFiltersChange={setFilters}
            />
          )}

          {/* Event list */}
          <div className="flex-1 overflow-auto">
            <ActivityEventList
              rows={visibleRows}
              sourceCount={rows.length}
              onResetFilters={handleResetFilters}
            />
          </div>
        </>
      )}
    </div>
  );
}
