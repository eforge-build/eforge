/**
 * EfficiencyAnalyticsCard — compact visual comparison of model/profile
 * efficiency over a rolling window.
 *
 * Collapsed rows show a P50 output-rate comparison bar (normalized to the
 * section max) plus cost/run; clicking a row expands the full stat-tile grid.
 * Rollups are window aggregates — not time series — so the visual is a
 * comparison bar, never a sparkline. The metric definitions live in the
 * header's info tooltip instead of an inline paragraph.
 */
import * as React from 'react';
import { Gauge, Info } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { EfficiencyAnalyticsWindowDays } from '@/hooks/use-efficiency-analytics';
import { EFFICIENCY_ANALYTICS_WINDOWS } from '@/hooks/use-efficiency-analytics';
import type { EfficiencyAnalyticsMetricValue, EfficiencyAnalyticsRow, EfficiencyAnalyticsViewModel } from '@/lib/selectors/efficiency-analytics';
import { compactTokens, formatHarnessLabel, formatModelLabel, formatUsd } from '@/lib/format';
import { cn } from '@/lib/utils';

interface EfficiencyAnalyticsCardProps {
  model: EfficiencyAnalyticsViewModel;
  selectedWindow: EfficiencyAnalyticsWindowDays;
  onWindowChange: (windowDays: EfficiencyAnalyticsWindowDays) => void;
}

const SECTION_ROW_LIMIT = 4;

function formatMetric(metric: EfficiencyAnalyticsMetricValue, unit: 'rate' | 'usd' | 'usdPerMin' | 'tokensPerDollar'): string {
  if (metric.value == null) return metric.availability === 'partial' ? 'partial' : '—';
  switch (unit) {
    case 'rate':
      return `${Math.round(metric.value).toLocaleString()} out tok/s`;
    case 'usd':
      return formatUsd(metric.value);
    case 'usdPerMin':
      return `${formatUsd(metric.value)}/min`;
    case 'tokensPerDollar':
      return `${Math.round(metric.value).toLocaleString()} out tok/$`;
  }
}

function Metric({ label, metric, unit }: { label: string; metric: EfficiencyAnalyticsMetricValue; unit: 'rate' | 'usd' | 'usdPerMin' | 'tokensPerDollar' }) {
  return (
    <div className={cn('min-w-0 rounded-md border border-border/70 px-2 py-1.5', metric.availability === 'partial' && 'border-yellow/30 bg-yellow/10')}>
      <div className="text-10px uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-mono text-xs font-semibold tabular-nums text-foreground">{formatMetric(metric, unit)}</div>
      {metric.sampleCount > 0 && (
        <div className="font-mono text-10px tabular-nums text-muted-foreground">n={metric.sampleCount}</div>
      )}
    </div>
  );
}

/** Simple stat tile for the aggregate totals that carry no sample count. */
function TotalTile({ label, value }: { label: string; value: string | null }) {
  if (value == null) return null;
  return (
    <div className="min-w-0 rounded-md border border-border/70 px-2 py-1.5">
      <div className="text-10px uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-mono text-xs font-semibold tabular-nums text-foreground">{value}</div>
    </div>
  );
}

function rowLabel(row: EfficiencyAnalyticsRow): string {
  return row.kind === 'model' ? formatModelLabel(row.label) : row.label;
}

function rowSublabel(row: EfficiencyAnalyticsRow): string | null {
  return row.kind === 'model' ? formatHarnessLabel(row.sublabel, null) : row.sublabel;
}

/**
 * One collapsed model/profile row: name + cost/run, then a P50 output-rate
 * comparison bar normalized to the section's fastest row. Click to expand the
 * full stat tiles.
 */
