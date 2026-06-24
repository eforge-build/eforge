export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface StoreOpenOptions { create?: boolean; migrate?: boolean; readonly?: boolean }
export interface EforgePlanStore {
  readonly path: string;
  readonly readonly: boolean;
  transaction<T>(callback: () => T): T;
  close(): void;
}

export const USER_STATUSES = ['candidate', 'planned', 'active', 'shipped', 'stale', 'superseded'] as const;
export type UserStatus = typeof USER_STATUSES[number];
export const DEPENDENCY_STATUSES = ['unknown', 'open', 'closed', 'external', 'missing'] as const;
export type DependencyStatus = typeof DEPENDENCY_STATUSES[number];
export const LANE_KINDS = ['activeWork', 'readyCandidates', 'recommendedNextSequence', 'safeParallelizableGroup', 'blockedChain'] as const;
export type LaneKind = typeof LANE_KINDS[number];
export const RECOMMENDATION_ITEM_ROLES = ['member', 'blocked', 'blocker'] as const;
export type RecommendationItemRole = typeof RECOMMENDATION_ITEM_ROLES[number];
export const LIFECYCLE_STATES = ['none', 'planned', 'active', 'submitted', 'queued', 'build', 'pr-open', 'merged', 'shipped', 'failed', 'partial'] as const;
export type LifecycleState = typeof LIFECYCLE_STATES[number];
export const SEARCH_DOCUMENT_TYPES = ['backlog_item', 'epic', 'session_plan', 'recommendation'] as const;
export type SearchDocumentType = typeof SEARCH_DOCUMENT_TYPES[number];

export interface SectionUpsert { sectionName: string; content?: string; contentSha256?: string }
export interface BacklogItemUpsert { id: string; title: string; body?: string; userStatus: UserStatus; priority?: string; source?: string; createdAt?: string; updatedAt?: string; lastCheckedAt?: string; staleAfter?: string; epicRef?: string; epicId?: string; frontmatter?: JsonObject; bodySha256?: string; recordSha256?: string; importOrigin?: string; importPath?: string }
export interface BacklogItemRow extends Required<Pick<BacklogItemUpsert, 'id' | 'title' | 'body' | 'userStatus'>> { priority?: string; source?: string; createdAt?: string; updatedAt?: string; lastCheckedAt?: string; staleAfter?: string; epicRef?: string; epicId?: string; frontmatter: JsonObject; bodySha256?: string; recordSha256?: string; importOrigin?: string; importPath?: string }
export interface ItemDependencyUpsert { dependencyRef: string; dependencyKind?: string; dependencyStatus?: DependencyStatus; resolvedDependencyItemId?: string; sourcePath?: string; diagnostic?: JsonValue }
export interface ItemDependencyRow extends Required<Pick<ItemDependencyUpsert, 'dependencyRef' | 'dependencyKind' | 'dependencyStatus'>> { itemId: string; resolvedDependencyItemId?: string; sourcePath?: string; diagnostic?: JsonValue }

export interface EpicUpsert { id: string; title: string; body?: string; userStatus: UserStatus; priority?: string; source?: string; createdAt?: string; updatedAt?: string; lastCheckedAt?: string; staleAfter?: string; frontmatter?: JsonObject; bodySha256?: string; recordSha256?: string; importOrigin?: string; importPath?: string }
export interface EpicRow extends Required<Pick<EpicUpsert, 'id' | 'title' | 'body' | 'userStatus'>> { priority?: string; source?: string; createdAt?: string; updatedAt?: string; lastCheckedAt?: string; staleAfter?: string; frontmatter: JsonObject; bodySha256?: string; recordSha256?: string; importOrigin?: string; importPath?: string }

