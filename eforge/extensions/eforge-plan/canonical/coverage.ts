import type { EforgePlanStore } from '../sqlite/index.js';
import { getDatabase } from '../sqlite/store-internal.js';
import { userActionError } from '../action-errors.js';
import { isCurrentResultLifecycleState, isLiveQueuePrdStatus, isTerminalBuildStatus, isTerminalPlanningTaskStatus, isTerminalSessionPlanStatus, resultReasonCode } from '../planning-state-policy.js';
import { withCanonicalTransaction } from './store.js';

export interface CoverageAssociatedLink { kind: 'session-plan' | 'planning-task' | 'queue' | 'build' | 'landing' | 'lifecycle-evidence'; label: string; session?: string; taskId?: string; queuePrdId?: string; runId?: string; buildSessionId?: string; landingId?: string; path?: string; prUrl?: string; status?: string }
export interface CoverageEntry { itemRef: string; reasonCode: string; lifecycleState?: string; associatedLinks: CoverageAssociatedLink[] }
export interface CoverageResult { ok: boolean; entries: CoverageEntry[] }

export interface CoverageOptions { includeTerminalReasons?: boolean; excludePlanningTaskIds?: readonly string[] }

export function findCanonicalNonterminalCoverage(cwd: string, itemRefs: readonly string[], options: CoverageOptions = {}): CoverageResult {
  return withCanonicalTransaction(cwd, (store) => findCanonicalNonterminalCoverageRecord(store, itemRefs, options));
}

