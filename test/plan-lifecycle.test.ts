import { describe, it, expect } from 'vitest';
import { transitionPlan, VALID_TRANSITIONS } from '@eforge-build/engine/orchestrator/plan-lifecycle';
import type { EforgeState, PlanState } from '@eforge-build/engine/events';

function makeState(planId: string, status: PlanState['status']): EforgeState {
  return {
    setName: 'test-set',
    status: 'running',
    startedAt: new Date().toISOString(),
    baseBranch: 'main',
    worktreeBase: '/tmp/worktrees',
    plans: {
      [planId]: {
        status,
        branch: `eforge/test-set/${planId}`,
        dependsOn: [],
        merged: false,
      },
    },
    completedPlans: [],
  };
}

describe('VALID_TRANSITIONS', () => {
  it('defines all 6 statuses as keys', () => {
    const statuses: PlanState['status'][] = ['pending', 'running', 'completed', 'failed', 'blocked', 'merged'];
    expect(Object.keys(VALID_TRANSITIONS).sort()).toEqual(statuses.sort());
  });

  it('merged has no valid transitions', () => {
    expect(VALID_TRANSITIONS.merged).toEqual([]);
  });
});

describe('transitionPlan - valid transitions', () => {
  it('pending -> running', () => {
    const state = makeState('p1', 'pending');
    transitionPlan(state, 'p1', 'running');
    expect(state.plans.p1.status).toBe('running');
  });

  it('pending -> blocked', () => {
    const state = makeState('p1', 'pending');
    transitionPlan(state, 'p1', 'blocked');
    expect(state.plans.p1.status).toBe('blocked');
  });

  it('running -> completed', () => {
    const state = makeState('p1', 'running');
    transitionPlan(state, 'p1', 'completed');
    expect(state.plans.p1.status).toBe('completed');
    expect(state.completedPlans).toContain('p1');
  });

  it('running -> failed', () => {
    const state = makeState('p1', 'running');
    transitionPlan(state, 'p1', 'failed');
    expect(state.plans.p1.status).toBe('failed');
  });

  it('completed -> merged', () => {
    const state = makeState('p1', 'completed');
    transitionPlan(state, 'p1', 'merged');
    expect(state.plans.p1.status).toBe('merged');
    expect(state.completedPlans).toContain('p1');
  });

  it('completed -> failed', () => {
    const state = makeState('p1', 'completed');
    transitionPlan(state, 'p1', 'failed');
    expect(state.plans.p1.status).toBe('failed');
  });

  it('failed -> pending', () => {
    const state = makeState('p1', 'failed');
    transitionPlan(state, 'p1', 'pending');
    expect(state.plans.p1.status).toBe('pending');
  });

  it('blocked -> pending', () => {
    const state = makeState('p1', 'blocked');
    transitionPlan(state, 'p1', 'pending');
    expect(state.plans.p1.status).toBe('pending');
  });

  it('running -> pending (resume resets in-progress plans)', () => {
    const state = makeState('p1', 'running');
    transitionPlan(state, 'p1', 'pending');
    expect(state.plans.p1.status).toBe('pending');
  });
});

describe('transitionPlan - invalid transitions', () => {
  it('pending -> merged throws', () => {
    const state = makeState('p1', 'pending');
    expect(() => transitionPlan(state, 'p1', 'merged')).toThrow(
      "Invalid plan transition for 'p1': 'pending' -> 'merged'",
    );
  });

  it('merged -> running throws', () => {
    const state = makeState('p1', 'merged');
    expect(() => transitionPlan(state, 'p1', 'running')).toThrow(
      "Invalid plan transition for 'p1': 'merged' -> 'running'",
    );
  });

  it('completed -> pending throws', () => {
    const state = makeState('p1', 'completed');
    expect(() => transitionPlan(state, 'p1', 'pending')).toThrow(
      "Invalid plan transition for 'p1': 'completed' -> 'pending'",
    );
  });

  it('does not mutate state on invalid transition', () => {
    const state = makeState('p1', 'pending');
    try {
      transitionPlan(state, 'p1', 'merged');
    } catch {
      // expected
    }
    expect(state.plans.p1.status).toBe('pending');
  });
});

describe('transitionPlan - metadata', () => {
  it('sets error when metadata.error is provided', () => {
    const state = makeState('p1', 'running');
    transitionPlan(state, 'p1', 'failed', { error: 'something went wrong' });
    expect(state.plans.p1.status).toBe('failed');
    expect(state.plans.p1.error).toBe('something went wrong');
  });

  it('does not set error when metadata is omitted', () => {
    const state = makeState('p1', 'running');
    transitionPlan(state, 'p1', 'failed');
    expect(state.plans.p1.error).toBeUndefined();
  });

  it('does not set error when metadata has no error field', () => {
    const state = makeState('p1', 'running');
    transitionPlan(state, 'p1', 'failed', {});
    expect(state.plans.p1.error).toBeUndefined();
  });
});

describe('transitionPlan - unknown plan', () => {
  it('throws for unknown plan ID', () => {
    const state = makeState('p1', 'pending');
    expect(() => transitionPlan(state, 'nonexistent', 'running')).toThrow(
      "Unknown plan ID: 'nonexistent'",
    );
  });
});
