import { describe, it, expect } from 'vitest';
import { eforgeReducer, initialRunState } from '../../reducer';
import type { EforgeEvent } from '../../types';
import fixtureEvents from './fixtures/sample-build.json';

type FixtureEntry = { event: EforgeEvent; eventId: string };

describe('regression: new reducer matches pre-refactor behavior on sample-build fixture', () => {
  it('produces expected final RunState slices for the fixture', () => {
    const state = (fixtureEvents as unknown as FixtureEntry[]).reduce(
      (acc, { event, eventId }) => eforgeReducer(acc, { type: 'ADD_EVENT', event, eventId }),
      initialRunState,
    );

    // Lifecycle completion
    expect(state.isComplete).toBe(true);
    expect(state.resultStatus).toBe('completed');

    // Plan status map
    expect(state.planStatuses).toEqual({ 'plan-01': 'evaluate', 'plan-02': 'evaluate' });

    // Token totals
    expect(state.tokensIn).toBe(5000);
    expect(state.tokensOut).toBe(2500);
    expect(state.totalCost).toBeCloseTo(0.025, 8);

    // At least one agent thread finalized
    expect(state.agentThreads).toHaveLength(2);
    expect(state.agentThreads[0].agentId).toBe('agent-001');
    expect(state.agentThreads[0].durationMs).toBe(120000);

    // Merge commits captured
    expect(state.mergeCommits).toEqual({ 'plan-01': 'abc123def456', 'plan-02': '789fedcba012' });

    // earlyOrchestration dependency data
    expect(state.earlyOrchestration?.mode).toBe('compile');
    expect(state.earlyOrchestration?.plans[1].dependsOn).toEqual(['plan-01']);
  });
});
