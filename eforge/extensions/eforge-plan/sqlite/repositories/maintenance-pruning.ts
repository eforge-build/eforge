import type { EforgePlanStore, JsonValue, MaintenanceCategory, MaintenanceCandidateSample, ProtectedCount } from '../types.js';
import { all, execWritable, one, parseJsonColumn, run } from './sql.js';

interface RawRow extends Record<string, unknown> {}
export interface MaintenanceCandidates { samples: MaintenanceCandidateSample[]; archiveRows: Record<string, JsonValue>[]; count: number; ids: string[] }

const terminalSessionStatuses = "'applied','dismissed','failed','complete','completed','cancelled','canceled','terminal','merged','shipped'";
const protectedRecommendationRunPredicate = `NOT EXISTS (
  SELECT 1 FROM recommendation_lanes prl
  WHERE prl.run_id = rr.run_id AND (
    EXISTS (SELECT 1 FROM session_plan_items spi JOIN session_plans sp ON sp.session = spi.session WHERE spi.source_recommendation_ref IN (prl.lane_id, prl.lane_ref) AND lower(COALESCE(sp.status,'')) NOT IN (${terminalSessionStatuses}))
    OR EXISTS (SELECT 1 FROM session_plan_epics spe JOIN session_plans sp ON sp.session = spe.session WHERE spe.source_recommendation_ref IN (prl.lane_id, prl.lane_ref) AND lower(COALESCE(sp.status,'')) NOT IN (${terminalSessionStatuses}))
    OR EXISTS (SELECT 1 FROM lifecycle_evidence le, json_tree(CASE WHEN json_valid(le.links_json) THEN le.links_json ELSE '[]' END) jt WHERE le.is_current = 1 AND jt.type IN ('text','integer','real') AND CAST(jt.value AS TEXT) IN (prl.lane_id, prl.lane_ref))
  )
)`;

const categoryQueries: Record<MaintenanceCategory, (cutoff: string, keep: number, full: boolean) => string> = {
  'lifecycle-event-payloads': (cutoff, _keep, full) => `SELECT event_key AS id,${full ? '*' : 'event_key,event_type,timestamp'} FROM lifecycle_events WHERE payload_prunable = 1 AND payload_json IS NOT NULL AND timestamp IS NOT NULL AND timestamp < '${escapeSql(cutoff)}' ORDER BY timestamp,event_key`,
  'planning-task-payloads': (cutoff, _keep, full) => `SELECT task_id AS id,${full ? '*' : "task_id,purpose,status_snapshot,updated_at,(raw_request_json IS NOT NULL) AS has_raw_request,(raw_result_json IS NOT NULL) AS has_raw_result"} FROM planning_tasks WHERE raw_payload_prunable = 1 AND COALESCE(updated_at,created_at) IS NOT NULL AND COALESCE(updated_at,created_at) < '${escapeSql(cutoff)}' AND (raw_request_json IS NOT NULL OR raw_result_json IS NOT NULL) AND lower(COALESCE(status_snapshot,'')) IN ('applied','dismissed','failed','complete','completed','cancelled','canceled','terminal') ORDER BY updated_at,task_id`,
  'superseded-recommendation-runs': (cutoff, keep, full) => `SELECT rr.run_id AS id, ${full ? 'rr.*' : 'rr.run_id,rr.created_at'}, (SELECT count(*) FROM recommendation_lanes rl WHERE rl.run_id=rr.run_id) AS lane_count, (SELECT count(*) FROM recommendation_lane_items rli JOIN recommendation_lanes rl ON rl.lane_id=rli.lane_id WHERE rl.run_id=rr.run_id) AS lane_item_count FROM recommendation_runs rr WHERE rr.is_current = 0 AND rr.created_at IS NOT NULL AND rr.created_at < '${escapeSql(cutoff)}' AND ${protectedRecommendationRunPredicate} AND ${latestRecommendationRunPredicate('rr.run_id', keep)} ORDER BY rr.created_at,rr.run_id`,
  'import-report-payloads': (cutoff, keep, full) => `SELECT run_id AS id,${full ? '*' : 'run_id,started_at,finished_at'} FROM import_runs WHERE verbose_report_prunable = 1 AND verbose_report_json IS NOT NULL AND COALESCE(finished_at,started_at) IS NOT NULL AND COALESCE(finished_at,started_at) < '${escapeSql(cutoff)}' AND ${latestImportRunPredicate('run_id', keep)} ORDER BY finished_at,run_id`,
  'import-diagnostic-details': (cutoff, keep, full) => `SELECT d.diagnostic_id AS id,${full ? 'd.*' : 'd.diagnostic_id,d.run_id,d.severity,d.message'},r.started_at,r.finished_at FROM import_diagnostics d JOIN import_runs r ON r.run_id=d.run_id WHERE d.details_json IS NOT NULL AND COALESCE(r.finished_at,r.started_at) IS NOT NULL AND COALESCE(r.finished_at,r.started_at) < '${escapeSql(cutoff)}' AND ${latestImportRunPredicate('r.run_id', keep)} ORDER BY r.finished_at,d.diagnostic_id`,
};

