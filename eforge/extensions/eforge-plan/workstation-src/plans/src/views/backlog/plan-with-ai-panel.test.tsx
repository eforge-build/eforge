import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/toast';
import { mockBacklogCurationDraft, mockRecommendations } from '@/fixtures/mock-data';
import type { PlanningAgentTaskListItem } from '@/types';
import type { PlanningTaskWorkflowsApi } from './use-planning-task-workflows';
import { PlanWithAiPanel } from './plan-with-ai-panel';

function curationItem(status: 'running' | 'completed', taskId: string): PlanningAgentTaskListItem {
  const completed = status === 'completed';
  return {
    entry: {
      taskId,
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
      taskId,
      kind: 'eforge-plan.planning-draft',
      status,
      createdAt: '2026-06-07T00:30:00.000Z',
      updatedAt: '2026-06-07T00:30:06.000Z',
      ...(completed && { result: { summary: 'Ready.', assumptionsOpenQuestions: [], backlogCurationDraft: mockBacklogCurationDraft, recommendations: mockRecommendations } }),
    },
  };
}

function workflows(overrides: Partial<PlanningTaskWorkflowsApi> = {}): PlanningTaskWorkflowsApi {
  return {
    items: [],
    loading: false,
    busy: false,
    reload: vi.fn(async () => undefined),
    start: vi.fn(async () => null),
    analyzeAllBacklog: vi.fn(async () => null),
    retry: vi.fn(async () => undefined),
    redraft: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    apply: vi.fn(async () => null),
    ...overrides,
  };
}

function renderPanel(api: PlanningTaskWorkflowsApi) {
  return render(
    <ToastProvider>
      <PlanWithAiPanel workflows={api} />
    </ToastProvider>,
  );
}

describe('PlanWithAiPanel curation controls', () => {
  it('renders an accessible Analyze all backlog action that starts curation through the workflow API', () => {
    const analyzeAllBacklog = vi.fn(async () => null);
    renderPanel(workflows({ analyzeAllBacklog }));

    fireEvent.click(screen.getByRole('button', { name: 'Analyze all backlog' }));

    expect(analyzeAllBacklog).toHaveBeenCalledOnce();
  });

  it('keeps analyze-all disabled while the workflow API is busy or loading', () => {
    const { rerender } = render(
      <ToastProvider>
        <PlanWithAiPanel workflows={workflows({ busy: true })} />
      </ToastProvider>,
    );
    expect(screen.getByRole('button', { name: 'Analyze all backlog' })).toHaveProperty('disabled', true);

    rerender(
      <ToastProvider>
        <PlanWithAiPanel workflows={workflows({ loading: true })} />
      </ToastProvider>,
    );
    expect(screen.getByRole('button', { name: 'Analyze all backlog' })).toHaveProperty('disabled', true);
  });

  it('summarizes running and ready backlog curation tasks in the panel header', () => {
    renderPanel(workflows({ items: [curationItem('running', 'task-curation-running'), curationItem('completed', 'task-curation-ready')] }));

    expect(screen.getByText('1 backlog curation running')).toBeTruthy();
    expect(screen.getByText('1 curation ready')).toBeTruthy();
    expect(screen.getAllByText('Backlog curation').length).toBeGreaterThan(0);
  });
});
