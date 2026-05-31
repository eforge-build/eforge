import type { ComponentProps } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PlanPreviewProvider } from '@/components/preview';
import { ThreadPipeline } from '../thread-pipeline';

const review = { strategy: 'auto' as const, perspectives: ['code'], maxRounds: 1, evaluatorStrictness: 'standard' as const };
const orchestration = {
  name: 'feature-x',
  description: 'Feature X',
  created: '2025-01-01T00:00:00.000Z',
  mode: 'excursion' as const,
  baseBranch: 'main',
  pipeline: { scope: 'excursion' as const, compile: [], defaultBuild: [], defaultReview: review, rationale: 'resume' },
  plans: [
    { id: 'plan-01', name: 'Plan 01', dependsOn: [], branch: 'feature-x/plan-01', build: ['implement'], review },
    { id: 'plan-02', name: 'Plan 02', dependsOn: ['plan-01'], branch: 'feature-x/plan-02', build: [['test', 'pnpm test']], review },
  ],
};

function renderPipeline(props: Partial<ComponentProps<typeof ThreadPipeline>> = {}) {
  return render(
    <PlanPreviewProvider>
      <ThreadPipeline
        agentThreads={[]}
        startTime={Date.parse('2025-01-01T00:00:00.000Z')}
        endTime={Date.parse('2025-01-01T00:01:00.000Z')}
        planStatuses={{}}
        reviewIssues={{}}
        events={[]}
        orchestration={null}
        prdSource={null}
        planArtifacts={[]}
        decisions={{}}
        {...props}
      />
    </PlanPreviewProvider>,
  );
}

describe('ThreadPipeline resume artifact rendering', () => {
  it('renders a source-only row from resume metadata when planning:start is absent', () => {
    renderPipeline({ prdSource: { label: 'Recovered PRD', content: '# PRD' } });

    expect(screen.getByText('Pipeline')).toBeTruthy();
    expect(screen.getByText('PRD')).toBeTruthy();
    expect(screen.queryByText('Waiting for agent activity...')).toBeNull();
  });

  it('renders recovered plan rows from artifact data when plan statuses are empty', () => {
    renderPipeline({
      orchestration,
      planArtifacts: [
        { id: 'plan-01', name: 'Plan 01', body: '# Plan 01' },
        { id: 'plan-02', name: 'Plan 02', body: '# Plan 02' },
      ],
    });

    expect(screen.getByText('Plan 01')).toBeTruthy();
    expect(screen.getByText('Plan 02')).toBeTruthy();
    expect(screen.queryByText('Waiting for agent activity...')).toBeNull();
  });

  it('still renders normal compile/build sessions from planning source and plan artifacts', () => {
    renderPipeline({
      prdSource: { label: 'Build PRD', content: '# Fresh PRD' },
      planStatuses: { 'plan-01': 'implement' },
      planArtifacts: [{ id: 'plan-01', name: 'Plan 01', body: '# Plan 01' }],
    });

    expect(screen.getByText('PRD')).toBeTruthy();
    expect(screen.getByText('Plan 01')).toBeTruthy();
  });
});