export function collectMaintenanceCandidates(store: EforgePlanStore, category: MaintenanceCategory, input: { cutoff: string; rowLimit: number; sampleLimit: number; keepLatestRecommendationRuns: number; keepLatestImportRuns: number; dryRun?: boolean; archive?: boolean }): MaintenanceCandidates {
  const keep = category.startsWith('import-') ? input.keepLatestImportRuns : input.keepLatestRecommendationRuns;
  const base = categoryQueries[category](input.cutoff, keep, false);
  const count = (one<{ count: number }>(store, `SELECT count(*) AS count FROM (${base})`)?.count ?? 0);
  const rows = all<RawRow>(store, `${base} LIMIT ?`, input.rowLimit);
  const archiveRows = input.archive && !input.dryRun ? archiveRowsFor(store, category, all<RawRow>(store, `${categoryQueries[category](input.cutoff, keep, true)} LIMIT ?`, input.rowLimit)) : [];
  return { count, ids: rows.map((r) => String(r.id)), samples: rows.slice(0, input.sampleLimit).map((r) => sampleFor(category, r)), archiveRows };
}

export function retentionEligibilityCounts(store: EforgePlanStore, input: { cutoff: string; keepLatestRecommendationRuns: number; keepLatestImportRuns: number }): Record<string, number> {
  const result: Record<string, number> = {};
  for (const category of Object.keys(categoryQueries) as MaintenanceCategory[]) {
    const keep = category.startsWith('import-') ? input.keepLatestImportRuns : input.keepLatestRecommendationRuns;
    result[category] = one<{ count: number }>(store, `SELECT count(*) AS count FROM (${categoryQueries[category](input.cutoff, keep, false)})`)?.count ?? 0;
  }
  return result;
}

export function applyMaintenancePruning(store: EforgePlanStore, category: MaintenanceCategory, ids: string[], cutoff: string, keepLatestRecommendationRuns: number, keepLatestImportRuns: number): number {
  if (ids.length === 0) return 0;
  let count = 0;
  for (const id of ids) {
    let changed = 0;
    if (category === 'lifecycle-event-payloads') run(store, 'UPDATE lifecycle_events SET payload_json = NULL WHERE event_key = ? AND payload_prunable = 1 AND payload_json IS NOT NULL AND timestamp IS NOT NULL AND timestamp < ?', id, cutoff);
    if (category === 'planning-task-payloads') run(store, "UPDATE planning_tasks SET raw_request_json = NULL, raw_result_json = NULL WHERE task_id = ? AND raw_payload_prunable = 1 AND COALESCE(updated_at,created_at) IS NOT NULL AND COALESCE(updated_at,created_at) < ? AND (raw_request_json IS NOT NULL OR raw_result_json IS NOT NULL) AND lower(COALESCE(status_snapshot,'')) IN ('applied','dismissed','failed','complete','completed','cancelled','canceled','terminal')", id, cutoff);
    if (category === 'superseded-recommendation-runs') run(store, `DELETE FROM recommendation_runs AS rr WHERE run_id = ? AND is_current = 0 AND created_at IS NOT NULL AND created_at < ? AND ${protectedRecommendationRunPredicate} AND ${latestRecommendationRunPredicate('rr.run_id', keepLatestRecommendationRuns)}`, id, cutoff);
    if (category === 'import-report-payloads') run(store, `UPDATE import_runs SET verbose_report_json = NULL WHERE run_id = ? AND verbose_report_prunable = 1 AND verbose_report_json IS NOT NULL AND COALESCE(finished_at,started_at) IS NOT NULL AND COALESCE(finished_at,started_at) < ? AND ${latestImportRunPredicate('run_id', keepLatestImportRuns)}`, id, cutoff);
    if (category === 'import-diagnostic-details') run(store, `UPDATE import_diagnostics SET details_json = NULL WHERE diagnostic_id = ? AND details_json IS NOT NULL AND EXISTS (SELECT 1 FROM import_runs r WHERE r.run_id = import_diagnostics.run_id AND COALESCE(r.finished_at,r.started_at) IS NOT NULL AND COALESCE(r.finished_at,r.started_at) < ? AND ${latestImportRunPredicate('r.run_id', keepLatestImportRuns)})`, id, cutoff);
    changed = one<{ changes: number }>(store, 'SELECT changes() AS changes')?.changes ?? 0;
    count += changed;
  }
  return count;
}

