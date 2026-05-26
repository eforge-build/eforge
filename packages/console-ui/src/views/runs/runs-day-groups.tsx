// --- eforge:region plan-04-runs-filters-day-groups-detail-density ---
import * as React from 'react';
import type { DayGroupedRuns } from '@/lib/selectors/runs';
import { RunHistoryTable } from './run-history-table';

interface RunsDayGroupsProps {
  dayGroups: DayGroupedRuns[];
  selectedId: string | null;
  onSelect: (detailId: string) => void;
}

/**
 * Renders history run groups grouped under day section headers:
 * Today, Yesterday, and Older.
 */
export function RunsDayGroups({ dayGroups, selectedId, onSelect }: RunsDayGroupsProps) {
  if (dayGroups.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      {dayGroups.map((dayGroup) => (
        <div key={dayGroup.bucket}>
          <h3 className="text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-wide">
            {dayGroup.bucket}
          </h3>
          <RunHistoryTable
            groups={dayGroup.groups}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        </div>
      ))}
    </div>
  );
}
// --- eforge:endregion plan-04-runs-filters-day-groups-detail-density ---
