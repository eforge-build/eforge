import * as React from 'react';
import { useState, useEffect } from 'react';
import { EforgeLogo } from './eforge-logo';
import { selectNowStatusSummary, selectNowQueueSummary } from '@/lib/selectors/now';
import { countActiveIntakeRuns, countActiveBuildRuns } from '@/lib/selectors/enqueue-cards';
import { formatRelativeTime, formatAbsoluteTimestamp } from '@/lib/format';
import { projectBasename } from '@/lib/selectors/runs';
import { projectLabelFromContext } from '@/lib/selectors/project-label';
import { useProjectContext } from '@/hooks/use-project-context';
import type { ConsoleProjectState } from '@/lib/project-state';
import { ConnectionIndicator } from './connection-indicator';
import { AutoBuildToggle } from './auto-build-toggle';
import { SchedulerPauseControl } from './scheduler-pause-control';
import { ProjectNameChip } from './project-name-chip';
import { ControlSurfaceLinks } from './control-surface-links';
import { PipelineChips } from './pipeline-chips';

interface HeaderProps {
  projectState: ConsoleProjectState;
  autoBuildToggling: boolean;
  onSetAutoBuildEnabled: (enabled: boolean) => void;
  schedulerToggling: boolean;
  schedulerError: string | null;
  onPauseScheduler: () => void;
  onResumeScheduler: () => void;
  onNavigate?: (href: string) => void;
}

export function Header({ projectState, autoBuildToggling, onSetAutoBuildEnabled, schedulerToggling, schedulerError, onPauseScheduler, onResumeScheduler, onNavigate }: HeaderProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  const summary = selectNowStatusSummary(projectState, {}, now);

  // Build-pipeline glance: intake = in-progress enqueue runs, active = in-progress
  // build runs (intake excluded), queued = forward queue (pending + waiting; a
  // running queue item is an active build, not queued). Sourced from the same
  // focused selectors the Now view uses so the header never disagrees with it.
  const queueSummary = selectNowQueueSummary(projectState.queue);
  const intakeCount = countActiveIntakeRuns(projectState.runs);
  const activeBuildCount = countActiveBuildRuns(projectState.runs);
  const queuedCount = queueSummary.pendingCount + queueSummary.waitingCount;

  // Derive project repo basename from the most recent run's cwd
  const latestCwd = React.useMemo(() => {
    if (projectState.runs.length === 0) return null;
    const sorted = [...projectState.runs].sort((a, b) =>
      a.startedAt > b.startedAt ? -1 : a.startedAt < b.startedAt ? 1 : 0,
    );
    return sorted[0].cwd;
  }, [projectState.runs]);
  // Project identity comes from the latest run's cwd when one exists; on a
  // fresh/idle daemon with no runs, fall back to daemon-reported project context.
  const projectContext = useProjectContext();
  const basename = projectBasename(latestCwd) ?? projectLabelFromContext(projectContext);

  const absoluteTs =
    projectState.lastEventAt != null || projectState.lastSnapshotAt != null
      ? Math.max(projectState.lastEventAt ?? 0, projectState.lastSnapshotAt ?? 0)
      : null;
  const relativeLabel =
    summary.lastUpdateMsAgo != null ? formatRelativeTime(summary.lastUpdateMsAgo) : '--';
  const absoluteLabel = absoluteTs != null ? formatAbsoluteTimestamp(absoluteTs) : null;

  return (
    <header className="flex items-center h-12 px-3 gap-3 border-b border-border flex-shrink-0 bg-background">
      {/* Logo + project name */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <EforgeLogo size={24} activeBuilds={activeBuildCount} />
        <ProjectNameChip basename={basename} />
      </div>

      {/* Control surface links slot */}
      <ControlSurfaceLinks onNavigate={onNavigate} />

      {/* Right side: status chips */}
      <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground flex-shrink-0">
        {/* Last update timestamp */}
        <span aria-label="last update">
          {relativeLabel}
          {absoluteLabel != null && (
            <span className="ml-1 text-muted-foreground/60">({absoluteLabel})</span>
          )}
        </span>

        {/* Build pipeline glance — condensed Intake · Queued · Active cluster,
            the single count surface for the pipeline. */}
        <PipelineChips intake={intakeCount} queued={queuedCount} active={activeBuildCount} />

        {/* Connection indicator */}
        <ConnectionIndicator status={summary.connectionStatus} />

        <SchedulerPauseControl
          autoBuild={projectState.autoBuild}
          pending={schedulerToggling}
          error={schedulerError}
          onPause={onPauseScheduler}
          onResume={onResumeScheduler}
        />

        {/* Auto-build toggle */}
        <AutoBuildToggle
          enabled={summary.autoBuildEnabled}
          autoBuild={projectState.autoBuild}
          toggling={autoBuildToggling}
          onSetEnabled={onSetAutoBuildEnabled}
        />
      </div>
    </header>
  );
}
