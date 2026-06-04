/**
 * Typed Node helpers for the accepted-success recovery daemon API endpoints.
 *
 * `GET /api/recover/accept-success/preview` is a read-only preflight that reports
 * eligibility, cleanup effects, the effective landing action, and candidate
 * dependents. `POST /api/recover/accept-success` applies the action after
 * explicit user confirmation and is idempotent via the durable sidecar marker.
 */

import { daemonRequest, daemonRequestIfRunning } from '../daemon-client.js';
import { API_ROUTES } from '../routes.js';
import type {
  AcceptSuccessPreviewRequest,
  AcceptSuccessPreviewResponse,
  AcceptSuccessRequest,
  AcceptSuccessResponse,
} from '../routes.js';

function buildAcceptSuccessPreviewPath(query: AcceptSuccessPreviewRequest): string {
  const params = new URLSearchParams({ prdId: query.prdId });
  return `${API_ROUTES.acceptRecoverySuccessPreview}?${params.toString()}`;
}

export function apiAcceptRecoverySuccessPreview(opts: { cwd: string; query: AcceptSuccessPreviewRequest }) {
  return daemonRequest<AcceptSuccessPreviewResponse>(opts.cwd, 'GET', buildAcceptSuccessPreviewPath(opts.query));
}

export function apiAcceptRecoverySuccessPreviewIfRunning(opts: { cwd: string; query: AcceptSuccessPreviewRequest }) {
  return daemonRequestIfRunning<AcceptSuccessPreviewResponse>(opts.cwd, 'GET', buildAcceptSuccessPreviewPath(opts.query));
}

export function apiAcceptRecoverySuccess(opts: { cwd: string; body: AcceptSuccessRequest }) {
  return daemonRequest<AcceptSuccessResponse>(opts.cwd, 'POST', API_ROUTES.acceptRecoverySuccess, opts.body);
}

export function apiAcceptRecoverySuccessIfRunning(opts: { cwd: string; body: AcceptSuccessRequest }) {
  return daemonRequestIfRunning<AcceptSuccessResponse>(opts.cwd, 'POST', API_ROUTES.acceptRecoverySuccess, opts.body);
}