export interface RecommendationRunUpsert { runId: string; sourceFingerprint?: string; createdAt?: string; appliedAt?: string; lastRefreshedBy?: string; isCurrent?: boolean; rawModel?: JsonValue; summary?: JsonValue; freshness?: JsonValue; importOrigin?: string; importPath?: string }
export interface RecommendationRunRow extends RecommendationRunUpsert { isCurrent: boolean }
export interface RecommendationLaneUpsert { laneId: string; runId: string; laneKind: LaneKind; laneRef?: string; title?: string; sequence?: number; profile?: string; rationale?: string }
export interface RecommendationLaneRow extends Required<Pick<RecommendationLaneUpsert, 'laneId' | 'runId' | 'laneKind' | 'sequence'>> { laneRef?: string; title?: string; profile?: string; rationale?: string }
export interface RecommendationLaneItemUpsert { itemRef: string; role: RecommendationItemRole; itemId?: string; sequence?: number; rationale?: string; confidence?: number }

export interface PlanningTaskUpsert { taskId: string; purpose?: string; statusSnapshot?: string; sourceFingerprint?: string; requestedSections?: JsonValue; selectionSummary?: JsonValue; compactResultSummary?: JsonValue; rawRequest?: JsonValue; rawResult?: JsonValue; rawPayloadPrunable?: boolean; createdAt?: string; updatedAt?: string; appliedAt?: string; parentTaskId?: string }
export interface PlanningTaskRow extends PlanningTaskUpsert { rawPayloadPrunable: boolean }
export interface PlanningTaskRef { ref: string; resolvedId?: string; role?: string; sequence?: number; sourcePath?: string; metadata?: JsonValue }
export interface PlanningTaskRefsInput { taskId: string; items?: PlanningTaskRef[]; epics?: PlanningTaskRef[]; recommendationRefs?: PlanningTaskRef[] }

export interface SessionPlanUpsert { session: string; path?: string; topic?: string; status?: string; planningType?: string; planningDepth?: string; profile?: string; agentProfile?: string; eforgeSessionId?: string; submittedAt?: string; createdAt?: string; updatedAt?: string; summaryText?: string; artifactBodyHash?: string; frontmatter?: JsonObject; readinessSummary?: JsonValue; importOrigin?: string; importPath?: string }
export interface SessionPlanRow extends SessionPlanUpsert { frontmatter: JsonObject }
export interface SessionPlanItemLinkInput { session: string; items: Array<{ itemRef: string; role: string; provenance: string; itemId?: string; sourceTaskId?: string; sourceRecommendationRef?: string; promotedAt?: string; sequence?: number }> }
export interface SessionPlanEpicLinkInput { session: string; epics: Array<{ epicRef: string; role: string; provenance: string; epicId?: string; sourceTaskId?: string; sourceRecommendationRef?: string; promotedAt?: string; sequence?: number }> }

export interface LifecycleEventInput { eventKey: string; eventType: string; timestamp?: string; session?: string; runId?: string; buildSessionId?: string; queuePrdId?: string; landingId?: string; affectedItemRefs?: string[]; payload?: JsonValue; payloadPrunable?: boolean; sourceFingerprint?: string }
export interface LifecycleEventRow extends LifecycleEventInput { affectedItemRefs: string[]; payloadPrunable: boolean }
export interface LifecycleEvidenceInput { evidenceKey: string; itemRef: string; lifecycleState: LifecycleState; itemId?: string; session?: string; planningTaskId?: string; queuePrdId?: string; runId?: string; buildSessionId?: string; landingId?: string; sourceEventKey?: string; reasonCode?: string; evidenceKind?: string; status?: string; isCurrent?: boolean; isTerminal?: boolean; occurredAt?: string; supersededAt?: string; summary?: string; links?: JsonValue; retainedSummary?: JsonValue }
export interface LifecycleEvidenceRow extends LifecycleEvidenceInput { isCurrent: boolean; isTerminal: boolean }

