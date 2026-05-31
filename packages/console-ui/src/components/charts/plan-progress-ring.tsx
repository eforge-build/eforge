/**
 * PlanProgressRing — compact donut summarizing plan build outcomes
 * (complete / running / pending / failed) for one active build. The center
 * shows complete/total; an accessible label spells out the breakdown.
 */
import * as React from 'react';
import { Pie, PieChart, Cell } from 'recharts';
import { ChartContainer, type ChartConfig } from '@/components/ui/chart';

export interface PlanProgressCounts {
  total: number;
  complete: number;
  running: number;
  pending: number;
  failed: number;
}

const SEGMENTS: Array<{ key: keyof Omit<PlanProgressCounts, 'total'>; label: string; color: string }> = [
  { key: 'complete', label: 'Complete', color: 'var(--color-green)' },
  { key: 'running', label: 'Running', color: 'var(--color-blue)' },
  { key: 'pending', label: 'Pending', color: 'var(--color-muted-foreground)' },
  { key: 'failed', label: 'Failed', color: 'var(--color-red)' },
];

const CHART_CONFIG: ChartConfig = Object.fromEntries(
  SEGMENTS.map((s) => [s.key, { label: s.label, color: s.color }]),
);

interface PlanProgressRingProps {
  counts: PlanProgressCounts;
  size?: number;
}

export function PlanProgressRing({ counts, size = 72 }: PlanProgressRingProps) {
  const data = SEGMENTS.map((seg) => ({ key: seg.key, value: Math.max(0, counts[seg.key]), color: seg.color })).filter(
    (d) => d.value > 0,
  );

  const accessibleLabel = `Plans: ${counts.complete} complete, ${counts.running} running, ${counts.pending} pending, ${counts.failed} failed of ${counts.total}`;

  // Nothing to plot yet — show a neutral ring so the slot does not collapse.
  const hasData = data.length > 0;
  const ringInner = Math.round(size * 0.34);
  const ringOuter = Math.round(size * 0.48);

  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      role="img"
      aria-label={accessibleLabel}
      title={accessibleLabel}
    >
      <ChartContainer config={CHART_CONFIG} className="aspect-square h-full w-full">
        <PieChart>
          <Pie
            data={hasData ? data : [{ key: 'empty', value: 1, color: 'var(--color-bg-tertiary)' }]}
            dataKey="value"
            nameKey="key"
            innerRadius={ringInner}
            outerRadius={ringOuter}
            startAngle={90}
            endAngle={-270}
            strokeWidth={0}
            isAnimationActive={false}
          >
            {(hasData ? data : [{ key: 'empty', value: 1, color: 'var(--color-bg-tertiary)' }]).map((entry) => (
              <Cell key={entry.key} fill={entry.color} />
            ))}
          </Pie>
        </PieChart>
      </ChartContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-mono text-sm font-semibold leading-none tabular-nums text-foreground">
          {counts.complete}
          <span className="text-muted-foreground">/{counts.total}</span>
        </span>
        <span className="mt-0.5 text-10px uppercase tracking-wide text-muted-foreground">plans</span>
      </div>
    </div>
  );
}
