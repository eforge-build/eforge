import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { NowStackSyncViewModel } from '@/lib/selectors/now';
import type { StackSyncResponse } from '@eforge-build/client/browser';
import { postStackSync } from '@/lib/stack-sync-api';

interface StackSyncStatusCardProps {
  sync: NowStackSyncViewModel | null;
}

function outcomeVariant(
  outcome: NowStackSyncViewModel['lastOutcome'],
): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (!outcome) return 'outline';
  if (outcome === 'complete') return 'secondary';
  if (outcome === 'failed' || outcome === 'conflict') return 'destructive';
  if (outcome === 'deferred' || outcome === 'skipped') return 'outline';
  return 'outline';
}

export function StackSyncStatusCard({ sync }: StackSyncStatusCardProps) {
  const [syncing, setSyncing] = React.useState(false);
  const [syncError, setSyncError] = React.useState<string | null>(null);
  const [lastResponse, setLastResponse] = React.useState<StackSyncResponse | null>(null);

  const handleSync = React.useCallback(
    async (opts: { dryRun?: boolean; trigger: 'manual' | 'retry-deferred' }) => {
      setSyncing(true);
      setSyncError(null);
      try {
        const response = await postStackSync({
          trigger: opts.trigger,
          dryRun: opts.dryRun,
        });
        setLastResponse(response);
      } catch (err) {
        setSyncError(err instanceof Error ? err.message : 'Sync failed');
      } finally {
        setSyncing(false);
      }
    },
    [],
  );

  const inProgress = sync?.inProgress ?? false;
  const isDeferred = sync?.lastOutcome === 'deferred';

  // Use lastResponse as optimistic override after a local button click; fall back to view model
  const activeBuildSkips = lastResponse?.activeBuildSkips ?? sync?.lastActiveBuildSkips ?? [];
  const providerCommands = lastResponse?.providerCommands ?? sync?.lastProviderCommands ?? [];

  return (
    <Card className="mb-4">
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-sm font-semibold">Stack sync</CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {/* In-progress indicator */}
        {inProgress && (
          <p className="text-xs text-muted-foreground mb-2">Sync in progress...</p>
        )}

        {/* Last outcome status */}
        {sync && sync.lastOutcome && (
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <Badge variant={outcomeVariant(sync.lastOutcome)} className="capitalize text-xs">
              {sync.lastOutcome}
            </Badge>
            {sync.lastDryRun && (
              <span className="text-xs text-muted-foreground">(dry run)</span>
            )}
            {sync.lastTrigger && (
              <span className="text-xs text-muted-foreground">via {sync.lastTrigger}</span>
            )}
            {sync.lastCompletedAt && (
              <span className="text-xs text-muted-foreground">
                {new Date(sync.lastCompletedAt).toLocaleString()}
              </span>
            )}
            {sync.lastRestackCandidateCount > 0 && (
              <span className="text-xs text-muted-foreground">
                {sync.lastRestackCandidateCount} branch
                {sync.lastRestackCandidateCount !== 1 ? 'es' : ''} restacked
              </span>
            )}
          </div>
        )}

        {/* Reason for non-complete outcomes */}
        {sync?.lastReason && sync.lastOutcome !== 'complete' && (
          <p className="text-xs text-muted-foreground mb-2">Reason: {sync.lastReason}</p>
        )}

        {/* Error for failed/conflict outcomes */}
        {sync?.lastError && (
          <p className="text-xs text-destructive mb-2">{sync.lastError}</p>
        )}

        {/* Active-build skips */}
        {activeBuildSkips.length > 0 && (
          <div className="mb-2">
            <p className="text-xs font-medium text-muted-foreground mb-1">
              Active build skips ({activeBuildSkips.length}):
            </p>
            <ul className="space-y-0.5">
              {activeBuildSkips.map((skip, i) => (
                <li key={i} className="text-xs text-muted-foreground">
                  {skip.branch}
                  {skip.reason && ` — ${skip.reason}`}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Provider commands */}
        {providerCommands.length > 0 && (
          <div className="mb-2">
            <p className="text-xs font-medium text-muted-foreground mb-1">
              Provider commands:
            </p>
            <ul className="space-y-0.5">
              {providerCommands.map((cmd, i) => (
                <li key={i} className="text-xs font-mono text-muted-foreground">
                  {cmd.command} {cmd.args.join(' ')}
                  {cmd.dryRun && (
                    <span className="ml-1 text-muted-foreground">(dry run)</span>
                  )}
                  {cmd.exitCode != null && cmd.exitCode !== 0 && (
                    <span className="ml-1 text-destructive">exit {cmd.exitCode}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Error from button action */}
        {syncError && (
          <p className="text-xs text-destructive mb-2">{syncError}</p>
        )}

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2 mt-3">
          <button
            onClick={() => handleSync({ trigger: 'manual' })}
            disabled={syncing || inProgress}
            className="text-xs px-2 py-1 rounded border border-input bg-background hover:bg-accent hover:text-accent-foreground disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Sync stack now"
          >
            {syncing ? 'Syncing...' : 'Sync now'}
          </button>
          <button
            onClick={() => handleSync({ trigger: 'manual', dryRun: true })}
            disabled={syncing || inProgress}
            className="text-xs px-2 py-1 rounded border border-input bg-background hover:bg-accent hover:text-accent-foreground disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Dry run stack sync"
          >
            Dry run
          </button>
          {isDeferred && (
            <button
              onClick={() => handleSync({ trigger: 'retry-deferred' })}
              disabled={syncing || inProgress}
              className="text-xs px-2 py-1 rounded border border-input bg-background hover:bg-accent hover:text-accent-foreground disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Retry deferred stack sync"
            >
              Retry
            </button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
