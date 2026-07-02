import { lstat, readFile, realpath } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { BuildStageSpec, PlanInfo, PlansResponse, ReviewProfileConfig } from '@eforge-build/client';
import type { MonitorDB } from '../db.js';
import { parseEventRow } from './event-hydration.js';

interface BuildPlansInput {
  db: MonitorDB;
  sessionId: string;
  planOutputDir?: string;
}

type PlanDraft = PlanInfo;
type BuildReviewConfig = { build?: BuildStageSpec[]; review?: ReviewProfileConfig };

function isInsideDir(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

async function resolveContainedPath(path: string, parentDir: string): Promise<string | null> {
  const info = await lstat(path);
  if (info.isSymbolicLink()) return null;
  const real = await realpath(path);
  return isInsideDir(parentDir, real) ? real : null;
}

async function safeReadContainedFile(path: string, parentDir: string): Promise<string | null> {
  const real = await resolveContainedPath(path, parentDir);
  if (!real) return null;
  return readFile(real, 'utf-8');
}

export function candidateOrchestrationPaths(repoCwd: string, planBase: string, planSet: string): Array<{ path: string; base: string }> {
  const mainPath = resolve(repoCwd, planBase, planSet, 'orchestration.yaml');
  const mainBase = resolve(repoCwd, planBase);
  const worktreeBase = resolve(repoCwd, '..', `${basename(repoCwd)}-${planSet}-worktrees`, '__merge__');
  return [
    { path: mainPath, base: mainBase },
    { path: resolve(worktreeBase, planBase, planSet, 'orchestration.yaml'), base: resolve(worktreeBase, planBase) },
  ];
}

async function readBuildConfigFromOrchestration(db: MonitorDB, sessionId: string, planOutputDir?: string): Promise<Map<string, BuildReviewConfig> | null> {
  const run = [...db.getSessionRuns(sessionId)].reverse().find((r) => r.cwd && r.planSet);
  if (!run) return null;
  try {
    const candidates = candidateOrchestrationPaths(run.cwd, planOutputDir ?? 'eforge/plans', run.planSet);
    let content: string | null = null;
    for (const candidate of candidates) {
      if (!candidate.path.startsWith(`${candidate.base}/`)) continue;
      try {
        const realBase = await realpath(candidate.base);
        const realContent = await safeReadContainedFile(candidate.path, realBase);
        if (realContent !== null) { content = realContent; break; }
      } catch { /* try next */ }
    }
    if (!content) return null;
    const orch = parseYaml(content) as { plans?: unknown } | null;
    if (!orch || !Array.isArray(orch.plans)) return null;
    const map = new Map<string, BuildReviewConfig>();
    for (const raw of orch.plans) {
      const plan = raw as { id?: unknown; build?: unknown; review?: unknown };
      if (typeof plan.id !== 'string') continue;
      const entry: BuildReviewConfig = {};
      if (Array.isArray(plan.build)) entry.build = plan.build as BuildStageSpec[];
      if (plan.review && typeof plan.review === 'object' && !Array.isArray(plan.review)) entry.review = plan.review as ReviewProfileConfig;
      if (entry.build || entry.review) map.set(plan.id, entry);
    }
    return map.size > 0 ? map : null;
  } catch { return null; }
}

function isSubstantiveGapClosePlanBody(planBody: unknown): planBody is string {
  return typeof planBody === 'string' && planBody.trim().length > 1;
}

function getLatestGapCloserResultText(db: MonitorDB, sessionId: string): string | undefined {
  const resultEvents = db.getEventsByTypeForSession(sessionId, 'agent:result');
  for (let i = resultEvents.length - 1; i >= 0; i--) {
    const event = resultEvents[i];
    if (event.agent !== 'gap-closer') continue;
    try {
      const data = JSON.parse(event.data) as { result?: { resultText?: unknown } };
      if (isSubstantiveGapClosePlanBody(data.result?.resultText)) return data.result.resultText;
    } catch { /* ignore parse errors */ }
  }
  return undefined;
}

function compiledPlans(db: MonitorDB, sessionId: string): PlanDraft[] {
  const row = db.getEventsByTypeForSession(sessionId, 'planning:complete')[0];
  if (!row) return [];
  try {
    const data = JSON.parse(row.data) as { plans?: Array<{ id: string; name: string; body: string; dependsOn?: string[] }> };
    return (data.plans || []).map((p) => ({ id: p.id, name: p.name, body: p.body, dependsOn: p.dependsOn || [], type: 'plan' as const }));
  } catch { return []; }
}

function gapClosePlans(db: MonitorDB, sessionId: string): PlanDraft[] {
  const row = db.getEventsByTypeForSession(sessionId, 'gap_close:plan_ready').at(-1);
  if (!row) return [];
  try {
    const data = JSON.parse(row.data) as { planBody?: unknown };
    const body = isSubstantiveGapClosePlanBody(data.planBody) ? data.planBody : (getLatestGapCloserResultText(db, sessionId) ?? data.planBody);
    return [{ id: 'gap-close', name: 'PRD Gap Close', body: String(body), dependsOn: [], type: 'plan' }];
  } catch { return []; }
}

function resumeArtifactPlans(db: MonitorDB, sessionId: string): PlanDraft[] {
  const row = db.getEventsByTypeForSession(sessionId, 'build:resume:artifacts').at(-1);
  if (!row) return [];
  const parsed = parseEventRow(row.data, row.timestamp, row.type, row.id);
  if (parsed?.type !== 'build:resume:artifacts') return [];
  return parsed.plans.map((p) => ({ id: p.id, name: p.name, body: p.body, dependsOn: p.dependsOn, type: 'plan' as const, ...(p.build !== undefined ? { build: p.build } : {}), ...(p.review !== undefined ? { review: p.review } : {}) }));
}

function enrichPlans(plans: PlanDraft[], config: Map<string, BuildReviewConfig> | null): void {
  if (!config) return;
  for (const plan of plans) {
    const entry = config.get(plan.id);
    if (!entry) continue;
    if (plan.build === undefined) plan.build = entry.build;
    if (plan.review === undefined) plan.review = entry.review;
  }
}

export async function buildPlansResponse(input: BuildPlansInput): Promise<PlansResponse> {
  let allPlans = [
    ...compiledPlans(input.db, input.sessionId),
    ...gapClosePlans(input.db, input.sessionId),
  ];
  if (allPlans.length === 0) allPlans = resumeArtifactPlans(input.db, input.sessionId);
  enrichPlans(allPlans, await readBuildConfigFromOrchestration(input.db, input.sessionId, input.planOutputDir));
  return allPlans;
}
