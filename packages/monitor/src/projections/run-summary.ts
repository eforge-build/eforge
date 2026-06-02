import type { RunInfo, RunSummary } from '@eforge-build/client';
import type { MonitorDB, EventRecord } from '../db.js';
import { parseEventRow } from './event-hydration.js';

type PlanStatus = RunSummary['plans'][number];

function deriveStatus(runs: RunInfo[]): RunSummary['status'] {
  if (runs.length === 0) return 'unknown';
  if (runs.some((r) => r.status === 'running')) return 'running';
  if (runs.some((r) => r.status === 'failed')) return 'failed';
  return 'completed';
}

function parseData(row: EventRecord): Record<string, unknown> | null {
  try { return JSON.parse(row.data) as Record<string, unknown>; } catch { return null; }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [];
}

function seedPlansFromLatestPlanningComplete(db: MonitorDB, sessionId: string): Map<string, PlanStatus> | null {
  const events = db.getEventsByTypeForSession(sessionId, 'planning:complete');
  const latest = events.at(-1);
  if (!latest) return null;
  const data = parseData(latest);
  if (!Array.isArray(data?.plans)) return null;
  const map = new Map<string, PlanStatus>();
  for (const p of data.plans) {
    if (p && typeof p === 'object' && typeof (p as { id?: unknown }).id === 'string') {
      const plan = p as { id: string; branch?: string | null; dependsOn?: unknown };
      map.set(plan.id, { id: plan.id, status: 'pending', branch: plan.branch ?? null, dependsOn: stringArray(plan.dependsOn) });
    }
  }
  return map;
}

function seedPlansFromNewestResumeArtifacts(db: MonitorDB, sessionId: string): Map<string, PlanStatus> {
  const map = new Map<string, PlanStatus>();
  const rows = db.getEventsByTypeForSession(sessionId, 'build:resume:artifacts');
  for (let i = rows.length - 1; i >= 0; i--) {
    const parsed = parseEventRow(rows[i].data, rows[i].timestamp, rows[i].type, rows[i].id);
    if (parsed?.type !== 'build:resume:artifacts') continue;
    for (const plan of parsed.orchestration.plans) {
      map.set(plan.id, { id: plan.id, status: 'pending', branch: plan.branch ?? null, dependsOn: plan.dependsOn ?? [] });
    }
    return map;
  }
  return map;
}

function seedPlans(db: MonitorDB, sessionId: string): Map<string, PlanStatus> {
  return seedPlansFromLatestPlanningComplete(db, sessionId) ?? seedPlansFromNewestResumeArtifacts(db, sessionId);
}

function ensurePlan(map: Map<string, PlanStatus>, planId: string): PlanStatus {
  let plan = map.get(planId);
  if (!plan) {
    plan = { id: planId, status: 'pending', branch: null, dependsOn: [] };
    map.set(planId, plan);
  }
  return plan;
}

function overlayResumeState(data: Record<string, unknown>, map: Map<string, PlanStatus>): void {
  for (const planId of stringArray(data.seededMerged)) {
    ensurePlan(map, planId).status = 'completed';
  }
  for (const planId of stringArray(data.seededPending)) {
    if (!map.has(planId)) map.set(planId, { id: planId, status: 'pending', branch: null, dependsOn: [] });
  }
}

function overlayBuildStart(data: Record<string, unknown>, map: Map<string, PlanStatus>): void {
  if (typeof data.planId !== 'string') return;
  const plan = ensurePlan(map, data.planId);
  plan.status = 'running';
  if (typeof data.branch === 'string') plan.branch = data.branch;
  if (Array.isArray(data.dependsOn)) plan.dependsOn = stringArray(data.dependsOn);
}

function overlayBuildEvents(db: MonitorDB, sessionId: string, map: Map<string, PlanStatus>): void {
  const overlayTypes = new Set(['build:resume:state', 'plan:build:start', 'plan:build:complete', 'plan:build:failed']);
  for (const evt of db.getEventsBySession(sessionId)) {
    if (!overlayTypes.has(evt.type)) continue;
    const data = parseData(evt);
    if (!data) continue;
    if (evt.type === 'build:resume:state') {
      overlayResumeState(data, map);
    } else if (evt.type === 'plan:build:start') {
      overlayBuildStart(data, map);
    } else if (evt.type === 'plan:build:complete') {
      if (typeof data.planId === 'string' && map.has(data.planId)) map.get(data.planId)!.status = 'completed';
    } else if (evt.type === 'plan:build:failed') {
      if (typeof data.planId === 'string' && map.has(data.planId)) map.get(data.planId)!.status = 'failed';
    }
  }
}

function currentPhase(db: MonitorDB, sessionId: string): string | null {
  const row = db.getEventsByTypeForSession(sessionId, 'phase:start').at(-1);
  const data = row ? parseData(row) : null;
  return typeof data?.phase === 'string' ? data.phase : null;
}

function currentAgent(db: MonitorDB, sessionId: string): string | null {
  const stopped = new Set<string>();
  for (const evt of db.getEventsByTypeForSession(sessionId, 'agent:stop')) {
    const data = parseData(evt); if (typeof data?.agentId === 'string') stopped.add(data.agentId);
  }
  const starts = db.getEventsByTypeForSession(sessionId, 'agent:start');
  for (let i = starts.length - 1; i >= 0; i--) {
    const data = parseData(starts[i]);
    if (typeof data?.agentId === 'string' && !stopped.has(data.agentId)) return typeof data.agent === 'string' ? data.agent : data.agentId;
  }
  return null;
}

function duration(runs: RunInfo[]): RunSummary['duration'] {
  if (runs.length === 0) return { startedAt: null, completedAt: null, seconds: null };
  const startedAt = runs[0].startedAt;
  const completedAt = runs[runs.length - 1].completedAt ?? null;
  return { startedAt, completedAt, seconds: completedAt ? Math.round((new Date(completedAt).getTime() - new Date(startedAt).getTime()) / 1000) : Math.round((Date.now() - new Date(startedAt).getTime()) / 1000) };
}

export function buildRunSummary(db: MonitorDB, sessionId: string): RunSummary {
  const sessionRuns = db.getSessionRuns(sessionId);
  const plans = seedPlans(db, sessionId);
  overlayBuildEvents(db, sessionId, plans);
  const events = db.getEventsBySession(sessionId);
  return {
    sessionId,
    status: deriveStatus(sessionRuns),
    runs: sessionRuns.map((r) => ({ id: r.id, command: r.command, status: r.status, startedAt: r.startedAt, completedAt: r.completedAt ?? null })),
    plans: Array.from(plans.values()),
    currentPhase: currentPhase(db, sessionId),
    currentAgent: currentAgent(db, sessionId),
    eventCounts: { total: events.length, errors: events.filter((e) => e.type.endsWith(':failed') || e.type.endsWith(':error')).length },
    duration: duration(sessionRuns),
  };
}
