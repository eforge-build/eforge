import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { safeParseWithSchema } from '@eforge-build/client';
import { PlanningTaskWorkflowIndexSchema } from '../planning-agent-task-schemas.js';
import type { Collector } from './types.js';
import { addDiagnostic } from './diagnostics.js';
import { asString, projectRelative, sha256 } from './stable.js';

export const collectLegacyPlanningTasks: Collector = (cwd, graph) => {
  if (!graph.include.includes('planningTasks')) return;
  const path = join(cwd, '.eforge/storage/extensions/eforge-plan/planning-tasks/index.json'); if (!existsSync(path)) return; const rel = projectRelative(cwd, path);
  let json: unknown; try { json = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { addDiagnostic(graph, 'unsupported-legacy-payload', 'Malformed planning task index JSON.', { path: rel, severity: 'error', details: { error: String(e) } }); return; }
  const parsed = safeParseWithSchema(PlanningTaskWorkflowIndexSchema, json); if (!parsed.success) { addDiagnostic(graph, 'unsupported-legacy-payload', 'Unsupported planning task index payload.', { path: rel, severity: 'error', details: parsed.error as never }); return; }
  for (const [i, entry] of entries(parsed.data).entries()) {
    const o = entry as Record<string, unknown>; const taskId = asString(o.taskId) ?? asString(o.id) ?? `legacy-task-${i}`; const sel = object(o.selection ?? o.selectionSummary ?? {});
    const itemRefs = strings(sel.itemIds ?? o.itemIds); const epicRefs = strings(sel.epicIds ?? sel.epicId ?? o.epicIds); const recRefs = strings(sel.recommendationRefs ?? o.recommendationRefs ?? sel.recommendationRef ?? sel.sourceRecommendationRef);
    for (const ref of itemRefs) if (!graph.items.some((it) => it.item.id === ref)) addDiagnostic(graph, 'orphan-ref', `Planning task ${taskId} selected missing item ${ref}.`, { ref, path: rel });
    for (const ref of epicRefs) if (!graph.epics.some((ep) => ep.epic.id === ref)) addDiagnostic(graph, 'orphan-ref', `Planning task ${taskId} selected missing epic ${ref}.`, { ref, path: rel });
    graph.planningTasks.push({ task: { taskId, parentTaskId: asString(o.parentTaskId), purpose: asString(o.purpose), sourceFingerprint: sha256(JSON.stringify(o)), requestedSections: (o.requestedOutputSections ?? o.requestedSections ?? o.sections) as never, selectionSummary: sel as never, compactResultSummary: o.compactResultSummary as never, rawRequest: o.rawRequest as never, rawResult: o.rawResult as never, rawPayloadPrunable: true, createdAt: asString(o.createdAt), updatedAt: asString(o.updatedAt), appliedAt: asString(o.appliedAt), statusSnapshot: asString(o.status) ?? 'indexed' }, refs: { items: itemRefs.map((ref, sequence) => ({ ref, resolvedId: graph.items.some((it) => it.item.id === ref) ? ref : undefined, role: 'selected', sequence, sourcePath: rel })), epics: epicRefs.map((ref, sequence) => ({ ref, resolvedId: graph.epics.some((ep) => ep.epic.id === ref) ? ref : undefined, role: 'selected', sequence, sourcePath: rel })), recommendationRefs: recRefs.map((ref, sequence) => ({ ref, role: 'selected', sequence, sourcePath: rel })) } });
  }
};
function entries(v: unknown): unknown[] { const o = object(v); return Array.isArray(o.entries) ? o.entries : Array.isArray(v) ? v : []; }
function object(v: unknown): Record<string, unknown> { return v && typeof v === 'object' ? v as Record<string, unknown> : {}; }
function strings(v: unknown): string[] { return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : typeof v === 'string' ? [v] : []; }
