import { X } from 'lucide-react';
import type { StoredEvent } from '@/lib/run-state';
import { EventCard } from './event-card';

interface TimelineProps {
  events: StoredEvent[];
  startTime: number | null;
  showVerbose: boolean;
  /**
   * When set, the log is narrowed to events for this `planId` (a map/reduce atom
   * or reduce node). Set by clicking a node in the orchestration board.
   */
  filterPlanId?: string | null;
  /** Clears the `filterPlanId` narrowing. */
  onClearFilter?: () => void;
}

function eventPlanId(event: StoredEvent['event']): string | undefined {
  return 'planId' in event ? (event as { planId?: string }).planId : undefined;
}

export function Timeline({ events, startTime, showVerbose, filterPlanId, onClearFilter }: TimelineProps) {
  const shown = filterPlanId
    ? events.filter((e) => eventPlanId(e.event) === filterPlanId)
    : events;

  return (
    <div className="flex flex-col flex-1">
      {filterPlanId && (
        <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-bg-secondary/80 px-3 py-1.5 text-11px backdrop-blur">
          <span className="text-text-dim">Filtered to</span>
          <span className="font-mono text-text-bright truncate">{filterPlanId}</span>
          <span className="text-text-dim">({shown.length})</span>
          <button
            type="button"
            onClick={onClearFilter}
            className="ml-auto inline-flex items-center gap-1 text-text-dim hover:text-text-bright"
          >
            <X className="w-3 h-3" /> clear
          </button>
        </div>
      )}
      {filterPlanId && shown.length === 0 && (
        <div className="px-3 py-4 text-11px text-text-dim italic">No log events for this node yet.</div>
      )}
      {shown.map((storedEvent, i) => (
        <EventCard
          key={storedEvent.eventId || i}
          event={storedEvent.event}
          startTime={startTime}
          showVerbose={showVerbose}
        />
      ))}
    </div>
  );
}
