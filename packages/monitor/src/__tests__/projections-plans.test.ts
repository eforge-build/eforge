import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../db.js';
import { buildPlansResponse } from '../projections/plans.js';
import type { MonitorDB } from '../db.js';

const ts = '2025-01-01T00:00:00.000Z';
const review = { strategy: 'auto' as const, perspectives: ['code'], maxRounds: 1, evaluatorStrictness: 'standard' as const };
function tmp(): string { return mkdtempSync(join(tmpdir(), 'eforge-plans-proj-')); }
function addRun(db: MonitorDB, cwd: string): void { db.insertRun({ id: 'r1', sessionId: 's1', planSet: 'set', command: 'compile', status: 'completed', startedAt: ts, cwd }); }
function insert(db: MonitorDB, type: string, data: Record<string, unknown>, agent?: string): void { db.insertEvent({ runId: 'r1', type, agent, data: JSON.stringify({ type, timestamp: ts, ...data }), timestamp: ts }); }

describe('plans projection', () => {
  it('projects compiled plans from the first planning:complete event and enriches from orchestration', async () => {
    const cwd = tmp(); mkdirSync(join(cwd, 'eforge/plans/set'), { recursive: true });
    writeFileSync(join(cwd, 'eforge/plans/set/orchestration.yaml'), 'plans:\n  - id: p1\n    build: [implement]\n    review:\n      strategy: auto\n      perspectives: [code]\n      maxRounds: 1\n      evaluatorStrictness: standard\n');
    const db = openDatabase(':memory:'); addRun(db, cwd);
    insert(db, 'planning:complete', { plans: [{ id: 'p1', name: 'P1', body: '# P1', branch: 'b', dependsOn: [] }] });
    insert(db, 'planning:complete', { plans: [{ id: 'p2', name: 'P2', body: '# P2', branch: 'b', dependsOn: [] }] });
    await expect(buildPlansResponse({ db, sessionId: 's1' })).resolves.toEqual([{ id: 'p1', name: 'P1', body: '# P1', dependsOn: [], type: 'plan', build: ['implement'], review }]);
    db.close();
  });
  it('uses gap-close fallback text from the latest gap-closer result', async () => {
    const db = openDatabase(':memory:'); addRun(db, tmp());
    insert(db, 'agent:result', { result: { resultText: '# Full gap plan' } }, 'gap-closer');
    insert(db, 'gap_close:plan_ready', { planBody: ' ' });
    expect((await buildPlansResponse({ db, sessionId: 's1' }))[0]).toMatchObject({ id: 'gap-close', body: '# Full gap plan' });
    db.close();
  });
  it('uses build:resume:artifacts only when other sources produce no plans', async () => {
    const db = openDatabase(':memory:'); addRun(db, tmp());
    insert(db, 'build:resume:artifacts', { prdId: 'prd', setName: 'set', featureBranch: 'b', artifactSource: 'merge-worktree', source: { label: 'Recovered', content: '# PRD' }, orchestration: { name: 'set', description: '', created: ts, baseBranch: 'main', pipeline: { compile: [], defaultBuild: [], defaultReview: review, rationale: '' }, plans: [] }, plans: [{ id: 'p1', name: 'P1', body: '# P1', dependsOn: [], build: ['implement'], review }] });
    expect(await buildPlansResponse({ db, sessionId: 's1' })).toEqual([{ id: 'p1', name: 'P1', body: '# P1', dependsOn: [], type: 'plan', build: ['implement'], review }]);
    db.close();
  });
});
