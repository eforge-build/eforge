import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db.js';
import { buildRunSummary as projectionBuildRunSummary } from '../projections/run-summary.js';
import { buildRunSummary as serverBuildRunSummary } from '../server.js';

const ts = '2025-01-01T00:00:00.000Z';
const review = { strategy: 'auto' as const, perspectives: ['code'], maxRounds: 1, evaluatorStrictness: 'standard' as const };
type ResumePlan = { id: string; name: string; dependsOn: string[]; branch: string; build: Array<string | string[]>; review: typeof review };
function event(type: string, data: Record<string, unknown>): string { return JSON.stringify({ type, timestamp: ts, ...data }); }
function insertRun(db: ReturnType<typeof openDatabase>, runId = 'r1', sessionId = 's1'): void {
  db.insertRun({ id: runId, sessionId, planSet: 'set', command: 'build', status: 'running', startedAt: ts, cwd: process.cwd() });
}
function resumeArtifacts(plans: ResumePlan[] = [
  { id: 'plan-01', name: 'Plan 01', dependsOn: [], branch: 'resume/plan-01', build: ['implement'], review },
  { id: 'plan-02', name: 'Plan 02', dependsOn: ['plan-01'], branch: 'resume/plan-02', build: [['test', 'pnpm test']], review },
], topLevelPlans = plans): string {
  return event('build:resume:artifacts', {
    prdId: 'prd-feature-x',
    setName: 'feature-x',
    featureBranch: 'eforge/feature-x',
    artifactSource: 'merge-worktree',
    source: { label: '.eforge/queue/failed/prd-feature-x.md', content: '# PRD' },
    orchestration: {
      name: 'feature-x',
      description: 'Feature X',
      created: ts,
      mode: 'excursion',
      baseBranch: 'main',
      pipeline: { scope: 'excursion', compile: [], defaultBuild: [], defaultReview: review, rationale: 'resume' },
      plans,
    },
    plans: topLevelPlans.map((plan) => ({ ...plan, body: `# ${plan.name}` })),
  });
}

