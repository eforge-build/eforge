import * as React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/toast';
import { mockBacklogCurationDraft, mockRecommendations } from '@/fixtures/mock-data';
import type { PlanningAgentTaskListItem } from '@/types';
import { PlanningTaskCard } from './planning-task-card';

function curationItem(status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' = 'completed', options: { omitDraft?: boolean } = {}): PlanningAgentTaskListItem {
  const completed = status === 'completed';
  return {
    entry: {
      taskId: `task-curation-${status}`,
      originalRequest: '',
      derivedRequest: 'Analyze all backlog records for curation.',
      selection: {},
      requestedOutputSections: ['backlogCurationDraft', 'recommendations'],
      purpose: 'backlog-curation',
      sourceFingerprint: mockBacklogCurationDraft.sourceFingerprint,
      createdAt: '2026-06-07T00:30:00.000Z',
    },
    available: true,
    status,
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

function renderCard(item: PlanningAgentTaskListItem) {
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
      />
    </ToastProvider>,
  );
}

describe('PlanningTaskCard curation behavior', () => {
  it('labels backlog curation tasks and hides generic recommendation apply', () => {
    renderCard(curationItem('completed'));

    expect(screen.getByText('Backlog curation')).toBeTruthy();
    expect(screen.getByText('Backlog curation preview')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Apply recommendations' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeTruthy();
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

  it('shows cancel while running and retry for failed available tasks', () => {
    const { unmount } = renderCard(curationItem('running'));
    expect(screen.getByRole('button', { name: /Cancel/ })).toBeTruthy();
    unmount();

    renderCard(curationItem('failed'));
    expect(screen.getByRole('button', { name: 'Retry with preserved context' })).toBeTruthy();
  });
});
