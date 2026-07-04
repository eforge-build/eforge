import type { Meta, StoryObj } from '@storybook/react-vite';
import { MiniPlanSwimlane } from './mini-plan-swimlane';
import type { PlanLane, PlanningLane } from '@/lib/run-state';

/**
 * MiniPlanSwimlane is prop-driven (PlanLane[] + PlanningLane), so stories
 * hand-author lanes directly. Pre-planning phases (satisfaction gate, repo
 * exploration) never appear as separate lanes — they fold into the PRD
 * planning row as relabelled agents.
 */

function lane(overrides: Partial<PlanLane>): PlanLane {
  return {
    planId: 'plan-01',
    planName: 'Plan One',
    stage: undefined,
    buildStages: ['implement', 'test-cycle', 'review-cycle'],
    isComplete: false,
    isFailed: false,
    agents: [],
    ...overrides,
  };
}

const meta = {
  title: 'Now/MiniPlanSwimlane',
  component: MiniPlanSwimlane,
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 520 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MiniPlanSwimlane>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Pre-planning phase agents (gate, exploration) inside the planning row while the planner runs. */
export const PlanningWithPhaseAgents: Story = {
  args: {
    hasPlanningRow: true,
    planning: {
      running: true,
      agents: [
        { agent: 'satisfaction-gate', tokens: 899_000, running: false },
        { agent: 'repo-exploration', tokens: 404_200, running: false },
        { agent: 'planner', tokens: 1_450_000, running: true },
      ],
    },
    lanes: [
      lane({ planId: 'plan-01', planName: 'Policy config defaults', stage: 'plan' }),
      lane({ planId: 'plan-02', planName: 'Client-owned events and schemas', stage: 'plan' }),
    ],
  },
};

/** Mid-build: planning collapsed done, one plan active, one waiting, one complete. */
export const MidBuild: Story = {
  args: {
    hasPlanningRow: true,
    planning: {
      running: false,
      agents: [
        { agent: 'satisfaction-gate', tokens: 899_000, running: false },
        { agent: 'repo-exploration', tokens: 404_200, running: false },
        { agent: 'planner', tokens: 4_900_000, running: false },
        { agent: 'plan-reviewer', tokens: 689_800, running: false },
      ],
    },
    lanes: [
      lane({
        planId: 'plan-01',
        planName: 'Policy config defaults',
        stage: 'complete',
        isComplete: true,
        agents: [
          { agent: 'builder', tokens: 2_600_000, running: false },
          { agent: 'test-writer', tokens: 781_200, running: false },
        ],
      }),
      lane({
        planId: 'plan-02',
        planName: 'Client-owned events and schemas',
        stage: 'implement',
        agents: [{ agent: 'builder', tokens: 1_300_000, running: true }],
      }),
      lane({ planId: 'plan-03', planName: 'Auto-resume decision guard', stage: 'plan' }),
    ],
  },
};

/** Validation phase lanes: derived-complete validation, running final validation. */
export const WithValidationPhases: Story = {
  args: {
    hasPlanningRow: true,
    planning: {
      running: false,
      agents: [{ agent: 'planner', tokens: 4_900_000, running: false }],
    },
    lanes: [
      lane({
        planId: 'plan-01',
        planName: 'Policy config defaults',
        stage: 'complete',
        isComplete: true,
        agents: [{ agent: 'builder', tokens: 2_600_000, running: false }],
      }),
      lane({
        planId: 'validation',
        planName: 'Validation',
        buildStages: [],
        isComplete: true, // derived: all threads ended, no plan:status:change
        agents: [{ agent: 'validation-fixer', tokens: 250_000, running: false }],
      }),
      lane({
        planId: 'final-validation',
        planName: 'Final Validation',
        buildStages: [],
        agents: [{ agent: 'prd-validator', tokens: 120_000, running: true }],
      }),
    ],
  },
};

/** A failed plan lane alongside a completed one. */
export const FailedPlan: Story = {
  args: {
    hasPlanningRow: true,
    planning: {
      running: false,
      agents: [{ agent: 'planner', tokens: 3_100_000, running: false }],
    },
    lanes: [
      lane({
        planId: 'plan-01',
        planName: 'Policy config defaults',
        stage: 'complete',
        isComplete: true,
        agents: [{ agent: 'builder', tokens: 2_600_000, running: false }],
      }),
      lane({
        planId: 'plan-02',
        planName: 'Client-owned events and schemas',
        stage: 'failed',
        isFailed: true,
        agents: [
          { agent: 'builder', tokens: 1_900_000, running: false },
          { agent: 'tester', tokens: 631_900, running: false },
        ],
      }),
    ],
  },
};
