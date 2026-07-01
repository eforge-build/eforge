import * as React from 'react';
import { Gauge } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { EfficiencyAnalyticsWindowDays } from '@/hooks/use-efficiency-analytics';
import { EFFICIENCY_ANALYTICS_WINDOWS } from '@/hooks/use-efficiency-analytics';
import type { EfficiencyAnalyticsMetricValue, EfficiencyAnalyticsRow, EfficiencyAnalyticsViewModel } from '@/lib/selectors/efficiency-analytics';
import { formatHarnessLabel, formatModelLabel, formatUsd } from '@/lib/format';
import { cn } from '@/lib/utils';

interface EfficiencyAnalyticsCardProps {
  model: EfficiencyAnalyticsViewModel;
  selectedWindow: EfficiencyAnalyticsWindowDays;
  onWindowChange: (windowDays: EfficiencyAnalyticsWindowDays) => void;
}

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

function RowTitle({ row }: { row: EfficiencyAnalyticsRow }) {
  const sublabel = row.kind === 'model' ? formatHarnessLabel(row.sublabel, null) : row.sublabel;
  return (
    <div className="min-w-0">
      <div className="truncate font-mono text-xs font-medium text-foreground" title={row.label}>
        {row.kind === 'model' ? formatModelLabel(row.label) : row.label}
      </div>
      {sublabel && <div className="truncate font-mono text-10px text-muted-foreground">{sublabel}</div>}
    </div>
  );
}

function AnalyticsRow({ row }: { row: EfficiencyAnalyticsRow }) {
  return (
    <div className="space-y-2 rounded-lg border border-border/60 bg-muted/10 p-2.5">
      <div className="flex items-start justify-between gap-2">
        <RowTitle row={row} />
        <div className="shrink-0 text-right font-mono text-10px tabular-nums text-muted-foreground">
          <div>{row.successCount} ok · {row.failureCount} failed</div>
          <div>{row.kind === 'profile' ? `${row.runSampleCount} run samples` : `${row.speedSampleCount} speed samples`}</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <Metric label="p50 output rate" metric={row.p50OutputTokensPerSecond} unit="rate" />
        <Metric label="p95 output rate" metric={row.p95OutputTokensPerSecond} unit="rate" />
        <Metric label="cost / run" metric={row.costPerRunUsd} unit="usd" />
        <Metric label="cost / min" metric={row.costPerMinuteUsd} unit="usdPerMin" />
        <Metric label="output tokens / $" metric={row.outputTokensPerDollar} unit="tokensPerDollar" />
      </div>
      {row.partialLabel && <div className="text-10px text-muted-foreground">partial: {row.partialLabel}</div>}
    </div>
  );
}

function RowSection({ title, rows }: { title: string; rows: EfficiencyAnalyticsRow[] }) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-10px font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
        <span className="font-mono text-10px tabular-nums text-muted-foreground">{rows.length} rows</span>
      </div>
      {rows.length === 0 ? (
        <p className="text-10px text-muted-foreground">No {title.toLowerCase()} rollups for this window.</p>
      ) : (
        <div className="space-y-2">{rows.map((row) => <AnalyticsRow key={row.id} row={row} />)}</div>
      )}
    </section>
  );
}

export function EfficiencyAnalyticsCard({ model, selectedWindow, onWindowChange }: EfficiencyAnalyticsCardProps) {
  return (
    <Card className="bg-card/50 border-border/60" data-testid="efficiency-analytics-card">
      <CardHeader className="px-4 pb-2 pt-4">
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <Gauge className="h-4 w-4 text-blue" />
            Efficiency analytics
          </CardTitle>
          <div className="flex flex-wrap justify-end gap-1" aria-label="Efficiency analytics window">
            {EFFICIENCY_ANALYTICS_WINDOWS.map((days) => (
              <button
                key={days}
                type="button"
                className={cn(
                  'rounded-md border px-2 py-1 font-mono text-10px tabular-nums transition-colors',
                  selectedWindow === days
                    ? 'border-blue/60 bg-blue/10 text-foreground'
                    : 'border-border/70 text-muted-foreground hover:text-foreground',
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
        <p className="text-10px text-muted-foreground">
          Historical telemetry proxies over the last {model.windowDays || selectedWindow}d. Output rate = output tokens / provider API duration seconds; cost/run = reported cost / runs; cost/min = reported cost / measured provider API duration minutes; output tokens/$ = output tokens / reported cost.
        </p>
        {!model.hasData ? (
          <p className="rounded-lg border border-dashed border-border/70 p-3 text-xs text-muted-foreground">{model.noDataLabel}</p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2 text-10px text-muted-foreground">
              <span><span className="font-mono text-foreground">{model.runCount}</span> runs</span>
              <span><span className="font-mono text-foreground">{model.sessionCount}</span> sessions</span>
              <span><span className="font-mono text-foreground">{model.agentResultCount}</span> results</span>
            </div>
            {(model.missingModelAttributionCount > 0 || model.missingProfileAttributionCount > 0) && (
              <p className="text-10px text-muted-foreground">
                partial attribution: {model.missingModelAttributionCount} model · {model.missingProfileAttributionCount} profile
              </p>
            )}
            <RowSection title="By model" rows={model.models} />
            <RowSection title="By profile" rows={model.profiles} />
          </>
        )}
      </CardContent>
    </Card>
  );
}
