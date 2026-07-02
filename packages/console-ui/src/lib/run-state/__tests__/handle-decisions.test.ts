import { describe, it, expect } from 'vitest';
import { handlePlanBuildDecision, handlePlanningDecision } from '../handlers/handle-decisions';
import { decisionDetail, decisionSummary } from '../decision-format';
import { initialRunState } from '../reducer';
import type { EforgeEvent } from '../types';
import type { BuildDecision, PlanningDecision } from '@eforge-build/client/browser';

const TIMESTAMP = '2024-01-15T10:00:00.000Z';

function makeDecisionEvent(
  planId: string,
  decision: BuildDecision,
): Extract<EforgeEvent, { type: 'plan:build:decision' }> {
  return {
    type: 'plan:build:decision',
    timestamp: TIMESTAMP,
    planId,
    decision,
  };
}

function makePlanningDecisionEvent(
  decision: PlanningDecision,
  planId?: string,
): Extract<EforgeEvent, { type: 'planning:decision' }> {
  return {
    type: 'planning:decision',
    timestamp: TIMESTAMP,
    ...(planId !== undefined && { planId }),
    decision,
  };
}

const reviewStrategyDecision: BuildDecision = {
  kind: 'review-strategy',
  rationale: 'Config specified single strategy',
  strategy: 'single',
  source: 'config',
};