export function assertNoCanonicalNonterminalCoverage(cwd: string, itemRefs: readonly string[], options: CoverageOptions = {}): void {
  const result = findCanonicalNonterminalCoverage(cwd, itemRefs, options);
  if (!result.ok) {
    const reasons = [...new Set(result.entries.map((entry) => entry.reasonCode))].join(', ');
    throw userActionError(`Selected backlog items already have nonterminal planning coverage: ${reasons}`, { path: 'itemIds', details: { coverage: result.entries as never, suppressedItems: suppressedItems(result.entries) as never } });
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
  return rows.filter((row) => includeTerminal || !isTerminalSessionPlanStatus(stringValue(row.status))).map((row) => ({ itemRef, reasonCode: String(row.status ?? '').toLowerCase() === 'submitted' ? 'submitted-session-plan' : 'planned-session-plan', lifecycleState: String(row.status ?? '').toLowerCase() === 'submitted' ? 'submitted' : 'planned', associatedLinks: [{ kind: 'session-plan', label: String(row.session), session: String(row.session), path: stringValue(row.path), status: stringValue(row.status) }] }));
}

function planningTaskCoverage(store: EforgePlanStore, itemRef: string, includeTerminal: boolean, excludedTaskIds: ReadonlySet<string>): CoverageEntry[] {
  const rows = all(store, `SELECT pt.task_id, pt.status_snapshot FROM planning_task_items pti JOIN planning_tasks pt ON pt.task_id = pti.task_id WHERE pti.item_ref = ? OR pti.item_id = ?`, itemRef, itemRef);
  return rows.filter((row) => !excludedTaskIds.has(String(row.task_id)) && (includeTerminal || !isTerminalPlanningTaskStatus(stringValue(row.status_snapshot)))).map((row) => ({ itemRef, reasonCode: 'active-planning-task', lifecycleState: 'active', associatedLinks: [{ kind: 'planning-task', label: String(row.task_id), taskId: String(row.task_id), status: String(row.status_snapshot ?? '') === 'active' ? 'running' : stringValue(row.status_snapshot) }] }));
}

function queueBuildCoverage(store: EforgePlanStore, itemRef: string, includeTerminal: boolean): CoverageEntry[] {
  const rows = all(store, `SELECT le.lifecycle_state, le.queue_prd_id, le.run_id, le.build_session_id, le.status, qp.status AS queue_status, br.status AS run_status, bs.status AS build_session_status FROM lifecycle_evidence le LEFT JOIN queue_prds qp ON qp.prd_id = le.queue_prd_id LEFT JOIN build_runs br ON br.run_id = le.run_id LEFT JOIN build_sessions bs ON bs.build_session_id = le.build_session_id WHERE le.is_current = 1 AND (le.item_ref = ? OR le.item_id = ?) AND (le.queue_prd_id IS NOT NULL OR le.run_id IS NOT NULL OR le.build_session_id IS NOT NULL)`, itemRef, itemRef);
  return rows.filter((row) => includeTerminal || isLiveCanonicalQueueBuildCoverage(row)).map((row) => {
    const state = String(row.lifecycle_state);
    const reason = isCurrentResultLifecycleState(state) ? resultReasonCode(state) : row.run_id || row.build_session_id ? 'active-build' : 'queued-build';
    return { itemRef, reasonCode: reason, lifecycleState: stringValue(row.lifecycle_state), associatedLinks: [{ kind: row.run_id ? 'build' : 'queue', label: String(row.run_id ?? row.build_session_id ?? row.queue_prd_id), queuePrdId: stringValue(row.queue_prd_id), runId: stringValue(row.run_id), buildSessionId: stringValue(row.build_session_id), status: stringValue(row.status) }] };
  });
}

function lifecycleCoverage(store: EforgePlanStore, itemRef: string, includeTerminal: boolean): CoverageEntry[] {
  const rows = all(store, `SELECT lifecycle_state, reason_code, evidence_kind, session, landing_id, status, links_json FROM lifecycle_evidence WHERE is_current = 1 AND lifecycle_state <> 'planned' AND queue_prd_id IS NULL AND run_id IS NULL AND build_session_id IS NULL AND (item_ref = ? OR item_id = ?)`, itemRef, itemRef);
  return rows.filter((row) => includeTerminal || isCurrentResultLifecycleState(String(row.lifecycle_state)) || (!isTerminalBuildStatus(stringValue(row.status)) && !['merged','shipped','failed','partial'].includes(String(row.status ?? '')))).map((row) => {
    const state = String(row.lifecycle_state);
    return { itemRef, reasonCode: isCurrentResultLifecycleState(state) ? resultReasonCode(state) : reasonCode(state), lifecycleState: stringValue(row.lifecycle_state), associatedLinks: [{ kind: row.landing_id ? 'landing' : 'lifecycle-evidence', label: String(row.lifecycle_state), session: stringValue(row.session), landingId: stringValue(row.landing_id), status: stringValue(row.status) }] };
  });
}

function isLiveCanonicalQueueBuildCoverage(row: Record<string, unknown>): boolean {
  const state = String(row.lifecycle_state);
  if (isCurrentResultLifecycleState(state)) return true;
  if (row.run_id !== null && row.run_id !== undefined) return !isTerminalBuildStatus(stringValue(row.run_status) ?? stringValue(row.status));
  if (row.build_session_id !== null && row.build_session_id !== undefined) return !isTerminalBuildStatus(stringValue(row.build_session_status) ?? stringValue(row.status));
  return isLiveQueuePrdStatus(stringValue(row.queue_status) ?? stringValue(row.status));
}

function all(store: EforgePlanStore, sql: string, ...params: unknown[]): Record<string, unknown>[] { return getDatabase(store).prepare(sql).all(...(params as never[])) as Record<string, unknown>[]; }
function stringValue(value: unknown): string | undefined { return typeof value === 'string' && value.length > 0 ? value : undefined; }
function reasonCode(state: string): string { if (state === 'pr-open') return 'pr-open'; if (state === 'build') return 'active-build'; if (state === 'queued') return 'queued-build'; if (state === 'planned') return 'planned-session-plan'; return state || 'active'; }
function suppressedItems(entries: CoverageEntry[]) { return entries.map((entry) => ({ itemId: entry.itemRef, state: 'non-actionable', lifecycleState: entry.lifecycleState, reasonCode: entry.reasonCode, reasonMessage: `Item ${entry.itemRef} is covered by ${entry.reasonCode}.`, associatedLinks: entry.associatedLinks })); }
