import { describe, it, expect } from 'vitest';
import { handlePlanBuildDecision, handlePlanningDecision } from '../handle-decisions';
import { decisionDetail, decisionSummary } from '../../decision-format';
import { initialRunState } from '../../reducer';
import type { EforgeEvent } from '../../types';
import type { BuildDecision, PlanningDecision } from '@eforge-build/client/browser';

const TIMESTAMP = '2024-01-15T10:00:00.000Z';

function makeDecisionEvent(
  planId: string,
  decision: BuildDecision,
): Extract<EforgeEvent, { type: 'plan:build:decision' }> {
  return { type: 'plan:build:decision', timestamp: TIMESTAMP, planId, decision };
}

const reviewStrategyDecision: BuildDecision = {
  kind: 'review-strategy',
  rationale: 'Config specified single strategy',
  strategy: 'single',
  source: 'config',
};

const enrichedCycleTerminatedDecision: BuildDecision = {
  kind: 'cycle-terminated',
  rationale: 'Max rounds reached after final evaluation',
  round: 1,
  reason: 'max-rounds',
  issuesRemaining: 0,
  lastReviewIssueCount: 2,
  finalEvaluationRan: true,
  finalEvaluationAccepted: 1,
  finalEvaluationRejected: 1,
};

const scopeDecision: PlanningDecision = {
  kind: 'scope-selected',
  rationale: 'Standard excursion scope',
  scope: 'excursion',
  source: 'pipeline-composer',
};

const PLAN_A = 'plan-01';

describe('handle-decisions smoke', () => {
  it('handlePlanBuildDecision appends decision wrapped as DecisionPoint to decisions[planId]', () => {
    const event = makeDecisionEvent(PLAN_A, reviewStrategyDecision);
    const delta = handlePlanBuildDecision(event, initialRunState);
    expect(delta!.decisions![PLAN_A]).toHaveLength(1);
    expect(delta!.decisions![PLAN_A][0].decision).toEqual(reviewStrategyDecision);
    expect(delta!.decisions![PLAN_A][0].eventType).toBe('plan:build:decision');
  });

  it('handlePlanBuildDecision enriched cycle-terminated: decisionSummary and decisionDetail format correctly', () => {
    const event = makeDecisionEvent(PLAN_A, enrichedCycleTerminatedDecision);
    const delta = handlePlanBuildDecision(event, initialRunState);
    const stored = delta!.decisions![PLAN_A][0].decision;
    expect(decisionSummary(stored)).toContain('last review: 2 issue(s)');
    expect(decisionDetail(stored)).toContain('Final evaluation accepted: 1');
  });

  it('handlePlanningDecision appends to decisions[__run__] when no planId given', () => {
    const event: Extract<EforgeEvent, { type: 'planning:decision' }> = {
      type: 'planning:decision',
      timestamp: TIMESTAMP,
      decision: scopeDecision,
    };
    const delta = handlePlanningDecision(event, initialRunState);
    expect(delta!.decisions!['__run__']).toHaveLength(1);
    expect(delta!.decisions!['__run__'][0].decision).toEqual(scopeDecision);
    expect(delta!.decisions!['__run__'][0].eventType).toBe('planning:decision');
  });
});
