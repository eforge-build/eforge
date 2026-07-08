/**
 * Focused rendering coverage for direct PR base-sync lanes.
 *
 * These tests exercise the pipeline component as a user-facing surface: feature
 * branch resolver activity should render with the selector-derived feature
 * branch label, and the direct base-sync phase should keep its registered lane
 * label/order without changing pack-lanes semantics.
 */
import type { ComponentProps } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PlanPreviewProvider } from '@/components/preview';
import { ThreadPipeline } from '../thread-pipeline';
import type { AgentThread, StoredEvent } from '@/lib/run-state';

const review = { strategy: 'auto' as const, perspectives: ['code'], maxRounds: 1, evaluatorStrictness: 'standard' as const };
const orchestration = {
  name: 'direct-pr-base-sync',
  description: 'Direct PR base sync',
  created: '2025-01-01T00:00:00.000Z',
  mode: 'excursion' as const,
  baseBranch: 'main',
  pipeline: { scope: 'excursion' as const, compile: [], defaultBuild: [], defaultReview: review, rationale: 'compile' },
  plans: [
    { id: 'plan-01', name: 'Feature implementation', dependsOn: [], branch: 'direct-pr-base-sync/plan-01', build: ['implement'], review },
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

function makeStoredEvent(event: Record<string, unknown>, eventId: string): StoredEvent {
  return { event: event as unknown as StoredEvent['event'], eventId };
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
        orchestration={orchestration}
        prdSource={null}
        planArtifacts={[{ id: 'plan-01', name: 'Feature implementation', body: '# Feature implementation' }]}
        decisions={{}}
        {...props}
      />
    </PlanPreviewProvider>,
  );
}

describe('ThreadPipeline direct base-sync lane labels', () => {
  it('renders feature-branch merge-resolver activity with a clear non-PRD lane label', () => {
    renderPipeline({
      planStatuses: { 'plan-01': 'complete' },
      agentThreads: [
        makeThread({
          planId: 'eforge/direct-pr-feature',
          agent: 'merge-conflict-resolver',
          startedAt: '2025-01-01T00:06:00.000Z',
        }),
      ],
    });

    expect(screen.getByText('Plan 01')).toBeTruthy();
    expect(screen.getByText('Feature branch: eforge/direct-pr-feature')).toBeTruthy();
    expect(screen.getByText(/merge-conflict-resolver/)).toBeTruthy();
  });

  it('renders direct base-sync lifecycle events as the phase lane without an agent thread', () => {
    renderPipeline({
      planStatuses: { 'plan-01': 'complete' },
      events: [
        makeStoredEvent({ type: 'base-sync:start', timestamp: '2025-01-01T00:05:00.000Z', remote: 'origin', baseBranch: 'main', featureBranch: 'eforge/direct-pr-feature', maxAttempts: 3 }, 'base-sync-start'),
        makeStoredEvent({ type: 'base-sync:success', timestamp: '2025-01-01T00:06:00.000Z', remote: 'origin', baseBranch: 'main', featureBranch: 'eforge/direct-pr-feature', baseSha: 'abc123', featureSha: 'def456', rebased: false }, 'base-sync-success'),
      ],
    });

    expect(screen.getByText('Direct Base Sync')).toBeTruthy();
    expect(screen.getByText(/Direct base sync/)).toBeTruthy();
  });

  it('orders direct base-sync activity after feature-branch resolver lanes and before validation', () => {
    renderPipeline({
      planStatuses: { 'plan-01': 'complete', 'base-sync': 'implement', validation: 'implement' },
      agentThreads: [
        makeThread({ planId: 'eforge/direct-pr-feature', agent: 'merge-conflict-resolver', startedAt: '2025-01-01T00:04:00.000Z' }),
        makeThread({ planId: 'base-sync', agent: 'merge-conflict-resolver', startedAt: '2025-01-01T00:05:00.000Z' }),
        makeThread({ planId: 'validation', agent: 'validation-fixer', startedAt: '2025-01-01T00:06:00.000Z' }),
      ],
    });

    const featurePlan = screen.getByText('Plan 01');
    const featureBranch = screen.getByText('Feature branch: eforge/direct-pr-feature');
    const baseSync = screen.getByText('Direct Base Sync');
    const validation = screen.getByText('Validation');

    expect(featurePlan.compareDocumentPosition(featureBranch) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(featureBranch.compareDocumentPosition(baseSync) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(baseSync.compareDocumentPosition(validation) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
