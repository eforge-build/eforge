/**
 * Typed helpers for session-plan management daemon API endpoints.
 */

import { daemonRequest, daemonRequestIfRunning } from '../daemon-client.js';
import { API_ROUTES } from '../routes.js';
import type {
  SessionPlanListRequest,
  SessionPlanListResponse,
  SessionPlanShowResponse,
  SessionPlanCreateRequest,
  SessionPlanCreateResponse,
  SessionPlanSetSectionRequest,
  SessionPlanSetSectionResponse,
  SessionPlanSkipDimensionRequest,
  SessionPlanSkipDimensionResponse,
  SessionPlanSetStatusRequest,
  SessionPlanSetStatusResponse,
  SessionPlanSelectDimensionsRequest,
  SessionPlanSelectDimensionsResponse,
  SessionPlanReadinessResponse,
  SessionPlanMigrateLegacyRequest,
  SessionPlanMigrateLegacyResponse,
  SessionPlanCreateFromPlaybookRequest,
  SessionPlanCreateFromPlaybookResponse,
} from '../routes.js';

// Re-export wire types for convenience
export type {
  SessionPlanListRequest,
  SessionPlanStatusWire,
  PlanningTypeWire,
  PlanningDepthWire,
  SkippedDimensionWire,
  SessionPlanListEntryWire,
  SessionPlanDataWire,
  SessionPlanListResponse,
  SessionPlanShowResponse,
  SessionPlanCreateRequest,
  SessionPlanCreateResponse,
  SessionPlanSetSectionRequest,
  SessionPlanSetSectionResponse,
  SessionPlanSkipDimensionRequest,
  SessionPlanSkipDimensionResponse,
  SessionPlanSetStatusRequest,
  SessionPlanSetStatusResponse,
  SessionPlanSelectDimensionsRequest,
  SessionPlanSelectDimensionsResponse,
  SessionPlanReadinessResponse,
  SessionPlanMigrateLegacyRequest,
  SessionPlanMigrateLegacyResponse,
  SessionPlanCreateFromPlaybookRequest,
  SessionPlanCreateFromPlaybookResponse,
} from '../routes.js';

// ---------------------------------------------------------------------------
// Typed client helpers
// ---------------------------------------------------------------------------

export function apiSessionPlanList(opts: { cwd: string; includeSubmitted?: boolean }) {
  const query = opts.includeSubmitted ? '?includeSubmitted=true' : '';
  return daemonRequest<SessionPlanListResponse>(opts.cwd, 'GET', `${API_ROUTES.sessionPlanList}${query}`);
}

export function apiSessionPlanShow(opts: { cwd: string; session: string }) {
  return daemonRequest<SessionPlanShowResponse>(
    opts.cwd,
    'GET',
    `${API_ROUTES.sessionPlanShow}?session=${encodeURIComponent(opts.session)}`,
  );
}

export function apiSessionPlanCreate(opts: { cwd: string; body: SessionPlanCreateRequest }) {
  return daemonRequest<SessionPlanCreateResponse>(opts.cwd, 'POST', API_ROUTES.sessionPlanCreate, opts.body);
}

export function apiSessionPlanSetSection(opts: { cwd: string; body: SessionPlanSetSectionRequest }) {
  return daemonRequest<SessionPlanSetSectionResponse>(
    opts.cwd,
    'POST',
    API_ROUTES.sessionPlanSetSection,
    opts.body,
  );
}

export function apiSessionPlanSkipDimension(opts: { cwd: string; body: SessionPlanSkipDimensionRequest }) {
  return daemonRequest<SessionPlanSkipDimensionResponse>(
    opts.cwd,
    'POST',
    API_ROUTES.sessionPlanSkipDimension,
    opts.body,
  );
}

export function apiSessionPlanSetStatus(opts: { cwd: string; body: SessionPlanSetStatusRequest }) {
  return daemonRequest<SessionPlanSetStatusResponse>(
    opts.cwd,
    'POST',
    API_ROUTES.sessionPlanSetStatus,
    opts.body,
  );
}

export function apiSessionPlanSelectDimensions(opts: {
  cwd: string;
  body: SessionPlanSelectDimensionsRequest;
}) {
  return daemonRequest<SessionPlanSelectDimensionsResponse>(
    opts.cwd,
    'POST',
    API_ROUTES.sessionPlanSelectDimensions,
    opts.body,
  );
}

