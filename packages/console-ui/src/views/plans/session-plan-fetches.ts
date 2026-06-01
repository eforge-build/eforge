/**
 * Typed fetch functions for the Plans workspace.
 * All paths are built from API_ROUTES and URLSearchParams — no /api/ literals.
 */
import { API_ROUTES } from '@eforge-build/client/browser';
import { fetchJson } from '@/lib/fetch-json';
import type {
  SessionPlanListResponse,
  SessionPlanShowResponse,
  SessionPlanSetListResponse,
  SessionPlanSetShowResponse,
  SessionPlanSetValidateResponse,
} from '@eforge-build/client/browser';

export async function fetchSessionPlanList(opts: {
  includeSubmitted?: boolean;
  signal?: AbortSignal;
}): Promise<SessionPlanListResponse> {
  const params = new URLSearchParams();
  if (opts.includeSubmitted) params.set('includeSubmitted', 'true');
  const query = params.toString() ? `?${params.toString()}` : '';
  const data = await fetchJson<SessionPlanListResponse>(
    `${API_ROUTES.sessionPlanList}${query}`,
    { signal: opts.signal },
  );
  return data!;
}

export async function fetchSessionPlanShow(opts: {
  session: string;
  signal?: AbortSignal;
}): Promise<SessionPlanShowResponse> {
  const params = new URLSearchParams({ session: opts.session });
  const data = await fetchJson<SessionPlanShowResponse>(
    `${API_ROUTES.sessionPlanShow}?${params.toString()}`,
    { signal: opts.signal },
  );
  return data!;
}

export async function fetchSessionPlanSetList(opts: {
  includeSubmitted?: boolean;
  signal?: AbortSignal;
}): Promise<SessionPlanSetListResponse> {
  const params = new URLSearchParams();
  if (opts.includeSubmitted) params.set('includeSubmitted', 'true');
  const query = params.toString() ? `?${params.toString()}` : '';
  const data = await fetchJson<SessionPlanSetListResponse>(
    `${API_ROUTES.sessionPlanSetList}${query}`,
    { signal: opts.signal },
  );
  return data!;
}

export async function fetchSessionPlanSetShow(opts: {
  planSetId: string;
  signal?: AbortSignal;
}): Promise<SessionPlanSetShowResponse> {
  const params = new URLSearchParams({ planSetId: opts.planSetId });
  const data = await fetchJson<SessionPlanSetShowResponse>(
    `${API_ROUTES.sessionPlanSetShow}?${params.toString()}`,
    { signal: opts.signal },
  );
  return data!;
}

export async function fetchSessionPlanSetValidate(opts: {
  planSetId: string;
  signal?: AbortSignal;
}): Promise<SessionPlanSetValidateResponse> {
  const params = new URLSearchParams({ planSetId: opts.planSetId });
  const data = await fetchJson<SessionPlanSetValidateResponse>(
    `${API_ROUTES.sessionPlanSetValidate}?${params.toString()}`,
    { signal: opts.signal },
  );
  return data!;
}
