// --- eforge:region console-shell ---
import { useState, useEffect, useRef } from 'react';
import { buildPath, subscribeWithSnapshot } from '@eforge-build/client/browser';
import { API_ROUTES } from '@eforge-build/client/browser';
import type { SessionStreamSnapshot, EforgeEvent } from '@eforge-build/client/browser';
import type { ConnectionStatus } from '@/lib/types';
import { isTerminalStatus } from '@/lib/selectors/active-builds';

/** Maximum number of recent live events retained in memory per session. */
const MAX_RETAINED_LIVE_EVENTS = 50;

export interface ActiveSessionDetail {
  sessionId: string;
  connectionStatus: ConnectionStatus;
  status: SessionStreamSnapshot['status'] | 'connecting' | 'disconnected';
  snapshotEvents: SessionStreamSnapshot['events'];
  /** Most recent live events (capped to last MAX_RETAINED_LIVE_EVENTS). */
  liveEvents: EforgeEvent[];
  /** Total count of live events received (not capped). */
  liveEventCount: number;
  lastEventAt: number | null;
  error: string | null;
}

export interface UseActiveSessionStreamsResult {
  sessions: Record<string, ActiveSessionDetail>;
  activeSessionIds: string[];
  subscriptionCount: number;
}

/**
 * Injected subscribe function type — matches the `subscribeWithSnapshot` signature
 * used in tests to inject a fake implementation.
 */
export type SubscribeFn = typeof subscribeWithSnapshot;

function isTerminalSessionStatus(status: string): boolean {
  return isTerminalStatus(status) || status === 'completed' || status === 'failed';
}

function isTerminalLiveEvent(event: EforgeEvent): boolean {
  if (event.type === 'session:end') return true;
  return false;
}

export function useActiveSessionStreams(
  sessionIds: readonly string[],
  _subscribeFn: SubscribeFn = subscribeWithSnapshot,
): UseActiveSessionStreamsResult {
  const [sessions, setSessions] = useState<Record<string, ActiveSessionDetail>>({});
  // Track AbortControllers per session ID
  const controllersRef = useRef<Map<string, AbortController>>(new Map());
  // Track terminal session IDs that were already preserved for one render pass
  const preservedTerminalRef = useRef<Set<string>>(new Set());
  // Ref for stable subscribe function reference
  const subscribeFnRef = useRef<SubscribeFn>(_subscribeFn);
  subscribeFnRef.current = _subscribeFn;

  useEffect(() => {
    const currentIds = new Set(sessionIds);
    const existingIds = new Set(controllersRef.current.keys());

    // Abort controllers for sessions removed from the active set
    for (const id of existingIds) {
      if (!currentIds.has(id)) {
        const ctrl = controllersRef.current.get(id);
        ctrl?.abort();
        controllersRef.current.delete(id);
      }
    }

    // Subscribe to newly added sessions
    for (const sessionId of sessionIds) {
      if (existingIds.has(sessionId)) continue;

      const ctrl = new AbortController();
      controllersRef.current.set(sessionId, ctrl);

      const url = buildPath(API_ROUTES.events, { runId: sessionId });

      // Initialize detail as connecting
      setSessions((prev) => ({
        ...prev,
        [sessionId]: {
          sessionId,
          connectionStatus: 'connecting',
          status: 'connecting',
          snapshotEvents: [],
          liveEvents: [],
          liveEventCount: 0,
          lastEventAt: null,
          error: null,
        },
      }));

      (async () => {
        try {
          for await (const frame of subscribeFnRef.current<SessionStreamSnapshot, EforgeEvent>(
            url,
            { signal: ctrl.signal },
          )) {
            if (frame.kind === 'snapshot') {
              const snapshot = frame.snapshot;
              setSessions((prev) => ({
                ...prev,
                [sessionId]: {
                  ...prev[sessionId],
                  connectionStatus: 'connected',
                  status: snapshot.status,
                  snapshotEvents: snapshot.events,
                  liveEvents: [],
                  liveEventCount: 0,
                  lastEventAt: Date.now(),
                  error: null,
                },
              }));
              // Close if terminal session
              if (isTerminalSessionStatus(snapshot.status)) {
                ctrl.abort();
                controllersRef.current.delete(sessionId);
                break;
              }
            } else if (frame.kind === 'event') {
              const event = frame.event;
              setSessions((prev) => {
                const detail = prev[sessionId];
                if (!detail) return prev;
                const newLiveEvents = [...detail.liveEvents, event].slice(-MAX_RETAINED_LIVE_EVENTS);
                return {
                  ...prev,
                  [sessionId]: {
                    ...detail,
                    liveEvents: newLiveEvents,
                    liveEventCount: detail.liveEventCount + 1,
                    lastEventAt: Date.now(),
                  },
                };
              });
              // Close on terminal live event
              if (isTerminalLiveEvent(event)) {
                const terminalStatus =
                  event.type === 'session:end' && event.result.status === 'failed'
                    ? 'failed'
                    : 'completed';
                setSessions((prev) => ({
                  ...prev,
                  [sessionId]: {
                    ...prev[sessionId],
                    status: terminalStatus,
                  },
                }));
                ctrl.abort();
                controllersRef.current.delete(sessionId);
                break;
              }
            }
          }
        } catch (err: unknown) {
          if (ctrl.signal.aborted) return;
          const errorMsg = err instanceof Error ? err.message : String(err);
          ctrl.abort();
          controllersRef.current.delete(sessionId);
          setSessions((prev) => ({
            ...prev,
            [sessionId]: {
              ...prev[sessionId],
              connectionStatus: 'disconnected',
              status: 'disconnected',
              error: errorMsg,
            },
          }));
        }
      })();
    }

    // Cleanup: remove stale sessions from state that are no longer active.
    // Terminal sessions that just left the active set are kept for exactly one
    // render pass so consumers can read their final state before removal.
    const prevPreserved = preservedTerminalRef.current;
    const nextPreserved = new Set<string>();
    setSessions((prev) => {
      const next: Record<string, ActiveSessionDetail> = {};
      for (const id of sessionIds) {
        if (prev[id]) next[id] = prev[id];
      }
      // Keep terminal sessions for one pass after they leave currentIds
      for (const [id, detail] of Object.entries(prev)) {
        if (!currentIds.has(id) && isTerminalSessionStatus(detail.status)) {
          if (!prevPreserved.has(id)) {
            // First time this session left the active set — preserve for one pass
            next[id] = detail;
            nextPreserved.add(id);
          }
          // else: already preserved once, allow removal
        }
      }
      return next;
    });
    preservedTerminalRef.current = nextPreserved;
  }, [sessionIds.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup all on unmount
  useEffect(() => {
    return () => {
      for (const ctrl of controllersRef.current.values()) {
        ctrl.abort();
      }
      controllersRef.current.clear();
    };
  }, []);

  return {
    sessions,
    activeSessionIds: Array.from(sessionIds),
    subscriptionCount: controllersRef.current.size,
  };
}
// --- eforge:endregion console-shell ---
