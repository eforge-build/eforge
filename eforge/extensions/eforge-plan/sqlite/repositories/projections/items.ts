import type { EforgePlanStore, UserStatus } from '../../types.js';
import { all, one, optionalString, parseJsonColumn } from '../sql.js';

export interface ProjectionItemRow { id: string; title: string; body: string; userStatus: UserStatus; priority?: string; source?: string; createdAt?: string; updatedAt?: string; lastCheckedAt?: string; staleAfter?: string; epicId?: string; epicRef?: string; bodySha256?: string; recordSha256?: string; importOrigin?: string; importPath?: string; frontmatter: Record<string, unknown>; tags: string[] }
export interface ProjectionEpicRow { id: string; title: string; body: string; userStatus: UserStatus; priority?: string; source?: string; createdAt?: string; updatedAt?: string; frontmatter: Record<string, unknown>; tags: string[] }
export interface ProjectionSectionRow { ownerId: string; sectionName: string; content: string }
export interface ProjectionDependencyRow { itemId: string; dependencyRef: string; dependencyStatus: string; resolvedDependencyItemId?: string }

const CLOSED_DEPENDENCY_USER_STATUSES = new Set(['shipped', 'stale', 'superseded']);

function tags(store: EforgePlanStore, table: 'backlog_item_tags' | 'epic_tags', column: 'item_id' | 'epic_id', id: string): string[] { return all<{ tag: string }>(store, `SELECT tag FROM ${table} WHERE ${column} = ? ORDER BY tag`, id).map((r) => r.tag); }
export function rowToProjectionItem(store: EforgePlanStore, row: Record<string, unknown>): ProjectionItemRow { const id = row.id as string; return { id, title: row.title as string, body: row.body as string, userStatus: row.user_status as UserStatus, priority: optionalString(row.priority), source: optionalString(row.source), createdAt: optionalString(row.created_at), updatedAt: optionalString(row.updated_at), lastCheckedAt: optionalString(row.last_checked_at), staleAfter: optionalString(row.stale_after), epicId: optionalString(row.epic_id) ?? optionalString(row.epic_ref), epicRef: optionalString(row.epic_ref), bodySha256: optionalString(row.body_sha256), recordSha256: optionalString(row.record_sha256), importOrigin: optionalString(row.import_origin), importPath: optionalString(row.import_path), frontmatter: parseJsonColumn('backlog_items','frontmatter_json', row.frontmatter_json, {}) as Record<string, unknown>, tags: tags(store, 'backlog_item_tags', 'item_id', id) }; }
export function rowToProjectionEpic(store: EforgePlanStore, row: Record<string, unknown>): ProjectionEpicRow { const id = row.id as string; return { id, title: row.title as string, body: row.body as string, userStatus: row.user_status as UserStatus, priority: optionalString(row.priority), source: optionalString(row.source), createdAt: optionalString(row.created_at), updatedAt: optionalString(row.updated_at), frontmatter: parseJsonColumn('epics','frontmatter_json', row.frontmatter_json, {}) as Record<string, unknown>, tags: tags(store, 'epic_tags', 'epic_id', id) }; }
export function getProjectionItem(store: EforgePlanStore, id: string): ProjectionItemRow | undefined { const row = one<Record<string, unknown>>(store, 'SELECT * FROM backlog_items WHERE id = ?', id); return row ? rowToProjectionItem(store, row) : undefined; }
export function listProjectionItems(store: EforgePlanStore): ProjectionItemRow[] { return all<Record<string, unknown>>(store, 'SELECT * FROM backlog_items ORDER BY id').map((row) => rowToProjectionItem(store, row)); }
export function getProjectionEpic(store: EforgePlanStore, id: string): ProjectionEpicRow | undefined { const row = one<Record<string, unknown>>(store, 'SELECT * FROM epics WHERE id = ?', id); return row ? rowToProjectionEpic(store, row) : undefined; }
export function listProjectionEpics(store: EforgePlanStore): ProjectionEpicRow[] { return all<Record<string, unknown>>(store, 'SELECT * FROM epics ORDER BY id').map((row) => rowToProjectionEpic(store, row)); }
export function listProjectionItemSections(store: EforgePlanStore, itemId: string): ProjectionSectionRow[] { return all<Record<string, unknown>>(store, 'SELECT item_id, section_name, content FROM backlog_item_sections WHERE item_id = ? ORDER BY section_name', itemId).map((r) => ({ ownerId: r.item_id as string, sectionName: r.section_name as string, content: r.content as string })); }
export function listProjectionEpicSections(store: EforgePlanStore, epicId: string): ProjectionSectionRow[] { return all<Record<string, unknown>>(store, 'SELECT epic_id, section_name, content FROM epic_sections WHERE epic_id = ? ORDER BY section_name', epicId).map((r) => ({ ownerId: r.epic_id as string, sectionName: r.section_name as string, content: r.content as string })); }
export function listProjectionDependencies(store: EforgePlanStore): ProjectionDependencyRow[] {
  return all<Record<string, unknown>>(store, `
    SELECT d.*, target.id AS target_item_id, target.user_status AS target_user_status
    FROM item_dependencies d
    LEFT JOIN backlog_items target ON target.id = COALESCE(d.resolved_dependency_item_id, d.dependency_ref)
    ORDER BY d.item_id, d.dependency_ref
  `).map(rowToProjectionDependency);
}

function rowToProjectionDependency(row: Record<string, unknown>): ProjectionDependencyRow {
  const storedStatus = row.dependency_status as string;
  const targetId = optionalString(row.target_item_id);
  const targetStatus = optionalString(row.target_user_status);
  const resolvedDependencyItemId = storedStatus === 'external' ? optionalString(row.resolved_dependency_item_id) : optionalString(row.resolved_dependency_item_id) ?? targetId;
  const dependencyStatus = storedStatus === 'external' ? 'external' : targetStatus ? dependencyStatusForTarget(targetStatus) : storedStatus;
  return { itemId: row.item_id as string, dependencyRef: row.dependency_ref as string, dependencyStatus, ...(resolvedDependencyItemId ? { resolvedDependencyItemId } : {}) };
}

function dependencyStatusForTarget(userStatus: string): string {
  return CLOSED_DEPENDENCY_USER_STATUSES.has(userStatus) ? 'closed' : 'open';
}
