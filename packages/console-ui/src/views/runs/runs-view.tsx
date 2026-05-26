// --- eforge:region runs-build-entrypoints ---
import * as React from 'react';
import {
  Card,
  CardContent,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/common/empty-state';
import type { ConsoleProjectState } from '@/lib/project-state';
import type { UseActiveSessionStreamsResult } from '@/hooks/use-active-session-streams';
import {
  selectRunGroups,
  partitionRunGroups,
  filterRunGroups,
  bucketRunGroupsByDay,
  projectBasename,
} from '@/lib/selectors/runs';
import type { RunFilterState } from '@/lib/selectors/runs';
import { useRunDetail } from '@/hooks/use-run-detail';
import { toConsolePath } from '@/lib/navigation';
import { ActiveRunsPanel } from './active-runs-panel';
import { RunDetailPanel } from './run-detail-panel';
import { RunsFilterBar } from './runs-filter-bar';
import { RunsDayGroups } from './runs-day-groups';

interface RunsViewProps {
  projectState: ConsoleProjectState;
  activeSessionStreams: UseActiveSessionStreamsResult;
  /** Injected for deterministic tests; defaults to `new Date()` inside the selector. */
  now?: Date;
}

function getSelectedSessionFromSearch(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('session');
}

const DEFAULT_FILTER: RunFilterState = {
  status: 'all',
  command: 'all',
  search: '',
};

/**
 * Route component for `/console/runs`.
 * Answers: "What has run recently and where can I inspect active or historical build details?"
 */
export function RunsView({ projectState, activeSessionStreams, now }: RunsViewProps) {
  const {
    runs,
    sessionMetadata,
    connectionStatus,
    error,
    lastSnapshotAt,
    lastEventAt,
  } = projectState;
  const { sessions, activeSessionIds } = activeSessionStreams;

  const [selectedId, setSelectedId] = React.useState<string | null>(
    () => getSelectedSessionFromSearch(),
  );

  const [filter, setFilter] = React.useState<RunFilterState>(DEFAULT_FILTER);

  const handleSelect = React.useCallback((detailId: string) => {
    setSelectedId(detailId);
    if (typeof window !== 'undefined') {
      const url = `${toConsolePath('runs')}?session=${encodeURIComponent(detailId)}`;
      window.history.pushState(null, '', url);
    }
  }, []);

  React.useEffect(() => {
    const handlePopState = () => {
      setSelectedId(getSelectedSessionFromSearch());
    };
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  const detail = useRunDetail(selectedId);

  const allGroups = React.useMemo(
    () => selectRunGroups(runs, sessionMetadata),
    [runs, sessionMetadata],
  );

  const { active: activeGroups, history: historyGroups } = React.useMemo(
    () => partitionRunGroups(allGroups, activeSessionIds),
    [allGroups, activeSessionIds],
  );

  const filteredHistoryGroups = React.useMemo(
    () => filterRunGroups(historyGroups, filter),
    [historyGroups, filter],
  );

  const dayGroupedHistory = React.useMemo(
    () => bucketRunGroupsByDay(filteredHistoryGroups, now),
    [filteredHistoryGroups, now],
  );

  const projectName = React.useMemo(
    () => projectBasename(allGroups.find((g) => g.cwd)?.cwd ?? null),
    [allGroups],
  );

  const selectedGroup = React.useMemo(
    () => allGroups.find((g) => g.detailId === selectedId) ?? null,
    [allGroups, selectedId],
  );

  // Connecting state
  if (connectionStatus === 'connecting') {
    return (
      <div className="flex flex-col gap-4">
        <RunsHeader projectName={null} />
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-sm text-muted-foreground">
              Connecting to daemon stream...
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Disconnected state
  if (connectionStatus === 'disconnected') {
    return (
      <div className="flex flex-col gap-4">
        <RunsHeader projectName={null} />
        <Card className="border-destructive">
          <CardContent className="py-4 space-y-2">
            <p className="text-sm font-medium text-destructive">
              Disconnected from daemon stream
            </p>
            {error && (
              <p className="text-xs text-muted-foreground">{error}</p>
            )}
            {lastSnapshotAt && (
              <p className="text-xs text-muted-foreground">
                Last snapshot: {new Date(lastSnapshotAt).toLocaleString()}
              </p>
            )}
            {lastEventAt && (
              <p className="text-xs text-muted-foreground">
                Last event: {new Date(lastEventAt).toLocaleString()}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // Empty state (connected but no runs)
  if (runs.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <RunsHeader projectName={null} />
        <EmptyState
          title="No runs recorded for this project daemon yet"
          description="Queued work appears in the Queue view. Once builds start, they will appear here."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <RunsHeader projectName={projectName} />
      <RunsFilterBar filter={filter} onChange={setFilter} />
      <div className="flex flex-col lg:flex-row gap-4">
        <div className="flex-1 min-w-0 space-y-4">
          {activeGroups.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold mb-2">Active builds</h2>
              <ActiveRunsPanel
                groups={activeGroups}
                sessions={sessions}
                selectedId={selectedId}
                onSelect={handleSelect}
              />
            </section>
          )}
          {filteredHistoryGroups.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold mb-2">Run history</h2>
              <RunsDayGroups
                dayGroups={dayGroupedHistory}
                selectedId={selectedId}
                onSelect={handleSelect}
              />
            </section>
          )}
        </div>
        <div className="w-full lg:w-80 shrink-0">
          <RunDetailPanel
            selectedId={selectedId}
            detail={detail}
            profileLabel={selectedGroup?.profileLabel}
          />
        </div>
      </div>
    </div>
  );
}

interface RunsHeaderProps {
  projectName: string | null;
}

function RunsHeader({ projectName }: RunsHeaderProps) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <h1 className="text-sm font-semibold">Runs</h1>
        {projectName && (
          <Badge variant="secondary">{projectName}</Badge>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Recent build sessions and detail entry points
      </p>
    </div>
  );
}
// --- eforge:endregion runs-build-entrypoints ---
