/**
 * ActivityEventRow — single event row in the Activity/Audit view.
 *
 * Renders:
 *  - Timestamp and relative age
 *  - Colored family dot (aria-label includes the family name)
 *  - Event type and one-line summary
 *  - Identifier chips (session, plan, run, prd, etc.)
 *
 * Clicking the row notifies the parent to open the raw event panel.
 * The inline raw JSON <details> panel has been removed; JSON is now
 * shown in the RawEventPanel slide-over.
 */
import * as React from 'react';
import { cn } from '@/lib/utils';
import type { ActivityEventRowModel, ActivityFamily } from './selectors';

// ---------------------------------------------------------------------------
// Family dot colour mapping (CSS variables from globals.css)
// ---------------------------------------------------------------------------

function familyDotStyle(family: Exclude<ActivityFamily, 'all'>): React.CSSProperties {
  return { backgroundColor: `var(--color-event-family-${family})` };
}

interface ActivityEventRowProps {
  row: ActivityEventRowModel;
  isSelected: boolean;
  onSelect: (id: string) => void;
}

export function ActivityEventRow({ row, isSelected, onSelect }: ActivityEventRowProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      onClick={() => onSelect(row.id)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect(row.id); }}
      className={cn(
        'group flex flex-col gap-1 rounded-md border border-border p-2.5 text-xs transition-colors',
        'cursor-pointer hover:bg-muted/40 focus:outline-none focus:ring-1 focus:ring-ring',
        row.attention && 'border-l-2 border-l-destructive',
        isSelected && 'bg-muted/60 ring-1 ring-ring',
      )}
    >
      {/* Top row: timestamp, family dot, type, summary */}
      <div className="flex flex-wrap items-center gap-2 min-w-0">
        <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
          {row.timestampLabel}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          ({row.receivedLabel})
        </span>

        {/* Colored family dot */}
        <span
          className="shrink-0 inline-block h-2 w-2 rounded-full"
          style={familyDotStyle(row.family)}
          aria-label={`family: ${row.family}`}
          role="img"
        />

        <code className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
          {row.eventType}
        </code>

        <span className="min-w-0 truncate text-xs text-foreground">{row.summary}</span>
      </div>

      {/* Identifiers */}
      {row.identifiers.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {row.identifiers.map((id) => (
            <span
              key={id.label}
              className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs"
            >
              <span className="text-muted-foreground">{id.label}:</span>
              <span className="font-mono text-foreground">{id.value}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