export function preserveLifecycleEvidenceSummariesInStore(store: EforgePlanStore): number {
  const rows = all<RawRow>(store, 'SELECT * FROM lifecycle_evidence WHERE is_current = 1');
  for (const row of rows) {
    const summary = {
      lifecycleState: row.lifecycle_state as string,
      reasonCode: stringOrUndefined(row.reason_code),
      status: stringOrUndefined(row.status),
      summary: stringOrUndefined(row.summary),
      occurredAt: stringOrUndefined(row.occurred_at),
      itemRef: row.item_ref as string,
      session: stringOrUndefined(row.session),
      planningTaskId: stringOrUndefined(row.planning_task_id),
      queuePrdId: stringOrUndefined(row.queue_prd_id),
      runId: stringOrUndefined(row.run_id),
      buildSessionId: stringOrUndefined(row.build_session_id),
      landingId: stringOrUndefined(row.landing_id),
      sourceEventKey: stringOrUndefined(row.source_event_key),
      links: parseJsonColumn('lifecycle_evidence', 'links_json', row.links_json, null),
    };
    run(store, 'UPDATE lifecycle_evidence SET retained_summary_json = ? WHERE evidence_key = ?', JSON.stringify(summary), row.evidence_key as string);
  }
  return rows.length;
}

export function getProtectedCounts(store: EforgePlanStore): ProtectedCount[] {
  const tables = ['backlog_items','epics','item_dependencies','session_plans','session_plan_items','session_plan_epics','queue_prds','build_runs','build_sessions','landing_links'] as const;
  const counts: ProtectedCount[] = tables.map((table) => ({ name: table, count: one<{ count: number }>(store, `SELECT count(*) AS count FROM ${table}`)?.count ?? 0 }));
  counts.push({ name: 'current_lifecycle_evidence', count: one<{ count: number }>(store, 'SELECT count(*) AS count FROM lifecycle_evidence WHERE is_current = 1')?.count ?? 0 });
  counts.push({ name: 'current_recommendation_runs', count: one<{ count: number }>(store, 'SELECT count(*) AS count FROM recommendation_runs WHERE is_current = 1')?.count ?? 0 });
  counts.push({ name: 'current_recommendation_lanes', count: one<{ count: number }>(store, 'SELECT count(*) AS count FROM recommendation_lanes rl JOIN recommendation_runs rr ON rr.run_id = rl.run_id WHERE rr.is_current = 1')?.count ?? 0 });
  counts.push({ name: 'current_recommendation_lane_items', count: one<{ count: number }>(store, 'SELECT count(*) AS count FROM recommendation_lane_items rli JOIN recommendation_lanes rl ON rl.lane_id = rli.lane_id JOIN recommendation_runs rr ON rr.run_id = rl.run_id WHERE rr.is_current = 1')?.count ?? 0 });
  return counts;
}

export function assertProtectedCountsUnchanged(before: ProtectedCount[], after: ProtectedCount[]): void {
  const afterMap = new Map(after.map((c) => [c.name, c.count]));
  for (const count of before) if (afterMap.get(count.name) !== count.count) throw new Error(`Protected count changed for ${count.name}: ${count.count} -> ${afterMap.get(count.name)}`);
}

