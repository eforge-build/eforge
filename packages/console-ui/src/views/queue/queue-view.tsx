/**
 * QueueView — top-level route component for /console/queue.
 *
 * Consumes the shared Console project state from the shell; does not open a
 * second daemon SSE stream. All filtering and grouping is client-side.
 *
 * Rendering regions:
 *   1. Header — route title, total count, last-snapshot timestamp.
 *   2. Read-only note — boundary note replacing mutation controls.
 *   3. State panels — connecting, disconnected-error, stale-snapshot.
 *   4. Summary cards — count totals.
 *   5. Status filter — local filter buttons.
 *   6. Attention rows — failed items (also appear in their status group).
 *   7. Status groups — all items grouped by status.
 */
import * as React from 'react';
import { useState } from 'react';
import type { ConsoleProjectState } from '@/lib/project-state';
import {
  selectQueueSummary,
  selectQueueStatusGroups,
} from '@/lib/selectors/queue';
import type { QueueStatusFilter } from './queue-status-filter';
import { QueueStatusFilterBar } from './queue-status-filter';
import { QueueSummaryCards } from './queue-summary-cards';
import { QueueStatusGroup } from './queue-status-group';
import {
  QueueConnectingPanel,
  QueueEmptyPanel,
  QueueUnavailablePanel,
  QueueStaleSnapshotBanner,
  QueuePartialDataBanner,
} from './queue-state-panels';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface QueueViewProps {
  projectState: Pick<
    ConsoleProjectState,
    'queue' | 'connectionStatus' | 'lastSnapshotAt' | 'lastEventAt' | 'error'
  >;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function QueueView({ projectState }: QueueViewProps) {
  const [statusFilter, setStatusFilter] = useState<QueueStatusFilter>('all');

  const { queue, connectionStatus, lastSnapshotAt, error } = projectState;

  // Derived state
  const summary = selectQueueSummary(queue);
  const allGroups = selectQueueStatusGroups(queue);

  // Filter groups by active status filter
  const visibleGroups =
    statusFilter === 'all'
      ? allGroups
      : allGroups.filter((g) => g.status === statusFilter);

  // Connection states
  const isConnecting = connectionStatus === 'connecting' && lastSnapshotAt === null;
  const isDisconnectedNoData = connectionStatus === 'disconnected' && lastSnapshotAt === null;
  const isDisconnectedWithData = connectionStatus === 'disconnected' && lastSnapshotAt !== null;
  // Partial-data: connected but first snapshot not yet received — items present may be incomplete
  const isPartialData = connectionStatus === 'connected' && lastSnapshotAt === null;
  const isEmpty = queue.length === 0 && !isConnecting && !isDisconnectedNoData;

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Header */}
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-lg font-semibold text-foreground">Queue</h1>
        {lastSnapshotAt !== null && (
          <span className="text-xs text-muted-foreground">
            {summary.total} {summary.total === 1 ? 'item' : 'items'}
          </span>
        )}
      </div>

      {/* Read-only boundary note */}
      <div className="rounded-md border border-muted-foreground/20 bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground">
        This is a read-only view. Queue operations are not available in the Console.
      </div>

      {/* Connecting state */}
      {isConnecting && <QueueConnectingPanel />}

      {/* Disconnected — no snapshot */}
      {isDisconnectedNoData && <QueueUnavailablePanel error={error} />}

      {/* Normal content area */}
      {!isConnecting && !isDisconnectedNoData && (
        <>
          {/* Stale snapshot banner */}
          {isDisconnectedWithData && lastSnapshotAt !== null && (
            <QueueStaleSnapshotBanner lastSnapshotAt={lastSnapshotAt} />
          )}

          {/* Partial-data banner: connected but snapshot not yet received */}
          {isPartialData && <QueuePartialDataBanner />}

          {/* Empty state */}
          {isEmpty && <QueueEmptyPanel />}

          {/* Populated content */}
          {queue.length > 0 && (
            <>
              {/* Summary cards */}
              <QueueSummaryCards summary={summary} />

              {/* Status filter */}
              <QueueStatusFilterBar
                activeFilter={statusFilter}
                onFilterChange={setStatusFilter}
              />

              {/* Status groups */}
              {visibleGroups.length > 0 && (
                <div className="flex flex-col gap-5">
                  {visibleGroups.map((group) => (
                    <QueueStatusGroup key={group.status} group={group} />
                  ))}
                </div>
              )}

              {/* No items match filter */}
              {visibleGroups.length === 0 && statusFilter !== 'all' && (
                <div className="py-8 text-center">
                  <p className="text-sm text-muted-foreground">
                    No {statusFilter} items in the queue.
                  </p>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