export interface QueuePrdUpsert { prdId: string; session?: string; sourceId?: string; sourcePath?: string; externalRef?: string; status?: string; createdAt?: string; updatedAt?: string; submittedAt?: string; statusSummary?: string; errorSummary?: string; importFingerprint?: string }
export interface QueuePrdRow extends QueuePrdUpsert {}
export interface BuildRunUpsert { runId: string; session?: string; queuePrdId?: string; buildSessionId?: string; status?: string; startedAt?: string; finishedAt?: string; planSet?: string; cwd?: string; statusSummary?: string; errorSummary?: string; importFingerprint?: string }
export interface BuildRunRow extends BuildRunUpsert {}
export interface BuildSessionUpsert { buildSessionId: string; session?: string; status?: string; startedAt?: string; finishedAt?: string; statusSummary?: string; errorSummary?: string; importFingerprint?: string }
export interface BuildSessionRow extends BuildSessionUpsert {}
export interface LandingLinkUpsert { landingId: string; session?: string; itemId?: string; queuePrdId?: string; runId?: string; buildSessionId?: string; status?: string; prUrl?: string; featureBranch?: string; commitSha?: string; mergeRef?: string; createdAt?: string; completedAt?: string; summary?: JsonValue }
export interface LandingLinkRow extends LandingLinkUpsert {}
export interface QueueBuildCorrelationInput { queuePrdId: string; runId?: string; buildSessionId?: string; landingId?: string }

export interface ImportRunInput { runId: string; dryRun?: boolean; applied?: boolean; replacedExisting?: boolean; startedAt?: string; finishedAt?: string; counts?: JsonValue; summary?: JsonValue; verboseReport?: JsonValue; verboseReportPrunable?: boolean }
export interface ImportRunRow extends ImportRunInput { dryRun: boolean; applied: boolean; replacedExisting: boolean; verboseReportPrunable: boolean }
export interface ImportDiagnosticInput { diagnosticId: string; runId: string; severity: string; code: string; message: string; ref?: string; path?: string; details?: JsonValue }
export interface ImportDiagnosticRow extends ImportDiagnosticInput {}
export interface MaintenanceRunInput { runId: string; categories?: JsonValue; startedAt?: string; finishedAt?: string; prunedCounts?: JsonValue; archivedCounts?: JsonValue; preservedEvidenceCounts?: JsonValue; status?: string; errorSummary?: string }
export interface MaintenanceRunRow extends MaintenanceRunInput {}

export interface SearchDocumentUpsert { documentType: SearchDocumentType; documentId: string; title?: string; tagsText?: string; summaryText?: string; bodyText?: string; itemIdsText?: string; epicIdsText?: string; recommendationRefsText?: string; sourceSha256?: string; updatedAt?: string; dirty?: boolean }
export interface SearchDocumentRow extends SearchDocumentUpsert { dirty: boolean }
export interface SearchIndexDirtyInput { documentType: SearchDocumentType; documentId: string; reason?: string; markedAt?: string }
export interface SearchIndexStateRow { id: 1; dirty: boolean; dirtySince?: string; dirtyReason?: string; lastRebuiltAt?: string }
// --- eforge:region plan-05-fts-search-bounded-actions ---
export interface SearchHitRow { documentType: SearchDocumentType; documentId: string; title: string; rank?: number; snippet?: string; updatedAt?: string; itemIdsText?: string; epicIdsText?: string; recommendationRefsText?: string }
export interface SearchIndexStatusRow { dirty: boolean; dirtyCount: number; dirtyTypes: SearchDocumentType[]; dirtySince?: string; dirtyReason?: string; lastRebuiltAt?: string }
export interface SearchPaginationInput { limit?: number; offset?: number }
export interface SearchPaginationPage { limit: number; offset: number; returned: number; hasMore: boolean; nextOffset?: number }
export type SearchSelectedField = 'rank' | 'snippet' | 'refs' | 'updatedAt';
// --- eforge:endregion plan-05-fts-search-bounded-actions ---
