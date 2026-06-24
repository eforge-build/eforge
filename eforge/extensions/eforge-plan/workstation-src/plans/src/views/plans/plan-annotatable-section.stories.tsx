import * as React from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { PlanData, PlanRevisionAnnotationTarget } from '@/types';
import { AnnotatablePlanSection } from './plan-annotatable-section';

const plan: PlanData = {
  session: 'storybook-session',
  topic: 'Extension-owned prompt references',
  status: 'planning',
  sections: {
    'design-decisions': [
      '- Prefer an owner-scoped prompt reference contract over arbitrary path strings. A safe shape could mirror existing source-provider patterns: a contribution id or module/export reference owned by the requesting extension, plus bounded input for template variables.',
      '- Keep prompt interpolation fail-closed: unresolved `{{variable}}` tokens should still fail the task before model invocation, and extension prompt refs should not bypass existing append/tool-name substitution behavior.',
      '- Treat extension prompt files as package assets. Add packaging tests or build assertions so prompts are present after `tsup`/workspace build and not only in source.',
      '- Keep the first implementation compatibility-oriented: existing eforge-plan actions should start the same daemon-owned task kind and produce the same result shapes.',
    ].join('\n'),
  },
};

function SelectionDebugPanel({ target }: { target: PlanRevisionAnnotationTarget | null }) {
  return (
    <aside className="rounded-md border bg-card p-3 text-xs">
      <h3 className="mb-2 font-semibold uppercase tracking-wide text-muted-foreground">Selected annotation target</h3>
      {target
        ? <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded bg-background p-2">{JSON.stringify(target, null, 2)}</pre>
        : <p className="text-muted-foreground">Drag-select text in the section, then click “Annotate selection”.</p>}
    </aside>
  );
}

function AnnotatableSectionStory() {
  const [content, setContent] = React.useState(plan.sections?.['design-decisions'] ?? '');
  const [target, setTarget] = React.useState<PlanRevisionAnnotationTarget | null>(null);
  const currentPlan = React.useMemo<PlanData>(() => ({ ...plan, sections: { 'design-decisions': content } }), [content]);

  return (
    <div className="grid max-w-5xl gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="grid gap-2">
        <p className="text-sm text-muted-foreground">
          This story isolates the rendered session-plan section used by the Plans workstation. Browser text selection should work directly in the markdown body; the selection button enables only while the selected range is inside this section.
        </p>
        <AnnotatablePlanSection
          plan={currentPlan}
          dimension="design-decisions"
          content={content}
          disabled={false}
          defaultOpen
          onSaveSection={async (dimension, nextContent) => {
            if (dimension === 'design-decisions') setContent(nextContent);
          }}
          onSelectAnnotationTarget={setTarget}
        />
      </div>
      <SelectionDebugPanel target={target} />
    </div>
  );
}

const meta = {
  title: 'Plans/AnnotatablePlanSection',
  component: AnnotatableSectionStory,
  parameters: {
    layout: 'fullscreen',
  },
} satisfies Meta<typeof AnnotatableSectionStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const DesignDecisionSelection: Story = {
  render: () => <AnnotatableSectionStory />,
};
