import type { LifecycleState, UserStatus, JsonValue } from '../sqlite/types.js';
import type { KanbanLane } from '../schema.js';

export type EffectiveLifecycle = LifecycleState;
export type LifecycleReasonCode =
  | 'planned-session-plan' | 'submitted-session-plan' | 'active-planning-task' | 'queued-build' | 'running-build' | 'active-build-session'
  | 'open-pr' | 'merged-result' | 'shipped-result' | 'failed-result' | 'partial-plan' | 'unresolved-dependency'
  | 'explicit-active-status' | 'explicit-planned-status' | 'explicit-shipped-status' | 'explicit-archive-status' | 'candidate-no-evidence';
export type RecommendationDisposition = 'actionable' | 'suppressed' | 'de-actioned' | 'relocated';

export interface AssociatedPlanBuildLink {
  kind: string;
  id: string;
  label?: string;
  itemIds: string[];
  affectedItemIds?: string[];
  session?: string;
  status?: string;
  timestamp?: string;
  path?: string;
  url?: string;
  runId?: string;
  buildSessionId?: string;
  prUrl?: string;
  reasonCode?: LifecycleReasonCode | string;
  missing?: boolean;
  metadata?: JsonValue;
}
export interface CoverageEntry { itemId: string; reasonCode: LifecycleReasonCode | string; lifecycleState: LifecycleState; associatedLinks: AssociatedPlanBuildLink[]; terminal: boolean }
export interface CoverageResult { schemaVersion: 1; ok: boolean; entries: CoverageEntry[]; coveredItemIds: string[] }

export interface CompactItemProjection {
  id: string; title: string; status: UserStatus; userStatus: UserStatus; priority: string; tags: string[]; lane: KanbanLane; reasons: string[]; reasonCodes: string[];
  dependsOn?: string[]; unresolvedDependsOn?: string[]; activeTraceReasons: string[]; blocked: boolean; ready: boolean; reviewDue: boolean; closed: boolean;
  epic?: string; lifecycleState: LifecycleState | 'queue'; effectiveLifecycle: LifecycleState | 'queue'; associatedLinks?: AssociatedPlanBuildLink[]; path?: string; hasBody?: boolean; updatedAt?: string;
}
export interface GetItemProjectionInput { id: string; includeBody?: boolean; includeEpic?: boolean; includeSections?: boolean; includeLifecycleRows?: boolean; includeDependencies?: boolean; includeDependents?: boolean }
export interface GetEpicProjectionInput { id: string; includeBody?: boolean; includeItems?: boolean; includeSections?: boolean; includeItemDependencies?: boolean; limit?: number; offset?: number }
export interface ListBoardCompactProjectionInput { epic?: string; lane?: KanbanLane; includeClosed?: boolean; includeArchive?: boolean; includeEpics?: boolean; includeLaneCounts?: boolean; includeDependencies?: boolean; limit?: number; offset?: number }
export type BoardActionInput = { epic?: string; includeArchive?: boolean };
export type BoardDebugProjection = Record<string, unknown>;
export type GetRecommendationsProjection = Record<string, unknown>;
export type RecommendationActionabilityProjection = Record<string, unknown>;
export type ListPlanningArtifactsInput = { includeSubmitted?: boolean; includeBoard?: boolean; epic?: string; includeArchive?: boolean; limit?: number; offset?: number };
export type ListPlanningArtifactsProjection = Record<string, unknown>;
export type SessionPlanLifecycleProjection = Record<string, unknown>;
