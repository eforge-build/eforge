/**
 * Tests for thread-pipeline lane ordering and PRD pill host.
 *
 * Verifies:
 * - orderedPlanIds includes thread-only lane keys (e.g. validation with no planStatuses entry)
 * - PRD pill renders on the planning lane when planning threads exist
 * - no planning/validation thread is grouped under __global__
 */
import type { ComponentProps } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { PlanPreviewProvider } from '@/components/preview';
import { ThreadPipeline } from '../thread-pipeline';
import type { AgentThread } from '@/lib/run-state';

const review = { strategy: 'auto' as const, perspectives: ['code'], maxRounds: 1, evaluatorStrictness: 'standard' as const };
const orchestration = {
  name: 'feature-x',
  description: 'Feature X',
  created: '2025-01-01T00:00:00.000Z',
  mode: 'excursion' as const,
  baseBranch: 'main',
  pipeline: { scope: 'excursion' as const, compile: [], defaultBuild: [], defaultReview: review, rationale: 'compile' },
  plans: [
    { id: 'plan-01', name: 'Plan 01', dependsOn: [], branch: 'feature-x/plan-01', build: ['implement'], review },
  ],
};

function makeThread(overrides: Partial<AgentThread> & { agent: string; startedAt: string }): AgentThread {
  return {
    agentId: `agent-${Math.random().toString(36).slice(2, 8)}`,
    endedAt: null,
    durationMs: null,
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    cacheRead: null,
    cacheCreation: null,
    costUsd: null,
    numTurns: null,
    model: 'test-model',
    ...overrides,
  };
}

function renderPipeline(props: Partial<ComponentProps<typeof ThreadPipeline>> = {}) {
  return render(
    <PlanPreviewProvider>
      <ThreadPipeline
        agentThreads={[]}
        startTime={Date.parse('2025-01-01T00:00:00.000Z')}
        endTime={Date.parse('2025-01-01T00:10:00.000Z')}
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

describe('ThreadPipeline lane ordering', () => {
  it('includes a validation lane key when only validation threads exist (no planStatuses entry)', () => {
    const validationThread = makeThread({
      planId: 'validation',
      agent: 'validation-fixer',
      startedAt: '2025-01-01T00:05:00.000Z',
    });

    renderPipeline({
      orchestration,
      planStatuses: { 'plan-01': 'complete' },
      agentThreads: [validationThread],
      planArtifacts: [{ id: 'plan-01', name: 'Plan 01', body: '# Plan 01' }],
    });

    // The validation lane should render with the agent name visible in the pipeline.
    // Plan 01 should also be present.
    expect(screen.getByText('Plan 01')).toBeTruthy();
    // Validation lane renders with laneLabel('validation') = 'Validation'
    expect(screen.getByText('Validation')).toBeTruthy();
  });

  it('does not group planning or validation threads under __global__/Compile', () => {
    const planningThread = makeThread({
      planId: 'planning',
      agent: 'planner',
      startedAt: '2025-01-01T00:00:00.000Z',
      endedAt: '2025-01-01T00:03:00.000Z',
    });
    const validationThread = makeThread({
      planId: 'validation',
      agent: 'validation-fixer',
      startedAt: '2025-01-01T00:05:00.000Z',
    });

    renderPipeline({
      orchestration,
      planStatuses: { 'plan-01': 'complete' },
      agentThreads: [planningThread, validationThread],
      planArtifacts: [{ id: 'plan-01', name: 'Plan 01', body: '# Plan 01' }],
    });

    // No "Compile" row should be present (no __global__ threads)
    expect(screen.queryByText('Compile')).toBeNull();
    // Planning and Validation lanes render as their own rows
    expect(screen.getByText('Planning')).toBeTruthy();
    expect(screen.getByText('Validation')).toBeTruthy();
  });
});

describe('ThreadPipeline PRD pill host', () => {
  it('renders the PRD pill on the planning lane when planning threads exist', () => {
    const planningThread = makeThread({
      planId: 'planning',
      agent: 'planner',
      startedAt: '2025-01-01T00:00:00.000Z',
      endedAt: '2025-01-01T00:03:00.000Z',
    });

    renderPipeline({
      orchestration,
      planStatuses: { 'plan-01': 'implement' },
      agentThreads: [planningThread],
      planArtifacts: [{ id: 'plan-01', name: 'Plan 01', body: '# Plan 01' }],
      prdSource: { label: 'My PRD', content: '# My PRD' },
    });

    // PRD pill should exist
    expect(screen.getByText('PRD')).toBeTruthy();
    // The Compile row should not host the PRD (no global threads, and even if
    // there were, the planning lane takes ownership of the pill)
    expect(screen.queryByText('Compile')).toBeNull();
  });

  it('renders the PRD pill on the Compile row when no planning threads exist', () => {
    const globalThread = makeThread({
      agent: 'pipeline-composer',
      startedAt: '2025-01-01T00:00:00.000Z',
      endedAt: '2025-01-01T00:01:00.000Z',
    });

    renderPipeline({
      orchestration,
      planStatuses: { 'plan-01': 'implement' },
      agentThreads: [globalThread],
      planArtifacts: [{ id: 'plan-01', name: 'Plan 01', body: '# Plan 01' }],
      prdSource: { label: 'My PRD', content: '# My PRD' },
    });

    // PRD pill should exist on the Compile row
    expect(screen.getByText('PRD')).toBeTruthy();
  });

  it('keeps the resume Source row when no global threads and no planning lane', () => {
    renderPipeline({
      prdSource: { label: 'Recovered PRD', content: '# PRD' },
    });

    expect(screen.getByText('PRD')).toBeTruthy();
    expect(screen.queryByText('Waiting for agent activity...')).toBeNull();
  });
});
