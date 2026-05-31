// --- eforge:region console-shell ---
import { useReducer, useEffect, useCallback } from 'react';
import { API_ROUTES, subscribeWithSnapshot } from '@eforge-build/client/browser';
import type { AutoBuildState, DaemonStreamSnapshot, EforgeEvent, QueueItem } from '@eforge-build/client/browser';
import {
  consoleProjectReducer,
  initialConsoleProjectState,
  type ConsoleProjectState,
} from '@/lib/project-state';
import type { ConnectionStatus } from '@/lib/types';

export interface UseDaemonEventsResult {
  projectState: ConsoleProjectState;
  connectionStatus: ConnectionStatus;
  refreshQueue: () => Promise<void>;
  setDaemonAutoBuild: (autoBuild: AutoBuildState | null) => void;
}

export function useDaemonEvents(): UseDaemonEventsResult {
  const [projectState, dispatch] = useReducer(
    consoleProjectReducer,
    initialConsoleProjectState,
  );

  const refreshQueue = useCallback(async () => {
    const response = await fetch(API_ROUTES.queue);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Queue refresh failed (${response.status}): ${text}`);
    }
    const queue = await response.json() as QueueItem[];
    dispatch({ type: 'QUEUE_REFRESH_RECEIVED', queue });
  }, []);

  const setDaemonAutoBuild = useCallback((autoBuild: AutoBuildState | null) => {
    dispatch({ type: 'SET_AUTO_BUILD', autoBuild });
  }, []);

  useEffect(() => {
    const abort = new AbortController();

    dispatch({ type: 'CONNECTING' });

    (async () => {
      try {
        for await (const frame of subscribeWithSnapshot<DaemonStreamSnapshot, EforgeEvent>(
          API_ROUTES.daemonEvents,
          { signal: abort.signal },
        )) {
          if (frame.kind === 'snapshot') {
            dispatch({
              type: 'SNAPSHOT_RECEIVED',
              snapshot: frame.snapshot,
              receivedAt: Date.now(),
            });
          } else if (frame.kind === 'event') {
            dispatch({
              type: 'EVENT_RECEIVED',
              event: frame.event,
              eventId: frame.eventId ?? '',
              receivedAt: Date.now(),
            });
          }
          // Named events are not expected on the daemon-events stream; ignore.
        }
      } catch (err: unknown) {
        if (abort.signal.aborted) return;
        console.error('useDaemonEvents: subscribeWithSnapshot failed:', err);
        dispatch({
          type: 'STREAM_ERROR',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();

    return () => {
      abort.abort();
    };
  }, []);

  return {
    projectState,
    connectionStatus: projectState.connectionStatus,
    refreshQueue,
    setDaemonAutoBuild,
  };
}
// --- eforge:endregion console-shell ---
