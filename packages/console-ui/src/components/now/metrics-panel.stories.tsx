import type { Meta, StoryObj } from '@storybook/react-vite';
import { MetricsPanel } from './metrics-panel';
import { selectAllNowRunItems, selectNowMetricsPanel } from '@/lib/selectors/now';
import { makeRun } from '@/test-support/factories';
import type { RunInfo } from '@eforge-build/client/browser';

/**
 * Stories build wire-level RunInfo[] and route them through the *real*
 * selectors (selectAllNowRunItems → selectNowMetricsPanel) to produce the
 * NowMetricsPanel view model. We never hand-author the view model, so when its
 * shape changes the selector update flows through here automatically.
 */

const HOUR = 60 * 60 * 1000;

/** A completed build run that finished `durationMin` ago-ish, `startedAgo` back. */
function completedBuild(startedAgoMs: number, durationMs: number, overrides: Partial<RunInfo> = {}): RunInfo {
  const startedAt = new Date(Date.now() - startedAgoMs).toISOString();
  const completedAt = new Date(Date.now() - startedAgoMs + durationMs).toISOString();
  return makeRun({ command: 'build', status: 'completed', startedAt, completedAt, ...overrides });
}

function failedBuild(startedAgoMs: number, durationMs: number, overrides: Partial<RunInfo> = {}): RunInfo {
  const startedAt = new Date(Date.now() - startedAgoMs).toISOString();
  const completedAt = new Date(Date.now() - startedAgoMs + durationMs).toISOString();
  return makeRun({ command: 'build', status: 'failed', startedAt, completedAt, ...overrides });
}

/** Derive the panel model from runs exactly as the dashboard does. */
function modelFromRuns(runs: RunInfo[]) {
  return selectNowMetricsPanel(selectAllNowRunItems(runs));
}

const meta = {
  title: 'Now/MetricsPanel',
  component: MetricsPanel,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof MetricsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A healthy mix: mostly landed with a couple of failures. */
export const HealthyMix: Story = {
  args: {
    model: modelFromRuns([
      completedBuild(6 * HOUR, 7 * 60_000, { planSet: 'auth-refactor' }),
      completedBuild(5 * HOUR, 12 * 60_000, { planSet: 'queue-stacks' }),
      failedBuild(4 * HOUR, 3 * 60_000, { planSet: 'flaky-migration' }),
      completedBuild(3 * HOUR, 9 * 60_000, { planSet: 'metrics-panel' }),
      completedBuild(2 * HOUR, 15 * 60_000, { planSet: 'storybook-phase-1' }),
      completedBuild(1 * HOUR, 6 * 60_000, { planSet: 'docs-drift' }),
    ]),
  },
};

/** A rough run of failures — drives the donut toward a low land rate. */
export const MostlyFailing: Story = {
  args: {
    model: modelFromRuns([
      failedBuild(5 * HOUR, 2 * 60_000, { planSet: 'wip-1' }),
      failedBuild(4 * HOUR, 4 * 60_000, { planSet: 'wip-2' }),
      completedBuild(3 * HOUR, 8 * 60_000, { planSet: 'wip-3' }),
      failedBuild(2 * HOUR, 1 * 60_000, { planSet: 'wip-4' }),
      failedBuild(1 * HOUR, 5 * 60_000, { planSet: 'wip-5' }),
    ]),
  },
};

/** Many builds — exercises the throughput bar strip at fuller density. */
export const HighThroughput: Story = {
  args: {
    model: modelFromRuns(
      Array.from({ length: 18 }, (_, i) =>
        (i % 4 === 0 ? failedBuild : completedBuild)(
          (18 - i) * 20 * 60_000,
          (3 + (i % 7) * 2) * 60_000,
          { planSet: `build-${i + 1}` },
        ),
      ),
    ),
  },
};
