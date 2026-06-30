import type { Meta, StoryObj } from '@storybook/react-vite';
import { OrchestrationSummary } from './orchestration-summary';
import type { MapReduceSummary } from '@/lib/run-state';

const meta = {
  title: 'MapReduce/OrchestrationSummary',
  component: OrchestrationSummary,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof OrchestrationSummary>;

export default meta;
type Story = StoryObj<typeof meta>;

const inFlight: MapReduceSummary = {
  graphId: 'graph-payments-refactor-7f3a',
  atomCounts: { total: 14, queued: 3, running: 4, completed: 6, skipped: 1, failed: 0 },
  reduceCounts: { total: 6, queued: 4, running: 2, completed: 0, failed: 0, incomplete: 0 },
  maxDepth: 2,
  currentWave: 0,
  tokensIn: 412_000,
  tokensOut: 88_300,
  totalTokens: 500_300,
  costUsd: 3.42,
};

const completed: MapReduceSummary = {
  graphId: 'graph-payments-refactor-7f3a',
  atomCounts: { total: 14, queued: 0, running: 0, completed: 13, skipped: 1, failed: 0 },
  reduceCounts: { total: 6, queued: 0, running: 0, completed: 6, failed: 0, incomplete: 0 },
  maxDepth: 2,
  currentWave: null,
  tokensIn: 1_240_000,
  tokensOut: 196_500,
  totalTokens: 1_436_500,
  costUsd: 9.87,
};

const withFailures: MapReduceSummary = {
  graphId: 'graph-large-migration-0c12',
  atomCounts: { total: 22, queued: 0, running: 0, completed: 18, skipped: 2, failed: 2 },
  reduceCounts: { total: 9, queued: 0, running: 1, completed: 6, failed: 1, incomplete: 1 },
  maxDepth: 3,
  currentWave: 2,
  tokensIn: 980_400,
  tokensOut: 152_100,
  totalTokens: 1_132_500,
  costUsd: 7.05,
};

/** Map phase running, first reduce wave just starting. */
export const InFlight: Story = { args: { summary: inFlight } };

/** Everything terminal and successful. */
export const Completed: Story = { args: { summary: completed } };

/** Mixed terminal state: failed/skipped atoms and a failed + incomplete reducer. */
export const WithFailures: Story = { args: { summary: withFailures } };

/** Snapshot received but no nodes executed yet (all queued). */
export const FreshSnapshot: Story = {
  args: {
    summary: {
      graphId: 'graph-fresh-9a2b',
      atomCounts: { total: 8, queued: 8, running: 0, completed: 0, skipped: 0, failed: 0 },
      reduceCounts: { total: 3, queued: 3, running: 0, completed: 0, failed: 0, incomplete: 0 },
      maxDepth: 1,
      currentWave: 0,
      tokensIn: 0,
      tokensOut: 0,
      totalTokens: 0,
      costUsd: 0,
    },
  },
};
