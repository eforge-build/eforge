import type { EforgePlanStore, JsonValue, SearchDocumentType } from '../types.js';
import { all, optionalString, parseJsonColumn } from './sql.js';

export interface BacklogItemSearchProjectionRow { id: string; title: string; body: string; userStatus: string; priority?: string; updatedAt?: string; epicRef?: string; epicId?: string; tags: string[]; sections: Array<{ name: string; content: string }>; dependencies: string[] }
export interface EpicSearchProjectionRow { id: string; title: string; body: string; userStatus: string; priority?: string; updatedAt?: string; tags: string[]; sections: Array<{ name: string; content: string }>; itemIds: string[] }
export interface SessionPlanSearchProjectionRow { session: string; path?: string; topic?: string; status?: string; planningType?: string; planningDepth?: string; profile?: string; updatedAt?: string; summaryText?: string; readinessSummary?: JsonValue; itemIds: string[]; epicIds: string[]; recommendationRefs: string[] }
export interface RecommendationSearchProjectionRow { laneId: string; runId: string; isCurrent: boolean; laneKind: string; laneRef?: string; title?: string; profile?: string; rationale?: string; updatedAt?: string; runSummary?: JsonValue; itemRefs: string[]; itemIds: string[]; itemRationales: string[]; recommendationRefs: string[] }

function stringRows(store: EforgePlanStore, sql: string, column: string, ...params: unknown[]): string[] { return all<Record<string, unknown>>(store, sql, ...(params as never[])).map((r) => optionalString(r[column])).filter((v): v is string => !!v); }
function sections(store: EforgePlanStore, table: 'backlog_item_sections' | 'epic_sections', idColumn: 'item_id' | 'epic_id', id: string) { return all<Record<string, unknown>>(store, `SELECT section_name, content FROM ${table} WHERE ${idColumn} = ? ORDER BY section_name`, id).map((r) => ({ name: r.section_name as string, content: r.content as string })); }

export function listBacklogItemSearchProjectionRows(store: EforgePlanStore, ids?: readonly string[]): BacklogItemSearchProjectionRow[] {
  const rows = all<Record<string, unknown>>(store, `SELECT * FROM backlog_items ${ids?.length ? `WHERE id IN (${ids.map(() => '?').join(',')})` : ''} ORDER BY id`, ...(ids ?? []));
  return rows.map((r) => ({ id: r.id as string, title: r.title as string, body: r.body as string, userStatus: r.user_status as string, priority: optionalString(r.priority), updatedAt: optionalString(r.updated_at), epicRef: optionalString(r.epic_ref), epicId: optionalString(r.epic_id), tags: stringRows(store, 'SELECT tag FROM backlog_item_tags WHERE item_id = ? ORDER BY tag', 'tag', r.id as string), sections: sections(store, 'backlog_item_sections', 'item_id', r.id as string), dependencies: stringRows(store, 'SELECT COALESCE(resolved_dependency_item_id, dependency_ref) AS ref FROM item_dependencies WHERE item_id = ? ORDER BY dependency_ref', 'ref', r.id as string) }));
}

export function listEpicSearchProjectionRows(store: EforgePlanStore, ids?: readonly string[]): EpicSearchProjectionRow[] {
  const rows = all<Record<string, unknown>>(store, `SELECT * FROM epics ${ids?.length ? `WHERE id IN (${ids.map(() => '?').join(',')})` : ''} ORDER BY id`, ...(ids ?? []));
  return rows.map((r) => ({ id: r.id as string, title: r.title as string, body: r.body as string, userStatus: r.user_status as string, priority: optionalString(r.priority), updatedAt: optionalString(r.updated_at), tags: stringRows(store, 'SELECT tag FROM epic_tags WHERE epic_id = ? ORDER BY tag', 'tag', r.id as string), sections: sections(store, 'epic_sections', 'epic_id', r.id as string), itemIds: stringRows(store, 'SELECT id FROM backlog_items WHERE epic_id = ? OR epic_ref = ? ORDER BY id', 'id', r.id as string, r.id as string) }));
}

