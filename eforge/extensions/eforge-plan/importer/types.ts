import type { BacklogItemUpsert, EpicUpsert, ItemDependencyUpsert, JsonValue, LifecycleEventInput, LifecycleEvidenceInput, PlanningTaskRefsInput, PlanningTaskUpsert, QueuePrdUpsert, BuildRunUpsert, BuildSessionUpsert, LandingLinkUpsert, RecommendationLaneItemUpsert, RecommendationLaneUpsert, RecommendationRunUpsert, SearchDocumentType, SessionPlanEpicLinkInput, SessionPlanItemLinkInput, SessionPlanUpsert, SectionUpsert } from '../sqlite/types.js';

export const PLANNING_STORE_IMPORT_INCLUDES = ['backlog', 'epics', 'sessionPlans', 'traces', 'queue', 'monitor', 'recommendations', 'planningTasks'] as const;
export const MAX_IMPORT_DIAGNOSTIC_LIMIT = 500;
export type PlanningStoreImportInclude = typeof PLANNING_STORE_IMPORT_INCLUDES[number];
export interface RunPlanningStoreImportOptions { dryRun?: boolean; replaceExisting?: boolean; include?: PlanningStoreImportInclude[]; diagnosticLimit?: number }
export type ImportDiagnosticCode = 'orphan-ref' | 'missing-file' | 'duplicate-id' | 'invalid-trace-row' | 'stale-recommendation-ref' | 'unreadable-artifact' | 'unsupported-legacy-payload';
export type ImportDiagnosticSeverity = 'info' | 'warning' | 'error';
export interface ImportDiagnostic { diagnosticId: string; severity: ImportDiagnosticSeverity; code: ImportDiagnosticCode; message: string; ref?: string; path?: string; details?: JsonValue }
export interface PlanningStoreImportReport { schemaVersion: 1; dryRun: boolean; applied: boolean; replacedExisting: boolean; storePath: string; include: PlanningStoreImportInclude[]; sourceFingerprint: string; counts: Record<string, number>; diagnosticCount: number; diagnostics: ImportDiagnostic[]; diagnosticsOmitted: number }
export interface LegacyBacklogItemRecord { item: BacklogItemUpsert; tags: string[]; sections: SectionUpsert[]; dependencies: ItemDependencyUpsert[] }
export interface LegacyEpicRecord { epic: EpicUpsert; tags: string[]; sections: SectionUpsert[] }
export interface LegacyRecommendationLane { lane: RecommendationLaneUpsert; items: RecommendationLaneItemUpsert[] }
export interface LegacyPlanningTaskRecord { task: PlanningTaskUpsert; refs: Omit<PlanningTaskRefsInput, 'taskId'> }
export interface LegacySessionPlanRecord { plan: SessionPlanUpsert; itemLinks: SessionPlanItemLinkInput['items']; epicLinks: SessionPlanEpicLinkInput['epics'] }
export interface SearchDirtyRecord { documentType: SearchDocumentType; documentId: string; reason?: string }
export interface LegacyImportGraph {
  runId: string; startedAt: string; include: PlanningStoreImportInclude[]; sourceFingerprint: string; counts: Record<string, number>; diagnostics: ImportDiagnostic[];
  epics: LegacyEpicRecord[]; items: LegacyBacklogItemRecord[]; sessionPlans: LegacySessionPlanRecord[];
  recommendationRun?: RecommendationRunUpsert; recommendationLanes: LegacyRecommendationLane[]; planningTasks: LegacyPlanningTaskRecord[];
  queuePrds: QueuePrdUpsert[]; buildRuns: BuildRunUpsert[]; buildSessions: BuildSessionUpsert[]; landingLinks: LandingLinkUpsert[];
  lifecycleEvents: LifecycleEventInput[]; lifecycleEvidence: LifecycleEvidenceInput[]; searchDirty: SearchDirtyRecord[];
}
export type Collector = (cwd: string, graph: LegacyImportGraph) => Promise<void> | void;