const cycleTerminatedDecision: BuildDecision = {
  kind: 'cycle-terminated',
  rationale: 'No issues found',
  round: 1,
  reason: 'no-issues',
  issuesRemaining: 0,
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

const perspectivesRespawnedDecision: BuildDecision = {
  kind: 'perspectives-respawned',
  rationale: 'Adaptive selection retained code and dropped api',
  round: 1,
  perspectives: ['code'],
  dropped: ['api'],
};

const perspectivesRespawnedWithoutDroppedDecision: BuildDecision = {
  kind: 'perspectives-respawned',
  rationale: 'Initial round keeps configured perspectives',
  round: 0,
  perspectives: ['code', 'docs'],
  dropped: [],
};

const planSetShapeDecision: PlanningDecision = {
  kind: 'plan-set-shape',
  rationale: 'Two plans split by subsystem',
  planCount: 2,
  planIds: ['plan-01', 'plan-02'],
};

const buildPipelineDecision: PlanningDecision = {
  kind: 'build-pipeline-chosen',
  rationale: 'Default pipeline stages for excursion',
  defaultBuild: ['implement', 'review-cycle'],
};

const PLAN_A = 'plan-01';
const PLAN_B = 'plan-02';

describe('handlePlanBuildDecision', () => {
  it('appends the decision wrapped as a DecisionPoint to decisions[planId]', () => {
    const event = makeDecisionEvent(PLAN_A, reviewStrategyDecision);
    const delta = handlePlanBuildDecision(event, initialRunState);

    expect(delta).toBeDefined();
    expect(delta!.decisions).toBeDefined();
    expect(delta!.decisions![PLAN_A]).toHaveLength(1);
    expect(delta!.decisions![PLAN_A][0]).toEqual({
      decision: reviewStrategyDecision,
      timestamp: TIMESTAMP,
      eventType: 'plan:build:decision',
    });
  });

  it('round-trips timestamp and eventType from the event into the stored wrapper', () => {
    const event = makeDecisionEvent(PLAN_A, reviewStrategyDecision);
    const delta = handlePlanBuildDecision(event, initialRunState);

    const point = delta!.decisions![PLAN_A][0];
    expect(point.timestamp).toBe(TIMESTAMP);
    expect(point.eventType).toBe('plan:build:decision');
    expect(point.decision).toEqual(reviewStrategyDecision);
  });

  it('preserves existing decisions for the same planId', () => {
    const existingPoint = { decision: reviewStrategyDecision, timestamp: TIMESTAMP, eventType: 'plan:build:decision' as const };
    const stateWithExisting = {
      ...initialRunState,
      decisions: { [PLAN_A]: [existingPoint] },
    };
    const event = makeDecisionEvent(PLAN_A, cycleTerminatedDecision);
    const delta = handlePlanBuildDecision(event, stateWithExisting);

    expect(delta!.decisions![PLAN_A]).toHaveLength(2);
    expect(delta!.decisions![PLAN_A][0]).toEqual(existingPoint);
    expect(delta!.decisions![PLAN_A][1]).toEqual({
      decision: cycleTerminatedDecision,
      timestamp: TIMESTAMP,
      eventType: 'plan:build:decision',
    });
  });

  it('keys multiple plans independently — plan-A decisions do not appear under plan-B', () => {
    const existingPoint = { decision: reviewStrategyDecision, timestamp: TIMESTAMP, eventType: 'plan:build:decision' as const };
    const stateWithA = {
      ...initialRunState,
      decisions: { [PLAN_A]: [existingPoint] },
    };
    const event = makeDecisionEvent(PLAN_B, cycleTerminatedDecision);
    const delta = handlePlanBuildDecision(event, stateWithA);

    // Plan B gets its decision
    expect(delta!.decisions![PLAN_B]).toHaveLength(1);
    expect(delta!.decisions![PLAN_B][0].decision).toEqual(cycleTerminatedDecision);

    // Plan A's decisions are preserved and not modified
    expect(delta!.decisions![PLAN_A]).toHaveLength(1);
    expect(delta!.decisions![PLAN_A][0]).toEqual(existingPoint);
  });

  it('returns a partial state slice that the reducer can shallow-merge', () => {
    const event = makeDecisionEvent(PLAN_A, reviewStrategyDecision);
    const delta = handlePlanBuildDecision(event, initialRunState);

    // Should only contain the decisions slice, not the full state
    expect(delta).toHaveProperty('decisions');
    // Should not contain unrelated state fields in the delta itself
    const deltaKeys = Object.keys(delta!);
    expect(deltaKeys).toEqual(['decisions']);
  });

  it('preserves enriched cycle termination data and renders last-review count separately', () => {
    const event = makeDecisionEvent(PLAN_A, enrichedCycleTerminatedDecision);
    const delta = handlePlanBuildDecision(event, initialRunState);
    const stored = delta!.decisions![PLAN_A][0].decision;

    expect(stored).toEqual(enrichedCycleTerminatedDecision);
    expect(decisionSummary(stored)).toContain('last review: 2 issue(s)');
    expect(decisionSummary(stored)).not.toContain('issues remaining');
    expect(decisionDetail(stored)).toContain('Final evaluation accepted: 1');
    expect(decisionDetail(stored)).toContain('Post-evaluation issue count: 0');
  });

  it('renders dropped perspectives in respawned decision summary and detail', () => {
    const event = makeDecisionEvent(PLAN_A, perspectivesRespawnedDecision);
    const delta = handlePlanBuildDecision(event, initialRunState);
    const stored = delta!.decisions![PLAN_A][0].decision;

    expect(decisionSummary(stored)).toContain('dropped: api');
    expect(decisionDetail(stored)).toContain('Dropped: api');
  });

  it('renders an explicit empty dropped list in respawned decision details', () => {
    const event = makeDecisionEvent(PLAN_A, perspectivesRespawnedWithoutDroppedDecision);
    const delta = handlePlanBuildDecision(event, initialRunState);
    const stored = delta!.decisions![PLAN_A][0].decision;

    expect(decisionSummary(stored)).not.toContain('dropped:');
    expect(decisionDetail(stored)).toContain('Dropped: (none)');
  });

  it('renders custom extension perspective key in perspectives-respawned decision summary and detail', () => {
    const customPerspectiveDecision: BuildDecision = {
      kind: 'perspectives-respawned',
      rationale: 'Extension perspective "accessibility" from my-accessibility-ext was active; standard code review retained',
      round: 0,
      perspectives: ['accessibility', 'code'],
      dropped: [],
    };
    const event = makeDecisionEvent(PLAN_A, customPerspectiveDecision);
    const delta = handlePlanBuildDecision(event, initialRunState);
    const stored = delta!.decisions![PLAN_A][0].decision;

    // Custom extension perspective key must appear in both summary and detail
    expect(decisionSummary(stored)).toContain('accessibility');
    expect(decisionDetail(stored)).toContain('accessibility');
    // Extension provenance is surfaced via the rationale field
    expect(decisionDetail(stored)).toContain('my-accessibility-ext');
  });

  it('renders custom perspective name in perspectives-inferred decision', () => {
    const customInferredDecision: BuildDecision = {
      kind: 'perspectives-inferred',
      rationale: 'Extension perspective "i18n" inferred from changed locale files',
      perspectives: ['i18n', 'docs'],
      categories: [],
      rules: [],
    };
    const event = makeDecisionEvent(PLAN_A, customInferredDecision);
    const delta = handlePlanBuildDecision(event, initialRunState);
    const stored = delta!.decisions![PLAN_A][0].decision;

    expect(decisionSummary(stored)).toContain('i18n');
    expect(decisionDetail(stored)).toContain('i18n');
    expect(decisionDetail(stored)).toContain('locale files');
  });
});

// ---------------------------------------------------------------------------
// handlePlanningDecision
// ---------------------------------------------------------------------------

describe('handlePlanningDecision', () => {
  it('appends the decision wrapped as a DecisionPoint to decisions[__run__] when no planId is given', () => {
    const event = makePlanningDecisionEvent(planSetShapeDecision);
    const delta = handlePlanningDecision(event, initialRunState);

    expect(delta).toBeDefined();
    expect(delta!.decisions).toBeDefined();
    expect(delta!.decisions!['__run__']).toHaveLength(1);
    expect(delta!.decisions!['__run__'][0]).toEqual({
      decision: planSetShapeDecision,
      timestamp: TIMESTAMP,
      eventType: 'planning:decision',
    });
  });

  it('round-trips timestamp and eventType from the event into the stored wrapper', () => {
    const event = makePlanningDecisionEvent(planSetShapeDecision);
    const delta = handlePlanningDecision(event, initialRunState);

    const point = delta!.decisions!['__run__'][0];
    expect(point.timestamp).toBe(TIMESTAMP);
    expect(point.eventType).toBe('planning:decision');
    expect(point.decision).toEqual(planSetShapeDecision);
  });

  it('appends the decision wrapped as a DecisionPoint to decisions[planId] when planId is given', () => {
    const event = makePlanningDecisionEvent(buildPipelineDecision, PLAN_A);
    const delta = handlePlanningDecision(event, initialRunState);

    expect(delta!.decisions![PLAN_A]).toHaveLength(1);
    expect(delta!.decisions![PLAN_A][0]).toEqual({
      decision: buildPipelineDecision,
      timestamp: TIMESTAMP,
      eventType: 'planning:decision',
    });
  });

  it('preserves existing decisions under __run__ when appending', () => {
    const existingPoint = { decision: planSetShapeDecision, timestamp: TIMESTAMP, eventType: 'planning:decision' as const };
    const stateWithExisting = {
      ...initialRunState,
      decisions: { '__run__': [existingPoint] },
    };
    const event = makePlanningDecisionEvent(buildPipelineDecision);
    const delta = handlePlanningDecision(event, stateWithExisting);

    expect(delta!.decisions!['__run__']).toHaveLength(2);
    expect(delta!.decisions!['__run__'][0]).toEqual(existingPoint);
    expect(delta!.decisions!['__run__'][1]).toEqual({
      decision: buildPipelineDecision,
      timestamp: TIMESTAMP,
      eventType: 'planning:decision',
    });
  });

  it('does not affect plan-keyed decisions when writing to __run__', () => {
    const existingPoint = { decision: reviewStrategyDecision, timestamp: TIMESTAMP, eventType: 'plan:build:decision' as const };
    const stateWithPlan = {
      ...initialRunState,
      decisions: { [PLAN_A]: [existingPoint] },
    };
    const event = makePlanningDecisionEvent(planSetShapeDecision);
    const delta = handlePlanningDecision(event, stateWithPlan);

    // __run__ gets the planning decision
    expect(delta!.decisions!['__run__']).toHaveLength(1);
    // Plan A's decisions are preserved
    expect(delta!.decisions![PLAN_A]).toHaveLength(1);
    expect(delta!.decisions![PLAN_A][0]).toEqual(existingPoint);
  });

  it('returns a delta containing only the decisions slice', () => {
    const event = makePlanningDecisionEvent(planSetShapeDecision);
    const delta = handlePlanningDecision(event, initialRunState);

    expect(Object.keys(delta!)).toEqual(['decisions']);
  });
});
