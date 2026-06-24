import { userActionError } from '../action-errors.js';
import { MAINTENANCE_CATEGORIES, type CompactPlanningStoreInput, type MaintenanceCategory } from './types.js';

export interface NormalizedMaintenancePolicy {
  dryRun: boolean;
  categories: MaintenanceCategory[];
  cutoff: string;
  archive: boolean;
  rowLimit: number;
  sampleLimit: number;
  keepLatestRecommendationRuns: number;
  keepLatestImportRuns: number;
  rebuildSearchAfter: boolean;
}

export const PROTECTED_TABLES = [
  'backlog_items', 'epics', 'item_dependencies', 'session_plans', 'session_plan_items', 'session_plan_epics',
  'queue_prds', 'build_runs', 'build_sessions', 'landing_links',
] as const;

export function normalizeMaintenancePolicy(input: CompactPlanningStoreInput = {}): NormalizedMaintenancePolicy {
  const categories = normalizeCategories(input.categories);
  return {
    dryRun: input.dryRun ?? true,
    categories,
    cutoff: cutoffFrom(input),
    archive: input.archive ?? false,
    rowLimit: clampInteger(input.rowLimit, 1000, 1, 10000),
    sampleLimit: clampInteger(input.sampleLimit, 20, 0, 100),
    keepLatestRecommendationRuns: clampInteger(input.keepLatestRecommendationRuns, 5, 0, 1000),
    keepLatestImportRuns: clampInteger(input.keepLatestImportRuns, 10, 0, 1000),
    rebuildSearchAfter: input.rebuildSearchAfter ?? true,
  };
}

export function normalizeCategories(categories?: MaintenanceCategory[]): MaintenanceCategory[] {
  if (!categories?.length) return [...MAINTENANCE_CATEGORIES];
  const allowed = new Set<string>(MAINTENANCE_CATEGORIES);
  const normalized: MaintenanceCategory[] = [];
  for (const category of categories) {
    if (!allowed.has(category)) throw userActionError(`Unknown maintenance category: ${category}`, { path: 'categories' });
    if (!normalized.includes(category)) normalized.push(category);
  }
  return normalized;
}

function cutoffFrom(input: CompactPlanningStoreInput): string {
  if (input.olderThan !== undefined) {
    if (!isStrictIsoDateTime(input.olderThan)) throw userActionError('olderThan must be a valid ISO timestamp.', { path: 'olderThan' });
    const date = new Date(input.olderThan);
    if (Number.isNaN(date.getTime())) throw userActionError('olderThan must be a valid ISO timestamp.', { path: 'olderThan' });
    return date.toISOString();
  }
  const days = clampInteger(input.olderThanDays, 90, 0, 36500);
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function isStrictIsoDateTime(value: string): boolean { return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value); }

function clampInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  const n = Math.trunc(value ?? fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

export function terminalPlanningTaskStatuses(): string[] { return ['applied', 'dismissed', 'failed', 'complete', 'completed', 'cancelled', 'canceled', 'terminal']; }
