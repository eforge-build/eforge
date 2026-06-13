/**
 * Browser-safe fetch helpers for the recovery and continue-and-repair routes.
 *
 * Console consumes these instead of inlining `/api/...` paths. Every helper
 * builds its URL from `API_ROUTES` and surfaces non-2xx responses as an Error
 * whose message includes the daemon response text.
 */

import { API_ROUTES } from './routes.js';
import type {
  ReadSidecarResponse,
  RecoverRequest,
  RecoverResponse,
  ApplyRecoveryRequest,
  ApplyRecoveryResponse,
  ContinueRepairRequest,
  ContinueRepairResponse,
  ContinueRepairEligibilityRequest,
  ContinueRepairEligibilityResponse,
  AcceptSuccessPreviewRequest,
  AcceptSuccessPreviewResponse,
  AcceptSuccessRequest,
  AcceptSuccessResponse,
} from './routes.js';

async function getJson<TResponse>(path: string, init?: RequestInit): Promise<TResponse> {
  const res = await fetch(path, { ...init, method: 'GET' });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Recovery request failed (${res.status}): ${text}`);
  }
  return await res.json() as TResponse;
}

async function postJson<TResponse>(path: string, body: unknown, init?: RequestInit): Promise<TResponse> {
  const headers = new Headers(init?.headers);
  headers.set('Content-Type', 'application/json');
  const res = await fetch(path, {
    ...init,
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Recovery request failed (${res.status}): ${text}`);
  }
  return await res.json() as TResponse;
}

/** Read the recovery sidecar (markdown + JSON) for a failed PRD. */
export function fetchRecoverySidecar(
  query: { prdId: string },
  init?: RequestInit,
): Promise<ReadSidecarResponse> {
  const params = new URLSearchParams({ prdId: query.prdId });
  return getJson<ReadSidecarResponse>(`${API_ROUTES.readRecoverySidecar}?${params.toString()}`, init);
}

/** Trigger recovery analysis for a failed PRD (spawns a recovery worker). */
export function triggerRecoveryAnalysis(
  body: RecoverRequest,
  init?: RequestInit,
): Promise<RecoverResponse> {
  return postJson<RecoverResponse>(API_ROUTES.recover, body, init);
}

/** Apply the recovery verdict recorded in a sidecar. */
export function applySidecarRecovery(
  body: ApplyRecoveryRequest,
  init?: RequestInit,
): Promise<ApplyRecoveryResponse> {
  return postJson<ApplyRecoveryResponse>(API_ROUTES.applyRecovery, body, init);
}

/** Read-only preview of an accepted-success recovery action for a failed PRD. */
export function fetchAcceptSuccessPreview(
  query: AcceptSuccessPreviewRequest,
  init?: RequestInit,
): Promise<AcceptSuccessPreviewResponse> {
  const params = new URLSearchParams({ prdId: query.prdId });
  return getJson<AcceptSuccessPreviewResponse>(`${API_ROUTES.acceptRecoverySuccessPreview}?${params.toString()}`, init);
}

/** Accept a failed build as successful, applying cleanup, landing, and unblocking. */
export function acceptRecoverySuccess(
  body: AcceptSuccessRequest,
  init?: RequestInit,
): Promise<AcceptSuccessResponse> {
  return postJson<AcceptSuccessResponse>(API_ROUTES.acceptRecoverySuccess, body, init);
}

/** Queue a continue-and-repair build for scheduler dispatch. */
export function startContinueRepair(
  body: ContinueRepairRequest,
  init?: RequestInit,
): Promise<ContinueRepairResponse> {
  return postJson<ContinueRepairResponse>(API_ROUTES.continueRepair, body, init);
}

/** Read-only preflight: check whether continue-and-repair is available. */
export function fetchContinueRepairEligibility(
  query: ContinueRepairEligibilityRequest,
  init?: RequestInit,
): Promise<ContinueRepairEligibilityResponse> {
  const params = new URLSearchParams({ prdId: query.prdId });
  if (query.setName !== undefined) {
    params.set('setName', query.setName);
  }
  return getJson<ContinueRepairEligibilityResponse>(`${API_ROUTES.continueRepairEligibility}?${params.toString()}`, init);
}
