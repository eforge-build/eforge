import { describe, expect, it } from 'vitest';
import type { BuildResumeArtifactsEvent, BuildResumeStateEvent, EforgeEvent } from '@eforge-build/client/browser';
import { createInitialRunState, reduce } from '../reducer';

const review = { strategy: 'auto' as const, perspectives: ['code'], maxRounds: 1, evaluatorStrictness: 'standard' as const };

function resumeStateEvent(overrides: Partial<BuildResumeStateEvent> = {}): BuildResumeStateEvent {
  return {
    type: 'build:resume:state',
    timestamp: '2025-01-01T00:00:00.000Z',
    seededMerged: ['plan-01'],
    seededPending: ['plan-02'],
    featureBranch: 'eforge/feature-x',
    landedCommitCount: 1,
    diffStat: '1 file changed',
    ...overrides,
  };
}

function resumeEvent(overrides: Partial<BuildResumeArtifactsEvent> = {}): BuildResumeArtifactsEvent {
  return {
    type: 'build:resume:artifacts',
    timestamp: '2025-01-01T00:00:00.000Z',
    prdId: 'prd-feature-x',
    setName: 'feature-x',
    featureBranch: 'eforge/feature-x',
    artifactSource: 'merge-worktree',
    source: { label: '.eforge/queue/failed/prd-feature-x.md', content: '# PRD' },
    orchestration: {
      name: 'feature-x',
      description: 'Feature X',
      created: '2025-01-01T00:00:00.000Z',
      mode: 'excursion',
      baseBranch: 'main',
      pipeline: { scope: 'excursion', compile: [], defaultBuild: [], defaultReview: review, rationale: 'resume' },
      plans: [
        { id: 'plan-01', name: 'Plan 01', dependsOn: [], branch: 'feature-x/plan-01', build: ['implement'], review },
        { id: 'plan-02', name: 'Plan 02', dependsOn: ['plan-01'], branch: 'feature-x/plan-02', build: [['test', 'pnpm test']], review },
      ],
    },
    plans: [
      { id: 'plan-01', name: 'Plan 01', body: '# Plan 01', dependsOn: [], branch: 'feature-x/plan-01', build: ['implement'], review },
      { id: 'plan-02', name: 'Plan 02', body: '# Plan 02', dependsOn: ['plan-01'], branch: 'feature-x/plan-02', build: [['test', 'pnpm test']], review },
    ],
    ...overrides,
  };
}

describe('handleBuildResumeArtifacts', () => {
  it('seeds recovered plans, source metadata, and early orchestration', () => {
    const state = reduce(createInitialRunState(), resumeEvent(), '1');

    expect(state.planStatuses).toEqual({ 'plan-01': 'plan', 'plan-02': 'plan' });
    expect(state.resumeSource?.label).toBe('.eforge/queue/failed/prd-feature-x.md');
    expect(state.resumeArtifacts.map((p) => p.id)).toEqual(['plan-01', 'plan-02']);
    expect(state.earlyOrchestration?.plans[1].dependsOn).toEqual(['plan-01']);
    expect(state.earlyOrchestration?.plans[1].build).toEqual([['test', 'pnpm test']]);
  });

  it('does not create agent, usage, token, cost, or file-change side effects', () => {
    const state = reduce(createInitialRunState(), resumeEvent(), '1');

    expect(state.agentThreads).toHaveLength(0);
    expect(state.tokensIn).toBe(0);
    expect(state.tokensOut).toBe(0);
    expect(state.cacheRead).toBe(0);
    expect(state.cacheCreation).toBe(0);
    expect(state.totalCost).toBe(0);
    expect(state.liveAgentUsage).toEqual({});
    expect(state.fileChanges.size).toBe(0);
  });

  it('preserves fresher lifecycle stage overlays for recovered plans', () => {
    const initial = reduce(createInitialRunState(), {
      type: 'plan:status:change',
      timestamp: '2025-01-01T00:00:01.000Z',
      planId: 'plan-02',
      status: 'running',
    } as EforgeEvent, 'lifecycle');

    const afterResume = reduce(initial, resumeEvent(), 'resume');
    expect(afterResume.planStatuses['plan-01']).toBe('plan');
    expect(afterResume.planStatuses['plan-02']).toBe('implement');

    const afterLaterLifecycle = reduce(afterResume, {
      type: 'plan:status:change',
      timestamp: '2025-01-01T00:00:02.000Z',
      planId: 'plan-02',
      status: 'completed',
    } as EforgeEvent, 'later');
    expect(afterLaterLifecycle.planStatuses['plan-02']).toBe('complete');
  });

  it('preserves complete, implement, and failed statuses when artifacts arrive later', () => {
    const initial = {
      ...createInitialRunState(),
      planStatuses: { 'plan-01': 'complete', 'plan-02': 'implement', 'plan-03': 'failed' },
    } as ReturnType<typeof createInitialRunState>;

    const afterResume = reduce(initial, resumeEvent({
      plans: [
        ...resumeEvent().plans,
        { id: 'plan-03', name: 'Plan 03', body: '# Plan 03', dependsOn: [], branch: 'feature-x/plan-03', build: ['implement'], review },
      ],
    }), 'resume');

    expect(afterResume.planStatuses['plan-01']).toBe('complete');
    expect(afterResume.planStatuses['plan-02']).toBe('implement');
    expect(afterResume.planStatuses['plan-03']).toBe('failed');
  });
});

