import type { Meta, StoryObj } from '@storybook/react-vite';
import { ThreadPipeline } from './thread-pipeline';
import { PlanPreviewProvider } from '@/components/preview';
import { validationSwimlaneBugRunState } from '@/test-support/factories';
import { buildMapReduceTimeline } from '@/lib/run-state';
import { buildPlanPresentation } from '@/lib/run-state/plan-presentation';
import type { AgentThread, MapReduceOrchestration } from '@/lib/run-state';

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
    planPresentation: buildPlanPresentation({
      orchestration: runState.earlyOrchestration,
      restPlans: [{ id: 'plan-01', name: 'Acceptance Recovery Evidence', body: 'Implement acceptance evidence', dependsOn: [], type: 'plan' }],
      events: runState.events,
    }),
    validationCommands: runState.validationCommands,
    perspectiveErrors: runState.perspectiveErrors,
    reviewIssuesByPerspective: runState.reviewIssuesByPerspective,
    decisions: runState.decisions,
  },
};

/** Long semantic IDs/names shrink inside the label column without covering stages. */
export const LongPlanPresentation: Story = {
  args: {
    agentThreads: [], startTime: Date.parse('2024-01-15T10:00:00.000Z'), endTime: Date.parse('2024-01-15T10:01:00.000Z'),
    planStatuses: { 'semantic-plan-with-an-intentionally-very-long-canonical-identifier': 'implement' },
    reviewIssues: {}, events: [], orchestration: null,
    planPresentation: buildPlanPresentation({ restPlans: [{
      id: 'semantic-plan-with-an-intentionally-very-long-canonical-identifier',
      name: 'A deliberately long readable plan name that demonstrates label truncation while stages remain visible',
      body: '# Long semantic plan', dependsOn: [], type: 'plan',
    }] }),
  },
};

// --- map/reduce compile fixture -------------------------------------------

function planner(agentId: string, planId: string, startedAt: string, endedAt: string | null, tokens: number, agent = 'planner'): AgentThread {
  const durationMs = endedAt ? Date.parse(endedAt) - Date.parse(startedAt) : null;
  return {
    agentId, agent, planId, startedAt, endedAt, durationMs, durationApiMs: durationMs,
    inputTokens: tokens - 2_000, outputTokens: 2_000, totalTokens: tokens,
    cacheRead: null, cacheCreation: null, costUsd: 0.05, numTurns: 8, model: 'pi-glm-5.2',
  };
}

const mapReduceFixture: MapReduceOrchestration = {
  graphId: 'atom-graph-story',
  atomCount: 6,
  edgeCount: 0,
  edges: [],
  atoms: {
    'atom-foundation-001': { atomId: 'atom-foundation-001', title: 'Foundation contracts', reason: 'foundation-contract', criterionIds: ['c1'], dependencyAtomIds: [], status: 'completed' },
    'atom-console-002': { atomId: 'atom-console-002', title: 'Console rendering', reason: 'subsystem', criterionIds: ['c2'], dependencyAtomIds: [], status: 'completed' },
    'atom-docs-003': { atomId: 'atom-docs-003', title: 'Docs sync', reason: 'general', criterionIds: ['c3'], dependencyAtomIds: [], status: 'completed' },
    'atom-general-004': { atomId: 'atom-general-004', title: 'General wiring', reason: 'general', criterionIds: ['c4'], dependencyAtomIds: [], status: 'skipped', statusReason: 'covered by atom-console-002' },
    'atom-test-005': { atomId: 'atom-test-005', title: 'Test coverage', reason: 'general', criterionIds: ['c5'], dependencyAtomIds: [], status: 'completed' },
    'atom-general-006': { atomId: 'atom-general-006', title: 'Cleanup pass', reason: 'general', criterionIds: ['c6'], dependencyAtomIds: [], status: 'running' },
  },
  atomOrder: ['atom-foundation-001', 'atom-console-002', 'atom-docs-003', 'atom-general-004', 'atom-test-005', 'atom-general-006'],
  rootNodeId: 'reduce-001-001',
  maxDepth: 1,
  nodeCount: 3,
  reduceNodes: {
    'reduce-000-001': { nodeId: 'reduce-000-001', depth: 0, inputAtomIds: ['atom-foundation-001', 'atom-console-002', 'atom-docs-003'], inputNodeIds: [], status: 'completed' },
    'reduce-000-002': { nodeId: 'reduce-000-002', depth: 0, inputAtomIds: ['atom-general-004', 'atom-test-005', 'atom-general-006'], inputNodeIds: [], status: 'running' },
    'reduce-001-001': { nodeId: 'reduce-001-001', depth: 1, inputAtomIds: [], inputNodeIds: ['reduce-000-001', 'reduce-000-002'], status: 'queued' },
  },
  reduceOrder: ['reduce-000-001', 'reduce-000-002', 'reduce-001-001'],
};

const mapReduceThreads: AgentThread[] = [
  planner('a-gate', 'satisfaction-gate', '2024-01-15T10:00:00.000Z', '2024-01-15T10:00:40.000Z', 14_400),
  planner('a-explore', 'repository-exploration', '2024-01-15T10:00:40.000Z', '2024-01-15T10:02:00.000Z', 27_300),
  planner('a-atom-1', 'atom-foundation-001', '2024-01-15T10:02:00.000Z', '2024-01-15T10:03:20.000Z', 31_000),
  planner('a-atom-2', 'atom-console-002', '2024-01-15T10:02:00.000Z', '2024-01-15T10:03:50.000Z', 42_500),
  planner('a-atom-3', 'atom-docs-003', '2024-01-15T10:02:00.000Z', '2024-01-15T10:03:00.000Z', 18_200),
  planner('a-atom-5', 'atom-test-005', '2024-01-15T10:03:00.000Z', '2024-01-15T10:04:30.000Z', 22_800),
  planner('a-atom-6', 'atom-general-006', '2024-01-15T10:03:20.000Z', null, 12_100),
  planner('a-reduce-1', 'reduce-000-001', '2024-01-15T10:04:00.000Z', '2024-01-15T10:05:30.000Z', 55_100),
  planner('a-reduce-2', 'reduce-000-002', '2024-01-15T10:04:40.000Z', null, 23_400),
  planner('a-plan-review', 'planning', '2024-01-15T10:05:40.000Z', null, 8_900, 'plan-reviewer'),
];

/**
 * A live map/reduce compile: satisfaction gate and repository exploration run
 * first, then atom planners collapse into grouped lanes.
 */
export const MapReduceGroupedLanes: Story = {
  args: {
    agentThreads: mapReduceThreads,
    startTime: Date.parse('2024-01-15T10:00:00.000Z'),
    endTime: Date.parse('2024-01-15T10:06:30.000Z'),
    planStatuses: {}, reviewIssues: {}, events: [], orchestration: null,
    prdSource: { label: 'Map/reduce PRD', content: '# Map/reduce PRD' },
    planPresentation: [], decisions: {},
    mapReduce: buildMapReduceTimeline(mapReduceFixture, mapReduceThreads),
  },
};