export function apiSessionPlanReadiness(opts: { cwd: string; session: string }) {
  return daemonRequest<SessionPlanReadinessResponse>(
    opts.cwd,
    'GET',
    `${API_ROUTES.sessionPlanReadiness}?session=${encodeURIComponent(opts.session)}`,
  );
}

export function apiSessionPlanMigrateLegacy(opts: { cwd: string; body: SessionPlanMigrateLegacyRequest }) {
  return daemonRequest<SessionPlanMigrateLegacyResponse>(
    opts.cwd,
    'POST',
    API_ROUTES.sessionPlanMigrateLegacy,
    opts.body,
  );
}

export function apiSessionPlanListIfRunning(opts: { cwd: string; includeSubmitted?: boolean }) {
  const query = opts.includeSubmitted ? '?includeSubmitted=true' : '';
  return daemonRequestIfRunning<SessionPlanListResponse>(opts.cwd, 'GET', `${API_ROUTES.sessionPlanList}${query}`);
}

export function apiSessionPlanShowIfRunning(opts: { cwd: string; session: string }) {
  return daemonRequestIfRunning<SessionPlanShowResponse>(
    opts.cwd,
    'GET',
    `${API_ROUTES.sessionPlanShow}?session=${encodeURIComponent(opts.session)}`,
  );
}

export function apiSessionPlanCreateIfRunning(opts: { cwd: string; body: SessionPlanCreateRequest }) {
  return daemonRequestIfRunning<SessionPlanCreateResponse>(
    opts.cwd,
    'POST',
    API_ROUTES.sessionPlanCreate,
    opts.body,
  );
}

export function apiSessionPlanSetSectionIfRunning(opts: { cwd: string; body: SessionPlanSetSectionRequest }) {
  return daemonRequestIfRunning<SessionPlanSetSectionResponse>(
    opts.cwd,
    'POST',
    API_ROUTES.sessionPlanSetSection,
    opts.body,
  );
}

export function apiSessionPlanSkipDimensionIfRunning(opts: {
  cwd: string;
  body: SessionPlanSkipDimensionRequest;
}) {
  return daemonRequestIfRunning<SessionPlanSkipDimensionResponse>(
    opts.cwd,
    'POST',
    API_ROUTES.sessionPlanSkipDimension,
    opts.body,
  );
}

export function apiSessionPlanSetStatusIfRunning(opts: { cwd: string; body: SessionPlanSetStatusRequest }) {
  return daemonRequestIfRunning<SessionPlanSetStatusResponse>(
    opts.cwd,
    'POST',
    API_ROUTES.sessionPlanSetStatus,
    opts.body,
  );
}

export function apiSessionPlanSelectDimensionsIfRunning(opts: {
  cwd: string;
  body: SessionPlanSelectDimensionsRequest;
}) {
  return daemonRequestIfRunning<SessionPlanSelectDimensionsResponse>(
    opts.cwd,
    'POST',
    API_ROUTES.sessionPlanSelectDimensions,
    opts.body,
  );
}

export function apiSessionPlanReadinessIfRunning(opts: { cwd: string; session: string }) {
  return daemonRequestIfRunning<SessionPlanReadinessResponse>(
    opts.cwd,
    'GET',
    `${API_ROUTES.sessionPlanReadiness}?session=${encodeURIComponent(opts.session)}`,
  );
}

export function apiSessionPlanMigrateLegacyIfRunning(opts: {
  cwd: string;
  body: SessionPlanMigrateLegacyRequest;
}) {
  return daemonRequestIfRunning<SessionPlanMigrateLegacyResponse>(
    opts.cwd,
    'POST',
    API_ROUTES.sessionPlanMigrateLegacy,
    opts.body,
  );
}

export function apiSessionPlanCreateFromPlaybook(opts: {
  cwd: string;
  body: SessionPlanCreateFromPlaybookRequest;
}) {
  return daemonRequest<SessionPlanCreateFromPlaybookResponse>(
    opts.cwd,
    'POST',
    API_ROUTES.sessionPlanCreateFromPlaybook,
    opts.body,
  );
}

export function apiSessionPlanCreateFromPlaybookIfRunning(opts: {
  cwd: string;
  body: SessionPlanCreateFromPlaybookRequest;
}) {
  return daemonRequestIfRunning<SessionPlanCreateFromPlaybookResponse>(
    opts.cwd,
    'POST',
    API_ROUTES.sessionPlanCreateFromPlaybook,
    opts.body,
  );
}
