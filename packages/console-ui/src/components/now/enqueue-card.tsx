import * as React from 'react';
import { FileCog } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { NowEnqueueCard as NowEnqueueCardModel } from '@/lib/selectors/now';
import { formatDuration, truncateId, compactTokens } from '@/lib/format';
import { CancelBuildButton } from './cancel-build-button';
import { cn } from '@/lib/utils';

const STREAM_STATUS_BADGE: Record<string, 'secondary' | 'destructive'> = {
  connecting: 'secondary',
  disconnected: 'destructive',
};

interface EnqueueCardProps {
  card: NowEnqueueCardModel;
}

/**
 * Compact card for a pre-build enqueue run (PRD formatting/validation). It is
 * intentionally lighter than a build card — dashed border, no lifecycle rail,
 * no plan swimlane — so it reads as "preparing input", not "a build is running".
 */
export function EnqueueCard({ card }: EnqueueCardProps) {
  const durationLabel = formatDuration(card.durationMs);
  const tokensLabel = card.tokens > 0 ? `${compactTokens(card.tokens)} tok` : null;
  const costLabel = card.cost > 0 ? `$${card.cost.toFixed(2)}` : null;
  const metricBits = [durationLabel, tokensLabel, costLabel].filter(
    (bit): bit is string => Boolean(bit),
  );
  const showPulse = !card.latestError;
  const showStreamBadge = card.streamStatus !== 'connected';
  const streamBadgeVariant = STREAM_STATUS_BADGE[card.streamStatus] ?? 'secondary';

  return (
    <Card
      className={cn(
        'relative overflow-hidden border-dashed border-border/70 bg-muted/5 shadow-sm',
        card.latestError && 'border-solid border-l-2 border-l-destructive ring-1 ring-destructive/25',
      )}
    >
      {showPulse && (
        <div
          className="pointer-events-none absolute inset-0 bg-muted/10 motion-safe:animate-pulse"
          aria-hidden="true"
        />
      )}
      <CardContent className="relative z-10 space-y-1.5 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <FileCog className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Preparing PRD for queue
          </span>
          <div className="flex shrink-0 items-center gap-2">
            {showStreamBadge && (
              <Badge variant={streamBadgeVariant} className="capitalize text-xs">
                {card.streamStatus}
              </Badge>
            )}
            <CancelBuildButton sessionId={card.sessionId} label={card.title} />
          </div>
        </div>

        <p className="truncate text-sm font-semibold text-foreground" title={card.title}>
          {card.title}
        </p>

        {card.latestError ? (
          <p className="truncate text-xs text-destructive" title={card.latestError}>
            {card.latestError}
          </p>
        ) : card.step ? (
          <p className="flex items-center gap-1.5 text-xs text-blue">
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue motion-safe:animate-pulse"
              aria-hidden="true"
            />
            {card.step}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">Preparing…</p>
        )}

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t pt-2 text-xs tabular-nums text-muted-foreground">
          <span className="font-medium text-foreground">{metricBits[0]}</span>
          {metricBits.slice(1).map((bit) => (
            <React.Fragment key={bit}>
              <span className="text-border" aria-hidden="true">·</span>
              <span>{bit}</span>
            </React.Fragment>
          ))}
          <span className="text-border" aria-hidden="true">·</span>
          <code className="font-mono">{truncateId(card.sessionId)}</code>
        </div>
      </CardContent>
    </Card>
  );
}
