import type { JsonObject, LifecycleLinkRow, SearchDocumentType, SearchIndexStatus, SearchResult } from './types';

export type SQLiteLifecycleReasonCode =
  | 'queued-build' | 'running-build' | 'open-pr' | 'merged-result' | 'shipped-result'
  | 'failed-result' | 'partial-plan' | 'planned-session-plan' | 'submitted-session-plan'
  | 'active-planning-task' | 'queued-trace' | 'building-trace' | 'active-build-session-trace' | 'open-pr-trace'
  | string;

export type RecommendationDisposition = 'actionable' | 'suppressed' | 'de-actioned' | 'relocated';

export interface AssociatedPlanningLink extends LifecycleLinkRow {
  id?: string;
  title?: string;
  url?: string;
}

export interface SQLiteLifecycleProjectionFields {
  userStatus?: string;
  effectiveLifecycle?: string;
  reasonCodes?: SQLiteLifecycleReasonCode[];
  associatedLinks?: AssociatedPlanningLink[];
  snippets?: string[];
}

export interface StoreFileSizes {
  dbBytes: number;
  walBytes: number;
  shmBytes: number;
}

export interface StoreTableCount {
  table: string;
  count: number;
}

export interface PlanningStoreStatus {
  schemaVersion: 1;
  initialized: boolean;
  storePath: string;
  fileSizes: StoreFileSizes;
  sqliteSchemaVersion?: number;
  tableCounts: StoreTableCount[];
  retentionEligibilityCounts: Record<string, number>;
  searchIndexStatus?: SearchIndexStatus;
  recentMaintenanceRuns: MaintenanceRunSummary[];
}

export interface MaintenanceRunSummary {
  runId?: string;
  actionId?: string;
  summary?: string;
  completedAt?: string;
  categories?: string[];
  startedAt?: string;
  finishedAt?: string;
  status?: string;
  prunedCounts?: Record<string, number>;
  archivedCounts?: Record<string, number>;
  preservedEvidenceCounts?: Record<string, number>;
  errorSummary?: string;
}

export interface MaintenanceActionReport {
  schemaVersion?: number;
  actionId?: string;
  runId?: string;
  category?: string;
  status?: string;
  dryRun?: boolean;
  summary?: string;
  counts?: Record<string, number>;
  prunedCounts?: Record<string, number>;
  archivedCounts?: Record<string, number>;
  preservedEvidenceCounts?: Record<string, number>;
  searchRefresh?: { refreshed?: number; deleted?: number; clearedDirty?: number; types?: string[] };
  beforeBytes?: number;
  afterBytes?: number;
  walBytesBefore?: number;
  walBytesAfter?: number;
  shmBytesBefore?: number;
  shmBytesAfter?: number;
  samples?: JsonObject[] | Record<string, JsonObject[]>;
}

export interface PlanningSearchInput {
  query: string;
  limit?: number;
  offset?: number;
  types?: SearchDocumentType[];
  fields?: string[];
}

export interface PlanningSearchResultPage {
  schemaVersion: 1;
  results: SearchResult[];
  total: number;
  countsByType: Partial<Record<SearchDocumentType, number>>;
  page: { limit: number; offset: number; returned: number; hasMore: boolean; nextOffset?: number };
  indexDirty: boolean;
  indexStatus: SearchIndexStatus;
}