export function listTableCounts(store: EforgePlanStore): Array<{ table: string; count: number }> {
  const rows = all<{ name: string }>(store, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  return rows.map((r) => ({ table: r.name, count: one<{ count: number }>(store, `SELECT count(*) AS count FROM ${r.name}`)?.count ?? 0 }));
}

export function runWalCheckpoint(store: EforgePlanStore): void { execWritable(store, 'PRAGMA wal_checkpoint(TRUNCATE)'); }
export function runVacuum(store: EforgePlanStore): void { execWritable(store, 'VACUUM'); }

function sampleFor(category: MaintenanceCategory, row: RawRow): MaintenanceCandidateSample {
  if (category === 'lifecycle-event-payloads') return { eventKey: row.event_key as string, eventType: row.event_type as string, occurredAt: stringOrUndefined(row.timestamp), summary: row.event_type as string };
  if (category === 'planning-task-payloads') return { taskId: row.task_id as string, purpose: stringOrUndefined(row.purpose), status: stringOrUndefined(row.status_snapshot), updatedAt: stringOrUndefined(row.updated_at), hasRawRequest: row.has_raw_request != null ? Boolean(row.has_raw_request) : row.raw_request_json != null, hasRawResult: row.has_raw_result != null ? Boolean(row.has_raw_result) : row.raw_result_json != null };
  if (category === 'superseded-recommendation-runs') return { runId: row.run_id as string, createdAt: stringOrUndefined(row.created_at), isCurrent: false, laneCount: Number(row.lane_count ?? 0), laneItemCount: Number(row.lane_item_count ?? 0) };
  if (category === 'import-report-payloads') return { runId: row.run_id as string, createdAt: stringOrUndefined(row.started_at), updatedAt: stringOrUndefined(row.finished_at) };
  return { diagnosticId: row.diagnostic_id as string, runId: row.run_id as string, status: row.severity as string, summary: row.message as string, updatedAt: stringOrUndefined(row.finished_at) };
}

function archiveRowsFor(store: EforgePlanStore, category: MaintenanceCategory, rows: RawRow[]): Record<string, JsonValue>[] {
  const archived = rows.map((row) => archiveFor(category, row));
  if (category !== 'superseded-recommendation-runs') return archived;
  for (const row of rows) {
    const runId = row.run_id as string;
    for (const lane of all<RawRow>(store, 'SELECT * FROM recommendation_lanes WHERE run_id = ? ORDER BY sequence,lane_id', runId)) archived.push(archiveFor(category, { archive_table: 'recommendation_lanes', ...lane }));
    for (const item of all<RawRow>(store, 'SELECT rli.* FROM recommendation_lane_items rli JOIN recommendation_lanes rl ON rl.lane_id = rli.lane_id WHERE rl.run_id = ? ORDER BY rl.sequence,rli.sequence,rli.item_ref', runId)) archived.push(archiveFor(category, { archive_table: 'recommendation_lane_items', ...item }));
  }
  return archived;
}

function archiveFor(category: MaintenanceCategory, row: RawRow): Record<string, JsonValue> {
  const out: Record<string, JsonValue> = { category };
  for (const [key, value] of Object.entries(row)) out[key] = jsonish(value);
  return out;
}
function jsonish(value: unknown): JsonValue { if (value === undefined) return null; if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) return value; return JSON.parse(JSON.stringify(value)) as JsonValue; }
function stringOrUndefined(value: unknown): string | undefined { return typeof value === 'string' ? value : undefined; }
function latestRecommendationRunPredicate(idExpression: string, keep: number): string { return `${idExpression} NOT IN (SELECT run_id FROM recommendation_runs WHERE is_current=0 AND created_at IS NOT NULL ORDER BY created_at DESC, run_id DESC LIMIT ${keep})`; }
function latestImportRunPredicate(idExpression: string, keep: number): string { return `${idExpression} NOT IN (SELECT run_id FROM import_runs WHERE COALESCE(finished_at,started_at) IS NOT NULL ORDER BY COALESCE(finished_at,started_at) DESC, run_id DESC LIMIT ${keep})`; }
function escapeSql(value: string): string { return value.replaceAll("'", "''"); }
