import { useEffect } from 'react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SummaryChips } from './summary-chips';
import { BottomTabPanel } from './bottom-tab-panel';
import { useHybridRunDetail } from '@/hooks/use-run-detail';
import { extractPrdTitle } from '@/lib/plan-content';
import type { RunState } from '@/lib/run-state';
import { PlanPreviewProvider, PlanPreviewPanel, usePlanPreview } from '@/components/preview';

interface RunDetailViewProps {
  /** Session/run ID being viewed. */
  detailId: string;
  /** Display title derived from the daemon's run and queue projections. */
  buildTitle?: string;
  /** Whether this session is currently live (active). */
  isLive: boolean;
  /** Pre-reduced live RunState (only provided when isLive is true). */
  liveRunState?: RunState;
  /** Called when the user navigates back. */
  onBack?: () => void;
}

export function RunDetailView({ detailId, buildTitle, isLive, liveRunState, onBack }: RunDetailViewProps) {
  const { runState, plans, isLoading, error } = useHybridRunDetail(
    detailId,
    isLive,
    liveRunState,
  );

  return (
    <PlanPreviewProvider>
      <RunDetailContent
        detailId={detailId}
        buildTitle={buildTitle}
        isLive={isLive}
        runState={runState}
        plans={plans}
        isLoading={isLoading}
        error={error}
        onBack={onBack}
      />
    </PlanPreviewProvider>
  );
}

interface RunDetailContentProps {
  detailId: string;
  buildTitle?: string;
  isLive: boolean;
  runState: RunState | null;
  plans: Parameters<typeof BottomTabPanel>[0]['plans'];
  isLoading: boolean;
  error: string | null;
  onBack?: () => void;
}

function getRunTitle(runState: RunState | null): string | null {
  if (!runState) return null;
  if (runState.enqueueTitle) return runState.enqueueTitle;

  for (let i = runState.events.length - 1; i >= 0; i--) {
    const { event } = runState.events[i];
    if (event.type !== 'planning:start') continue;
    return extractPrdTitle(event.source) ?? event.label ?? null;
  }

  return null;
}

function RunDetailContent({ detailId, buildTitle, isLive, runState, plans, isLoading, error, onBack }: RunDetailContentProps) {
  const { setRuntimeData } = usePlanPreview();
  const runTitle = getRunTitle(runState) ?? buildTitle ?? null;

  useEffect(() => {
    if (!runState) return;
    setRuntimeData({
      planStatuses: runState.planStatuses,
      fileChanges: runState.fileChanges,
    });
  }, [runState, setRuntimeData]);

  return (
    <div className="flex flex-col h-full">
      {/* Back button + breadcrumb strip */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border shrink-0">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="flex items-center gap-1.5 text-text-dim hover:text-text-bright"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back
        </Button>
        <div className="min-w-0 flex flex-1 flex-col">
          <span className="text-sm font-medium text-foreground truncate" title={runTitle ?? detailId}>
            {runTitle ?? detailId}
          </span>
          {runTitle && (
            <span className="text-10px text-text-dim font-mono truncate" title={detailId}>
              {detailId}
            </span>
          )}
        </div>
        {isLive && (
          <span className="ml-1 inline-flex items-center gap-1 text-10px font-medium text-blue">
            <span className="w-1.5 h-1.5 rounded-full bg-blue animate-pulse" />
            Live
          </span>
        )}
      </div>

      {/* Summary chips */}
      {runState && (
        <div className="px-4 py-2 border-b border-border shrink-0">
          <SummaryChips runState={runState} />
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 min-h-0">
        {isLoading && !runState && (
          <div className="flex items-center justify-center h-full gap-2 text-text-dim">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Loading build detail...</span>
          </div>
        )}

        {error && !runState && (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-red">{error}</p>
          </div>
        )}

        {runState && (
          <BottomTabPanel runState={runState} plans={plans} detailId={detailId} />
        )}
      </div>

      <PlanPreviewPanel sessionId={detailId} />
    </div>
  );
}
