import type { Meta, StoryObj } from '@storybook/react-vite';
import { ThreadPipeline } from './thread-pipeline';
import { PlanPreviewProvider } from '@/components/preview';
import { validationSwimlaneBugRunState } from '@/test-support/factories';

const runState = validationSwimlaneBugRunState();

const meta = {
  title: 'Pipeline/ThreadPipeline',
  component: ThreadPipeline,
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <PlanPreviewProvider>
        <Story />
      </PlanPreviewProvider>
    ),
  ],
} satisfies Meta<typeof ThreadPipeline>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Regression fixture: validation command spans and the `prd-validator` agent
 * should both render on the Validation lane. The synthetic Compile row may
 * still appear for legacy plan-less compile agents, but it must not host the
 * post-merge validation command bars.
 */
export const ValidationCommandsInValidationLane: Story = {
  args: {
    agentThreads: runState.agentThreads,
    startTime: runState.startTime,
    endTime: Date.parse('2024-01-15T10:04:20.000Z'),
    planStatuses: runState.planStatuses,
    reviewIssues: runState.reviewIssues,
    events: runState.events,
    orchestration: runState.earlyOrchestration,
    prdSource: { label: 'Validation swimlane bug PRD', content: '# Validation swimlane bug repro' },
    planArtifacts: [
      {
        id: 'plan-01',
        name: 'Acceptance Recovery Evidence',
        body: 'Implement acceptance evidence',
      },
    ],
    validationCommands: runState.validationCommands,
    perspectiveErrors: runState.perspectiveErrors,
    reviewIssuesByPerspective: runState.reviewIssuesByPerspective,
    decisions: runState.decisions,
  },
};
