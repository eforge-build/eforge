/**
 * Typed client helpers for the read-only session plan-set HTTP API.
 *
 * Each operation has a starting variant (`api*`) that ensures a daemon and a
 * passive `*IfRunning` variant that returns `null` when no daemon lockfile is
 * present. Both return the daemon request envelope (`{ data, port }`), matching
 * the convention in `session-plan.ts`. Route constants come from `API_ROUTES`;
 * wire types from `../session-plan-set.js`.
 */
import { daemonRequest, daemonRequestIfRunning } from '../daemon-client.js';
import { API_ROUTES } from '../routes.js';
import type {
  SessionPlanSetListResponse,
  SessionPlanSetShowResponse,
  SessionPlanSetValidateResponse,
} from '../session-plan-set.js';

// Re-export wire types for convenience.
export type {
  SessionPlanSetStatusWire,
  SessionPlanSetStrategyWire,
  SessionPlanSetChildKindWire,
  SessionPlanSetDiagnosticCodeWire,
  SessionPlanSetExternalRefWire,
  SessionPlanSetDiagnosticWire,
  SessionPlanSetChildSummaryWire,
  SessionPlanSetAnchorSummaryWire,
  SessionPlanSetSummaryWire,
  SessionPlanSetValidationResultWire,
  SessionPlanSetListEntryWire,
  SessionPlanSetListRequest,
  SessionPlanSetListResponse,
  SessionPlanSetShowRequest,
  SessionPlanSetShowResponse,
  SessionPlanSetValidateRequest,
  SessionPlanSetValidateResponse,
} from '../session-plan-set.js';

function listPath(includeSubmitted?: boolean): string {
  return includeSubmitted
    ? `${API_ROUTES.sessionPlanSetList}?includeSubmitted=true`
    : API_ROUTES.sessionPlanSetList;
}

function showPath(planSetId: string): string {
  return `${API_ROUTES.sessionPlanSetShow}?planSetId=${encodeURIComponent(planSetId)}`;
}

function validatePath(planSetId: string): string {
  return `${API_ROUTES.sessionPlanSetValidate}?planSetId=${encodeURIComponent(planSetId)}`;
}

// ---------------------------------------------------------------------------
// Typed client helpers
// ---------------------------------------------------------------------------

export function apiSessionPlanSetList(opts: { cwd: string; includeSubmitted?: boolean }) {
  return daemonRequest<SessionPlanSetListResponse>(opts.cwd, 'GET', listPath(opts.includeSubmitted));
}

export function apiSessionPlanSetListIfRunning(opts: { cwd: string; includeSubmitted?: boolean }) {
  return daemonRequestIfRunning<SessionPlanSetListResponse>(
    opts.cwd,
    'GET',
    listPath(opts.includeSubmitted),
  );
}

export function apiSessionPlanSetShow(opts: { cwd: string; planSetId: string }) {
  return daemonRequest<SessionPlanSetShowResponse>(opts.cwd, 'GET', showPath(opts.planSetId));
}

export function apiSessionPlanSetShowIfRunning(opts: { cwd: string; planSetId: string }) {
  return daemonRequestIfRunning<SessionPlanSetShowResponse>(
    opts.cwd,
    'GET',
    showPath(opts.planSetId),
  );
}

export function apiSessionPlanSetValidate(opts: { cwd: string; planSetId: string }) {
  return daemonRequest<SessionPlanSetValidateResponse>(opts.cwd, 'GET', validatePath(opts.planSetId));
}

export function apiSessionPlanSetValidateIfRunning(opts: { cwd: string; planSetId: string }) {
  return daemonRequestIfRunning<SessionPlanSetValidateResponse>(
    opts.cwd,
    'GET',
    validatePath(opts.planSetId),
  );
}
