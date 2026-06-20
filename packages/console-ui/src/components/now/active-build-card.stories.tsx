import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { ActiveBuildCard } from './active-build-card';
import { selectNowActiveBuildCards } from '@/lib/selectors/now';
import type { NowActiveBuildCard } from '@/lib/selectors/now';
import type { ActiveSessionDetail } from '@/hooks/use-active-session-streams';
import { createInitialRunState as freshRunState } from '@/lib/run-state';
import {
  makeRun,
  makeQueue,
  activeSessionDetail,
  sampleBuildRunState,
  landingRunState,
  failedRunState,
  validationSwimlaneBugRunState,
  SAMPLE_BUILD_PLANNING_LIMIT,
  SAMPLE_BUILD_PLANS_RUNNING_LIMIT,
} from '@/test-support/factories';

/**
 * The ActiveBuildCard takes a fully-computed NowActiveBuildCard view model.
 * Rather than hand-author that model (brittle as the selector evolves), every
 * story builds a RunInfo + an ActiveSessionDetail whose runState is folded from
 * real events, then runs them through the *real* selectNowActiveBuildCards. The
 * card you see is produced by the exact code path the live dashboard uses.
 */

const SESSION = 'sess-active';

/** Run selectNowActiveBuildCards for a single active session and return its card. */
function cardFor(detail: ActiveSessionDetail, planSet = 'storybook-phase-1'): NowActiveBuildCard {
  const run = makeRun({ sessionId: SESSION, planSet, status: 'running' });
  const cards = selectNowActiveBuildCards(
    [run],
    { [SESSION]: { planCount: 2, baseProfile: 'default' } },
    { [SESSION]: { ...detail, sessionId: SESSION } },
    Date.now(),
    new Map([[planSet, makeQueue({ id: planSet, title: 'Storybook Phase 1', status: 'running' })]]),
  );
  return cards[0];
}

const meta = {
  title: 'Now/ActiveBuildCard',
  component: ActiveBuildCard,
  parameters: { layout: 'padded' },
  args: { onNavigate: fn() },
} satisfies Meta<typeof ActiveBuildCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Stream still connecting — no run state has arrived yet. */
export const Connecting: Story = {
  args: {
    card: cardFor(
      activeSessionDetail({ connectionStatus: 'connecting', status: 'connecting', runState: freshRunState() }),
    ),
  },
};

/** Early lifecycle: planning complete, plans not yet started (PRD phase on the rail). */
export const PlanningPhase: Story = {
  args: {
    card: cardFor(activeSessionDetail({ runState: sampleBuildRunState(SAMPLE_BUILD_PLANNING_LIMIT) })),
  },
};

/** Mid-pipeline: plan-01 merged, plan-02 building (the common "plans running" state). */
export const PlansRunning: Story = {
  args: {
    card: cardFor(activeSessionDetail({ runState: sampleBuildRunState(SAMPLE_BUILD_PLANS_RUNNING_LIMIT) })),
  },
};

/** Regression fixture: Validation has a running prd-validator and should expand as active, not "waiting". */
export const ValidationLaneActive: Story = {
  args: {
    card: cardFor(activeSessionDetail({ runState: validationSwimlaneBugRunState() }), 'validation-swimlane-bug'),
  },
};

/** Late pipeline: PRD validation + gap-close done, build is landing. */
export const Landing: Story = {
  args: {
    card: cardFor(activeSessionDetail({ runState: landingRunState() })),
  },
};

/** Hard failure during plan-02 — drives the card's terminal error styling. */
export const Failed: Story = {
  args: {
    card: cardFor(activeSessionDetail({ runState: failedRunState() })),
  },
};

/** Stream dropped while the build was mid-flight. */
export const Disconnected: Story = {
  args: {
    card: cardFor(
      activeSessionDetail({
        connectionStatus: 'disconnected',
        status: 'disconnected',
        runState: sampleBuildRunState(SAMPLE_BUILD_PLANS_RUNNING_LIMIT),
        error: 'stream closed (ECONNRESET)',
      }),
    ),
  },
};
