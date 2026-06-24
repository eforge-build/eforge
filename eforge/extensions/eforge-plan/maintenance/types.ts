import type { JsonValue, SearchDocumentType } from '../sqlite/index.js';
import type { SearchIndexStatus, SearchRefreshReport } from '../search/types.js';

export const MAINTENANCE_CATEGORIES = [
  'lifecycle-event-payloads',
  'planning-task-payloads',
  'superseded-recommendation-runs',
  'import-report-payloads',
  'import-diagnostic-details',
] as const;
export type MaintenanceCategory = typeof MAINTENANCE_CATEGORIES[number];

export interface CompactPlanningStoreInput {
  dryRun?: boolean;
  categories?: MaintenanceCategory[];
  olderThan?: string;
  olderThanDays?: number;
  archive?: boolean;
  rowLimit?: number;
  sampleLimit?: number;
  keepLatestRecommendationRuns?: number;
  keepLatestImportRuns?: number;
  rebuildSearchAfter?: boolean;
}

export interface GetStoreStatusInput { recentRunLimit?: number }
export interface VacuumPlanningStoreInput { checkpointWal?: boolean }
export interface RebuildSearchIndexInput { types?: SearchDocumentType[]; reason?: string }

export interface MaintenanceCandidateSample {
  eventKey?: string;
  eventType?: string;
  taskId?: string;
  purpose?: string;
  status?: string;
  runId?: string;
  diagnosticId?: string;
  isCurrent?: boolean;
  occurredAt?: string;
  updatedAt?: string;
  createdAt?: string;
  summary?: string;
  laneCount?: number;
  laneItemCount?: number;
  hasRawRequest?: boolean;
  hasRawResult?: boolean;
}

export interface ArchivePathReport { category: MaintenanceCategory; path: string; rowCount: number }
export interface SearchRefreshReportForMaintenance extends SearchRefreshReport {}

export interface MaintenanceReport {
  schemaVersion: 1;
  runId: string;
  status: 'dry-run' | 'applied' | 'failed';
  dryRun: boolean;
  categories: MaintenanceCategory[];
  cutoff: string;
  archive: boolean;
  rowLimit: number;
  sampleLimit: number;
  prunedCounts: Record<string, number>;
  archivedCounts: Record<string, number>;
  preservedEvidenceCounts: Record<string, number>;
  archivePaths: ArchivePathReport[];
  samples: Partial<Record<MaintenanceCategory, MaintenanceCandidateSample[]>>;
  searchRefresh?: SearchRefreshReportForMaintenance;
  warnings: string[];
}

export interface TableCount { table: string; count: number }
export interface StoreFileSizes { dbBytes: number; walBytes: number; shmBytes: number }
export interface PlanningStoreStatus {
  schemaVersion: 1;
  initialized: boolean;
  storePath: string;
  fileSizes: StoreFileSizes;
  sqliteSchemaVersion?: number;
  tableCounts: TableCount[];
  retentionEligibilityCounts: Record<string, number>;
  searchIndexStatus?: SearchIndexStatus;
  recentMaintenanceRuns: JsonValue[];
}

export interface SearchIndexMaintenanceActionReport {
  schemaVersion: 1;
  runId: string;
  category: 'search-rebuild' | 'search-optimize';
  status: 'applied' | 'failed';
  searchRefresh?: SearchRefreshReport;
  optimizedAt?: string;
  ok?: boolean;
}

export interface VacuumStoreReport {
  schemaVersion: 1;
  runId: string;
  status: 'applied' | 'failed';
  beforeBytes: number;
  afterBytes: number;
  walBytesBefore: number;
  walBytesAfter: number;
  shmBytesBefore: number;
  shmBytesAfter: number;
  checkpoint?: { requested: boolean; walBytesBefore: number; walBytesAfter: number };
}

export type ArchiveRow = Record<string, JsonValue>;

export function asJsonValue(value: unknown): JsonValue {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}
