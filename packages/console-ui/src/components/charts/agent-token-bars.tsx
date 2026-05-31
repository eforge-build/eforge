/**
 * AgentTokenBars — compact horizontal bar chart of token usage per agent for
 * one active build, sourced from the run-state's live per-agent usage. Surfaces
 * which agents are consuming the build's budget.
 */
import * as React from 'react';
import { Bar, BarChart, XAxis, YAxis, Cell } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { compactTokens } from '@/lib/format';

export interface AgentUsageDatum {
  agent: string;
  tokens: number;
}

const BAR_PALETTE = [
  'var(--color-blue)',
  'var(--color-green)',
  'var(--color-event-family-session)',
  'var(--color-event-family-extension)',
  'var(--color-yellow)',
  'var(--color-event-family-agent)',
];

const CONFIG: ChartConfig = { tokens: { label: 'Tokens', color: 'var(--color-blue)' } };

interface AgentTokenBarsProps {
  data: AgentUsageDatum[];
  /** Max rows to plot; remaining agents are dropped. */
  maxRows?: number;
}

export function AgentTokenBars({ data, maxRows = 5 }: AgentTokenBarsProps) {
  const rows = data.filter((d) => d.tokens > 0).slice(0, maxRows);
  if (rows.length === 0) return null;

  // Height scales with row count so bars stay readable.
  const height = rows.length * 18 + 8;

  return (
    <div>
      <p className="mb-1 text-10px uppercase tracking-wide text-muted-foreground">Tokens by agent</p>
      <ChartContainer config={CONFIG} className="aspect-auto w-full" style={{ height }}>
        <BarChart
          data={rows}
          layout="vertical"
          margin={{ top: 0, right: 8, bottom: 0, left: 0 }}
          barCategoryGap={4}
        >
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="agent"
            width={96}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 10 }}
            interval={0}
          />
          <ChartTooltip
            cursor={false}
            content={<ChartTooltipContent hideLabel formatter={(v) => `${compactTokens(Number(v))} tok`} />}
          />
          <Bar dataKey="tokens" radius={2} isAnimationActive={false}>
            {rows.map((row, i) => (
              <Cell key={row.agent} fill={BAR_PALETTE[i % BAR_PALETTE.length]} />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
    </div>
  );
}
