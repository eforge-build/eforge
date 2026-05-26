// --- eforge:region runs-build-entrypoints ---
import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { RunDetailResult } from '@/hooks/use-run-detail';
import { selectPlanStatusCounts } from '@/lib/selectors/runs';
import { RunPlansPreview } from './run-plans-preview';
import { RunEventsPreview } from './run-events-preview';

interface RunDetailPanelProps {
  selectedId: string | null;
  detail: RunDetailResult;
  profileLabel?: string;
}

/**
 * Selected-detail panel rendering independent loading/error/partial-success
 * states for summary, state, and plans resources.
 */
export function RunDetailPanel({ selectedId, detail, profileLabel }: RunDetailPanelProps) {
  if (!selectedId) {
    return (
      <Card data-testid="run-detail-panel" className="h-full">
        <CardContent className="flex items-center justify-center h-full pt-6">
          <p className="text-sm text-muted-foreground">Select a run to inspect details.</p>
        </CardContent>
      </Card>
    );
  }

  const { summary, state, plans } = detail;

  return (
    <Card data-testid="run-detail-panel" className="h-full overflow-auto">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">
          Run detail: {selectedId}
        </CardTitle>
        {profileLabel && (
          <p className="text-xs text-muted-foreground">
            Profile: <span className="font-mono">{profileLabel}</span>
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary section */}
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Summary
          </h3>
          {summary.status === 'idle' && (
            <p className="text-xs text-muted-foreground">–</p>
          )}
          {summary.status === 'loading' && (
            <p className="text-xs text-muted-foreground">Loading summary...</p>
          )}
          {summary.status === 'error' && (
            <p className="text-xs text-destructive">
              Failed to load summary: {summary.error}
            </p>
          )}
          {summary.status === 'empty' && (
            <p className="text-xs text-muted-foreground">
              No persisted detail for this run id
            </p>
          )}
          {summary.status === 'success' && (
            <div className="space-y-1 text-xs">
              <div>
                Status: <span className="font-mono">{summary.data.status}</span>
              </div>
              {summary.data.currentPhase && (
                <div>
                  Phase:{' '}
                  <span className="font-mono">{summary.data.currentPhase}</span>
                </div>
              )}
              {summary.data.currentAgent && (
                <div>
                  Agent:{' '}
                  <span className="font-mono">{summary.data.currentAgent}</span>
                </div>
              )}
              <div>
                Events: {summary.data.eventCounts.total} total,{' '}
                {summary.data.eventCounts.errors} error(s)
              </div>
              {summary.data.runs.length > 0 && (
                <div>Runs: {summary.data.runs.length}</div>
              )}
              {summary.data.plans.length > 0 && (() => {
                const counts = selectPlanStatusCounts(summary.data.plans);
                return (
                  <div>
                    Plans: {summary.data.plans.length} —{' '}
                    {counts.completed} completed, {counts.running} running,{' '}
                    {counts.failed} failed, {counts.pending} pending
                  </div>
                );
              })()}
              {summary.data.duration.startedAt && (
                <div>
                  Started:{' '}
                  <span className="font-mono">
                    {summary.data.duration.startedAt}
                  </span>
                </div>
              )}
              {summary.data.duration.completedAt && (
                <div>
                  Completed:{' '}
                  <span className="font-mono">
                    {summary.data.duration.completedAt}
                  </span>
                </div>
              )}
              {summary.data.duration.seconds != null && (
                <div>Duration: {summary.data.duration.seconds.toFixed(1)}s</div>
              )}
            </div>
          )}
        </section>

        {/* Recent events section */}
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Recent Events
          </h3>
          {state.status === 'idle' && (
            <p className="text-xs text-muted-foreground">–</p>
          )}
          {state.status === 'loading' && (
            <p className="text-xs text-muted-foreground">Loading events...</p>
          )}
          {state.status === 'error' && (
            <p className="text-xs text-destructive">
              Failed to load events: {state.error}
            </p>
          )}
          {state.status === 'empty' && (
            <p className="text-xs text-muted-foreground">
              No persisted detail for this run id
            </p>
          )}
          {state.status === 'success' && (
            <RunEventsPreview events={state.data.events} />
          )}
        </section>

        {/* Generated plans section */}
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Generated Plans
          </h3>
          {plans.status === 'idle' && (
            <p className="text-xs text-muted-foreground">–</p>
          )}
          {plans.status === 'loading' && (
            <p className="text-xs text-muted-foreground">Loading plans...</p>
          )}
          {plans.status === 'error' && (
            <p className="text-xs text-destructive">
              Failed to load plans: {plans.error}
            </p>
          )}
          {plans.status === 'empty' && (
            <p className="text-xs text-muted-foreground">
              No persisted detail for this run id
            </p>
          )}
          {plans.status === 'success' && (
            <RunPlansPreview plans={plans.data} />
          )}
        </section>
      </CardContent>
    </Card>
  );
}
// --- eforge:endregion runs-build-entrypoints ---
