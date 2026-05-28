import { describe, it, expect } from 'vitest';
import { eforgeReducer, initialRunState } from '../../reducer';
import type { EforgeEvent, OrchestrationConfig } from '../../types';
import fixtureEvents from './fixtures/sample-build.json';

type FixtureEntry = { event: EforgeEvent; eventId: string };

describe('regression: orchestration data gap during compile-mode planning', () => {
  it('effectiveOrchestration exposes dependsOn data via earlyOrchestration before SWR fetch returns', () => {
    const state = (fixtureEvents as unknown as FixtureEntry[]).reduce(
      (acc, { event, eventId }) => eforgeReducer(acc, { type: 'ADD_EVENT', event, eventId }),
      initialRunState,
    );
    // Simulate the in-flight window where the SWR fetch has not yet returned.
    const swrOrchestration: OrchestrationConfig | null = null;
    const effectiveOrchestration = swrOrchestration ?? state.earlyOrchestration;
    expect(effectiveOrchestration).not.toBeNull();
    expect(effectiveOrchestration?.plans).toHaveLength(2);
    expect(effectiveOrchestration?.plans[1].dependsOn).toEqual(['plan-01']);
  });
});
