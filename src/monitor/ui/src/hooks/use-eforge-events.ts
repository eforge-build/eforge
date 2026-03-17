import { useReducer, useEffect, useRef, useState } from 'react';
import { eforgeReducer, initialRunState, type RunState } from '@/lib/reducer';
import type { ConnectionStatus, EforgeEvent } from '@/lib/types';

interface UseEforgeEventsResult {
  runState: RunState;
  connectionStatus: ConnectionStatus;
}

interface RunStateResponse {
  status: string;
  events: Array<{ id: number; data: string }>;
}

export function useEforgeEvents(sessionId: string | null): UseEforgeEventsResult {
  const [runState, dispatch] = useReducer(eforgeReducer, initialRunState);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const eventSourceRef = useRef<EventSource | null>(null);
  const cacheRef = useRef<Map<string, RunState>>(new Map());

  useEffect(() => {
    if (!sessionId) {
      dispatch({ type: 'RESET' });
      setConnectionStatus('disconnected');
      return;
    }

    // Check client-side cache first (completed sessions only)
    const cached = cacheRef.current.get(sessionId);
    if (cached) {
      dispatch({ type: 'BATCH_LOAD', events: cached.events });
      setConnectionStatus('connected');
      return;
    }

    // Close existing SSE connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    let cancelled = false;
    setConnectionStatus('connecting');

    // Batch-fetch all events via HTTP
    fetch(`/api/run-state/${sessionId}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<RunStateResponse>;
      })
      .then((data) => {
        if (cancelled) return;

        // Parse all events and dispatch as a single batch
        const parsed: Array<{ event: EforgeEvent; eventId: string }> = [];
        for (const ev of data.events) {
          try {
            parsed.push({ event: JSON.parse(ev.data), eventId: String(ev.id) });
          } catch { /* skip unparseable */ }
        }

        dispatch({ type: 'BATCH_LOAD', events: parsed });
        setConnectionStatus('connected');

        const lastEventId = data.events.length > 0 ? data.events[data.events.length - 1].id : 0;
        const hasSessionEnd = parsed.some((ev) => ev.event.type === 'session:end');

        if (hasSessionEnd) {
          // Session is done — cache it and skip SSE
          const finalState = parsed.reduce(
            (st, ev) => eforgeReducer(st, { type: 'ADD_EVENT', ...ev }),
            { ...initialRunState, fileChanges: new Map() } as RunState,
          );
          cacheRef.current.set(sessionId, finalState);
          return;
        }

        // Session is still active — open SSE for live events only
        const es = new EventSource(`/api/events/${sessionId}`);
        eventSourceRef.current = es;

        // Track which events we already have from batch load
        let maxSeenId = lastEventId;

        es.onmessage = (msg) => {
          if (cancelled) return;
          const msgId = parseInt(msg.lastEventId, 10);
          // Skip events we already have from the batch
          if (msgId <= maxSeenId) return;
          maxSeenId = msgId;
          try {
            const event: EforgeEvent = JSON.parse(msg.data);
            dispatch({ type: 'ADD_EVENT', event, eventId: msg.lastEventId });
          } catch (e) {
            console.error('Failed to parse event:', e);
          }
        };

        es.onerror = () => {
          if (!cancelled) setConnectionStatus('connecting');
        };
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('Failed to fetch run state:', err);
        setConnectionStatus('disconnected');
        // Fallback to SSE-only for backward compat
        dispatch({ type: 'RESET' });
        const es = new EventSource(`/api/events/${sessionId}`);
        eventSourceRef.current = es;
        es.onopen = () => { if (!cancelled) setConnectionStatus('connected'); };
        es.onmessage = (msg) => {
          if (cancelled) return;
          try {
            const event: EforgeEvent = JSON.parse(msg.data);
            dispatch({ type: 'ADD_EVENT', event, eventId: msg.lastEventId });
          } catch (e) {
            console.error('Failed to parse event:', e);
          }
        };
        es.onerror = () => { if (!cancelled) setConnectionStatus('connecting'); };
      });

    return () => {
      cancelled = true;
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [sessionId]);

  return { runState, connectionStatus };
}
