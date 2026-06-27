import * as React from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ToastProvider } from '@/components/toast';
import { getMockArtifacts, mockDetail } from '@/fixtures/mock-data';
import type { PlanData, PlanDetail, Readiness } from '@/types';
import { PlanDetailWorkspace } from './plan-detail-workspace';

interface MutationResult { plan?: PlanData; readiness?: Readiness }

const SESSION = '2026-06-07-import-preview';
const artifact = getMockArtifacts().find((entry) => entry.session === SESSION) ?? null;
const titles = new Map(getMockArtifacts().map((entry) => [entry.session ?? entry.key, entry.title ?? entry.key]));

/**
 * A richer session plan than the thin mock fixture: an executive summary plus
 * several dimension sections and open questions, so the full workspace surface
 * (annotatable sections, readiness, review rail) has enough to iterate on.
 */
function buildDetail(): PlanDetail & { plan: PlanData } {
  const base = mockDetail(`plan:${SESSION}`) as PlanDetail & { plan: PlanData };
  return {
    ...base,
    plan: {
      ...base.plan,
      open_questions: ['Should the preview include generated PRD text?', 'How do we flag destructive changes before apply?'],
      sections: {
        'executive summary': 'Deliver a read-only import preview that lists the file and backlog changes a planning import would produce, so reviewers can approve before anything is written.',
        'problem statement': 'Imports currently write files immediately, leaving no chance to review generated changes. Reviewers want to see the diff and backlog impact before committing.',
        scope: [
          '- Render a read-only preview of generated file changes.',
          '- Summarize backlog items the import would create or update.',
          '- Require an explicit confirmation step before any write.',
        ].join('\n'),
        'acceptance criteria': [
          '- Preview lists generated changes without writing files.',
          '- Apply requires an explicit confirmation.',
          '- Cancelling leaves the repository unchanged.',
        ].join('\n'),
        'design decisions': [
          '- Reuse the existing source-provider diff renderer rather than a bespoke preview view.',
          '- Keep the preview fail-closed: an unresolved import aborts before the confirmation step.',
        ].join('\n'),
      },
    },
  };
}

/** Self-contained host: owns mutable detail state so action results apply locally. */
function WorkspaceStory() {
  const [detail, setDetail] = React.useState<PlanDetail & { plan: PlanData }>(buildDetail);

  const onApply = React.useCallback((result: MutationResult) => {
    // The mock bridge returns a thin two-section plan from applied revisions.
    // Merge its sections over the current ones so a partial patch updates the
    // touched sections without dropping the executive summary and others - the
    // real daemon returns a full plan, so this only compensates for the fixture.
    setDetail((current) => ({
      ...current,
      plan: result.plan ? { ...result.plan, sections: { ...current.plan.sections, ...result.plan.sections } } : current.plan,
      readiness: result.readiness ?? current.readiness,
    }));
  }, []);

  return (
    <ToastProvider>
      <div className="grid max-w-6xl gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <PlanDetailWorkspace
          detail={detail}
          artifact={artifact}
          titles={titles}
          onApply={onApply}
          onRefresh={async () => undefined}
          onHandoff={async () => undefined}
          onDeleted={async () => undefined}
          onClose={() => undefined}
        />
      </div>
    </ToastProvider>
  );
}

const meta = {
  title: 'Plans/PlanDetailWorkspace',
  component: WorkspaceStory,
  parameters: {
    layout: 'fullscreen',
  },
} satisfies Meta<typeof WorkspaceStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const SessionPlanReview: Story = {
  render: () => <WorkspaceStory />,
};
