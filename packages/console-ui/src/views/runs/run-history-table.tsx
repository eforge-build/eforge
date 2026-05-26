// --- eforge:region runs-build-entrypoints ---
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/common/empty-state';
import type { RunGroupViewModel } from '@/lib/selectors/runs';
import { StatusPill } from './status-pill';
import { formatAbsolute, formatDuration } from './time-format';

interface RunHistoryTableProps {
  groups: RunGroupViewModel[];
  selectedId: string | null;
  onSelect: (detailId: string) => void;
}

/** Compact bordered list for historical run groups. */
export function RunHistoryTable({ groups, selectedId, onSelect }: RunHistoryTableProps) {
  if (groups.length === 0) {
    return (
      <EmptyState
        title="No historical runs"
        description="Completed runs will appear here."
      />
    );
  }

  return (
    <div className="space-y-1">
      {groups.map((group) => (
        <RunHistoryRow
          key={group.key}
          group={group}
          isSelected={selectedId === group.detailId}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

interface RunHistoryRowProps {
  group: RunGroupViewModel;
  isSelected: boolean;
  onSelect: (detailId: string) => void;
}

function RunHistoryRow({ group, isSelected, onSelect }: RunHistoryRowProps) {
  return (
    <div
      className={`border rounded p-2 text-xs flex flex-col gap-1${isSelected ? ' border-primary bg-accent' : ''}`}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <StatusPill status={group.status} />
        <span className="font-mono font-semibold truncate max-w-xs">{group.label}</span>
        {group.commands.map((cmd) => (
          <span
            key={cmd}
            className="bg-secondary text-secondary-foreground rounded px-1 py-0.5"
          >
            {cmd}
          </span>
        ))}
        {group.planCountLabel && (
          <span className="text-muted-foreground">{group.planCountLabel}</span>
        )}
        {group.profileLabel && (
          <span className="text-muted-foreground">profile:{group.profileLabel}</span>
        )}
      </div>
      <div className="flex items-center gap-3 text-muted-foreground flex-wrap">
        {group.startedAt && (
          <span>started: {formatAbsolute(group.startedAt)}</span>
        )}
        {group.completedAt && (
          <span>completed: {formatAbsolute(group.completedAt)}</span>
        )}
        {group.durationSeconds != null && (
          <span>duration: {formatDuration(group.durationSeconds)}</span>
        )}
        {group.cwd && (
          <span className="font-mono truncate max-w-xs">{group.cwd}</span>
        )}
        {group.sessionId && (
          <span className="font-mono text-xs">session:{group.sessionId}</span>
        )}
      </div>
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => onSelect(group.detailId)}>
          Inspect run
        </Button>
      </div>
    </div>
  );
}
// --- eforge:endregion runs-build-entrypoints ---
