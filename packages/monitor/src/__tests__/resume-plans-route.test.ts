import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { API_ROUTES, buildPath, type PlanInfo } from '@eforge-build/client';
import { openDatabase, type MonitorDB } from '../db.js';
import { startServer, type MonitorServer } from '../server.js';

const review = { strategy: 'auto' as const, perspectives: ['code'], maxRounds: 1, evaluatorStrictness: 'standard' as const };
const ts = '2025-01-01T00:00:00.000Z';
const servers: MonitorServer[] = [];
const dbs: MonitorDB[] = [];

async function startFixture(): Promise<{ server: MonitorServer; db: MonitorDB; sessionId: string; runId: string }> {
  const cwd = mkdtempSync(join(tmpdir(), 'eforge-resume-plans-route-'));
  const db = openDatabase(':memory:');
  const sessionId = 'session-1';
  const runId = 'run-1';
  db.insertRun({ id: runId, sessionId, planSet: 'feature-x', command: 'resume', status: 'running', startedAt: ts, cwd });
  const server = await startServer(db, 0, { cwd });
  servers.push(server);
  dbs.push(db);
  return { server, db, sessionId, runId };
}

function insertEvent(db: MonitorDB, runId: string, type: string, data: Record<string, unknown>): void {
  db.insertEvent({ runId, type, data: JSON.stringify({ timestamp: ts, type, ...data }), timestamp: ts });
}

async function fetchPlans(server: MonitorServer, id: string): Promise<PlanInfo[]> {
  const res = await fetch(`${server.url}${buildPath(API_ROUTES.plans, { runId: id })}`);
  expect(res.status).toBe(200);
  return res.json() as Promise<PlanInfo[]>;
}

afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop();
  for (const db of dbs.splice(0)) db.close();
});

describe('GET /api/plans/:runId resume artifact projection', () => {
  it('returns resume artifact plans when no existing plan source produced plans', async () => {
    const { server, db, runId, sessionId } = await startFixture();
    insertEvent(db, runId, 'build:resume:artifacts', {
      prdId: 'prd-feature-x',
      setName: 'feature-x',
      featureBranch: 'eforge/feature-x',
      artifactSource: 'merge-worktree',
      source: { label: 'Recovered PRD', content: '# PRD' },
      orchestration: {
        name: 'feature-x',
        description: 'Feature X',
        created: ts,
        baseBranch: 'main',
        pipeline: { compile: [], defaultBuild: [], defaultReview: review, rationale: 'resume' },
        plans: [
          { id: 'plan-01', name: 'Plan 01', dependsOn: [], branch: 'feature-x/plan-01', build: ['implement'], review },
          { id: 'plan-02', name: 'Plan 02', dependsOn: ['plan-01'], branch: 'feature-x/plan-02', build: [['test', 'pnpm test']], review },
        ],
      },
      plans: [
        { id: 'plan-01', name: 'Plan 01', body: '# Plan 01', dependsOn: [], build: ['implement'], review },
        { id: 'plan-02', name: 'Plan 02', body: '# Plan 02', dependsOn: ['plan-01'], build: [['test', 'pnpm test']], review },
      ],
    });

    const plans = await fetchPlans(server, sessionId);
    expect(plans).toEqual([
      { id: 'plan-01', name: 'Plan 01', body: '# Plan 01', dependsOn: [], type: 'plan', build: ['implement'], review },
      { id: 'plan-02', name: 'Plan 02', body: '# Plan 02', dependsOn: ['plan-01'], type: 'plan', build: [['test', 'pnpm test']], review },
    ]);
  });

  it('skips malformed resume artifact rows instead of projecting partial plan data', async () => {
    const { server, db, runId, sessionId } = await startFixture();
    insertEvent(db, runId, 'build:resume:artifacts', {
      prdId: 'prd-feature-x',
      setName: 'feature-x',
      featureBranch: 'eforge/feature-x',
      artifactSource: 'merge-worktree',
      source: { label: 'Recovered PRD' },
      orchestration: {
        name: 'feature-x',
        description: 'Feature X',
        created: ts,
        baseBranch: 'main',
        pipeline: { compile: [], defaultBuild: [], defaultReview: review, rationale: 'resume' },
        plans: [],
      },
      plans: [{ id: 'plan-01', name: 'Plan 01', dependsOn: [] }],
    });

    await expect(fetchPlans(server, sessionId)).resolves.toEqual([]);
  });

  it('prefers planning:complete plans over resume artifacts', async () => {
    const { server, db, runId, sessionId } = await startFixture();
    insertEvent(db, runId, 'build:resume:artifacts', {
      prdId: 'prd-feature-x',
      setName: 'feature-x',
      featureBranch: 'eforge/feature-x',
      artifactSource: 'merge-worktree',
      source: { label: 'Recovered PRD' },
      orchestration: { name: 'feature-x', description: '', created: ts, baseBranch: 'main', pipeline: { compile: [], defaultBuild: [], defaultReview: review, rationale: '' }, plans: [] },
      plans: [{ id: 'resume-plan', name: 'Resume Plan', body: '# Resume', dependsOn: [] }],
    });
    insertEvent(db, runId, 'planning:complete', {
      plans: [{ id: 'fresh-plan', name: 'Fresh Plan', body: '# Fresh', dependsOn: [] }],
    });

    const plans = await fetchPlans(server, sessionId);
    expect(plans.map((p) => p.id)).toEqual(['fresh-plan']);
  });

  it('prefers gap-close plans over resume artifacts when planning is absent', async () => {
    const { server, db, runId, sessionId } = await startFixture();
    insertEvent(db, runId, 'build:resume:artifacts', {
      prdId: 'prd-feature-x',
      setName: 'feature-x',
      featureBranch: 'eforge/feature-x',
      artifactSource: 'merge-worktree',
      source: { label: 'Recovered PRD' },
      orchestration: { name: 'feature-x', description: '', created: ts, baseBranch: 'main', pipeline: { compile: [], defaultBuild: [], defaultReview: review, rationale: '' }, plans: [] },
      plans: [{ id: 'resume-plan', name: 'Resume Plan', body: '# Resume', dependsOn: [] }],
    });
    insertEvent(db, runId, 'gap_close:plan_ready', { planBody: '# Gap Close' });

    const plans = await fetchPlans(server, sessionId);
    expect(plans).toEqual([{ id: 'gap-close', name: 'PRD Gap Close', body: '# Gap Close', dependsOn: [], type: 'plan' }]);
  });
});
