// --- eforge:region console-shell ---
import * as React from 'react';
import { useState, useCallback, useEffect, lazy, Suspense } from 'react';
import { ConsoleShell } from '@/components/shell/console-shell';
import { CommandPalette } from '@/components/command-palette';
import { useDaemonEvents } from '@/hooks/use-daemon-events';
import { useAutoBuild } from '@/hooks/use-auto-build';
import { useActiveSessionStreams } from '@/hooks/use-active-session-streams';
import { selectActiveSessionIds } from '@/lib/selectors';
import { parseConsoleRoute, toConsolePath } from '@/lib/navigation';
import type { ConsoleRouteId } from '@/lib/navigation';
const RunDetailView = lazy(() =>
  import('@/views/run-detail').then((m) => ({ default: m.RunDetailView })),
);

const WorkstationsView = lazy(() =>
  import('@/views/workstations').then((m) => ({ default: m.WorkstationsView })),
);
// --- eforge:region now-dashboard ---
import { NowDashboard } from './views/now-dashboard';
// --- eforge:endregion now-dashboard ---
// --- eforge:region system-configuration-view ---
const SystemConfigurationView = lazy(() =>
  import('@/views/system').then((m) => ({ default: m.SystemConfigurationView })),
);
// --- eforge:endregion system-configuration-view ---

function currentLocationPath(): string {
  return window.location.pathname + window.location.search;
}

function getInitialRoute(): ConsoleRouteId {
  if (typeof window !== 'undefined') {
    return parseConsoleRoute(currentLocationPath());
  }
  return 'now';
}

export function App() {
  const [currentRoute, setCurrentRoute] = useState<ConsoleRouteId>(getInitialRoute);

  // Daemon-wide state
  const { projectState, refreshQueue, refreshRuns, refreshFailedEnqueues, setDaemonAutoBuild } = useDaemonEvents();
  const {
    toggling: autoBuildToggling,
    setEnabled: onSetAutoBuildEnabled,
    schedulerToggling,
    schedulerError,
    pauseScheduler,
    resumeScheduler,
  } = useAutoBuild(projectState.autoBuild, setDaemonAutoBuild);

  // Derive active session IDs from live runs
  const activeSessionIds = selectActiveSessionIds(projectState.runs);

  // Subscribe to active session streams
  const activeSessionStreams = useActiveSessionStreams(activeSessionIds);

  useEffect(() => {
    const handlePopState = () => {
      setCurrentRoute(parseConsoleRoute(currentLocationPath()));
    };
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  // Canonicalize legacy `/console/runs/:id` build-detail URLs to `/console/builds/:id`
  // on first load so bookmarks and shared links land on the current path.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const route = parseConsoleRoute(window.location.pathname);
    if (typeof route === 'object' && route.id === 'buildDetail') {
      const canonical = toConsolePath(route);
      if (window.location.pathname.replace(/\/$/, '') !== canonical) {
        window.history.replaceState(null, '', canonical);
      }
    }
  }, []);

  const handleNavigate = useCallback((href: string) => {
    const route = parseConsoleRoute(href);
    setCurrentRoute(route);
    if (typeof window !== 'undefined') {
      window.history.pushState(null, '', toConsolePath(route));
    }
  }, []);

  const routeContent = (() => {
    // --- eforge:region now-dashboard ---
    if (currentRoute === 'now') {
      return (
        <NowDashboard
          projectState={projectState}
          activeSessions={activeSessionStreams}
          onNavigate={handleNavigate}
          refreshQueue={refreshQueue}
          refreshRuns={refreshRuns}
          refreshFailedEnqueues={refreshFailedEnqueues}
        />
      );
    }
    // --- eforge:endregion now-dashboard ---

    // --- eforge:region system-configuration-view ---
    if (currentRoute === 'system') {
      return (
        <Suspense fallback={<div className="flex items-center justify-center h-full text-text-dim text-sm">Loading...</div>}>
          <SystemConfigurationView projectState={projectState} />
        </Suspense>
      );
    }
    // --- eforge:endregion system-configuration-view ---


    if (currentRoute === 'workstations' || (typeof currentRoute === 'object' && currentRoute.id === 'workstationDetail')) {
      const selectedWorkstationId = typeof currentRoute === 'object' ? currentRoute.workstationId : undefined;
      const workstationSubPath = typeof currentRoute === 'object' ? currentRoute.subPath : undefined;
      return (
        <Suspense fallback={<div className="flex items-center justify-center h-full text-text-dim text-sm">Loading...</div>}>
          <WorkstationsView selectedWorkstationId={selectedWorkstationId} subPath={workstationSubPath} onNavigate={handleNavigate} />
        </Suspense>
      );
    }

    if (typeof currentRoute === 'object' && currentRoute.id === 'buildDetail') {
      const { detailId } = currentRoute;
      const isLive = activeSessionIds.includes(detailId);
      const liveRunState = isLive
        ? activeSessionStreams.sessions[detailId]?.runState
        : undefined;
      return (
        <Suspense fallback={<div className="flex items-center justify-center h-full text-text-dim text-sm">Loading...</div>}>
          <RunDetailView
            detailId={detailId}
            isLive={isLive}
            liveRunState={liveRunState}
            onBack={() => handleNavigate('/console/')}
          />
        </Suspense>
      );
    }
    return null;
  })();

  return (
    <>
      <CommandPalette onNavigate={handleNavigate} />
      <ConsoleShell
        projectState={projectState}
        autoBuildToggling={autoBuildToggling}
        onSetAutoBuildEnabled={onSetAutoBuildEnabled}
        schedulerToggling={schedulerToggling}
        schedulerError={schedulerError}
        onPauseScheduler={pauseScheduler}
        onResumeScheduler={resumeScheduler}
        onNavigate={handleNavigate}
      >
        {routeContent}
      </ConsoleShell>
    </>
  );
}
// --- eforge:endregion console-shell ---
