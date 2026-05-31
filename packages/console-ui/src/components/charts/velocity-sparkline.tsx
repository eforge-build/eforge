/**
 * VelocitySparkline — a tiny filled area sparkline for a single live metric
 * (e.g. cumulative tokens or cost over the build's lifetime). Renders a labeled
 * cell with the current value and a trend line. Degrades to a flat baseline
 * hint until at least two samples have accrued.
 */
import * as React from 'react';
import { Area, AreaChart } from 'recharts';
import { ChartContainer, type ChartConfig } from '@/components/ui/chart';

export interface SparklineSample {
  /** Monotonic sample timestamp (ms). */
  t: number;
  value: number;
}

interface VelocitySparklineProps {
  label: string;
  /** Pre-formatted current value, e.g. "1.4M tok" or "$8.43". */
  display: string;
  samples: SparklineSample[];
  /** CSS color token, e.g. "var(--color-blue)". */
  color: string;
}

export function VelocitySparkline({ label, display, samples, color }: VelocitySparklineProps) {
  const config: ChartConfig = { value: { label, color } };
  const hasTrend = samples.length >= 2;
  const data = hasTrend ? samples : [{ t: 0, value: 0 }, { t: 1, value: 0 }];
  const gradientId = React.useId().replace(/:/g, '');

  return (
    <div className="min-w-0 flex-1 rounded-md border border-border/60 bg-muted/10 px-2 py-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-10px uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className="shrink-0 font-mono text-xs font-medium tabular-nums text-foreground">{display}</span>
      </div>
      <div className="mt-1 h-7">
        <ChartContainer config={config} className="aspect-auto h-full w-full">
          <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={`spark-${gradientId}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.45} />
                <stop offset="100%" stopColor={color} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <Area
              dataKey="value"
              type="monotone"
              stroke={color}
              strokeWidth={1.5}
              fill={`url(#spark-${gradientId})`}
              isAnimationActive={false}
              dot={false}
              activeDot={false}
            />
          </AreaChart>
        </ChartContainer>
      </div>
    </div>
  );
}
