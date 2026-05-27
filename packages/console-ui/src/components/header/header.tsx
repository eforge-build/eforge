import * as React from 'react';
import { useState, useEffect } from 'react';
import { EFORGE_LOGO_URL, EFORGE_LOGO_ALT } from '@/lib/brand';
import { selectNowStatusSummary } from '@/lib/selectors/now';
import { formatRelativeTime, formatAbsoluteTimestamp } from '@/lib/format';
import { projectBasename } from '@/lib/selectors/runs';
import type { ConsoleProjectState } from '@/lib/project-state';
import { ConnectionIndicator } from './connection-indicator';
import { AutoBuildToggle } from './auto-build-toggle';
import { ProjectNameChip } from './project-name-chip';
import { ControlSurfaceLinks } from './control-surface-links';

interface HeaderProps {
  projectState: ConsoleProjectState;
  onNavigate?: (href: string) => void;
}

export function Header({ projectState, onNavigate }: HeaderProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  const summary = selectNowStatusSummary(projectState, {}, now);

  // Derive project repo basename from the most recent run's cwd
  const latestCwd = React.useMemo(() => {
    if (projectState.runs.length === 0) return null;
    const sorted = [...projectState.runs].sort((a, b) =>
      a.startedAt > b.startedAt ? -1 : a.startedAt < b.startedAt ? 1 : 0,
    );
    return sorted[0].cwd;
  }, [projectState.runs]);
  const basename = projectBasename(latestCwd);

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
        <img
          src={EFORGE_LOGO_URL}
          alt={EFORGE_LOGO_ALT}
          className="w-6 h-6 rounded"
          width={24}
          height={24}
        />
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

        {/* Queue count chip */}
        <span aria-label="queue count">
          Q: <span className="text-foreground">{summary.queueDepth}</span>
        </span>

        {/* Active builds chip */}
        <span aria-label="active builds count">
          Active: <span className="text-foreground">{summary.activeBuildCount}</span>
        </span>

        {/* Connection indicator */}
        <ConnectionIndicator status={summary.connectionStatus} />

        {/* Auto-build toggle */}
        <AutoBuildToggle enabled={summary.autoBuildEnabled} />
      </div>
    </header>
  );
}