function CompactRow({ row, maxRate }: { row: EfficiencyAnalyticsRow; maxRate: number }) {
  const [open, setOpen] = React.useState(false);
  const rate = row.p50OutputTokensPerSecond;
  const barPct = rate.value != null && maxRate > 0 ? Math.max(2, Math.round((rate.value / maxRate) * 100)) : 0;
  const sublabel = rowSublabel(row);

  return (
    <div className="rounded-lg border border-border/60 bg-muted/10 px-2.5 py-2">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className="block w-full space-y-1 text-left"
      >
        <span className="flex items-baseline justify-between gap-2">
          <span className="min-w-0 truncate font-mono text-xs font-medium text-foreground" title={row.label}>
            {rowLabel(row)}
          </span>
          <span className="shrink-0 font-mono text-xs tabular-nums text-foreground">
            {formatMetric(row.costPerRunUsd, 'usd')}
            <span className="ml-1 text-10px text-muted-foreground">/ run</span>
          </span>
        </span>
        <span className="flex items-center gap-2">
          <span className="block h-1 flex-1 overflow-hidden rounded-full bg-muted">
            {barPct > 0 && (
              <span className="block h-full rounded-full bg-[var(--color-blue)]" style={{ width: `${barPct}%` }} />
            )}
          </span>
          <span
            className={cn(
              'shrink-0 font-mono text-10px tabular-nums',
              rate.availability === 'partial' ? 'text-yellow/80' : 'text-muted-foreground',
            )}
          >
            {formatMetric(rate, 'rate')}
          </span>
        </span>
        <span className="flex items-baseline justify-between gap-2 text-10px tabular-nums text-muted-foreground">
          <span className="min-w-0 truncate font-mono">{sublabel ?? ''}</span>
          <span className="shrink-0 font-mono">
            {row.successCount} ok{row.failureCount > 0 && <span className="text-destructive"> · {row.failureCount} failed</span>}
          </span>
        </span>
      </button>
      {open && (
        <div className="space-y-1.5 pt-2">
          <div className="grid grid-cols-2 gap-1.5">
            <Metric label="p50 output rate" metric={row.p50OutputTokensPerSecond} unit="rate" />
            <Metric label="p95 output rate" metric={row.p95OutputTokensPerSecond} unit="rate" />
            <Metric label="cost / run" metric={row.costPerRunUsd} unit="usd" />
            <Metric label="cost / min" metric={row.costPerMinuteUsd} unit="usdPerMin" />
            <Metric label="output tokens / $" metric={row.outputTokensPerDollar} unit="tokensPerDollar" />
            <TotalTile label="cache hit" value={row.cachePercentage != null ? `${Math.round(row.cachePercentage)}%` : null} />
            <TotalTile label="total cost" value={row.totalCostUsd != null ? formatUsd(row.totalCostUsd) : null} />
            <TotalTile label="output tokens" value={row.outputTokens != null ? `${compactTokens(row.outputTokens)} tok` : null} />
          </div>
          <div className="font-mono text-10px tabular-nums text-muted-foreground">
            {row.kind === 'profile' ? `${row.runSampleCount} run samples` : `${row.speedSampleCount} speed samples`}
          </div>
          {row.partialLabel && <div className="text-10px text-muted-foreground">partial: {row.partialLabel}</div>}
        </div>
      )}
    </div>
  );
}

function RowSection({ title, rows }: { title: string; rows: EfficiencyAnalyticsRow[] }) {
  const [showAll, setShowAll] = React.useState(false);
  const shown = showAll ? rows : rows.slice(0, SECTION_ROW_LIMIT);
  const hidden = rows.length - shown.length;
  // Normalize bars to the fastest row in the section so relative speed reads
  // at a glance.
  const maxRate = rows.reduce((max, row) => Math.max(max, row.p50OutputTokensPerSecond.value ?? 0), 0);

  return (
    <section className="space-y-1.5">
      <h4 className="text-10px font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
      {rows.length === 0 ? (
        <p className="text-10px text-muted-foreground">No {title.toLowerCase()} rollups for this window.</p>
      ) : (
        <div className="space-y-1.5">
          {shown.map((row) => <CompactRow key={row.id} row={row} maxRate={maxRate} />)}
        </div>
      )}
      {hidden > 0 && (
        <button
          type="button"
          className="text-10px text-muted-foreground transition-colors hover:text-foreground"
          onClick={() => setShowAll(true)}
        >
          + {hidden} more — show all
        </button>
      )}
    </section>
  );
}

export function EfficiencyAnalyticsCard({ model, selectedWindow, onWindowChange }: EfficiencyAnalyticsCardProps) {
  return (
    <TooltipProvider delayDuration={200}>
      <Card className="bg-card/50 border-border/60" data-testid="efficiency-analytics-card">
        <CardHeader className="px-4 pb-2 pt-4">
          <div className="flex items-start justify-between gap-3">
            <CardTitle className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
              <Gauge className="h-4 w-4 text-blue" />
              Efficiency analytics
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" className="inline-flex cursor-help" aria-label="How these metrics are computed">
                    <Info className="h-3.5 w-3.5 text-muted-foreground/70" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-72">
                  Historical telemetry proxies over the last {model.windowDays || selectedWindow}d. Output rate = output
                  tokens / provider API duration seconds; cost/run = reported cost / runs; cost/min = reported cost /
                  measured provider API duration minutes; output tokens/$ = output tokens / reported cost.
                </TooltipContent>
              </Tooltip>
            </CardTitle>
            <div className="flex flex-wrap justify-end gap-0.5" aria-label="Efficiency analytics window">
              {EFFICIENCY_ANALYTICS_WINDOWS.map((days) => (
                <button
                  key={days}
                  type="button"
                  className={cn(
                    'rounded px-1.5 py-0.5 font-mono text-10px tabular-nums transition-colors',
                    selectedWindow === days
                      ? 'bg-blue/10 text-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                  aria-pressed={selectedWindow === days}
                  onClick={() => onWindowChange(days)}
                >
                  {days}d
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 px-4 pb-4">
          {!model.hasData ? (
            <p className="rounded-lg border border-dashed border-border/70 p-3 text-xs text-muted-foreground">{model.noDataLabel}</p>
          ) : (
            <>
              <p className="text-10px tabular-nums text-muted-foreground">
                <span className="font-mono text-foreground">{model.runCount}</span> runs ·{' '}
                <span className="font-mono text-foreground">{model.sessionCount}</span> sessions ·{' '}
                <span className="font-mono text-foreground">{model.agentResultCount}</span> results
                {(model.missingModelAttributionCount > 0 || model.missingProfileAttributionCount > 0) && (
                  <> · partial attribution: {model.missingModelAttributionCount} model, {model.missingProfileAttributionCount} profile</>
                )}
              </p>
              <RowSection title="By model" rows={model.models} />
              <RowSection title="By profile" rows={model.profiles} />
            </>
          )}
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}
