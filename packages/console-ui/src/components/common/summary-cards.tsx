import { useCallback } from 'react';
import { CheckCircle2, XCircle, Loader2, Clock, Zap, DollarSign, Layers, MessageSquare, FileCode, AlertTriangle } from 'lucide-react';
import { formatNumber } from '@/lib/run-state/format';
import { cn } from '@/lib/utils';
import { AnimatedCounter } from './animated-counter';
import type { RunEfficiencyMetrics, SessionProfile } from '@/lib/run-state';
import { ProfileBadge } from '@/components/profile/profile-badge';

interface SummaryCardsProps {
  duration: string;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheCreation: number;
  totalCost: number;
  plansCompleted: number;
  plansFailed: number;
  plansTotal: number;
  totalTurns: number;
  filesChanged: number;
  reviewCritical: number;
  reviewWarning: number;
  isComplete?: boolean;
  isFailed?: boolean;
  profile?: SessionProfile | null;
  // --- eforge:region plan-02-live-efficiency-surfaces ---
  efficiency?: RunEfficiencyMetrics;
  // --- eforge:endregion plan-02-live-efficiency-surfaces ---
}

function StatGroup({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-1.5">{children}</div>;
}

function Separator() {
  return <span className="text-text-dim/30 mx-1">·</span>;
}

export function SummaryCards({
  duration,
  tokensIn,
  tokensOut,
  cacheRead,
  totalCost,
  plansCompleted,
  plansFailed,
  plansTotal,
  totalTurns,
  filesChanged,
  reviewCritical,
  reviewWarning,
  isComplete,
  isFailed,
  profile,
  // --- eforge:region plan-02-live-efficiency-surfaces ---
  efficiency,
  // --- eforge:endregion plan-02-live-efficiency-surfaces ---
}: SummaryCardsProps) {
  const statusAccent = isFailed ? 'red' : isComplete ? 'green' : 'blue';
  const statusIcon = isFailed
    ? <XCircle className="w-3 h-3 text-red" />
    : isComplete
      ? <CheckCircle2 className="w-3 h-3 text-green" />
      : <Loader2 className="w-3 h-3 text-blue animate-spin" />;
  const statusLabel = isFailed ? 'Failed' : isComplete ? 'Completed' : 'Running';

  const formatTokens = useCallback((n: number) => formatNumber(n), []);
  const formatCost = useCallback((n: number) => `$${(n / 10000).toFixed(4)}`, []);

  // --- eforge:region plan-02-live-efficiency-surfaces ---
  const formatEfficiency = useCallback((label: string, value: number | null) => {
    if (value == null) return 'unavailable';
    switch (label) {
      case 'output generation rate': return `${Math.round(value)} out tok/s`;
      case 'token traffic': return `${Math.round(value)} tok/min`;
      case 'cost burn': return `$${value.toFixed(2)}/min`;
      case 'output tokens / $': return `${Math.round(value)} out tok/$`;
      case 'cache context': return `${Math.round(value)}% cache`;
      default: return value.toLocaleString();
    }
  }, []);
  const efficiencyMetrics = efficiency ? [
    efficiency.outputGenerationRate,
    efficiency.tokenTraffic,
    efficiency.costBurn,
    efficiency.outputTokensPerDollar,
    efficiency.cacheContext,
  ] : [];
  // --- eforge:endregion plan-02-live-efficiency-surfaces ---

  return (
    <div className="flex items-center gap-1.5 flex-wrap text-xs">
      <StatGroup>
        {statusIcon}
        <span className={cn(
          'font-semibold',
          statusAccent === 'green' && 'text-green',
          statusAccent === 'red' && 'text-red',
          statusAccent === 'blue' && 'text-blue',
        )}>
          {statusLabel}
        </span>
        {profile?.profileName && <ProfileBadge profile={profile} />}
      </StatGroup>

      <Separator />

      <StatGroup>
        <Clock className="w-3 h-3 text-text-dim" />
        <span className="text-text-bright">{duration}</span>
      </StatGroup>

      {plansTotal > 0 && (
        <>
          <Separator />
          <StatGroup>
            <Layers className="w-3 h-3 text-text-dim" />
            <span className={cn(
              plansFailed > 0 ? 'text-red' : plansCompleted === plansTotal ? 'text-green' : 'text-text-bright',
            )}>
              {plansCompleted}/{plansTotal}{plansFailed ? ` (${plansFailed} failed)` : ''}
            </span>
          </StatGroup>
        </>
      )}

      {totalTurns > 0 && (
        <>
          <Separator />
          <StatGroup>
            <MessageSquare className="w-3 h-3 text-text-dim" />
            <span className="text-text-bright">
              <AnimatedCounter value={totalTurns} format={String} />
            </span>
          </StatGroup>
        </>
      )}

      {tokensIn + tokensOut > 0 && (
        <>
          <Separator />
          <StatGroup>
            <Zap className="w-3 h-3 text-text-dim" />
            <span className="text-text-bright">
              <AnimatedCounter value={tokensIn + tokensOut} format={formatTokens} />
            </span>
            {cacheRead > 0 && tokensIn > 0 && (
              <span className="text-text-dim text-10px">
                ({Math.round(cacheRead / tokensIn * 100)}% cached)
              </span>
            )}
          </StatGroup>
        </>
      )}

      {totalCost > 0 && (
        <>
          <Separator />
          <StatGroup>
            <DollarSign className="w-3 h-3 text-text-dim" />
            <span className="text-text-bright">
              <AnimatedCounter value={Math.round(totalCost * 10000)} format={formatCost} />
            </span>
          </StatGroup>
        </>
      )}
      {/* --- eforge:region plan-02-live-efficiency-surfaces --- */}
      {efficiencyMetrics.map((metric) => (
        <StatGroup key={metric.label}>
          <Separator />
          <span
            className={cn(
              'rounded-full border px-1.5 py-0.5 text-10px',
              metric.availability === 'partial' && 'border-yellow/40 text-yellow',
              metric.availability === 'unavailable' && 'border-border text-text-dim',
              metric.availability === 'available' && 'border-border/80 text-text-bright',
            )}
            title={`${metric.formula}. ${metric.detail}${metric.sampleCounts ? ` Samples: ${metric.sampleCounts.included}/${metric.sampleCounts.total}.` : ''}`}
          >
            <span className="text-text-dim">{metric.label}: </span>
            {formatEfficiency(metric.label, metric.value)}
          </span>
        </StatGroup>
      ))}
      {/* --- eforge:endregion plan-02-live-efficiency-surfaces --- */}

      {filesChanged > 0 && (
        <>
          <Separator />
          <StatGroup>
            <FileCode className="w-3 h-3 text-text-dim" />
            <span className="text-text-bright">
              <AnimatedCounter value={filesChanged} format={String} />
            </span>
          </StatGroup>
        </>
      )}

      {(reviewCritical > 0 || reviewWarning > 0) && (
        <>
          <Separator />
          <StatGroup>
            <AlertTriangle className="w-3 h-3 text-text-dim" />
            {reviewCritical > 0 && <span className="text-red">{reviewCritical} critical</span>}
            {reviewWarning > 0 && <span className="text-yellow">{reviewWarning} warning</span>}
          </StatGroup>
        </>
      )}
    </div>
  );
}