export function listSessionPlanSearchProjectionRows(store: EforgePlanStore, ids?: readonly string[]): SessionPlanSearchProjectionRow[] {
  const rows = all<Record<string, unknown>>(store, `SELECT * FROM session_plans ${ids?.length ? `WHERE session IN (${ids.map(() => '?').join(',')})` : ''} ORDER BY session`, ...(ids ?? []));
  return rows.map((r) => { const session = r.session as string; return { session, path: optionalString(r.path), topic: optionalString(r.topic), status: optionalString(r.status), planningType: optionalString(r.planning_type), planningDepth: optionalString(r.planning_depth), profile: optionalString(r.profile), updatedAt: optionalString(r.updated_at) ?? optionalString(r.submitted_at) ?? optionalString(r.created_at), summaryText: optionalString(r.summary_text), readinessSummary: parseJsonColumn('session_plans', 'readiness_summary_json', r.readiness_summary_json), itemIds: stringRows(store, 'SELECT COALESCE(item_id, item_ref) AS ref FROM session_plan_items WHERE session = ? ORDER BY sequence, item_ref', 'ref', session), epicIds: stringRows(store, 'SELECT COALESCE(epic_id, epic_ref) AS ref FROM session_plan_epics WHERE session = ? ORDER BY sequence, epic_ref', 'ref', session), recommendationRefs: stringRows(store, 'SELECT source_recommendation_ref AS ref FROM session_plan_items WHERE session = ? AND source_recommendation_ref IS NOT NULL UNION SELECT source_recommendation_ref AS ref FROM session_plan_epics WHERE session = ? AND source_recommendation_ref IS NOT NULL ORDER BY ref', 'ref', session, session) }; });
}

export function listRecommendationSearchProjectionRows(store: EforgePlanStore, ids?: readonly string[], includeHistorical = true): RecommendationSearchProjectionRow[] {
  const rows = all<Record<string, unknown>>(store, `SELECT rl.*, rr.is_current, rr.created_at, rr.summary_json FROM recommendation_lanes rl JOIN recommendation_runs rr ON rr.run_id = rl.run_id WHERE ${includeHistorical ? '1=1' : 'rr.is_current = 1'} ${ids?.length ? `AND rl.lane_id IN (${ids.map(() => '?').join(',')})` : ''} ORDER BY rr.created_at DESC, rl.sequence, rl.lane_id`, ...(ids ?? []));
  return rows.map((r) => { const laneId = r.lane_id as string; const itemRows = all<Record<string, unknown>>(store, 'SELECT item_ref, item_id, rationale FROM recommendation_lane_items WHERE lane_id = ? ORDER BY sequence, item_ref', laneId); const laneRef = optionalString(r.lane_ref); return { laneId, runId: r.run_id as string, isCurrent: Number(r.is_current) === 1, laneKind: r.lane_kind as string, laneRef, title: optionalString(r.title), profile: optionalString(r.profile), rationale: optionalString(r.rationale), updatedAt: optionalString(r.created_at), runSummary: parseJsonColumn('recommendation_runs', 'summary_json', r.summary_json), itemRefs: itemRows.map((i) => i.item_ref as string), itemIds: itemRows.map((i) => optionalString(i.item_id)).filter((v): v is string => !!v), itemRationales: itemRows.map((i) => optionalString(i.rationale)).filter((v): v is string => !!v), recommendationRefs: [laneRef, laneId].filter((v): v is string => !!v) }; });
}

export function projectionIdsForType(store: EforgePlanStore, type: SearchDocumentType): string[] {
  if (type === 'backlog_item') return stringRows(store, 'SELECT id FROM backlog_items ORDER BY id', 'id');
  if (type === 'epic') return stringRows(store, 'SELECT id FROM epics ORDER BY id', 'id');
  if (type === 'session_plan') return stringRows(store, 'SELECT session FROM session_plans ORDER BY session', 'session');
  return stringRows(store, 'SELECT lane_id FROM recommendation_lanes ORDER BY lane_id', 'lane_id');
}
