// --- eforge:region console-shell ---
import { useReducer, useEffect } from 'react';
import { API_ROUTES, subscribeWithSnapshot } from '@eforge-build/client/browser';
import type { DaemonStreamSnapshot, EforgeEvent } from '@eforge-build/client/browser';
import {
  consoleProjectReducer,
  initialConsoleProjectState,
  type ConsoleProjectState,
} from '@/lib/project-state';
import type { ConnectionStatus } from '@/lib/types';

export interface UseDaemonEventsResult {
  projectState: ConsoleProjectState;
  connectionStatus: ConnectionStatus;
}

export function useDaemonEvents(): UseDaemonEventsResult {
  const [projectState, dispatch] = useReducer(
    consoleProjectReducer,
    initialConsoleProjectState,
  );

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
  };
}
// --- eforge:endregion console-shell ---