describe('handleBuildResumeState', () => {
  it('yields the same merged completion state before or after recovered artifacts', () => {
    const stateThenArtifacts = reduce(
      reduce(createInitialRunState(), resumeStateEvent(), 'state'),
      resumeEvent(),
      'artifacts',
    );
    const artifactsThenState = reduce(
      reduce(createInitialRunState(), resumeEvent(), 'artifacts'),
      resumeStateEvent(),
      'state',
    );

    expect(stateThenArtifacts.planStatuses).toEqual(artifactsThenState.planStatuses);
    expect(stateThenArtifacts.planStatuses['plan-01']).toBe('complete');
    expect(stateThenArtifacts.planStatuses['plan-02']).toBe('plan');
  });

  it('does not downgrade active, complete, or failed stages', () => {
    const state = reduce({
      ...createInitialRunState(),
      planStatuses: {
        missing: 'plan',
        active: 'implement',
        doc: 'doc-sync',
        test: 'test',
        review: 'review',
        evaluate: 'evaluate',
        done: 'complete',
        failed: 'failed',
      },
    }, resumeStateEvent({ seededMerged: ['missing', 'active', 'doc', 'test', 'review', 'evaluate', 'done', 'failed'], seededPending: [] }), 'state');

    expect(state.planStatuses).toEqual({
      missing: 'complete',
      active: 'implement',
      doc: 'doc-sync',
      test: 'test',
      review: 'review',
      evaluate: 'evaluate',
      done: 'complete',
      failed: 'failed',
    });
  });

  it('does not downgrade active or terminal stages listed as seeded pending', () => {
    const state = reduce({
      ...createInitialRunState(),
      planStatuses: {
        active: 'implement',
        done: 'complete',
        failed: 'failed',
      },
    }, resumeStateEvent({ seededMerged: [], seededPending: ['active', 'done', 'failed', 'missing'] }), 'state');

    expect(state.planStatuses).toEqual({
      active: 'implement',
      done: 'complete',
      failed: 'failed',
      missing: 'plan',
    });
  });

  it('lets later lifecycle events override seeded resume completion', () => {
    const seeded = reduce(createInitialRunState(), resumeStateEvent({ seededMerged: ['plan-01'], seededPending: [] }), 'state');
    const running = reduce(seeded, {
      type: 'plan:status:change',
      timestamp: '2025-01-01T00:00:01.000Z',
      planId: 'plan-01',
      status: 'running',
    } as EforgeEvent, 'running');
    const failed = reduce(running, {
      type: 'plan:status:change',
      timestamp: '2025-01-01T00:00:02.000Z',
      planId: 'plan-01',
      status: 'failed',
    } as EforgeEvent, 'failed');

    expect(seeded.planStatuses['plan-01']).toBe('complete');
    expect(running.planStatuses['plan-01']).toBe('implement');
    expect(failed.planStatuses['plan-01']).toBe('failed');
  });

  it('lets seeded pending plans advance through later lifecycle events', () => {
    const seeded = reduce(
      createInitialRunState(),
      resumeStateEvent({ seededMerged: [], seededPending: ['plan-02'] }),
      'state',
    );
    const running = reduce(seeded, {
      type: 'plan:status:change',
      timestamp: '2025-01-01T00:00:01.000Z',
      planId: 'plan-02',
      status: 'running',
    } as EforgeEvent, 'running');
    const completed = reduce(running, {
      type: 'plan:status:change',
      timestamp: '2025-01-01T00:00:02.000Z',
      planId: 'plan-02',
      status: 'completed',
    } as EforgeEvent, 'completed');

    expect(seeded.planStatuses['plan-02']).toBe('plan');
    expect(running.planStatuses['plan-02']).toBe('implement');
    expect(completed.planStatuses['plan-02']).toBe('complete');
  });
});
