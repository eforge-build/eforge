import * as React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PlanningAgentTaskListItem } from '@/types';
import { ToastProvider } from '@/components/toast';
import type { PlanningTaskWorkflowsApi } from './backlog/use-planning-task-workflows';
import { ActivityRail } from './activity-rail';

function creationItem(taskId = 'task-creation', session?: string): PlanningAgentTaskListItem {
  return {
    entry: {
      taskId,
      originalRequest: '',
      derivedRequest: 'Draft a session plan.',
      selection: {},
      requestedOutputSections: ['sessionPlanCreationDraft'],
      createdAt: '2026-01-01T00:00:00.000Z',
      session,
    },
    available: true,
    status: 'completed',
    task: {
      taskId,
      kind: 'eforge-plan.planning-draft',
      status: 'completed',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:01.000Z',
      completedAt: '2026-01-01T00:00:01.000Z',
      result: {
        summary: 'Ready to create.',
        assumptionsOpenQuestions: [],
        sessionPlanCreationDraft: {
          session: 'created-session',
          topic: 'Created topic',
          planningType: 'feature',
          planningDepth: 'focused',
          sections: [{ dimension: 'scope', content: 'Scope content.' }],
        },
      },
    },
  };
}

function workflows(item: PlanningAgentTaskListItem, items = [item], applyErrors = { [item.entry.taskId]: { taskId: item.entry.taskId, message: 'Session plan already exists', automatic: true } }): PlanningTaskWorkflowsApi {
  return {
    items,
    loading: false,
    busy: false,
    applyErrors,
    reload: vi.fn(async () => undefined),
    start: vi.fn(async () => null),
    analyzeAllBacklog: vi.fn(async () => null),
    retry: vi.fn(async () => undefined),
    redraft: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    apply: vi.fn(async () => null),
  };
}

describe('ActivityRail planning apply errors', () => {
  it('surfaces apply errors in the row and passes them into the drawer', () => {
    const task = creationItem();
    render(<ToastProvider><ActivityRail workflows={workflows(task)} /></ToastProvider>);

    const row = screen.getByRole('button', { name: /Planning task/ });
    expect(within(row).getByText('Apply failed')).toBeTruthy();
    expect(within(row).getByText('Session plan already exists')).toBeTruthy();

    fireEvent.click(row);

    const drawer = screen.getByLabelText('Planning task details');
    expect(within(drawer).getAllByText(/Automatic session-plan creation failed/).length).toBeGreaterThan(0);
    expect(within(drawer).getAllByText(/Session plan already exists/).length).toBeGreaterThan(0);
    expect(within(drawer).getByRole('button', { name: 'Create session plan' })).toHaveProperty('disabled', false);
  });

  it('pins apply-error terminal tasks beyond the recent terminal limit', () => {
    const items = [
      creationItem('task-visible-1', 'visible-1'),
      creationItem('task-visible-2', 'visible-2'),
      creationItem('task-visible-3', 'visible-3'),
      creationItem('task-visible-4', 'visible-4'),
      creationItem('task-hidden-overflow', 'hidden-overflow'),
      creationItem('task-pinned-error', 'pinned-error'),
    ];
    const applyErrors = { 'task-pinned-error': { taskId: 'task-pinned-error', message: 'Still visible after overflow', automatic: true } };

    render(<ToastProvider><ActivityRail workflows={workflows(items[0]!, items, applyErrors)} /></ToastProvider>);

    expect(screen.getByText('Plan pinned-error')).toBeTruthy();
    expect(screen.queryByText('Plan hidden-overflow')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Plan pinned-error/ }));

    const drawer = screen.getByLabelText('Planning task details');
    expect(within(drawer).getAllByText(/Still visible after overflow/).length).toBeGreaterThan(0);
  });
});
