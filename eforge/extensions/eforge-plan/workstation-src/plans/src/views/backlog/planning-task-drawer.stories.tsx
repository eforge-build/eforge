import * as React from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ToastProvider } from '@/components/toast';
import type { JsonObject, PlanningAgentTaskListItem } from '@/types';
import { PlanningTaskDrawer } from './planning-task-drawer';
import type { RedraftInput } from './use-planning-task-workflows';

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

const backlogAnalysisTask: PlanningAgentTaskListItem = {
  entry: {
    taskId: 'task-a10b262e-8a8d-4f69-b9c4-backlog-analysis',
    originalRequest: '',
    derivedRequest: 'Analyze and curate all open eforge-plan backlog records.',
    selection: {},
    requestedOutputSections: ['backlogCurationDraft', 'recommendations'],
    includeRoadmap: true,
    purpose: 'backlog-curation',
    itemAuditConcurrency: 4,
    sourceFingerprint: 'storybook-backlog-analysis-fixture',
    createdAt: minutesAgo(11),
  },
  available: true,
  status: 'running',
  task: {
    taskId: 'task-a10b262e-8a8d-4f69-b9c4-backlog-analysis',
    kind: 'eforge-plan.planning-draft',
    status: 'running',
    createdAt: minutesAgo(11),
    updatedAt: new Date().toISOString(),
    startedAt: minutesAgo(11),
    metadata: {
      progressMessage: 'Audited 8/9 items',
      sectionProgress: {
        currentSection: 'start',
        coveredSections: [
          'mcp-default-formatting',
          'pi-tool-result-formatting',
          'extension-management-tool',
          'extension-contribution-formatting',
          'tests-docs',
        ],
      },
      backlogCurationProgress: {
        total: 9,
        cacheHits: 0,
        misses: 9,
        completed: 8,
        running: 1,
        remaining: 0,
        items: [
          { itemId: 'validate-backlog-epic-coverage', title: 'Validate backlog epic coverage and missing dependency traces', status: 'running', summary: 'Auditing the source packet for current lifecycle evidence.' },
          { itemId: 'compact-pagination-summary', title: 'Apply compact pagination summaries to contribution results', status: 'completed', verdict: 'partial', summary: 'Some host projections are compact, but rich/debug output still needs follow-up.' },
          { itemId: 'explicit-pending-state', title: 'Add explicit pending state to planning records', status: 'completed', verdict: 'partial' },
          { itemId: 'per-invocation-runtime', title: 'Add per-invocation runtime selection for planner tasks', status: 'completed', verdict: 'partial' },
          { itemId: 'bounded-auto-recovery', title: 'Add bounded auto-recovery for failed planning task drafts', status: 'completed', verdict: 'partial' },
          { itemId: 'hard-host-boundaries', title: 'Enforce hard host-boundaries for workstation actions', status: 'completed', verdict: 'partial' },
          { itemId: 'direct-pr-backlog-links', title: 'Improve direct PR backlog link projections', status: 'completed', verdict: 'partial' },
          { itemId: 'planning-task-provenance', title: 'Persist and render planning task provenance summaries', status: 'completed', verdict: 'partial' },
          { itemId: 'review-cycle-traceability', title: 'Optional issue-level traceability for review-cycle details', status: 'failed', summary: 'Needs human review before the reducer can decide whether to keep or archive the item.' },
        ],
      },
    },
  },
};

const noop = async () => undefined;
const noopApply = async (_taskId: string, _input: JsonObject) => undefined;
const noopRedraft = async (_taskId: string, _input: RedraftInput) => undefined;

function PlanningTaskDrawerStory() {
  const [item] = React.useState(() => backlogAnalysisTask);
  return (
    <ToastProvider>
      <div className="min-h-screen rounded-md border border-dashed border-border/70 bg-background/40 p-4 text-sm text-muted-foreground">
        The planning-task drawer is pinned open so the backlog analysis progress layout can be iterated in isolation.
      </div>
      <PlanningTaskDrawer
        item={item}
        busy={false}
        onCancel={noop}
        onRemove={noop}
        onRetry={noop}
        onRedraft={noopRedraft}
        onApply={noopApply}
        onClose={() => undefined}
      />
    </ToastProvider>
  );
}

const meta = {
  title: 'Backlog/PlanningTaskDrawer',
  component: PlanningTaskDrawerStory,
  parameters: {
    layout: 'fullscreen',
  },
} satisfies Meta<typeof PlanningTaskDrawerStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const RunningBacklogAnalysis: Story = {
  render: () => <PlanningTaskDrawerStory />,
};
