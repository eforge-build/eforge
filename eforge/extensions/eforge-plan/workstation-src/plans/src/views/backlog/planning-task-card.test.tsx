import * as React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/toast';
import { mockBacklogCurationDraft, mockBacklogCurationPreview, mockRecommendations } from '@/fixtures/mock-data';
import type { PlanningAgentTaskListItem } from '@/types';
import { PlanningTaskCard } from './planning-task-card';

function curationItem(status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' = 'completed', options: { omitDraft?: boolean; invalidPreview?: boolean } = {}): PlanningAgentTaskListItem {
  const completed = status === 'completed';
  return {
    entry: {
      taskId: `task-curation-${status}`,
      originalRequest: '',
      derivedRequest: 'Analyze all backlog records for curation.',
      selection: {},
      requestedOutputSections: ['backlogCurationDraft', 'recommendations'],
      purpose: 'backlog-curation',
      itemAuditConcurrency: 4,
      sourceFingerprint: mockBacklogCurationDraft.sourceFingerprint,
      createdAt: '2026-06-07T00:30:00.000Z',
    },
    available: true,
    status,
    ...(options.invalidPreview && { backlogCurationPreview: mockBacklogCurationPreview }),
    task: {
      taskId: `task-curation-${status}`,
      kind: 'eforge-plan.planning-draft',
      status,
      createdAt: '2026-06-07T00:30:00.000Z',
      updatedAt: '2026-06-07T00:30:06.000Z',
      ...(completed && { result: { summary: 'Ready.', assumptionsOpenQuestions: [], ...(options.omitDraft ? {} : { backlogCurationDraft: mockBacklogCurationDraft }), recommendations: mockRecommendations } }),
      ...(status === 'failed' && { errorMessage: 'failed' }),
    },
  };
}

function renderCard(item: PlanningAgentTaskListItem, applyError?: { taskId: string; message: string; automatic: boolean }) {
  return render(
    <ToastProvider>
      <PlanningTaskCard
        item={item}
        busy={false}
        onCancel={vi.fn(async () => undefined)}
        onRemove={vi.fn(async () => undefined)}
        onRetry={vi.fn(async () => undefined)}
        onRedraft={vi.fn(async () => undefined)}
        onApply={vi.fn(async () => undefined)}
        applyError={applyError}
      />
    </ToastProvider>,
  );
}

describe('PlanningTaskCard curation behavior', () => {
  it('labels backlog curation tasks and hides generic recommendation apply', () => {
    renderCard(curationItem('completed'));

    expect(screen.getAllByText(/Backlog analysis/).length).toBeGreaterThan(0);
    expect(screen.getByText('Backlog curation preview')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Apply recommendations' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeTruthy();
  });

  it('passes invalid curation preview details through to the preview', () => {
    renderCard(curationItem('completed', { invalidPreview: true }));

    expect(screen.getByText('Invalid generated recommendation references')).toBeTruthy();
    expect(screen.getByText(/safeParallelizableGroups\.planning-foundations\.itemIds\[0\]: Item recommend-next-work/)).toBeTruthy();
    expect(screen.getByText(/wrong-lane/)).toBeTruthy();
  });

  it('shows a curation-specific unavailable preview without generic apply when a curation draft is missing', () => {
    renderCard(curationItem('completed', { omitDraft: true }));

    expect(screen.getByText('Backlog curation draft unavailable')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Apply recommendations' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Redraft curation' })).toBeTruthy();
  });

  it('does not expose generic recommendation apply for mismatched curation draft results', () => {
    const item = curationItem('completed');
    item.entry.purpose = 'recommendation-refresh';

    renderCard(item);

    expect(screen.getByText('Backlog curation draft unavailable')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Apply recommendations' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Redraft curation' })).toBeNull();
  });

  it('shows backlog curation item-agent progress while running', () => {
    const item = curationItem('running');
    item.task!.metadata = {
      progressMessage: 'Audited 2/4 items',
      backlogCurationProgress: {
        total: 5,
        cacheHits: 1,
        misses: 4,
        completed: 3,
        running: 1,
        remaining: 1,
        items: [
          { itemId: 'item-running', title: 'Running item', status: 'running' },
          { itemId: 'item-shipped', title: 'Shipped item', status: 'completed', verdict: 'shipped' },
          { itemId: 'item-cache', title: 'Cached item', status: 'cache-hit', verdict: 'still-needed' },
          { itemId: 'item-failed', title: 'Failed item', status: 'failed' },
          { itemId: 'item-pending', title: 'Pending item', status: 'pending' },
        ],
      },
    };

    renderCard(item);

    expect(screen.getByText('Backlog item agents')).toBeTruthy();
    expect(screen.getByText(/3\/5 analyzed/)).toBeTruthy();
    expect(screen.getByText('Running item')).toBeTruthy();
    expect(screen.getByText('Shipped item')).toBeTruthy();
    expect(screen.getByText('Failed item')).toBeTruthy();
    expect(screen.getByText('Pending item')).toBeTruthy();
    expect(screen.queryByText('2 +1 more')).toBeNull();
  });

  it('shows cancel while running and retry for failed available tasks', () => {
    const { unmount } = renderCard(curationItem('running'));
    expect(screen.getByRole('button', { name: /Cancel/ })).toBeTruthy();
    unmount();

    renderCard(curationItem('failed'));
    expect(screen.getAllByText('failed').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Retry with preserved context' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeTruthy();
  });

  it('keeps cancelled and unavailable task messaging visible', () => {
    const { unmount } = renderCard(curationItem('cancelled'));
    expect(screen.getByText('Task cancelled.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry with preserved context' })).toBeTruthy();
    unmount();

    const unavailable = curationItem('completed');
    unavailable.available = false;
    unavailable.staleReason = 'Task record is no longer available.';
    renderCard(unavailable);
    expect(screen.getByText('Task record is no longer available.')).toBeTruthy();
  });

  it('shows automatic apply errors alongside manual creation controls', () => {
    const item = curationItem('completed');
    item.entry.purpose = undefined;
    item.entry.requestedOutputSections = ['sessionPlanCreationDraft'];
    item.task!.result = {
      summary: 'Ready.',
      assumptionsOpenQuestions: [],
      decision: 'ready',
      sessionPlanCreationDraft: { session: 'created-session', topic: 'Created', planningType: 'feature', planningDepth: 'focused', sections: [{ dimension: 'scope', content: 'Scope.' }] },
    };

    renderCard(item, { taskId: item.entry.taskId, message: 'Session plan already exists', automatic: true });

    expect(screen.getByText('Automatic session-plan creation failed.')).toBeTruthy();
    expect(screen.getAllByText(/Session plan already exists/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Create session plan' })).toBeTruthy();
  });
});
