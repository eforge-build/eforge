// --- eforge:region plan-04-runs-filters-day-groups-detail-density ---
import * as React from 'react';
import { Button } from '@/components/ui/button';
import type { RunFilterState, RunStatusFilter, RunCommandFilter } from '@/lib/selectors/runs';
import { STATUS_CHIP_OPTIONS, COMMAND_CHIP_OPTIONS } from '@/lib/selectors/runs';

interface RunsFilterBarProps {
  filter: RunFilterState;
  onChange: (filter: RunFilterState) => void;
}

/** Status/command chip filter bar and search input for the Runs history view. */
export function RunsFilterBar({ filter, onChange }: RunsFilterBarProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-xs text-muted-foreground mr-1 shrink-0">Status:</span>
        {STATUS_CHIP_OPTIONS.map((s: RunStatusFilter) => (
          <Button
            key={s}
            variant={filter.status === s ? 'default' : 'outline'}
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => onChange({ ...filter, status: s })}
          >
            {s}
          </Button>
        ))}
      </div>
      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-xs text-muted-foreground mr-1 shrink-0">Command:</span>
        {COMMAND_CHIP_OPTIONS.map((c: RunCommandFilter) => (
          <Button
            key={c}
            variant={filter.command === c ? 'default' : 'outline'}
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => onChange({ ...filter, command: c })}
          >
            {c}
          </Button>
        ))}
      </div>
      <div>
        <input
          type="text"
          aria-label="Search runs"
          placeholder="Search runs..."
          className="w-full border rounded px-2 py-1 text-xs bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          value={filter.search}
          onChange={(e) => onChange({ ...filter, search: e.target.value })}
        />
      </div>
    </div>
  );
}
// --- eforge:endregion plan-04-runs-filters-day-groups-detail-density ---
