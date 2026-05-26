import * as React from 'react';
import type { QueueSummary } from '@/lib/selectors/queue';

interface SummaryCardProps {
  label: string;
  value: number;
}

function SummaryCard({ label, value }: SummaryCardProps) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md border bg-card px-3 py-2 text-card-foreground shadow-sm">
      <span className="text-lg font-bold leading-none tabular-nums">{value}</span>
      <span className="text-xs text-muted-foreground uppercase tracking-wide">{label}</span>
    </div>
  );
}

interface QueueSummaryCardsProps {
  summary: QueueSummary;
}

/**
 * Summary count cards: total, running, pending, and failed.
 */
export function QueueSummaryCards({ summary }: QueueSummaryCardsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      <SummaryCard label="Total" value={summary.total} />
      <SummaryCard label="Running" value={summary.running} />
      <SummaryCard label="Pending" value={summary.pending} />
      <SummaryCard label="Failed" value={summary.failed} />
    </div>
  );
}
