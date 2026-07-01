import { Gauge } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { selectActiveEfficiencySummary } from '@/lib/selectors/active-efficiency';
import type { ActiveEfficiencyMetric } from '@/lib/selectors/active-efficiency';
import type { NowActiveBuildCard } from '@/lib/selectors/now';
import { cn } from '@/lib/utils';

interface ActiveEfficiencySummaryProps {
  cards: NowActiveBuildCard[];
}

function formatMetric(metric: ActiveEfficiencyMetric): string {
  if (metric.value == null) return metric.availability === 'partial' ? 'partial' : 'unavailable';
  switch (metric.label) {
    case 'output generation rate':
      return `${Math.round(metric.value).toLocaleString()} out tok/s`;
    case 'token traffic':
      return `${Math.round(metric.value).toLocaleString()} tok/min`;
    case 'cost burn':
      return `$${metric.value.toFixed(2)}/min`;
    case 'output tokens / $':
      return `${Math.round(metric.value).toLocaleString()} out tok/$`;
    case 'cache context':
      return `${Math.round(metric.value)}%`;
    default:
      return metric.value.toLocaleString();
  }
}

function MetricChip({ metric }: { metric: ActiveEfficiencyMetric }) {
  return (
    <div
      className={cn(
        'rounded-md border px-2.5 py-1.5',
        metric.availability === 'partial' && 'border-yellow/30 bg-yellow/10',
        metric.availability === 'unavailable' && 'border-border bg-muted/20 text-muted-foreground',
      )}
      title={`${metric.formula}. ${metric.detail}`}
    >
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{metric.label}</div>
      <div className="text-xs font-semibold text-foreground">{formatMetric(metric)}</div>
    </div>
  );
}

export function ActiveEfficiencySummary({ cards }: ActiveEfficiencySummaryProps) {
  if (cards.length === 0) return null;
  const summary = selectActiveEfficiencySummary(cards);
  const metrics = summary.metrics;
  return (
    <Card className="border-border/80 bg-card/70">
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Gauge className="h-4 w-4 text-blue" />
          Active now efficiency
          <span className="text-xs font-normal text-muted-foreground">{summary.activeBuildCount} active</span>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
          <MetricChip metric={metrics.outputGenerationRate} />
          <MetricChip metric={metrics.tokenTraffic} />
          <MetricChip metric={metrics.costBurn} />
          <MetricChip metric={metrics.outputTokensPerDollar} />
          <MetricChip metric={metrics.cacheContext} />
        </div>
      </CardContent>
    </Card>
  );
}
