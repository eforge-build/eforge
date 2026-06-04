/**
 * End-to-end recorded-build test for AC-022: multi-plan build with gap-close.
 *
 * This test is the automated stand-in for AC-022's manual dashboard
 * verification. It drives a recorded event stream (fixtures/multi-plan-gap-close.json)
 * through the production reducer, derives Now-card and run-detail data via the
 * real selectors, renders the real MiniPlanSwimlane and ThreadPipeline components,
 * and asserts all four AC-022 invariants in one composed scenario:
 *
 *   1. Planning row populated with planning agents only (planner/plan-reviewer/
 *      pipeline-composer; no validation agents).
 *   2. Validation rendered as its own lane (Validation + Final Validation).
 *   3. No duplicate Planning/PRD row.
 *   4. PRD lane not re-lighting during validation (PRD pill hosted on the planning
 *      lane; validation threads not grouped under the planning/__global__ bucket).
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PlanPreviewProvider } from '@/components/preview';
import { MiniPlanSwimlane } from '@/components/now/mini-plan-swimlane';
import { ThreadPipeline } from '@/components/pipeline/thread-pipeline';
import { createInitialRunState, reduce, selectPlanLanes, selectPlanningLane } from '../index';
import type { EforgeEvent } from '../types';
import fixtureEvents from './fixtures/multi-plan-gap-close.json';

// ---------------------------------------------------------------------------
// Reduce the recorded fixture through the production reducer
// ---------------------------------------------------------------------------

const state = fixtureEvents.reduce(
  (s, { event, eventId }) => reduce(s, event as unknown as EforgeEvent, eventId),
  createInitialRunState(),
);

// Derive selector outputs
const planLanes = selectPlanLanes(state);
const planningLane = selectPlanningLane(state);
const hasPlanningRow =
  state.earlyOrchestration != null ||
  state.events.some((e) => e.event.type.startsWith('planning:'));

// ---------------------------------------------------------------------------
// Selector-level assertions (composed scenario)
// ---------------------------------------------------------------------------

describe('AC-022: multi-plan gap-close - selectors', () => {
  it('planning lane contains only planning agents (planner, plan-reviewer, pipeline-composer)', () => {
    const planningAgentNames = planningLane.agents.map((a) => a.agent);
    expect(planningAgentNames).toContain('planner');
    expect(planningAgentNames).toContain('plan-reviewer');
    expect(planningAgentNames).toContain('pipeline-composer');
    // Must not contain validation agents
    expect(planningAgentNames).not.toContain('validation-fixer');
    expect(planningAgentNames).not.toContain('prd-validator');
    expect(planningAgentNames).not.toContain('builder');
    expect(planningAgentNames).not.toContain('reviewer');
  });

  it('plan lanes are ordered as [plan-01, plan-02, validation, gap-close, final-validation] with no planning lane', () => {
    const laneIds = planLanes.map((l) => l.planId);
    expect(laneIds).toEqual(['plan-01', 'plan-02', 'validation', 'gap-close', 'final-validation']);
    expect(laneIds).not.toContain('planning');
  });

  it('lane labels resolve via the registry to Validation, Gap Close, Final Validation', () => {
    const validation = planLanes.find((l) => l.planId === 'validation');
    const gapClose = planLanes.find((l) => l.planId === 'gap-close');
    const finalValidation = planLanes.find((l) => l.planId === 'final-validation');
    expect(validation?.planName).toBe('Validation');
    expect(gapClose?.planName).toBe('Gap Close');
    expect(finalValidation?.planName).toBe('Final Validation');
  });

  it('hasPlanningRow is true (earlyOrchestration is set)', () => {
    expect(hasPlanningRow).toBe(true);
    expect(state.earlyOrchestration).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Now-card render assertions (MiniPlanSwimlane)
// ---------------------------------------------------------------------------

describe('AC-022: multi-plan gap-close - MiniPlanSwimlane', () => {
  it('renders exactly one PRD/Planning row with planning agents, no validation agents in planning row', () => {
    render(
      <MiniPlanSwimlane
        lanes={planLanes}
        planning={planningLane}
        hasPlanningRow={hasPlanningRow}
      />,
    );

    // Exactly one PRD pill
    const prdElements = screen.getAllByText('PRD');
    expect(prdElements).toHaveLength(1);

    // The planning row header ("planning") exists exactly once
    const planningHeaders = screen.getAllByText('planning');
    expect(planningHeaders).toHaveLength(1);

    // Validation and Final Validation are their own lanes (not duplicates of planning)
    // The lane labels are shown as plan names in the lane headers.
    // Since the lanes are collapsed by default (completed), we check lane ids via planLanes.
    expect(planLanes.filter((l) => l.planId === 'validation')).toHaveLength(1);
    expect(planLanes.filter((l) => l.planId === 'final-validation')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Run-detail render assertions (ThreadPipeline)
// ---------------------------------------------------------------------------

describe('AC-022: multi-plan gap-close - ThreadPipeline', () => {
  it('renders planning lane with PRD pill, Validation and Final Validation rows; no Compile/__global__ row; PRD pill renders exactly once on the planning lane', () => {
    render(
      <PlanPreviewProvider>
        <ThreadPipeline
          agentThreads={state.agentThreads}
          startTime={state.startTime}
          endTime={state.endTime}
          planStatuses={state.planStatuses}
          reviewIssues={state.reviewIssues}
          events={state.events}
          orchestration={state.earlyOrchestration}
          prdSource={{ label: 'Test PRD', content: '# Test PRD content' }}
          planArtifacts={[
            { id: 'plan-01', name: 'Plan One', body: '# Plan One' },
            { id: 'plan-02', name: 'Plan Two', body: '# Plan Two' },
          ]}
          decisions={{}}
        />
      </PlanPreviewProvider>,
    );

    // PRD pill renders exactly once - hosted on the planning lane (when prdSource
    // is present, the planning row renders the PRD pill instead of a "Planning" label).
    const prdElements = screen.getAllByText('PRD');
    expect(prdElements).toHaveLength(1);

    // Validation and Final Validation lanes render as their own rows
    expect(screen.getByText('Validation')).toBeTruthy();
    expect(screen.getByText('Final Validation')).toBeTruthy();

    // No Compile/__global__ row - validation/planning threads are not bucketed there
    expect(screen.queryByText('Compile')).toBeNull();

    // Planning agents (planner, plan-reviewer) are rendered on the planning lane,
    // visible as agent bar labels in the pipeline
    const plannerBars = screen.getAllByLabelText('Open detail for planner');
    expect(plannerBars.length).toBeGreaterThanOrEqual(1);
    const planReviewerBars = screen.getAllByLabelText('Open detail for plan-reviewer');
    expect(planReviewerBars.length).toBeGreaterThanOrEqual(1);
  });

  it('renders Planning label when no prdSource is provided', () => {
    render(
      <PlanPreviewProvider>
        <ThreadPipeline
          agentThreads={state.agentThreads}
          startTime={state.startTime}
          endTime={state.endTime}
          planStatuses={state.planStatuses}
          reviewIssues={state.reviewIssues}
          events={state.events}
          orchestration={state.earlyOrchestration}
          prdSource={null}
          planArtifacts={[
            { id: 'plan-01', name: 'Plan One', body: '# Plan One' },
            { id: 'plan-02', name: 'Plan Two', body: '# Plan Two' },
          ]}
          decisions={{}}
        />
      </PlanPreviewProvider>,
    );

    // Without prdSource, the planning lane renders as "Planning"
    expect(screen.getByText('Planning')).toBeTruthy();

    // No PRD pill when prdSource is null
    expect(screen.queryByText('PRD')).toBeNull();

    // Validation and Final Validation lanes still render as their own rows
    expect(screen.getByText('Validation')).toBeTruthy();
    expect(screen.getByText('Final Validation')).toBeTruthy();
  });
});
