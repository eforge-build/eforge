import { describe, expect, it } from 'vitest';
import type { BuildResumeArtifactsEvent, EforgeEvent } from '@eforge-build/client/browser';
import { createInitialRunState, reduce } from '../reducer';

const review = { strategy: 'auto' as const, perspectives: ['code'], maxRounds: 1, evaluatorStrictness: 'standard' as const };

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
});
