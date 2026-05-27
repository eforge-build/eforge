// --- eforge:region console-shell ---
import * as React from 'react';
import { useState, useCallback, useEffect, lazy, Suspense } from 'react';
import { ConsoleShell } from '@/components/shell/console-shell';
import { useDaemonEvents } from '@/hooks/use-daemon-events';
import { useActiveSessionStreams } from '@/hooks/use-active-session-streams';
import { selectActiveSessionIds } from '@/lib/selectors';
import { parseConsoleRoute, toConsolePath } from '@/lib/navigation';
import type { ConsoleRouteId } from '@/lib/navigation';
// --- eforge:region plan-06-build-detail-base ---
const RunDetailView = lazy(() =>
  import('@/views/run-detail').then((m) => ({ default: m.RunDetailView })),
);
// --- eforge:endregion plan-06-build-detail-base ---
// --- eforge:region now-dashboard ---
import { NowDashboard } from './views/now-dashboard';
// --- eforge:endregion now-dashboard ---
// --- eforge:region system-configuration-view ---
import { SystemConfigurationView } from '@/views/system';
// --- eforge:endregion system-configuration-view ---

function getInitialRoute(): ConsoleRouteId {
  if (typeof window !== 'undefined') {
    return parseConsoleRoute(window.location.pathname);
  }
  return 'now';
}

export function App() {
  const [currentRoute, setCurrentRoute] = useState<ConsoleRouteId>(getInitialRoute);

  // Daemon-wide state
  const { projectState } = useDaemonEvents();

  // Derive active session IDs from live runs
  const activeSessionIds = selectActiveSessionIds(projectState.runs);

  // Subscribe to active session streams
  const activeSessionStreams = useActiveSessionStreams(activeSessionIds);

  useEffect(() => {
    const handlePopState = () => {
      setCurrentRoute(parseConsoleRoute(window.location.pathname));
    };
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
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
      return <NowDashboard projectState={projectState} activeSessions={activeSessionStreams} onNavigate={handleNavigate} />;
    }
    // --- eforge:endregion now-dashboard ---

    // --- eforge:region system-configuration-view ---
    if (currentRoute === 'system') {
      return <SystemConfigurationView projectState={projectState} />;
    }
    // --- eforge:endregion system-configuration-view ---

    // --- eforge:region plan-06-build-detail-base ---
    if (typeof currentRoute === 'object' && currentRoute.id === 'runDetail') {
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
    // --- eforge:endregion plan-06-build-detail-base ---
    return null;
  })();

  return (
    <ConsoleShell
      projectState={projectState}
      onNavigate={handleNavigate}
    >
      {routeContent}
    </ConsoleShell>
  );
}
// --- eforge:endregion console-shell ---
