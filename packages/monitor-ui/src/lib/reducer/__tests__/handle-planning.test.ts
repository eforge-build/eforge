import { describe, it, expect } from 'vitest';
import { handlePlanningComplete } from '../handle-planning';
import { initialRunState } from '../../reducer';
import type { EforgeEvent } from '../../types';

function makeEvent<T extends EforgeEvent['type']>(
  type: T,
  extra: object,
): Extract<EforgeEvent, { type: T }> {
  return { type, timestamp: '2024-01-15T10:00:00.000Z', sessionId: 's1', ...extra } as unknown as Extract<EforgeEvent, { type: T }>;
}

const PLANS = [
  {
    id: 'plan-01',
    name: 'Plan One',
    dependsOn: [],
    branch: 'feature/plan-01',
    body: 'Body 1',
    filePath: '.eforge/plans/plan-01.md',
  },
  {
    id: 'plan-02',
    name: 'Plan Two',
    dependsOn: ['plan-01'],
    branch: 'feature/plan-02',
    body: 'Body 2',
    filePath: '.eforge/plans/plan-02.md',
  },
];

describe('handlePlanningComplete smoke', () => {
  it('seeds planStatuses with plan for every submitted plan', () => {
    const event = makeEvent('planning:complete', { plans: PLANS });
    const delta = handlePlanningComplete(event, initialRunState);
    expect(delta?.planStatuses).toEqual({ 'plan-01': 'plan', 'plan-02': 'plan' });
  });

  it('synthesizes earlyOrchestration in compile mode with dependsOn from the event', () => {
    const event = makeEvent('planning:complete', { plans: PLANS });
    const delta = handlePlanningComplete(event, initialRunState);
    expect(delta?.earlyOrchestration?.mode).toBe('compile');
    expect(delta?.earlyOrchestration?.plans).toHaveLength(2);
    expect(delta?.earlyOrchestration?.plans?.[1]?.dependsOn).toEqual(['plan-01']);
  });

  it('propagates build and review from planConfigs when present', () => {
    const planConfigs = [
      {
        id: 'plan-01',
        build: ['npm run build'],
        review: {
          strategy: 'parallel' as const,
          perspectives: ['security'],
          maxRounds: 2,
          evaluatorStrictness: 'strict' as const,
        },
      },
    ];
    const event = makeEvent('planning:complete', { plans: PLANS, planConfigs });
    const delta = handlePlanningComplete(event, initialRunState);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const plan01 = delta?.earlyOrchestration?.plans?.find((p: any) => p.id === 'plan-01');
    expect(plan01?.build).toEqual(['npm run build']);
    expect(plan01?.review?.strategy).toBe('parallel');
  });
});
