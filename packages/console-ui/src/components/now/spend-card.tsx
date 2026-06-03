/**
 * SpendCard — at-a-glance token + dollar spend. Today's dollars lead, with a
 * supporting line of tokens and cache hit rate, a per-day cost sparkline, and
 * the window total. Mirrors the Build health card's "big number + detail"
 * rhythm. Hidden until there is spend to show.
 *
 * Window note: the daemon retains the most recent N sessions (default 100), so
 * the sparkline reflects whatever days that history spans, not a guaranteed
 * full calendar window.
 */
import * as React from 'react';
import { Bar, BarChart, Cell, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import type { NowSpendPanel } from '@/lib/selectors/spend';
import { compactTokens, formatUsd } from '@/lib/format';

interface SpendCardProps {
  model: NowSpendPanel;
}

const SPEND_CONFIG: ChartConfig = { costUsd: { label: 'Spend', color: 'var(--color-blue)' } };

function SpendBars({ model }: { model: NowSpendPanel }) {
  if (model.bars.length === 0) return null;
  return (
    <div>
      <p className="mb-1 text-10px uppercase tracking-wide text-muted-foreground">
        Daily spend (last {model.windowDays}d)
      </p>
      <ChartContainer config={SPEND_CONFIG} className="aspect-auto h-16 w-full">
        <BarChart data={model.bars} margin={{ top: 2, right: 0, bottom: 0, left: 0 }} barCategoryGap={2}>
          <XAxis dataKey="date" hide />
          <YAxis hide />
          <ChartTooltip
            cursor={false}
            content={<ChartTooltipContent formatter={(v) => formatUsd(Number(v))} />}
          />
          <Bar dataKey="costUsd" radius={1} isAnimationActive={false}>
            {model.bars.map((bar) => (
              <Cell
                key={bar.date}
                fill={bar.isToday ? 'var(--color-blue)' : 'var(--color-muted-foreground)'}
              />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
    </div>
  );
}

export function SpendCard({ model }: SpendCardProps) {
  if (!model.hasData) return null;

  return (
    <Card className="bg-card/50 border-border/60">
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-sm font-semibold text-muted-foreground">Spend</CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-3">
        <div>
          <p className="text-10px uppercase tracking-wide text-muted-foreground">today</p>
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-2xl font-semibold leading-none tabular-nums text-foreground">
              {formatUsd(model.todayCostUsd)}
            </span>
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {compactTokens(model.todayTokens)} tok
            </span>
            {model.todayCachePct != null && (
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {Math.round(model.todayCachePct)}% cache
              </span>
            )}
          </div>
        </div>
        <SpendBars model={model} />
        <p className="text-xs text-muted-foreground">
          <span className="font-mono font-medium tabular-nums text-foreground">
            {formatUsd(model.windowCostUsd)}
          </span>{' '}
          over last {model.windowDays} days
        </p>
      </CardContent>
    </Card>
  );
}
