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
import type { NowSpendPanel, SpendModelRow } from '@/lib/selectors/spend';
import { compactTokens, formatHarnessLabel, formatModelLabel, formatUsd } from '@/lib/format';
import { cn } from '@/lib/utils';

interface SpendCardProps {
  model: NowSpendPanel;
}

const SPEND_CONFIG: ChartConfig = { costUsd: { label: 'Spend', color: 'var(--color-blue)' } };

/** How many models to list before collapsing the tail into a "+N more" note. */
const MODEL_ROW_LIMIT = 5;

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

function ModelRow({ row }: { row: SpendModelRow }) {
  const harness = formatHarnessLabel(row.harness, row.provider);
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate" title={row.model}>
          <span className="font-mono text-xs text-foreground">{formatModelLabel(row.model)}</span>
          {harness && (
            <span className="ml-1.5 font-mono text-10px text-muted-foreground">{harness}</span>
          )}
        </span>
        <span className="shrink-0 font-mono text-xs font-medium tabular-nums text-foreground">
          {formatUsd(row.costUsd)}
        </span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-[var(--color-blue)]"
          style={{ width: `${Math.max(2, Math.round(row.sharePct))}%` }}
        />
      </div>
      <div className="flex items-baseline justify-between gap-2 text-10px tabular-nums text-muted-foreground">
        <span>{compactTokens(row.tokensTotal)} tok</span>
        <span>
          {Math.round(row.sharePct)}% spend
          {row.cachePct != null && ` · ${Math.round(row.cachePct)}% cache`}
        </span>
      </div>
    </div>
  );
}

/** Stable key per model+harness+provider — the same model can appear under several. */
function rowKey(row: SpendModelRow): string {
  return `${row.model}::${row.harness ?? ''}::${row.provider ?? ''}`;
}

type ModelScope = 'window' | 'today';

/** Subtle segmented toggle between the window and today scopes. */
function ScopeToggle({
  scope,
  onScope,
  windowDays,
}: {
  scope: ModelScope;
  onScope: (s: ModelScope) => void;
  windowDays: number;
}) {
  const options: Array<{ value: ModelScope; label: string }> = [
    { value: 'window', label: `${windowDays}d` },
    { value: 'today', label: 'Today' },
  ];
  return (
    <div className="flex items-center gap-0.5 rounded-md bg-muted/60 p-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          aria-pressed={scope === opt.value}
          onClick={() => onScope(opt.value)}
          className={cn(
            'rounded px-1.5 py-0.5 text-10px font-medium tabular-nums transition-colors',
            scope === opt.value
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function ModelList({ models }: { models: SpendModelRow[] }) {
  if (models.length === 0) {
    return <p className="text-10px text-muted-foreground">No model spend yet.</p>;
  }
  const shown = models.slice(0, MODEL_ROW_LIMIT);
  const hidden = models.length - shown.length;
  return (
    <>
      <div className="space-y-2.5">
        {shown.map((row) => (
          <ModelRow key={rowKey(row)} row={row} />
        ))}
      </div>
      {hidden > 0 && (
        <p className="mt-1.5 text-10px text-muted-foreground">
          +{hidden} more model{hidden === 1 ? '' : 's'}
        </p>
      )}
    </>
  );
}

function SpendModels({
  windowModels,
  todayModels,
  windowDays,
}: {
  windowModels: SpendModelRow[];
  todayModels: SpendModelRow[];
  windowDays: number;
}) {
  const [scope, setScope] = React.useState<ModelScope>('window');
  // The section only appears once the window has per-model spend to show.
  if (windowModels.length === 0) return null;
  const active = scope === 'window' ? windowModels : todayModels;
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="text-10px uppercase tracking-wide text-muted-foreground">By model</p>
        <ScopeToggle scope={scope} onScope={setScope} windowDays={windowDays} />
      </div>
      <ModelList models={active} />
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
        <SpendModels
          windowModels={model.models}
          todayModels={model.modelsToday}
          windowDays={model.windowDays}
        />
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
