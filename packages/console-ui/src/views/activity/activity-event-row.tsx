/**
 * ActivityEventRow — single event row in the Activity/Audit view.
 *
 * Renders:
 *  - Timestamp and relative age
 *  - Family badge and event type
 *  - One-line summary
 *  - Identifier chips (session, plan, run, prd, etc.)
 *  - Source and scope metadata
 *  - Native <details> raw JSON panel for debugging
 */
import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { ActivityEventRowModel, ActivityFamily } from '@/lib/selectors/activity';

// ---------------------------------------------------------------------------
// Family badge colour mapping
// ---------------------------------------------------------------------------

const FAMILY_BADGE_CLASS: Record<Exclude<ActivityFamily, 'all'>, string> = {
  daemon: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  scheduler: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
  queue: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300',
  session: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  agent: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  extension: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
  stack: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300',
  other: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
};

interface ActivityEventRowProps {
  row: ActivityEventRowModel;
}

export function ActivityEventRow({ row }: ActivityEventRowProps) {
  const familyClass = FAMILY_BADGE_CLASS[row.family];

  return (
    <div
      className={cn(
        'group flex flex-col gap-1 rounded-md border border-border p-2.5 text-xs transition-colors',
        'hover:bg-muted/40',
        row.attention && 'border-l-2 border-l-destructive',
      )}
    >
      {/* Top row: timestamp, family, type, summary */}
      <div className="flex flex-wrap items-center gap-2 min-w-0">
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">
          {row.timestampLabel}
        </span>
        <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
          ({row.receivedLabel})
        </span>

        <span
          className={cn(
            'shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold',
            familyClass,
          )}
          aria-label={`family: ${row.family}`}
        >
          {row.family}
        </span>

        <code className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-foreground">
          {row.eventType}
        </code>

        <span className="min-w-0 truncate text-xs text-foreground">{row.summary}</span>
      </div>

      {/* Identifiers and metadata */}
      <div className="flex flex-wrap items-center gap-1.5">
        {row.identifiers.map((id) => (
          <span
            key={id.label}
            className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px]"
          >
            <span className="text-muted-foreground">{id.label}:</span>
            <span className="font-mono text-foreground">{id.value}</span>
          </span>
        ))}

        {row.scope !== 'unknown' && (
          <span className="text-[10px] text-muted-foreground">
            scope: {row.scope}
          </span>
        )}
      </div>

      {/* Raw JSON disclosure */}
      <details className="mt-0.5">
        <summary className="cursor-pointer select-none text-[10px] text-muted-foreground hover:text-foreground">
          Raw event JSON
        </summary>
        <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 text-[10px] leading-relaxed text-foreground">
          {row.rawJson}
        </pre>
      </details>
    </div>
  );
}
