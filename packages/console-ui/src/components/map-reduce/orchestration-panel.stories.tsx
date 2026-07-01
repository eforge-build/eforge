import type { Meta, StoryObj } from '@storybook/react-vite';
import { OrchestrationPanel } from './orchestration-panel';
import { PipelineSection } from '@/views/run-detail/pipeline-section';
import { PlanPreviewProvider } from '@/components/preview';
import { mapReduceRunState } from '@/test-support/factories';

const runState = mapReduceRunState();

const meta = {
  title: 'MapReduce/OrchestrationPanel',
  component: OrchestrationPanel,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <PlanPreviewProvider>
        <div className="h-screen overflow-y-auto bg-bg">
          <Story />
        </div>
      </PlanPreviewProvider>
    ),
  ],
} satisfies Meta<typeof OrchestrationPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The composed panel as it appears in run-detail: the summary card above the
 * vertical stage board, with the Board/Timeline toggle. "Timeline" swaps in the
 * same `PipelineSection` the rest of the app uses, so the two views are
 * reviewable together. Map phase is mid-flight (atom-003 running, atom-004
 * skipped, atom-005 queued) with reduce level 1 running and the root queued.
 */
export const Board: Story = {
  args: {
    runState,
    selectedPlanId: null,
    timeline: <PipelineSection runState={runState} plans={null} />,
  },
};

/** A node selected for log filtering — the matching board card is highlighted. */
export const NodeSelected: Story = {
  args: {
    runState,
    selectedPlanId: 'atom-002',
    timeline: <PipelineSection runState={runState} plans={null} />,
  },
};
