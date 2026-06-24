import { existsSync, unlinkSync } from 'node:fs';
import { openEforgePlanStore, resolveEforgePlanStorePath, upsertEpic, replaceEpicTags, replaceEpicSections, upsertBacklogItem, replaceBacklogItemTags, replaceBacklogItemSections, replaceItemDependencies, upsertSessionPlan, replaceAllSessionPlanItems, replaceAllSessionPlanEpics, clearCurrentRecommendationRuns, upsertRecommendationRun, deleteRecommendationLanesForRun, upsertRecommendationLane, replaceRecommendationLaneItems, listPlanningTasks, upsertPlanningTask, replacePlanningTaskRefs, upsertQueuePrd, upsertBuildRun, upsertBuildSession, upsertLandingLink, recordLifecycleEvent, recordLifecycleEvidence, recordImportRun, recordImportDiagnostic, markSearchIndexDirtyBatch } from '../sqlite/index.js';
import type { PlanningTaskUpsert } from '../sqlite/types.js';
import { addDiagnostic } from './diagnostics.js';
import type { LegacyImportGraph } from './types.js';

export function removeStoreFiles(cwd: string): boolean { let removed = false; const base = resolveEforgePlanStorePath(cwd); for (const p of [base, `${base}-wal`, `${base}-shm`]) if (existsSync(p)) { unlinkSync(p); removed = true; } return removed; }
export function applyLegacyImportGraph(cwd: string, graph: LegacyImportGraph, opts: { replaceExisting?: boolean } = {}): { replacedExisting: boolean; storePath: string } {
  const storePath = resolveEforgePlanStorePath(cwd); const replacedExisting = opts.replaceExisting ? removeStoreFiles(cwd) : false; const store = openEforgePlanStore(cwd, { create: true, migrate: true });
  try { store.transaction(() => {
    for (const e of graph.epics) { upsertEpic(store, e.epic); replaceEpicTags(store, e.epic.id, e.tags); replaceEpicSections(store, e.epic.id, e.sections); }
    for (const i of graph.items) { upsertBacklogItem(store, i.item); replaceBacklogItemTags(store, i.item.id, i.tags); replaceBacklogItemSections(store, i.item.id, i.sections); replaceItemDependencies(store, i.item.id, i.dependencies); }
    for (const s of graph.sessionPlans) { upsertSessionPlan(store, s.plan); replaceAllSessionPlanItems(store, { session: s.plan.session, items: s.itemLinks }); replaceAllSessionPlanEpics(store, { session: s.plan.session, epics: s.epicLinks }); }
    if (graph.recommendationRun) { clearCurrentRecommendationRuns(store); upsertRecommendationRun(store, graph.recommendationRun); deleteRecommendationLanesForRun(store, graph.recommendationRun.runId); for (const l of graph.recommendationLanes) { upsertRecommendationLane(store, l.lane); replaceRecommendationLaneItems(store, l.lane.laneId, l.items); } }
    const planningTaskIds = new Set([...listPlanningTasks(store).map((t) => t.taskId), ...graph.planningTasks.map((t) => t.task.taskId)]);
    for (const t of graph.planningTasks) { upsertPlanningTask(store, withoutParent(t.task)); replacePlanningTaskRefs(store, { taskId: t.task.taskId, ...t.refs }); }
    for (const t of graph.planningTasks) {
      const parentTaskId = t.task.parentTaskId;
      if (!parentTaskId) continue;
      if (planningTaskIds.has(parentTaskId)) upsertPlanningTask(store, t.task);
      else addDiagnostic(graph, 'orphan-ref', `Planning task ${t.task.taskId} references missing parent task ${parentTaskId}.`, { ref: parentTaskId });
    }
    for (const q of graph.queuePrds) upsertQueuePrd(store, q); for (const r of graph.buildRuns) upsertBuildRun(store, r); for (const s of graph.buildSessions) upsertBuildSession(store, s); for (const l of graph.landingLinks) upsertLandingLink(store, l);
    for (const e of graph.lifecycleEvents) recordLifecycleEvent(store, e); for (const e of graph.lifecycleEvidence) recordLifecycleEvidence(store, e);
    recordImportRun(store, { runId: graph.runId, dryRun: false, applied: true, replacedExisting, startedAt: graph.startedAt, finishedAt: new Date().toISOString(), counts: graph.counts, summary: { sourceFingerprint: graph.sourceFingerprint, include: graph.include }, verboseReport: { diagnostics: graph.diagnostics } as never, verboseReportPrunable: true });
    for (const d of graph.diagnostics) recordImportDiagnostic(store, { ...d, runId: graph.runId });
    markSearchIndexDirtyBatch(store, graph.searchDirty);
  }); } finally { store.close(); }
  return { replacedExisting, storePath };
}
function withoutParent(task: PlanningTaskUpsert): PlanningTaskUpsert { return { ...task, parentTaskId: undefined, selectionSummary: task.parentTaskId ? { ...(task.selectionSummary && typeof task.selectionSummary === 'object' && !Array.isArray(task.selectionSummary) ? task.selectionSummary : { importedSelectionSummary: task.selectionSummary }), importedParentTaskId: task.parentTaskId } as never : task.selectionSummary }; }
