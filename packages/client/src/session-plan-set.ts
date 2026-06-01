/**
 * Wire types for the read-only session plan-set HTTP API.
 *
 * These mirror the JSON-safe summary, diagnostic, and listing shapes produced by
 * `@eforge-build/input`, but are declared independently here so the client and
 * browser-safe (`console-ui`) consumers can import them without pulling in the
 * Node-only input package. `routes.ts` owns the route constants; this module
 * owns the request/response shapes for the three read-only operations.
 */

/** Lifecycle status of a session plan set and its children. */
export type SessionPlanSetStatusWire = 'planning' | 'ready' | 'submitted' | 'abandoned';

/** Strategy describing how children relate to one another. */
export type SessionPlanSetStrategyWire = 'sequential' | 'parallel' | 'dag';

/** Kind of a plan-set child entry. */
export type SessionPlanSetChildKindWire = 'plan' | 'note' | 'reference';

/** Diagnostic codes emitted by plan-set validation. */
export type SessionPlanSetDiagnosticCodeWire =
  | 'duplicate-child-id'
  | 'duplicate-child-file'
  | 'unknown-child-dependency'
  | 'missing-anchor'
  | 'missing-child-file'
  | 'child-frontmatter-parse-error'
  | 'invalid-anchor-path'
  | 'invalid-child-path';

/** An external tracker / document reference attached to a manifest or child. */
export interface SessionPlanSetExternalRefWire {
  kind: string;
  ref: string;
  url?: string;
  title?: string;
}

/** A single validation diagnostic. */
export interface SessionPlanSetDiagnosticWire {
  severity: 'error';
  code: SessionPlanSetDiagnosticCodeWire;
  message: string;
  /** Child id this diagnostic relates to, when applicable. */
  childId?: string;
  /** File path this diagnostic relates to, when applicable. */
  file?: string;
  /** Unknown dependency id, when applicable. */
  dependency?: string;
  /** Resolved or declared path, when applicable. */
  path?: string;
}

/** JSON-safe per-child validation summary derived from set diagnostics. */
export interface SessionPlanSetChildValidationSummaryWire {
  /** True when no diagnostics reference this child. */
  ok: boolean;
  /** Number of diagnostics that reference this child. */
  diagnosticCount: number;
}

/** JSON-safe child summary. Carries no raw child content. */
export interface SessionPlanSetChildSummaryWire {
  id: string;
  file: string;
  kind: SessionPlanSetChildKindWire;
  buildable: boolean;
  status: SessionPlanSetStatusWire;
  profile?: string;
  dependsOn: string[];
  exists: boolean;
  externalRefs: SessionPlanSetExternalRefWire[];
  /** Validation summary for this child, derived from the set's diagnostics. */
  validation?: SessionPlanSetChildValidationSummaryWire;
}

/** JSON-safe umbrella anchor summary. */
export interface SessionPlanSetAnchorSummaryWire {
  file: string;
  path: string;
  exists: boolean;
}

/** JSON-safe summary of a plan set. Contains no raw content or parser internals. */
export interface SessionPlanSetSummaryWire {
  id: string;
  title: string;
  status: SessionPlanSetStatusWire;
  strategy: SessionPlanSetStrategyWire;
  anchor?: SessionPlanSetAnchorSummaryWire;
  children: SessionPlanSetChildSummaryWire[];
  diagnostics: SessionPlanSetDiagnosticWire[];
  externalRefs: SessionPlanSetExternalRefWire[];
}

/** Result of validating a plan set. */
export interface SessionPlanSetValidationResultWire {
  ok: boolean;
  diagnostics: SessionPlanSetDiagnosticWire[];
  summary: SessionPlanSetSummaryWire;
}

/** A lightweight plan-set listing entry. */
export interface SessionPlanSetListEntryWire {
  /** Plan-set id from the manifest (not the directory name). */
  id: string;
  /** Directory name, used to load/show/validate the set. */
  planSetId: string;
  /** Human-readable title. */
  title: string;
  /** Plan-set lifecycle status. */
  status: SessionPlanSetStatusWire;
  /** Child relationship strategy. */
  strategy: SessionPlanSetStrategyWire;
  /** Absolute path to the plan-set directory. */
  dir: string;
  /** Absolute path to the `plan-set.yaml` manifest. */
  manifestPath: string;
  /** Number of declared children. */
  childCount: number;
}

/** Query options for GET /api/session-plan-set/list */
export interface SessionPlanSetListRequest {
  /** When true, include plan sets with status `'submitted'`. `'abandoned'` is always excluded. */
  includeSubmitted?: boolean;
}

/** Response for GET /api/session-plan-set/list */
export interface SessionPlanSetListResponse {
  planSets: SessionPlanSetListEntryWire[];
}

/** Query options for GET /api/session-plan-set/show */
export interface SessionPlanSetShowRequest {
  planSetId: string;
}

/** Response for GET /api/session-plan-set/show */
export interface SessionPlanSetShowResponse {
  /** Summary-shaped plan-set data (no raw child markdown). */
  planSet: SessionPlanSetSummaryWire;
  /** Validation result (diagnostics + summary). */
  validation: SessionPlanSetValidationResultWire;
  /** Absolute path to the plan-set directory. */
  dir: string;
  /** Absolute path to the manifest file. */
  manifestPath: string;
  /** Raw umbrella anchor markdown when the manifest declares an existing anchor. */
  anchorContent?: string;
}

/** Query options for GET /api/session-plan-set/validate */
export interface SessionPlanSetValidateRequest {
  planSetId: string;
}

/** Response for GET /api/session-plan-set/validate */
export type SessionPlanSetValidateResponse = SessionPlanSetValidationResultWire;
