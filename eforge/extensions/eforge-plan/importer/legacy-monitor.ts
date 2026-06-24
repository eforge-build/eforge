import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Collector } from './types.js';
import { addDiagnostic } from './diagnostics.js';
import { asString, projectRelative, sha256 } from './stable.js';

export const collectLegacyMonitor: Collector = (cwd, graph) => {
  if (!graph.include.includes('monitor')) return;
  const path = join(cwd, '.eforge/monitor.db'); if (!existsSync(path)) return; const rel = projectRelative(cwd, path); let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map((r) => r.name));
    if (tables.has('runs')) for (const row of db.prepare('SELECT * FROM runs').all() as Record<string, unknown>[]) { const runId = asString(row.id) ?? asString(row.run_id); if (!runId) continue; const session = knownSession(graph, asString(row.session)); graph.buildRuns.push({ runId, session, buildSessionId: asString(row.build_session_id) ?? asString(row.session_id), status: asString(row.status), startedAt: asString(row.started_at) ?? asString(row.startedAt), finishedAt: asString(row.finished_at) ?? asString(row.finishedAt), planSet: asString(row.plan_set), cwd: asString(row.cwd), statusSummary: asString(row.summary), errorSummary: asString(row.error), importFingerprint: sha256(JSON.stringify(row)) }); const bs = asString(row.build_session_id) ?? asString(row.session_id); if (bs) graph.buildSessions.push({ buildSessionId: bs, session, status: asString(row.status), startedAt: asString(row.started_at), finishedAt: asString(row.finished_at), importFingerprint: sha256(JSON.stringify(row)) }); }
    if (tables.has('events')) for (const row of db.prepare('SELECT * FROM events').all() as Record<string, unknown>[]) readEvent(graph, row, rel);
  } catch (e) { addDiagnostic(graph, 'unreadable-artifact', 'Could not read monitor DB.', { path: rel, severity: 'error', details: { error: String(e) } }); }
  finally { db?.close(); }
};
function readEvent(graph: Parameters<Collector>[1], row: Record<string, unknown>, path: string): void {
  const id = asString(row.id) ?? String(row.rowid ?? sha256(JSON.stringify(row)).slice(0, 12)); const payloadText = asString(row.payload) ?? asString(row.data) ?? asString(row.event_json); let payload: Record<string, unknown> = {};
  if (payloadText) { try { payload = JSON.parse(payloadText) as Record<string, unknown>; } catch (e) { addDiagnostic(graph, 'unsupported-legacy-payload', `Monitor event ${id} has invalid JSON payload.`, { ref: id, path, severity: 'error', details: { error: String(e) } }); return; } }
  const eventType = asString(row.type) ?? asString(payload.type) ?? 'monitor:event';
  const session = knownSession(graph, asString(row.session) ?? asString(payload.session)); const rawRunId = asString(row.run_id) ?? asString(payload.runId); const rawBuildSessionId = asString(row.build_session_id) ?? asString(payload.buildSessionId) ?? asString(payload.sessionId);
  const runId = knownRun(graph, rawRunId); const buildSessionId = knownBuildSession(graph, rawBuildSessionId);
  if (rawRunId && !runId) addDiagnostic(graph, 'orphan-ref', `Monitor event ${id} references missing build run ${rawRunId}.`, { ref: rawRunId, path });
  if (rawBuildSessionId && !buildSessionId) addDiagnostic(graph, 'orphan-ref', `Monitor event ${id} references missing build session ${rawBuildSessionId}.`, { ref: rawBuildSessionId, path });
  const itemRefs = explicitItemRefs(payload);
  graph.lifecycleEvents.push({ eventKey: `monitor:event:${id}`, eventType, timestamp: asString(row.timestamp) ?? asString(payload.timestamp), session, runId: rawRunId, buildSessionId: rawBuildSessionId, affectedItemRefs: itemRefs, payload: payload as never, payloadPrunable: true, sourceFingerprint: sha256(JSON.stringify({ row, payload })) });
  // Deliberately conservative: only explicit item reference arrays/fields become evidence.
  for (const itemRef of itemRefs) graph.lifecycleEvidence.push({ evidenceKey: `monitor:event:${id}:item:${itemRef}`, itemRef, itemId: graph.items.some((i) => i.item.id === itemRef) ? itemRef : undefined, session, runId, buildSessionId, sourceEventKey: `monitor:event:${id}`, lifecycleState: state(eventType), reasonCode: 'monitor-event', evidenceKind: 'monitor', status: asString(payload.status), links: { path, eventType, rawRunId, rawBuildSessionId } as never });
}
function explicitItemRefs(payload: Record<string, unknown>): string[] { const v = payload.itemIds ?? payload.sourceItemIds ?? payload.affectedItemRefs ?? payload.itemId; return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : typeof v === 'string' ? [v] : []; }
function knownSession(graph: Parameters<Collector>[1], session: string | undefined): string | undefined { return session && graph.sessionPlans.some((s) => s.plan.session === session) ? session : undefined; }
function knownRun(graph: Parameters<Collector>[1], runId: string | undefined): string | undefined { return runId && graph.buildRuns.some((r) => r.runId === runId) ? runId : undefined; }
function knownBuildSession(graph: Parameters<Collector>[1], buildSessionId: string | undefined): string | undefined { return buildSessionId && graph.buildSessions.some((s) => s.buildSessionId === buildSessionId) ? buildSessionId : undefined; }
function state(type: string) { if (type.includes('landing') || type.includes('merge')) return 'shipped' as const; if (type.includes('session')) return 'build' as const; if (type.includes('queue')) return 'queued' as const; if (type.includes('fail')) return 'failed' as const; return 'active' as const; }
