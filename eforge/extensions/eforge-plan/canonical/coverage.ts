import type { EforgePlanStore } from '../sqlite/index.js';
import { getDatabase } from '../sqlite/store-internal.js';
import { userActionError } from '../action-errors.js';
import { withCanonicalTransaction } from './store.js';

export interface CoverageAssociatedLink { kind: 'session-plan' | 'planning-task' | 'queue' | 'build' | 'landing' | 'lifecycle-evidence'; label: string; session?: string; taskId?: string; queuePrdId?: string; runId?: string; buildSessionId?: string; landingId?: string; path?: string; prUrl?: string; status?: string }
export interface CoverageEntry { itemRef: string; reasonCode: string; lifecycleState?: string; associatedLinks: CoverageAssociatedLink[] }
export interface CoverageResult { ok: boolean; entries: CoverageEntry[] }

const TERMINAL_SESSION_STATUSES = new Set(['deleted', 'completed', 'abandoned', 'shipped', 'merged']);
const TERMINAL_TASK_STATUSES = new Set(['applied', 'dismissed', 'failed', 'cancelled', 'completed']);
const TERMINAL_BUILD_STATUSES = new Set(['completed', 'failed', 'cancelled', 'skipped', 'merged', 'shipped']);
const TERMINAL_EVIDENCE = new Set(['completed', 'failed', 'cancelled', 'skipped', 'merged', 'shipped']);

export interface CoverageOptions { includeTerminalReasons?: boolean; excludePlanningTaskIds?: readonly string[] }

export function findCanonicalNonterminalCoverage(cwd: string, itemRefs: readonly string[], options: CoverageOptions = {}): CoverageResult {
  return withCanonicalTransaction(cwd, (store) => findCanonicalNonterminalCoverageRecord(store, itemRefs, options));
}

export function assertNoCanonicalNonterminalCoverage(cwd: string, itemRefs: readonly string[], options: CoverageOptions = {}): void {
  const result = findCanonicalNonterminalCoverage(cwd, itemRefs, options);
  if (!result.ok) {
    const reasons = [...new Set(result.entries.map((entry) => entry.reasonCode))].join(', ');
    throw userActionError(`Selected backlog items already have nonterminal planning coverage: ${reasons}`, { path: 'itemIds', details: { coverage: result.entries as never } });
  }
}

export function findCanonicalNonterminalCoverageRecord(store: EforgePlanStore, itemRefs: readonly string[], options: CoverageOptions = {}): CoverageResult {
  const entries = itemRefs.flatMap((itemRef) => coverageForItem(store, itemRef, options));
  return { ok: entries.length === 0, entries };
}

function coverageForItem(store: EforgePlanStore, itemRef: string, options: CoverageOptions): CoverageEntry[] {
  const includeTerminal = options.includeTerminalReasons ?? false;
  return [
    ...sessionPlanCoverage(store, itemRef, includeTerminal),
    ...planningTaskCoverage(store, itemRef, includeTerminal, new Set(options.excludePlanningTaskIds ?? [])),
    ...queueBuildCoverage(store, itemRef, includeTerminal),
    ...lifecycleCoverage(store, itemRef, includeTerminal),
  ];
}

function sessionPlanCoverage(store: EforgePlanStore, itemRef: string, includeTerminal: boolean): CoverageEntry[] {
  const rows = all(store, `SELECT sp.session, sp.path, sp.status FROM session_plan_items spi JOIN session_plans sp ON sp.session = spi.session WHERE spi.item_ref = ? OR spi.item_id = ?`, itemRef, itemRef);
  return rows.filter((row) => includeTerminal || !TERMINAL_SESSION_STATUSES.has(String(row.status ?? ''))).map((row) => ({ itemRef, reasonCode: 'planned-session-plan', lifecycleState: 'planned', associatedLinks: [{ kind: 'session-plan', label: String(row.session), session: String(row.session), path: stringValue(row.path), status: stringValue(row.status) }] }));
}

function planningTaskCoverage(store: EforgePlanStore, itemRef: string, includeTerminal: boolean, excludedTaskIds: ReadonlySet<string>): CoverageEntry[] {
  const rows = all(store, `SELECT pt.task_id, pt.status_snapshot FROM planning_task_items pti JOIN planning_tasks pt ON pt.task_id = pti.task_id WHERE pti.item_ref = ? OR pti.item_id = ?`, itemRef, itemRef);
  return rows.filter((row) => !excludedTaskIds.has(String(row.task_id)) && (includeTerminal || !TERMINAL_TASK_STATUSES.has(String(row.status_snapshot ?? '')))).map((row) => ({ itemRef, reasonCode: 'active-planning-task', lifecycleState: 'active', associatedLinks: [{ kind: 'planning-task', label: String(row.task_id), taskId: String(row.task_id), status: stringValue(row.status_snapshot) }] }));
}

function queueBuildCoverage(store: EforgePlanStore, itemRef: string, includeTerminal: boolean): CoverageEntry[] {
  const rows = all(store, `SELECT le.lifecycle_state, le.queue_prd_id, le.run_id, le.build_session_id, le.status FROM lifecycle_evidence le WHERE le.is_current = 1 AND (le.item_ref = ? OR le.item_id = ?) AND (le.queue_prd_id IS NOT NULL OR le.run_id IS NOT NULL OR le.build_session_id IS NOT NULL)`, itemRef, itemRef);
  return rows.filter((row) => includeTerminal || !TERMINAL_BUILD_STATUSES.has(String(row.status ?? ''))).map((row) => ({ itemRef, reasonCode: row.run_id || row.build_session_id ? 'active-build' : 'queued-build', lifecycleState: stringValue(row.lifecycle_state), associatedLinks: [{ kind: row.run_id ? 'build' : 'queue', label: String(row.run_id ?? row.build_session_id ?? row.queue_prd_id), queuePrdId: stringValue(row.queue_prd_id), runId: stringValue(row.run_id), buildSessionId: stringValue(row.build_session_id), status: stringValue(row.status) }] }));
}

function lifecycleCoverage(store: EforgePlanStore, itemRef: string, includeTerminal: boolean): CoverageEntry[] {
  const rows = all(store, `SELECT lifecycle_state, session, landing_id, status, links_json FROM lifecycle_evidence WHERE is_current = 1 AND lifecycle_state <> 'planned' AND queue_prd_id IS NULL AND run_id IS NULL AND build_session_id IS NULL AND (item_ref = ? OR item_id = ?)`, itemRef, itemRef);
  return rows.filter((row) => includeTerminal || (!TERMINAL_EVIDENCE.has(String(row.lifecycle_state)) && !TERMINAL_EVIDENCE.has(String(row.status ?? '')))).map((row) => ({ itemRef, reasonCode: reasonCode(String(row.lifecycle_state)), lifecycleState: stringValue(row.lifecycle_state), associatedLinks: [{ kind: row.landing_id ? 'landing' : 'lifecycle-evidence', label: String(row.lifecycle_state), session: stringValue(row.session), landingId: stringValue(row.landing_id), status: stringValue(row.status) }] }));
}

function all(store: EforgePlanStore, sql: string, ...params: unknown[]): Record<string, unknown>[] { return getDatabase(store).prepare(sql).all(...(params as never[])) as Record<string, unknown>[]; }
function stringValue(value: unknown): string | undefined { return typeof value === 'string' && value.length > 0 ? value : undefined; }
function reasonCode(state: string): string { if (state === 'pr-open') return 'pr-open'; if (state === 'build') return 'active-build'; if (state === 'queued') return 'queued-build'; if (state === 'planned') return 'planned-session-plan'; return state || 'active'; }
