/**
 * Hook that manages list and detail fetch state for the Plans workspace.
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import { fetchSessionPlanList, fetchSessionPlanShow } from './session-plan-fetches';
import { selectDefaultSession, isSessionInList } from './session-plan-selectors';
import type { SessionPlanListEntryWire, SessionPlanShowResponse } from '@eforge-build/client/browser';

type FetchStatus = 'idle' | 'loading' | 'success' | 'error';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface SessionPlansHookResult {
  /** Session plan list entries. */
  plans: SessionPlanListEntryWire[];
  listStatus: FetchStatus;
  listError: string | null;
  /** Whether submitted/handed-off plans are included in the list. */
  includeSubmitted: boolean;
  /** Currently selected session ID (null if list is empty). */
  selectedSession: string | null;
  /** Full detail for the selected plan. */
  detail: SessionPlanShowResponse | null;
  detailStatus: FetchStatus;
  detailError: string | null;
  /** Toggle the include-submitted filter. */
  setIncludeSubmitted: (value: boolean) => void;
  /** Select a plan from the list and fetch its detail. */
  selectPlan: (session: string) => void;
  /** Re-fetch the current list. */
  refresh: () => void;
}

export function useSessionPlans(): SessionPlansHookResult {
  const [plans, setPlans] = useState<SessionPlanListEntryWire[]>([]);
  const [listStatus, setListStatus] = useState<FetchStatus>('idle');
  const [listError, setListError] = useState<string | null>(null);
  const [includeSubmitted, setIncludeSubmittedState] = useState(false);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [detail, setDetail] = useState<SessionPlanShowResponse | null>(null);
  const [detailStatus, setDetailStatus] = useState<FetchStatus>('idle');
  const [detailError, setDetailError] = useState<string | null>(null);

  const listAbortRef = useRef<AbortController | null>(null);
  const detailAbortRef = useRef<AbortController | null>(null);
  // Track current selection in a ref so async callbacks can access the latest value.
  const selectedRef = useRef<string | null>(null);
  const includeSubmittedRef = useRef(false);

  const fetchDetail = useCallback((session: string) => {
    if (detailAbortRef.current) detailAbortRef.current.abort();
    const ctrl = new AbortController();
    detailAbortRef.current = ctrl;
    setDetailStatus('loading');
    setDetailError(null);
    setDetail(null);
    fetchSessionPlanShow({ session, signal: ctrl.signal })
      .then((data) => {
        if (ctrl.signal.aborted) return;
        setDetailStatus('success');
        setDetail(data);
      })
      .catch((err) => {
        if (ctrl.signal.aborted) return;
        setDetailStatus('error');
        setDetailError(errorMessage(err));
      });
  }, []);

  const fetchList = useCallback(
    (includeSubmittedFlag: boolean) => {
      if (listAbortRef.current) listAbortRef.current.abort();
      const ctrl = new AbortController();
      listAbortRef.current = ctrl;
      setListStatus('loading');
      setListError(null);
      fetchSessionPlanList({ includeSubmitted: includeSubmittedFlag, signal: ctrl.signal })
        .then((data) => {
          if (ctrl.signal.aborted) return;
          setListStatus('success');
          setPlans(data.plans);
          // Preserve existing selection if still in new list; else pick first.
          const current = selectedRef.current;
          const newSelected = isSessionInList(current, data.plans)
            ? current
            : selectDefaultSession(data.plans);
          selectedRef.current = newSelected;
          setSelectedSession(newSelected);
          if (newSelected) fetchDetail(newSelected);
        })
        .catch((err) => {
          if (ctrl.signal.aborted) return;
          setListStatus('error');
          setListError(errorMessage(err));
        });
    },
    [fetchDetail],
  );

  const setIncludeSubmitted = useCallback(
    (value: boolean) => {
      includeSubmittedRef.current = value;
      setIncludeSubmittedState(value);
      fetchList(value);
    },
    [fetchList],
  );

  const selectPlan = useCallback(
    (session: string) => {
      selectedRef.current = session;
      setSelectedSession(session);
      fetchDetail(session);
    },
    [fetchDetail],
  );

  const refresh = useCallback(() => {
    fetchList(includeSubmittedRef.current);
  }, [fetchList]);

  // Initial load on mount.
  useEffect(() => {
    fetchList(false);
    return () => {
      listAbortRef.current?.abort();
      detailAbortRef.current?.abort();
    };
  }, [fetchList]);

  return {
    plans,
    listStatus,
    listError,
    includeSubmitted,
    selectedSession,
    detail,
    detailStatus,
    detailError,
    setIncludeSubmitted,
    selectPlan,
    refresh,
  };
}
