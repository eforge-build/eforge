/**
 * ActivityDrawer — right-side Sheet containing the full activity event list,
 * toolbar, and raw-event panel.
 *
 * Open state syncs to `?activity=open` URL query parameter via replaceState.
 * Pressing Escape closes the drawer and removes the parameter.
 */
import * as React from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { ActivityToolbar } from './activity-drawer/activity-toolbar';
import { ActivityEventList } from './activity-drawer/activity-event-list';
import { RawEventPanel } from './activity-drawer/raw-event-panel';
import {
  selectActivityRows,
  filterActivityRows,
  groupActivityRows,
  defaultActivityFilters,
} from './activity-drawer/selectors';
import type { ActivityFilterState, ActivityEventRowModel } from './activity-drawer/selectors';
import type { ConsoleActivityEntry } from '@/lib/types';

// ---------------------------------------------------------------------------
// URL query-param helpers
// ---------------------------------------------------------------------------

function readActivityParam(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('activity') === 'open';
}

function setActivityParam(open: boolean): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (open) {
    url.searchParams.set('activity', 'open');
  } else {
    url.searchParams.delete('activity');
  }
  window.history.replaceState(null, '', url.toString());
}

// ---------------------------------------------------------------------------
// ActivityDrawer
// ---------------------------------------------------------------------------

interface ActivityDrawerProps {
  open: boolean;
  onClose: () => void;
  activity: ConsoleActivityEntry[];
  now: number;
}

export function ActivityDrawer({ open, onClose, activity, now }: ActivityDrawerProps) {
  const [filters, setFilters] = React.useState<ActivityFilterState>(defaultActivityFilters);
  const [selectedRowId, setSelectedRowId] = React.useState<string | null>(null);
  const [rawPanelOpen, setRawPanelOpen] = React.useState(false);
  const [selectedRow, setSelectedRow] = React.useState<ActivityEventRowModel | null>(null);

  // Sync URL param when open state changes
  React.useEffect(() => {
    setActivityParam(open);
  }, [open]);

  const allRows = React.useMemo(() => selectActivityRows(activity, now), [activity, now]);
  const filteredRows = React.useMemo(() => filterActivityRows(allRows, filters), [allRows, filters]);
  const groupCounts = React.useMemo(() => groupActivityRows(allRows), [allRows]);

  const handleRowSelect = React.useCallback((id: string) => {
    const row = allRows.find((r) => r.id === id) ?? null;
    setSelectedRowId(id);
    setSelectedRow(row);
    setRawPanelOpen(true);
  }, [allRows]);

  const handleResetFilters = React.useCallback(() => {
    setFilters(defaultActivityFilters);
  }, []);

  const handleDrawerClose = React.useCallback(() => {
    onClose();
  }, [onClose]);

  const handleRawPanelClose = React.useCallback(() => {
    setRawPanelOpen(false);
    setSelectedRowId(null);
  }, []);

  return (
    <>
      <Sheet open={open} onOpenChange={(isOpen) => { if (!isOpen) handleDrawerClose(); }}>
        <SheetContent side="right" className="flex flex-col w-full sm:max-w-2xl p-0">
          <SheetHeader className="px-4 pt-4 pb-2 border-b border-border shrink-0">
            <SheetTitle className="text-sm font-semibold">Activity</SheetTitle>
          </SheetHeader>

          <div className="flex-1 overflow-hidden flex flex-col px-4 pt-3">
            <div className="shrink-0">
              <ActivityToolbar
                filters={filters}
                groupCounts={groupCounts}
                onFiltersChange={setFilters}
              />
            </div>
            <div className="flex-1 overflow-y-auto pt-2">
              <ActivityEventList
                rows={filteredRows}
                sourceCount={allRows.length}
                onResetFilters={handleResetFilters}
                selectedRowId={selectedRowId}
                onRowSelect={handleRowSelect}
              />
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <RawEventPanel
        row={selectedRow}
        open={rawPanelOpen}
        onClose={handleRawPanelClose}
      />
    </>
  );
}
