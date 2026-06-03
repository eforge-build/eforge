/**
 * MetricsPanel — at-a-glance build health from actual build/resume run history.
 * Enqueue and compile bookkeeping runs are excluded so quick-read visuals match
 * user-visible build outcomes.
 */
import * as React from 'react';
import { Bar, BarChart, Cell, Pie, PieChart, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import type { NowMetricsPanel } from '@/lib/selectors/metrics';
import { formatDuration } from '@/lib/format';

interface MetricsPanelProps {
  model: NowMetricsPanel;
}

const SUCCESS_CONFIG: ChartConfig = {
  landed: { label: 'Landed', color: 'var(--color-green)' },
  failed: { label: 'Failed', color: 'var(--color-red)' },
  other: { label: 'Other', color: 'var(--color-muted-foreground)' },
};

const DURATION_CONFIG: ChartConfig = { durationMin: { label: 'Duration', color: 'var(--color-blue)' } };

function LandRateDonut({ model }: { model: NowMetricsPanel }) {
  const pct = model.landRate != null ? Math.round(model.landRate * 100) : null;
  return (
    <div className="flex items-center gap-3">
      <div className="relative h-[88px] w-[88px] shrink-0">
        <ChartContainer config={SUCCESS_CONFIG} className="aspect-square h-full w-full">
          <PieChart>
            <Pie
              data={model.successSlices}
              dataKey="value"
              nameKey="key"
              innerRadius={28}
              outerRadius={42}
              startAngle={90}
              endAngle={-270}
              strokeWidth={0}
              isAnimationActive={false}
            >
              {model.successSlices.map((slice) => (
                <Cell key={slice.key} fill={slice.color} />
              ))}
            </Pie>
          </PieChart>
        </ChartContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-mono text-base font-semibold leading-none tabular-nums text-foreground">
            {pct != null ? `${pct}%` : '--'}
          </span>
          <span className="mt-0.5 text-10px uppercase tracking-wide text-muted-foreground">land rate</span>
        </div>
      </div>
      <dl className="space-y-1 text-xs">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-[2px]" style={{ backgroundColor: 'var(--color-green)' }} />
          <dt className="text-muted-foreground">Landed</dt>
          <dd className="font-mono font-medium tabular-nums text-foreground">{model.landed}</dd>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-[2px]" style={{ backgroundColor: 'var(--color-red)' }} />
          <dt className="text-muted-foreground">Failed</dt>
          <dd className="font-mono font-medium tabular-nums text-foreground">{model.failed}</dd>
        </div>
      </dl>
    </div>
  );
}

function ThroughputBars({ model }: { model: NowMetricsPanel }) {
  if (model.runBars.length === 0) return null;
  return (
    <div>
      <p className="mb-1 text-10px uppercase tracking-wide text-muted-foreground">
        Recent build durations (oldest → newest)
      </p>
      <ChartContainer config={DURATION_CONFIG} className="aspect-auto h-20 w-full">
        <BarChart data={model.runBars} margin={{ top: 2, right: 0, bottom: 0, left: 0 }} barCategoryGap={2}>
          <XAxis dataKey="id" hide />
          <YAxis hide />
          <ChartTooltip
            cursor={false}
            content={
              <ChartTooltipContent
                formatter={(v, name) => (name === 'durationMin' ? formatDuration(Number(v) * 60_000) : String(v))}
              />
            }
          />
          <Bar dataKey="durationMin" radius={1} isAnimationActive={false}>
            {model.runBars.map((bar) => (
              <Cell key={bar.id} fill={bar.color} />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
    </div>
  );
}

export function MetricsPanel({ model }: MetricsPanelProps) {
  const hasHealthContent = model.hasHealthData || model.runBars.length > 0;
  // No build history yet means nothing to show — the card stays hidden rather
  // than rendering an empty shell.
  if (!hasHealthContent) return null;

  return (
    <Card className="bg-card/50 border-border/60">
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-sm font-semibold text-muted-foreground">Build health</CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-3">
        {model.hasHealthData && <LandRateDonut model={model} />}
        <ThroughputBars model={model} />
      </CardContent>
    </Card>
  );
}
