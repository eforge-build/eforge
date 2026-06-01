import type { RunInfo, RunSummary } from '@eforge-build/client';
import type { MonitorDB, EventRecord } from '../db.js';

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

function seedPlans(db: MonitorDB, sessionId: string): Map<string, PlanStatus> {
  const map = new Map<string, PlanStatus>();
  const events = db.getEventsByTypeForSession(sessionId, 'planning:complete');
  const latest = events.at(-1);
  if (!latest) return map;
  const data = parseData(latest);
  if (!Array.isArray(data?.plans)) return map;
  for (const p of data.plans) {
    if (p && typeof p === 'object' && typeof (p as { id?: unknown }).id === 'string') {
      const plan = p as { id: string; branch?: string | null; dependsOn?: string[] };
      map.set(plan.id, { id: plan.id, status: 'pending', branch: plan.branch ?? null, dependsOn: plan.dependsOn ?? [] });
    }
  }
  return map;
}

function overlayBuildEvents(db: MonitorDB, sessionId: string, map: Map<string, PlanStatus>): void {
  for (const evt of db.getEventsByTypeForSession(sessionId, 'plan:build:start')) {
    const data = parseData(evt);
    if (typeof data?.planId !== 'string') continue;
    const existing = map.get(data.planId);
    if (existing) {
      existing.status = 'running';
      if (data.branch !== undefined) existing.branch = typeof data.branch === 'string' ? data.branch : null;
      if (data.dependsOn !== undefined) existing.dependsOn = Array.isArray(data.dependsOn) ? data.dependsOn.filter((x): x is string => typeof x === 'string') : [];
    } else {
      map.set(data.planId, { id: data.planId, status: 'running', branch: typeof data.branch === 'string' ? data.branch : null, dependsOn: Array.isArray(data.dependsOn) ? data.dependsOn.filter((x): x is string => typeof x === 'string') : [] });
    }
  }
  for (const evt of db.getEventsByTypeForSession(sessionId, 'plan:build:complete')) {
    const data = parseData(evt); if (typeof data?.planId === 'string' && map.has(data.planId)) map.get(data.planId)!.status = 'completed';
  }
  for (const evt of db.getEventsByTypeForSession(sessionId, 'plan:build:failed')) {
    const data = parseData(evt); if (typeof data?.planId === 'string' && map.has(data.planId)) map.get(data.planId)!.status = 'failed';
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
