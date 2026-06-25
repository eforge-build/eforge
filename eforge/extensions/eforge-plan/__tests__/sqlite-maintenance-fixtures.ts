import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { dispatchExtensionAction } from '@eforge-build/engine/extensions/action-runtime.js';
import { createExtensionRecorder } from '@eforge-build/engine/extensions/recorder.js';
import type { NativeExtensionRecorderState, NativeExtensionRegistry } from '@eforge-build/engine/extensions/types.js';
import { expect } from 'vitest';
import eforgePlanExtension from '../index.js';
import { openEforgePlanStore, resolveEforgePlanStorePath } from '../sqlite/index.js';
import { rebuildSearchIndex } from '../search/index.js';

export const OLD = '2025-01-01T00:00:00.000Z';
export const NEW = '2027-01-01T00:00:00.000Z';
export const CUTOFF = '2026-01-01T00:00:00.000Z';

export function withTempMaintenanceProject<T>(fn: (cwd: string) => T | Promise<T>): Promise<T> {
  const cwd = mkdtempSync(join(tmpdir(), 'eforge-plan-maintenance-'));
  return Promise.resolve(fn(cwd)).finally(() => rmSync(cwd, { recursive: true, force: true }));
}

export function storeExists(cwd: string): boolean { return existsSync(resolveEforgePlanStorePath(cwd)); }

export function rawDb(cwd: string): DatabaseSync {
  const store = openEforgePlanStore(cwd);
  const path = store.path;
  store.close();
  return new DatabaseSync(path);
}

export function count(db: DatabaseSync, sql: string, ...params: unknown[]): number {
  return (db.prepare(sql).get(...params) as { count: number }).count;
}

export function scalar<T>(db: DatabaseSync, sql: string, ...params: unknown[]): T {
  const row = db.prepare(sql).get(...params) as Record<string, T>;
  return Object.values(row)[0] as T;
}

