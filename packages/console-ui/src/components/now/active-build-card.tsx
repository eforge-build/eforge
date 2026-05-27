import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { NowActiveBuildCard as NowActiveBuildCardModel } from '@/lib/selectors/now';
import { formatDuration, truncateId } from '@/lib/format';

interface ActiveBuildCardProps {
  card: NowActiveBuildCardModel;
}

const STREAM_STATUS_BADGE: Record<
  string,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  connected: 'default',
  connecting: 'secondary',
  disconnected: 'destructive',
};

export function ActiveBuildCard({ card }: ActiveBuildCardProps) {
  const durationLabel = formatDuration(card.durationMs);
  const streamBadgeVariant = STREAM_STATUS_BADGE[card.streamStatus] ?? 'outline';

  const plansLabel =
    card.planProgress.total > 0
      ? `${card.planProgress.complete}/${card.planProgress.total} plans`
      : null;

  const tokensLabel = card.tokens > 0 ? `${card.tokens.toLocaleString()} tok` : null;
  const costLabel = card.cost > 0 ? `$${card.cost.toFixed(4)}` : null;
  const cacheLabel =
    card.cachePercent > 0 ? `${Math.round(card.cachePercent)}% cache` : null;

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm font-semibold truncate">
            {card.planSet || truncateId(card.sessionId)}
          </CardTitle>
          <Badge variant={streamBadgeVariant} className="shrink-0 capitalize text-xs">
            {card.streamStatus}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground truncate">{card.command}</p>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-2 flex-1">
        {/* Identity row */}
        <div className="text-xs text-muted-foreground space-y-0.5">
          <div>
            <span className="font-medium text-foreground">Session:</span>{' '}
            <code className="font-mono">{truncateId(card.sessionId)}</code>
          </div>
          <div>
            <span className="font-medium text-foreground">Run:</span>{' '}
            <code className="font-mono">{truncateId(card.runId)}</code>
          </div>
          {card.profile && (
            <div>
              <span className="font-medium text-foreground">Profile:</span> {card.profile}
            </div>
          )}
          {card.planCount != null && (
            <div>
              <span className="font-medium text-foreground">Plans:</span> {card.planCount}
            </div>
          )}
        </div>

        {/* Phase / agent */}
        {card.currentPhase && (
          <div className="text-xs">
            <span className="font-medium text-foreground">Phase:</span>{' '}
            <span className="text-muted-foreground">{card.currentPhase}</span>
          </div>
        )}
        {card.latestAgent && (
          <div className="text-xs">
            <span className="font-medium text-foreground">Agent:</span>{' '}
            <span className="text-muted-foreground">{card.latestAgent}</span>
          </div>
        )}

        {/* Progress */}
        {card.latestProgress && (
          <p className="text-xs text-muted-foreground truncate" title={card.latestProgress}>
            {card.latestProgress}
          </p>
        )}

        {/* Error */}
        {card.latestError && (
          <p
            className="text-xs text-destructive truncate"
            title={card.latestError}
          >
            {card.latestError}
          </p>
        )}

        {/* Stats row: plan progress, tokens, cost, cache, duration */}
        <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t">
          <span className="flex gap-2">
            {plansLabel && <span>{plansLabel}</span>}
            {tokensLabel && <span>{tokensLabel}</span>}
            {costLabel && <span>{costLabel}</span>}
            {cacheLabel && <span>{cacheLabel}</span>}
          </span>
          <span>{durationLabel}</span>
        </div>

        {/* Link to runs */}
        <a
          href={card.href}
          className="text-xs text-primary hover:underline"
        >
          View runs
        </a>
      </CardContent>
    </Card>
  );
}
