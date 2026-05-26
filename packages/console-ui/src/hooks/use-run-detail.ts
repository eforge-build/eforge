// --- eforge:region runs-build-entrypoints ---
import { useState, useEffect, useRef } from 'react';
import { API_ROUTES, buildPath } from '@eforge-build/client/browser';
import type { RunSummary, RunState, PlansResponse } from '@eforge-build/client/browser';
import { fetchJson } from '@/lib/fetch-json';

export type ResourceState<T> =
  | { status: 'idle'; data: null; error: null }
  | { status: 'loading'; data: null; error: null }
  | { status: 'success'; data: T; error: null }
  | { status: 'empty'; data: null; error: null }
  | { status: 'error'; data: null; error: string };

export interface RunDetailResult {
  summary: ResourceState<RunSummary>;
  state: ResourceState<RunState>;
  plans: ResourceState<PlansResponse>;
}

const IDLE = { status: 'idle' as const, data: null, error: null };
const LOADING = { status: 'loading' as const, data: null, error: null };

function success<T>(data: T): ResourceState<T> {
  return { status: 'success', data, error: null };
}

function empty<T>(): ResourceState<T> {
  return { status: 'empty', data: null, error: null };
}

function resourceError<T>(msg: string): ResourceState<T> {
  return { status: 'error', data: null, error: msg };
}

/** Injectable fetch function type — matches `fetchJson` signature for testing. */
export type FetchJsonFn = typeof fetchJson;

/**
 * On-demand hook that fetches run summary, state, and plans for the selected
 * run id. All three resources load independently; one failure does not block
 * others. When `selectedId` is null all resources stay in the `idle` state.
 *
 * A monotonically increasing token is used to ignore stale responses when the
 * selected id changes before a fetch completes.
 */
export function useRunDetail(
  selectedId: string | null,
  fetchJsonOverride?: FetchJsonFn,
): RunDetailResult {
  const [summary, setSummary] = useState<ResourceState<RunSummary>>(IDLE);
  const [state, setState] = useState<ResourceState<RunState>>(IDLE);
  const [plans, setPlans] = useState<ResourceState<PlansResponse>>(IDLE);

  // Monotonically increasing token to detect stale results
  const tokenRef = useRef(0);
  const fetcher = fetchJsonOverride ?? fetchJson;

  useEffect(() => {
    if (!selectedId) {
      // Invalidate any in-flight request so stale responses are ignored
      tokenRef.current++;
      setSummary(IDLE);
      setState(IDLE);
      setPlans(IDLE);
      return;
    }

    const token = ++tokenRef.current;

    setSummary(LOADING);
    setState(LOADING);
    setPlans(LOADING);

    const summaryUrl = buildPath(API_ROUTES.runSummary, { id: selectedId });
    const stateUrl = buildPath(API_ROUTES.runState, { id: selectedId });
    const plansUrl = buildPath(API_ROUTES.plans, { runId: selectedId });

    fetcher<RunSummary>(summaryUrl, { allowNotFound: true })
      .then((data) => {
        if (tokenRef.current !== token) return;
        setSummary(data === null ? empty<RunSummary>() : success(data));
      })
      .catch((err: unknown) => {
        if (tokenRef.current !== token) return;
        setSummary(resourceError<RunSummary>(err instanceof Error ? err.message : String(err)));
      });

    fetcher<RunState>(stateUrl, { allowNotFound: true })
      .then((data) => {
        if (tokenRef.current !== token) return;
        setState(data === null ? empty<RunState>() : success(data));
      })
      .catch((err: unknown) => {
        if (tokenRef.current !== token) return;
        setState(resourceError<RunState>(err instanceof Error ? err.message : String(err)));
      });

    fetcher<PlansResponse>(plansUrl, { allowNotFound: true })
      .then((data) => {
        if (tokenRef.current !== token) return;
        setPlans(data === null ? empty<PlansResponse>() : success(data));
      })
      .catch((err: unknown) => {
        if (tokenRef.current !== token) return;
        setPlans(resourceError<PlansResponse>(err instanceof Error ? err.message : String(err)));
      });
    return () => {
      tokenRef.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  return { summary, state, plans };
}
// --- eforge:endregion runs-build-entrypoints ---
