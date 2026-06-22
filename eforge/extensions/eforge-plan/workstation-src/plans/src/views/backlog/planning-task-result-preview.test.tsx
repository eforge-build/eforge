import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PlanningAgentTaskListItem } from '@/types';
import { PlanningTaskResultPreview } from './planning-task-result-preview';

function creationItem(): PlanningAgentTaskListItem {
  return {
    entry: {
      taskId: 'task-creation',
      originalRequest: '',
      derivedRequest: 'Draft a session plan.',
      selection: {},
      requestedOutputSections: ['sessionPlanCreationDraft'],
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    available: true,
    status: 'completed',
    task: {
      taskId: 'task-creation',
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

describe('PlanningTaskResultPreview session-plan creation confirmation', () => {
  it('keeps create available and does not apply when confirmation is cancelled', () => {
    const onApply = vi.fn(async () => undefined);
    render(<PlanningTaskResultPreview item={creationItem()} busy={false} onRedraft={vi.fn(async () => undefined)} onApply={onApply} />);

    fireEvent.click(screen.getByRole('button', { name: 'Create session plan' }));
    expect(screen.getByRole('button', { name: 'Confirm create session plan' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Create session plan' })).toBeTruthy();
  });

  it('applies only after the second confirmation click', () => {
    const onApply = vi.fn(async () => undefined);
    render(<PlanningTaskResultPreview item={creationItem()} busy={false} onRedraft={vi.fn(async () => undefined)} onApply={onApply} />);

    fireEvent.click(screen.getByRole('button', { name: 'Create session plan' }));
    expect(onApply).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm create session plan' }));

    expect(onApply).toHaveBeenCalledWith('task-creation', { applySessionPlanCreationDraft: {} });
  });

  // --- eforge:region plan-04-workstation-session-plan-auto-apply ---
  it('shows automatic apply failures while keeping manual creation available', () => {
    const onApply = vi.fn(async () => undefined);
    render(
      <PlanningTaskResultPreview
        item={creationItem()}
        busy={false}
        onRedraft={vi.fn(async () => undefined)}
        onApply={onApply}
        applyError={{ taskId: 'task-creation', message: 'Session plan already exists', automatic: true }}
      />,
    );

    expect(screen.getByText(/Automatic session-plan creation failed/)).toBeTruthy();
    expect(screen.getByText(/Session plan already exists/)).toBeTruthy();
    const create = screen.getByRole('button', { name: 'Create session plan' });
    expect(create).toHaveProperty('disabled', false);

    fireEvent.click(create);
    const confirm = screen.getByRole('button', { name: 'Confirm create session plan' });
    expect(confirm).toHaveProperty('disabled', false);
    fireEvent.click(confirm);

    expect(onApply).toHaveBeenCalledWith('task-creation', { applySessionPlanCreationDraft: {} });
  });
  // --- eforge:endregion plan-04-workstation-session-plan-auto-apply ---
});
