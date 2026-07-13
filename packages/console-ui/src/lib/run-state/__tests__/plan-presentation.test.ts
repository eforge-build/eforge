import { describe, expect, it } from 'vitest';
import { initialRunState } from '../reducer';
import { handlePlanningComplete } from '../handlers/handle-planning';
import { planPresentation } from '../plan-presentation';
import { selectPlanLanes } from '../selectors/plan-progress';
import type { EforgeEvent, RunState } from '../types';

function planningComplete(plans: Array<{ id: string; name: string; dependsOn: string[]; branch: string }>) {
  return {
    type: 'planning:complete', timestamp: '2026-07-12T00:00:00.000Z', sessionId: 'session-1', plans,
  } as unknown as Extract<EforgeEvent, { type: 'planning:complete' }>;
}

describe('plan presentation', () => {
  it('reconciles late live names with an earlier snapshot while retaining its build metadata', () => {
    const state = {
      ...initialRunState,
      earlyOrchestration: {
        name: 'snapshot', description: '', created: '', baseBranch: 'main',
        pipeline: { compile: [], defaultBuild: [], defaultReview: { strategy: 'auto', perspectives: [], maxRounds: 1, evaluatorStrictness: 'standard' }, rationale: '' },
        plans: [{ id: 'opaque-id', name: 'Old name', dependsOn: [], branch: 'feature/old', build: ['implement'], review: { strategy: 'auto', perspectives: [], maxRounds: 1, evaluatorStrictness: 'standard' } }],
      },
    } as unknown as RunState;
    const delta = handlePlanningComplete(planningComplete([{ id: 'opaque-id', name: 'Readable name', dependsOn: [], branch: 'feature/new' }]), state);

    expect(delta?.earlyOrchestration?.plans[0]).toMatchObject({ id: 'opaque-id', name: 'Readable name', branch: 'feature/new', build: ['implement'] });
  });

  it('numbers only declared plans in declaration order and keeps IDs as lane identities', () => {
    const state = {
      ...initialRunState,
      earlyOrchestration: {
        name: '', description: '', created: '', baseBranch: '',
        pipeline: { compile: [], defaultBuild: [], defaultReview: { strategy: 'auto', perspectives: [], maxRounds: 1, evaluatorStrictness: 'standard' }, rationale: '' },
        plans: [
          { id: 'opaque-b', name: 'Second declared', dependsOn: [], branch: '', build: [], review: { strategy: 'auto', perspectives: [], maxRounds: 1, evaluatorStrictness: 'standard' } },
          { id: 'opaque-a', name: 'First declared', dependsOn: ['opaque-b'], branch: '', build: [], review: { strategy: 'auto', perspectives: [], maxRounds: 1, evaluatorStrictness: 'standard' } },
        ],
      },
      planStatuses: { 'opaque-b': 'implement', 'opaque-a': 'plan', 'gap-close': 'review' },
      agentThreads: [{ planId: 'gap-close', agent: 'builder', startedAt: '', endedAt: null, totalTokens: 0 }],
    } as unknown as RunState;
    const lanes = selectPlanLanes(state);

    expect(lanes.map((lane) => lane.planId)).toEqual(['opaque-b', 'opaque-a', 'gap-close']);
    expect(lanes[0].presentationLabel).toBe('Plan 01 — Second declared');
    expect(lanes[1].presentationTooltip).toEqual(['Plan 02 — First declared', 'ID: opaque-a']);
    expect(lanes[2].presentationLabel).toBeUndefined();
  });

  it('uses the canonical ID as the readable-name fallback, including pathological input', () => {
    const id = 'x'.repeat(2_000);
    const presentation = planPresentation(0, '   ', id);
    expect(presentation.label).toBe(`Plan 01 — ${id}`);
    expect(presentation.tooltip[1]).toBe(`ID: ${id}`);
  });
});
