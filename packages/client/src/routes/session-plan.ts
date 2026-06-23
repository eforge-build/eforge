// ---------------------------------------------------------------------------
// Session-plan route request/response interfaces
// ---------------------------------------------------------------------------

/** Lifecycle status of a session plan. */
export type SessionPlanStatusWire = 'planning' | 'ready' | 'abandoned' | 'submitted';

/** Planning type of a session plan. */
export type PlanningTypeWire =
  | 'bugfix'
  | 'feature'
  | 'refactor'
  | 'architecture'
  | 'docs'
  | 'maintenance'
  | 'unknown';

/** Planning depth of a session plan. */
export type PlanningDepthWire = 'quick' | 'focused' | 'deep';

/** A skipped dimension entry. */
export interface SkippedDimensionWire {
  name: string;
  reason: string;
}

/** Query options for GET /api/session-plan/list */
export interface SessionPlanListRequest {
  /** When true, include plans with status `'submitted'` in addition to `'planning'` and `'ready'`. */
  includeSubmitted?: boolean;
}

/** A lightweight session plan listing entry. */
export interface SessionPlanListEntryWire {
  session: string;
  topic: string;
  status: SessionPlanStatusWire;
  path: string;
  ready: boolean;
  missingDimensions: string[];
  /** Associated eforge run session identifier. Present when the plan was submitted and declares `eforge_session`. */
  eforge_session?: string;
}

/** Readiness detail returned by mutation routes and the readiness GET. */
export interface SessionPlanReadinessDetail {
  ready: boolean;
  missingDimensions: string[];
  coveredDimensions: string[];
  skippedDimensions: string[];
}

/** Full session plan data as returned by the daemon. */
export interface SessionPlanDataWire {
  session: string;
  topic: string;
  status: SessionPlanStatusWire;
  planning_type: PlanningTypeWire;
  planning_depth: PlanningDepthWire;
  eforge_session?: string;
  required_dimensions: string[];
  optional_dimensions: string[];
  skipped_dimensions: SkippedDimensionWire[];
  open_questions: string[];
  profile: 'errand' | 'excursion' | 'expedition' | null;
  body: string;
  /** Optional inherited agent runtime profile name. Set when created from a planning-mode playbook with a profile. */
  agent_profile?: string;
}

/** Response for GET /api/session-plan/list */
export interface SessionPlanListResponse {
  plans: SessionPlanListEntryWire[];
}

/** Response for GET /api/session-plan/show */
export interface SessionPlanShowResponse {
  plan: SessionPlanDataWire;
  readiness: SessionPlanReadinessDetail;
  path: string;
}

/** Request body for POST /api/session-plan/create */
export interface SessionPlanCreateRequest {
  session: string;
  topic: string;
  planning_type?: PlanningTypeWire;
  planning_depth?: PlanningDepthWire;
  profile?: 'errand' | 'excursion' | 'expedition' | null;
  /** Optional inherited agent runtime profile name. Not validated at create time. */
  agent_profile?: string;
}

/** Response for POST /api/session-plan/create */
export interface SessionPlanCreateResponse {
  session: string;
  path: string;
}

/** Request body for POST /api/session-plan/set-section */
export interface SessionPlanSetSectionRequest {
  session: string;
  dimension: string;
  content: string;
}

/** Response for POST /api/session-plan/set-section */
export interface SessionPlanSetSectionResponse {
  session: string;
  readiness: SessionPlanReadinessDetail;
}

/** Request body for POST /api/session-plan/skip-dimension */
export interface SessionPlanSkipDimensionRequest {
  session: string;
  dimension: string;
  reason: string;
}

/** Response for POST /api/session-plan/skip-dimension */
export interface SessionPlanSkipDimensionResponse {
  session: string;
  readiness: SessionPlanReadinessDetail;
}

/** Request body for POST /api/session-plan/set-status */
export interface SessionPlanSetStatusRequest {
  session: string;
  status: SessionPlanStatusWire;
  /** Required when status is 'submitted'. */
  eforge_session?: string;
}

/** Response for POST /api/session-plan/set-status */
export interface SessionPlanSetStatusResponse {
  session: string;
}

/** Request body for POST /api/session-plan/select-dimensions */
export interface SessionPlanSelectDimensionsRequest {
  session: string;
  planning_type?: PlanningTypeWire;
  planning_depth?: PlanningDepthWire;
  overwrite?: boolean;
}

/** Response for POST /api/session-plan/select-dimensions */
export interface SessionPlanSelectDimensionsResponse {
  session: string;
  required_dimensions: string[];
  optional_dimensions: string[];
  readiness: SessionPlanReadinessDetail;
}

/** Response for GET /api/session-plan/readiness */
export interface SessionPlanReadinessResponse {
  ready: boolean;
  missingDimensions: string[];
  coveredDimensions: string[];
  skippedDimensions: string[];
}

/** Request body for POST /api/session-plan/migrate-legacy */
export interface SessionPlanMigrateLegacyRequest {
  session: string;
}


/** Response for POST /api/session-plan/migrate-legacy */
export interface SessionPlanMigrateLegacyResponse {
  session: string;
  /** True when the plan was on the legacy schema and got migrated; false when the plan was already on the current schema. */
  migrated: boolean;
}