export function seedRetentionMaintenanceStore(cwd: string): void {
  const store = openEforgePlanStore(cwd);
  try { rebuildSearchIndex(store); } finally { store.close(); }
  const db = new DatabaseSync(resolveEforgePlanStorePath(cwd));
  try {
    db.exec('PRAGMA foreign_keys = ON');
    db.prepare("INSERT INTO epics (id,title,body,user_status,updated_at) VALUES (?,?,?,?,?)").run('epic-keep', 'Epic Keep', 'epic body', 'candidate', NEW);
    db.prepare("INSERT INTO backlog_items (id,title,body,user_status,updated_at,epic_id,epic_ref) VALUES (?,?,?,?,?,?,?)").run('item-keep', 'Item Keep', 'item body searchable', 'candidate', NEW, 'epic-keep', 'epic-keep');
    db.prepare("INSERT INTO backlog_items (id,title,body,user_status,updated_at,epic_id,epic_ref) VALUES (?,?,?,?,?,?,?)").run('item-current', 'Item Current', 'current body', 'active', NEW, 'epic-keep', 'epic-keep');
    db.prepare("INSERT INTO item_dependencies (item_id,dependency_ref,dependency_kind,dependency_status) VALUES (?,?,?,?)").run('item-keep', 'external-dep', 'depends-on', 'external');
    db.prepare("INSERT INTO session_plans (session,path,topic,status,updated_at,summary_text) VALUES (?,?,?,?,?,?)")
      .run('session-keep', '.eforge/session-plans/session-keep.md', 'Session Keep', 'ready', NEW, 'Session summary');
    db.prepare("INSERT INTO session_plan_items (session,item_ref,item_id,role,provenance,sequence) VALUES (?,?,?,?,?,?)")
      .run('session-keep', 'item-current', 'item-current', 'source', 'selected-item', 0);
    db.prepare("INSERT INTO session_plan_epics (session,epic_ref,epic_id,role,provenance,sequence) VALUES (?,?,?,?,?,?)")
      .run('session-keep', 'epic-keep', 'epic-keep', 'source', 'selected-epic', 0);
    db.prepare("INSERT INTO queue_prds (prd_id,session,status,created_at,updated_at) VALUES (?,?,?,?,?)").run('queue-keep', 'session-keep', 'complete', OLD, OLD);
    db.prepare("INSERT INTO build_sessions (build_session_id,session,status,started_at) VALUES (?,?,?,?)").run('build-session-keep', 'session-keep', 'running', OLD);
    db.prepare("INSERT INTO build_runs (run_id,session,queue_prd_id,build_session_id,status,started_at) VALUES (?,?,?,?,?,?)").run('run-keep', 'session-keep', 'queue-keep', 'build-session-keep', 'running', OLD);
    db.prepare("INSERT INTO landing_links (landing_id,session,item_id,queue_prd_id,run_id,build_session_id,status,pr_url,created_at,completed_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run('landing-keep', 'session-keep', null, 'queue-keep', 'run-keep', 'build-session-keep', 'metadata-only', 'https://example.test/pr/1', OLD, OLD);

    db.prepare("INSERT INTO lifecycle_events (event_key,event_type,timestamp,session,run_id,build_session_id,affected_item_refs_json,payload_json,payload_prunable) VALUES (?,?,?,?,?,?,?,?,?)")
      .run('old-prunable-event', 'session:start', OLD, 'session-keep', 'run-keep', 'build-session-keep', JSON.stringify(['item-current']), JSON.stringify({ secret: 'RAW_LIFECYCLE_PAYLOAD' }), 1);
    db.prepare("INSERT INTO lifecycle_events (event_key,event_type,timestamp,affected_item_refs_json,payload_json,payload_prunable) VALUES (?,?,?,?,?,?)")
      .run('old-protected-event', 'session:end', OLD, JSON.stringify(['item-keep']), JSON.stringify({ secret: 'PROTECTED_LIFECYCLE_PAYLOAD' }), 0);
    db.prepare("INSERT INTO lifecycle_events (event_key,event_type,timestamp,affected_item_refs_json,payload_json,payload_prunable) VALUES (?,?,?,?,?,?)")
      .run('new-prunable-event', 'session:start', NEW, JSON.stringify(['item-keep']), JSON.stringify({ secret: 'NEW_LIFECYCLE_PAYLOAD' }), 1);
    db.prepare("INSERT INTO lifecycle_evidence (evidence_key,item_id,item_ref,session,planning_task_id,run_id,build_session_id,source_event_key,lifecycle_state,reason_code,evidence_kind,status,is_current,is_terminal,occurred_at,summary,links_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run('evidence-current', 'item-current', 'item-current', 'session-keep', null, 'run-keep', 'build-session-keep', 'old-prunable-event', 'active', 'active-build', 'lifecycle-event', 'running', 1, 0, OLD, 'Current lifecycle summary', JSON.stringify([{ href: 'https://example.test/pr/1' }]));

    db.prepare("INSERT INTO planning_tasks (task_id,purpose,status_snapshot,source_fingerprint,selection_summary_json,compact_result_summary_json,raw_request_json,raw_result_json,raw_payload_prunable,created_at,updated_at,applied_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
      .run('old-terminal-task', 'session-plan-creation', 'applied', 'fp-old', JSON.stringify({ itemCount: 1 }), JSON.stringify({ draftCount: 1 }), JSON.stringify({ secret: 'RAW_TASK_REQUEST' }), JSON.stringify({ secret: 'RAW_TASK_RESULT' }), 1, OLD, OLD, OLD);
    db.prepare("INSERT INTO planning_task_items (task_id,item_ref,item_id,role,sequence) VALUES (?,?,?,?,?)").run('old-terminal-task', 'item-keep', 'item-keep', 'selected', 0);
    db.prepare("INSERT INTO planning_tasks (task_id,purpose,status_snapshot,source_fingerprint,raw_request_json,raw_result_json,raw_payload_prunable,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .run('active-task', 'session-plan-creation', 'running', 'fp-active', JSON.stringify({ secret: 'ACTIVE_TASK_REQUEST' }), JSON.stringify({ secret: 'ACTIVE_TASK_RESULT' }), 1, OLD, OLD);

    db.prepare("INSERT INTO recommendation_runs (run_id,source_fingerprint,created_at,is_current,raw_model_json,summary_json) VALUES (?,?,?,?,?,?)").run('rec-current', 'rec-current-fp', NEW, 1, JSON.stringify({ schemaVersion: 1, updatedAt: NEW, activeWork: [{ itemId: 'item-current', ref: 'active:item-current', rationale: 'current active work' }], readyCandidates: [], recommendedNextSequence: [{ itemId: 'item-current', ref: 'next:item-current', rationale: 'current recommendation' }], safeParallelizableGroups: [], blockedChains: [], rationaleAndAssumptions: ['current summary'] }), JSON.stringify({ recommendedNextItemIds: ['item-current'], safeParallelizableGroupCount: 0, blockedChainCount: 0, rationaleAndAssumptions: ['current summary'] }));
    db.prepare("INSERT INTO recommendation_lanes (lane_id,run_id,lane_kind,lane_ref,title,sequence,rationale) VALUES (?,?,?,?,?,?,?)").run('lane-current', 'rec-current', 'recommendedNextSequence', 'next:item-current', 'Current lane', 0, 'current rationale');
    db.prepare("INSERT INTO recommendation_lane_items (lane_id,item_ref,item_id,role,sequence,rationale) VALUES (?,?,?,?,?,?)").run('lane-current', 'item-current', 'item-current', 'member', 0, 'current item rationale');
    db.prepare("INSERT INTO recommendation_runs (run_id,source_fingerprint,created_at,is_current,raw_model_json,summary_json) VALUES (?,?,?,?,?,?)").run('rec-old', 'rec-old-fp', OLD, 0, JSON.stringify({ secret: 'HISTORICAL_RAW_MODEL' }), JSON.stringify({ title: 'old summary' }));
    db.prepare("INSERT INTO recommendation_lanes (lane_id,run_id,lane_kind,lane_ref,title,sequence,rationale) VALUES (?,?,?,?,?,?,?)").run('lane-old', 'rec-old', 'recommendedNextSequence', 'next:item-keep', 'Historical lane', 0, 'historical rationale');
    db.prepare("INSERT INTO recommendation_lane_items (lane_id,item_ref,item_id,role,sequence,rationale) VALUES (?,?,?,?,?,?)").run('lane-old', 'item-keep', 'item-keep', 'member', 0, 'old item rationale');

    db.prepare("INSERT OR REPLACE INTO search_documents (document_type,document_id,title,summary_text,body_text,updated_at) VALUES (?,?,?,?,?,?)").run('recommendation', 'lane-old', 'Historical lane', 'old rec', 'historical search text', OLD);
    db.prepare("INSERT OR REPLACE INTO search_documents (document_type,document_id,title,summary_text,body_text,updated_at) VALUES (?,?,?,?,?,?)").run('backlog_item', 'item-keep', 'Item Keep', 'summary', 'item body searchable', NEW);
  } finally { db.close(); }
}

function registry(): NativeExtensionRegistry {
  const { api, state } = createExtensionRecorder('eforge-plan', '/project/eforge/extensions/eforge-plan/index.ts');
  eforgePlanExtension(api as never);
  expect(state.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
  return { ...(state as NativeExtensionRecorderState), extensions: [], candidates: [] };
}

export async function invokeMaintenanceAction(cwd: string, actionId: string, input: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const result = await dispatchExtensionAction(registry(), { actionId: `eforge-plan:${actionId}`, input, requestedBy: { host: 'pi' }, cwd, timeoutMs: 5000 });
  expect(result).toMatchObject({ kind: 'success' });
  if (result.kind !== 'success') throw new Error(result.message);
  return result.output as Record<string, unknown>;
}

export async function readArchiveLines(cwd: string, relativePath: string): Promise<string[]> {
  return (await readFile(join(cwd, relativePath), 'utf-8')).trim().split('\n').filter(Boolean);
}