describe('run summary projection', () => {
  it('matches the compatibility server export for seeded plan lifecycle state', () => {
    const db = openDatabase(':memory:');
    db.insertRun({ id: 'r1', sessionId: 's1', planSet: 'set', command: 'build', status: 'running', startedAt: ts, cwd: process.cwd() });
    db.insertEvent({ runId: 'r1', type: 'planning:complete', data: event('planning:complete', { plans: [{ id: 'p1', name: 'P1', body: '# P1', branch: 'b1', dependsOn: ['p0'] }] }), timestamp: ts });
    db.insertEvent({ runId: 'r1', type: 'plan:build:start', planId: 'p1', data: event('plan:build:start', { planId: 'p1' }), timestamp: ts });
    expect(projectionBuildRunSummary(db, 's1')).toEqual(serverBuildRunSummary(db, 's1'));
    db.close();
  });
  it('creates missing entries from build-start and does not create missing failed entries', () => {
    const db = openDatabase(':memory:');
    db.insertRun({ id: 'r1', sessionId: 's1', planSet: 'set', command: 'build', status: 'failed', startedAt: ts, cwd: process.cwd() });
    db.insertEvent({ runId: 'r1', type: 'plan:build:start', planId: 'p1', data: event('plan:build:start', { planId: 'p1' }), timestamp: ts });
    db.insertEvent({ runId: 'r1', type: 'plan:build:failed', planId: 'missing', data: event('plan:build:failed', { planId: 'missing' }), timestamp: ts });
    expect(projectionBuildRunSummary(db, 's1').plans).toEqual([{ id: 'p1', status: 'running', branch: null, dependsOn: [] }]);
    db.close();
  });
  it('uses the latest planning event and reports current phase, active agent, and error counts', () => {
    const db = openDatabase(':memory:');
    db.insertRun({ id: 'r1', sessionId: 's1', planSet: 'set', command: 'build', status: 'running', startedAt: ts, cwd: process.cwd() });
    db.insertEvent({ runId: 'r1', type: 'planning:complete', data: event('planning:complete', { plans: [{ id: 'old', branch: 'old', dependsOn: [] }] }), timestamp: ts });
    db.insertEvent({ runId: 'r1', type: 'planning:complete', data: event('planning:complete', { plans: [{ id: 'new', branch: 'new', dependsOn: ['old'] }] }), timestamp: ts });
    db.insertEvent({ runId: 'r1', type: 'phase:start', data: event('phase:start', { phase: 'review' }), timestamp: ts });
    db.insertEvent({ runId: 'r1', type: 'agent:start', agent: 'builder', data: event('agent:start', { agentId: 'a1', agent: 'builder' }), timestamp: ts });
    db.insertEvent({ runId: 'r1', type: 'agent:start', agent: 'reviewer', data: event('agent:start', { agentId: 'a2', agent: 'reviewer' }), timestamp: ts });
    db.insertEvent({ runId: 'r1', type: 'agent:stop', agent: 'reviewer', data: event('agent:stop', { agentId: 'a2' }), timestamp: ts });
    db.insertEvent({ runId: 'r1', type: 'plan:build:failed', data: event('plan:build:failed', { planId: 'new' }), timestamp: ts });
    const summary = projectionBuildRunSummary(db, 's1');
    expect(summary.plans).toEqual([{ id: 'new', status: 'failed', branch: 'new', dependsOn: ['old'] }]);
    expect(summary.currentPhase).toBe('review');
    expect(summary.currentAgent).toBe('builder');
    expect(summary.eventCounts.errors).toBe(1);
    db.close();
  });

  // --- eforge:region plan-01-resume-projections ---
  it('uses recovered resume artifact orchestration branches and dependencies when planning metadata is absent', () => {
    const db = openDatabase(':memory:');
    insertRun(db);
    db.insertEvent({ runId: 'r1', type: 'build:resume:artifacts', data: resumeArtifacts(undefined, [
      { id: 'plan-01', name: 'Plan 01', dependsOn: ['top-parent'], branch: 'top/plan-01', build: ['implement'], review },
      { id: 'plan-02', name: 'Plan 02', dependsOn: [], branch: 'top/plan-02', build: [['test', 'pnpm test']], review },
    ]), timestamp: ts });

    expect(projectionBuildRunSummary(db, 's1').plans).toEqual([
      { id: 'plan-01', status: 'pending', branch: 'resume/plan-01', dependsOn: [] },
      { id: 'plan-02', status: 'pending', branch: 'resume/plan-02', dependsOn: ['plan-01'] },
    ]);
    db.close();
  });

  it('applies resume seeded merged and pending statuses before later build events', () => {
    const db = openDatabase(':memory:');
    insertRun(db);
    db.insertEvent({ runId: 'r1', type: 'build:resume:artifacts', data: resumeArtifacts(), timestamp: ts });
    db.insertEvent({ runId: 'r1', type: 'build:resume:state', data: event('build:resume:state', { seededMerged: ['plan-01'], seededPending: ['plan-02', 'plan-03'], featureBranch: 'eforge/feature-x', landedCommitCount: 1, diffStat: '1 file changed' }), timestamp: ts });
    db.insertEvent({ runId: 'r1', type: 'plan:build:start', planId: 'plan-02', data: event('plan:build:start', { planId: 'plan-02' }), timestamp: ts });

    expect(projectionBuildRunSummary(db, 's1').plans).toEqual([
      { id: 'plan-01', status: 'completed', branch: 'resume/plan-01', dependsOn: [] },
      { id: 'plan-02', status: 'running', branch: 'resume/plan-02', dependsOn: ['plan-01'] },
      { id: 'plan-03', status: 'pending', branch: null, dependsOn: [] },
    ]);
    db.close();
  });

  it('keeps planning event branch and dependency metadata when resume artifacts also exist', () => {
    const db = openDatabase(':memory:');
    insertRun(db);
    db.insertEvent({ runId: 'r1', type: 'planning:complete', data: event('planning:complete', { plans: [{ id: 'plan-01', branch: 'planned/plan-01', dependsOn: ['planned-parent'] }] }), timestamp: ts });
    db.insertEvent({ runId: 'r1', type: 'build:resume:artifacts', data: resumeArtifacts(), timestamp: ts });
    db.insertEvent({ runId: 'r1', type: 'build:resume:state', data: event('build:resume:state', { seededMerged: ['plan-01'], seededPending: [], featureBranch: 'eforge/feature-x', landedCommitCount: 1, diffStat: '1 file changed' }), timestamp: ts });

    expect(projectionBuildRunSummary(db, 's1').plans).toEqual([
      { id: 'plan-01', status: 'completed', branch: 'planned/plan-01', dependsOn: ['planned-parent'] },
    ]);
    db.close();
  });

  it('uses the newest valid resume artifact row when a newer malformed row exists', () => {
    const db = openDatabase(':memory:');
    insertRun(db);
    db.insertEvent({ runId: 'r1', type: 'build:resume:artifacts', data: resumeArtifacts([
      { id: 'old', name: 'Old', dependsOn: [], branch: 'resume/old', build: ['implement'], review },
    ]), timestamp: ts });
    db.insertEvent({ runId: 'r1', type: 'build:resume:artifacts', data: resumeArtifacts([
      { id: 'new', name: 'New', dependsOn: ['old'], branch: 'resume/new', build: ['implement'], review },
    ]), timestamp: ts });
    db.insertEvent({ runId: 'r1', type: 'build:resume:artifacts', data: event('build:resume:artifacts', { prdId: 'broken' }), timestamp: ts });

    expect(projectionBuildRunSummary(db, 's1').plans).toEqual([
      { id: 'new', status: 'pending', branch: 'resume/new', dependsOn: ['old'] },
    ]);
    db.close();
  });

  it('does not downgrade existing lifecycle status for seeded pending plans', () => {
    const db = openDatabase(':memory:');
    insertRun(db);
    db.insertEvent({ runId: 'r1', type: 'plan:build:start', planId: 'plan-01', data: event('plan:build:start', { planId: 'plan-01' }), timestamp: ts });
    db.insertEvent({ runId: 'r1', type: 'build:resume:state', data: event('build:resume:state', { seededMerged: [], seededPending: ['plan-01', 'plan-02'], featureBranch: 'eforge/feature-x', landedCommitCount: 0, diffStat: '0 files changed' }), timestamp: ts });

    expect(projectionBuildRunSummary(db, 's1').plans).toEqual([
      { id: 'plan-01', status: 'running', branch: null, dependsOn: [] },
      { id: 'plan-02', status: 'pending', branch: null, dependsOn: [] },
    ]);
    db.close();
  });

  it('lets later failed build events override seeded merged status', () => {
    const db = openDatabase(':memory:');
    insertRun(db);
    db.insertEvent({ runId: 'r1', type: 'build:resume:state', data: event('build:resume:state', { seededMerged: ['plan-01'], seededPending: [], featureBranch: 'eforge/feature-x', landedCommitCount: 1, diffStat: '1 file changed' }), timestamp: ts });
    db.insertEvent({ runId: 'r1', type: 'plan:build:failed', planId: 'plan-01', data: event('plan:build:failed', { planId: 'plan-01' }), timestamp: ts });

    expect(projectionBuildRunSummary(db, 's1').plans).toEqual([
      { id: 'plan-01', status: 'failed', branch: null, dependsOn: [] },
    ]);
    db.close();
  });
  // --- eforge:endregion plan-01-resume-projections ---
});
