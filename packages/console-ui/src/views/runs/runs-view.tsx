// --- eforge:region runs-build-entrypoints ---
import * as React from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { EmptyState } from '@/components/common/empty-state';
import type { ConsoleProjectState } from '@/lib/project-state';
import type { UseActiveSessionStreamsResult } from '@/hooks/use-active-session-streams';
import { selectRunGroups, partitionRunGroups } from '@/lib/selectors/runs';
import { useRunDetail } from '@/hooks/use-run-detail';
import { toConsolePath } from '@/lib/navigation';
import { ActiveRunsPanel } from './active-runs-panel';
import { RunHistoryTable } from './run-history-table';
import { RunDetailPanel } from './run-detail-panel';

interface RunsViewProps {
  projectState: ConsoleProjectState;
  activeSessionStreams: UseActiveSessionStreamsResult;
}

function getSelectedSessionFromSearch(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('session');
}

/**
 * Route component for `/console/runs`.
 * Answers: "What has run recently and where can I inspect active or historical build details?"
 */
export function RunsView({ projectState, activeSessionStreams }: RunsViewProps) {
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

  // Connecting state
  if (connectionStatus === 'connecting') {
    return (
      <div className="flex flex-col gap-4 p-4">
        <RunsHeader />
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
      <div className="flex flex-col gap-4 p-4">
        <RunsHeader />
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
      <div className="flex flex-col gap-4 p-4">
        <RunsHeader />
        <EmptyState
          title="No runs recorded for this project daemon yet"
          description="Queued work appears in the Queue view. Once builds start, they will appear here."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <RunsHeader />
      <div className="flex gap-4">
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
          {historyGroups.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold mb-2">Run history</h2>
              <RunHistoryTable
                groups={historyGroups}
                selectedId={selectedId}
                onSelect={handleSelect}
              />
            </section>
          )}
        </div>
        <div className="w-80 shrink-0 hidden lg:block">
          <RunDetailPanel selectedId={selectedId} detail={detail} />
        </div>
      </div>
      <div className="lg:hidden">
        <RunDetailPanel selectedId={selectedId} detail={detail} />
      </div>
    </div>
  );
}

function RunsHeader() {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">Runs</CardTitle>
        <CardDescription className="text-xs">
          Recent build sessions and detail entry points
        </CardDescription>
      </CardHeader>
    </Card>
  );
}
// --- eforge:endregion runs-build-entrypoints ---
