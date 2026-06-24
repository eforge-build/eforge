import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { collectLegacyBacklog } from './legacy-backlog.js';
import { collectLegacyMonitor } from './legacy-monitor.js';
import { collectLegacyPlanningTasks } from './legacy-planning-tasks.js';
import { collectLegacyQueue } from './legacy-queue.js';
import { collectLegacyRecommendations } from './legacy-recommendations.js';
import { collectLegacySessionPlans } from './legacy-session-plans.js';
import { collectLegacyTraces } from './legacy-traces.js';
import { PLANNING_STORE_IMPORT_INCLUDES, type ImportDiagnostic, type LegacyImportGraph, type PlanningStoreImportInclude, type RunPlanningStoreImportOptions } from './types.js';
import { canonicalJson, sha256 } from './stable.js';

export async function collectLegacyImportGraph(cwd: string, options: RunPlanningStoreImportOptions = {}): Promise<LegacyImportGraph> {
  const include = normalizeIncludes(options.include);
  const now = new Date().toISOString();
  const sourceScan = sourceFingerprint(cwd);
  const graph: LegacyImportGraph = { runId: `legacy-import:${sha256(canonicalJson({ cwd, include, fp: sourceScan.fingerprint })).slice(0, 24)}`, startedAt: now, include, sourceFingerprint: sourceScan.fingerprint, counts: {}, diagnostics: sourceScan.diagnostics, epics: [], items: [], sessionPlans: [], recommendationLanes: [], planningTasks: [], queuePrds: [], buildRuns: [], buildSessions: [], landingLinks: [], lifecycleEvents: [], lifecycleEvidence: [], searchDirty: [] };
  for (const collector of [collectLegacyBacklog, collectLegacySessionPlans, collectLegacyRecommendations, collectLegacyPlanningTasks, collectLegacyQueue, collectLegacyTraces, collectLegacyMonitor]) await collector(cwd, graph);
  graph.counts = { epics: graph.epics.length, items: graph.items.length, sessionPlans: graph.sessionPlans.length, recommendationLanes: graph.recommendationLanes.length, recommendationLaneItems: graph.recommendationLanes.reduce((n, l) => n + l.items.length, 0), planningTasks: graph.planningTasks.length, queuePrds: graph.queuePrds.length, buildRuns: graph.buildRuns.length, buildSessions: graph.buildSessions.length, landingLinks: graph.landingLinks.length, lifecycleEvents: graph.lifecycleEvents.length, lifecycleEvidence: graph.lifecycleEvidence.length, diagnostics: graph.diagnostics.length };
  return graph;
}
export function normalizeIncludes(include: RunPlanningStoreImportOptions['include']): PlanningStoreImportInclude[] { const allowed = new Set(PLANNING_STORE_IMPORT_INCLUDES); const values = include === undefined ? PLANNING_STORE_IMPORT_INCLUDES : include; return PLANNING_STORE_IMPORT_INCLUDES.filter((v) => values.includes(v) && allowed.has(v)); }
function sourceFingerprint(cwd: string): { fingerprint: string; diagnostics: ImportDiagnostic[] } { const roots = ['.eforge/storage/extensions/eforge-plan', '.eforge/session-plans', '.eforge/queue', '.eforge/monitor.db', '.backlog']; const rows: string[] = []; const diagnostics: ImportDiagnostic[] = []; for (const root of roots) scan(join(cwd, root), root, rows, diagnostics); return { fingerprint: sha256(rows.sort().join('\n')), diagnostics }; }
function scan(path: string, label: string, rows: string[], diagnostics: ImportDiagnostic[]): void { if (isPlanningStoreArtifact(label)) return; let s; try { if (!existsSync(path)) return; s = statSync(path); } catch (error) { diagnostics.push({ diagnosticId: `source-fingerprint:${sha256(label).slice(0, 16)}`, severity: 'error', code: 'unreadable-artifact', message: `Could not fingerprint legacy source ${label}.`, path: label, details: { error: error instanceof Error ? error.message : String(error) } }); return; } if (s.isFile()) rows.push(`${label}:${s.size}:${s.mtimeMs}`); else if (s.isDirectory()) { let names: string[]; try { names = readdirSync(path); } catch (error) { diagnostics.push({ diagnosticId: `source-fingerprint:${sha256(`${label}:readdir`).slice(0, 16)}`, severity: 'error', code: 'unreadable-artifact', message: `Could not list legacy source ${label}.`, path: label, details: { error: error instanceof Error ? error.message : String(error) } }); return; } for (const n of names) scan(join(path, n), `${label}/${n}`, rows, diagnostics); } }
function isPlanningStoreArtifact(label: string): boolean { return /eforge-plan-private\.sqlite(?:-(?:wal|shm))?$/.test(label); }
