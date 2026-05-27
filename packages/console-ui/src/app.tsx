// --- eforge:region console-shell ---
import * as React from 'react';
import { useState, useCallback, useEffect } from 'react';
import { ConsoleShell } from '@/components/shell/console-shell';
import { RoutePlaceholder } from '@/components/shell/route-placeholder';
import { useDaemonEvents } from '@/hooks/use-daemon-events';
import { useActiveSessionStreams } from '@/hooks/use-active-session-streams';
import { selectActiveSessionIds } from '@/lib/selectors';
import { parseConsoleRoute, toConsolePath } from '@/lib/navigation';
import type { ConsoleRouteId } from '@/lib/navigation';
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
      return <NowDashboard projectState={projectState} activeSessions={activeSessionStreams} />;
    }
    // --- eforge:endregion now-dashboard ---

    // --- eforge:region system-configuration-view ---
    if (currentRoute === 'system') {
      return <SystemConfigurationView projectState={projectState} />;
    }
    // --- eforge:endregion system-configuration-view ---

    // Run detail placeholder — full BuildDetailView lands in plan-06
    return (
      <RoutePlaceholder
        routeId="runDetail"
        connectionStatus={projectState.connectionStatus}
      />
    );
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
