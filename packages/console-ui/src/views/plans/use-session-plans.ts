/**
 * Hook that manages list and detail fetch state for the Plans workspace.
 *
 * The list is a discriminated union of flat session plans and session plan sets
 * (see `planning-artifacts.ts`). Both list routes are fetched together and the
 * detail fetch is dispatched by the selected artifact's kind.
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import {
  fetchSessionPlanList,
  fetchSessionPlanShow,
  fetchSessionPlanSetList,
  fetchSessionPlanSetShow,
} from './session-plan-fetches';
import {
  combineArtifacts,
  selectDefaultArtifactKey,
  isArtifactKeyInList,
  artifactKindFromKey,
  artifactIdFromKey,
  type PlanningArtifactListItem,
} from './planning-artifacts';
import type {
  SessionPlanShowResponse,
  SessionPlanSetShowResponse,
} from '@eforge-build/client/browser';

type FetchStatus = 'idle' | 'loading' | 'success' | 'error';

/** Detail payload for the selected artifact, tagged by kind. */
export type ArtifactDetail =
  | { kind: 'plan'; data: SessionPlanShowResponse }
  | { kind: 'plan-set'; data: SessionPlanSetShowResponse };

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface SessionPlansHookResult {
  /** Combined list of flat session plans and session plan sets. */
  items: PlanningArtifactListItem[];
  listStatus: FetchStatus;
  listError: string | null;
  /** Whether submitted/handed-off artifacts are included in the lists. */
  includeSubmitted: boolean;
  /** Currently selected artifact key (null if list is empty). */
  selectedKey: string | null;
  /** Full detail for the selected artifact, tagged by kind. */
  detail: ArtifactDetail | null;
  detailStatus: FetchStatus;
  detailError: string | null;
  /** Toggle the include-submitted filter. */
  setIncludeSubmitted: (value: boolean) => void;
  /** Select an artifact from the list and fetch its detail. */
  selectArtifact: (key: string) => void;
  /** Re-fetch the current lists. */
  refresh: () => void;
}

export function useSessionPlans(): SessionPlansHookResult {
  const [items, setItems] = useState<PlanningArtifactListItem[]>([]);
  const [listStatus, setListStatus] = useState<FetchStatus>('idle');
  const [listError, setListError] = useState<string | null>(null);
  const [includeSubmitted, setIncludeSubmittedState] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<ArtifactDetail | null>(null);
  const [detailStatus, setDetailStatus] = useState<FetchStatus>('idle');
  const [detailError, setDetailError] = useState<string | null>(null);

  const listAbortRef = useRef<AbortController | null>(null);
  const detailAbortRef = useRef<AbortController | null>(null);
  // Track current selection in a ref so async callbacks can access the latest value.
  const selectedRef = useRef<string | null>(null);
  const includeSubmittedRef = useRef(false);

  const fetchDetail = useCallback((key: string) => {
    const kind = artifactKindFromKey(key);
    const id = artifactIdFromKey(key);
    if (!kind || !id) return;
    if (detailAbortRef.current) detailAbortRef.current.abort();
    const ctrl = new AbortController();
    detailAbortRef.current = ctrl;
    setDetailStatus('loading');
    setDetailError(null);
    setDetail(null);

    const promise: Promise<ArtifactDetail> =
      kind === 'plan-set'
        ? fetchSessionPlanSetShow({ planSetId: id, signal: ctrl.signal }).then((data) => ({
            kind: 'plan-set' as const,
            data,
          }))
        : fetchSessionPlanShow({ session: id, signal: ctrl.signal }).then((data) => ({
            kind: 'plan' as const,
            data,
          }));

    promise
      .then((result) => {
        if (ctrl.signal.aborted) return;
        setDetailStatus('success');
        setDetail(result);
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
      Promise.all([
        fetchSessionPlanList({ includeSubmitted: includeSubmittedFlag, signal: ctrl.signal }),
        fetchSessionPlanSetList({ includeSubmitted: includeSubmittedFlag, signal: ctrl.signal }),
      ])
        .then(([planList, planSetList]) => {
          if (ctrl.signal.aborted) return;
          const combined = combineArtifacts(planList.plans, planSetList.planSets);
          setListStatus('success');
          setItems(combined);
          // Preserve existing selection if still in new list; else pick first.
          const current = selectedRef.current;
          const newSelected = isArtifactKeyInList(current, combined)
            ? current
            : selectDefaultArtifactKey(combined);
          selectedRef.current = newSelected;
          setSelectedKey(newSelected);
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

  const selectArtifact = useCallback(
    (key: string) => {
      selectedRef.current = key;
      setSelectedKey(key);
      fetchDetail(key);
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
    items,
    listStatus,
    listError,
    includeSubmitted,
    selectedKey,
    detail,
    detailStatus,
    detailError,
    setIncludeSubmitted,
    selectArtifact,
    refresh,
  };
}
