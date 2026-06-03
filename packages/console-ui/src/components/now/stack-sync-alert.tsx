/**
 * StackSyncAlert — top-strip escalation for a stack sync that needs attention.
 *
 * Stack sync is housekeeping that runs itself and lives on System. The only
 * states worth surfacing on the Now dashboard are genuine problems:
 *   - conflict / failed: the sync errored and a human may need to intervene.
 *   - deferred with no active build: the "active build overlaps" reason no
 *     longer applies, so the sync is effectively stuck and retry-able.
 * Normal outcomes (complete / skipped / deferred-during-a-build) render
 * nothing here.
 */
import * as React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { NowStackSyncViewModel } from '@/lib/selectors/now';
import { postStackSync } from '@/lib/stack-sync-api';
import { cn } from '@/lib/utils';

interface StackSyncAlertProps {
  sync: NowStackSyncViewModel | null;
  /** True when one or more builds are active — a deferred sync is then expected. */
  hasActiveBuilds: boolean;
  /** Navigate to the full controls (System route). */
  onManage?: () => void;
}

type Escalation =
  | { kind: 'conflict' | 'failed'; severity: 'critical' }
  | { kind: 'deferred'; severity: 'warning' };

function classify(sync: NowStackSyncViewModel | null, hasActiveBuilds: boolean): Escalation | null {
  if (!sync) return null;
  if (sync.lastOutcome === 'conflict') return { kind: 'conflict', severity: 'critical' };
  if (sync.lastOutcome === 'failed') return { kind: 'failed', severity: 'critical' };
  // A deferred sync is normal while a build is active; only escalate when it is
  // stuck (no active build is blocking it anymore).
  if (sync.lastOutcome === 'deferred' && !hasActiveBuilds) {
    return { kind: 'deferred', severity: 'warning' };
  }
  return null;
}

const HEADLINE: Record<Escalation['kind'], string> = {
  conflict: 'Stack sync conflict',
  failed: 'Stack sync failed',
  deferred: 'Stack sync deferred',
};

export function StackSyncAlert({ sync, hasActiveBuilds, onManage }: StackSyncAlertProps) {
  const [retrying, setRetrying] = React.useState(false);
  const [retryError, setRetryError] = React.useState<string | null>(null);

  const escalation = classify(sync, hasActiveBuilds);

  const handleRetry = React.useCallback(async () => {
    if (!escalation) return;
    setRetrying(true);
    setRetryError(null);
    try {
      // A stuck-deferred sync retries the deferred run; a conflict/failed sync
      // re-runs from scratch as a manual sync.
      await postStackSync({ trigger: escalation.kind === 'deferred' ? 'retry-deferred' : 'manual' });
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : 'Retry failed');
    } finally {
      setRetrying(false);
    }
  }, [escalation]);

  if (!escalation) return null;

  const detail = sync?.lastError ?? sync?.lastReason ?? undefined;
  const accent =
    escalation.severity === 'critical'
      ? 'border-l-2 border-l-destructive bg-destructive/5'
      : 'border-l-2 border-l-yellow bg-yellow/5';

  return (
    <Card className={cn(accent)}>
      <CardContent className="flex flex-wrap items-start gap-3 px-4 py-3">
        <Badge
          variant={escalation.severity === 'critical' ? 'destructive' : 'default'}
          className="mt-0.5 shrink-0"
        >
          {escalation.severity === 'critical' ? 'Conflict' : 'Stuck'}
        </Badge>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">{HEADLINE[escalation.kind]}</p>
          {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
          {retryError && <p className="mt-1 text-xs text-destructive">{retryError}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleRetry} disabled={retrying}>
            {retrying ? 'Retrying…' : 'Retry'}
          </Button>
          {onManage && (
            <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={onManage}>
              Details →
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
