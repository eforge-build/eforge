import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { mockBacklogCurationDraft, mockRecommendations } from '@/fixtures/mock-data';
import type { PlanningTaskWorkflowEntry } from '@/types';
import { BacklogCurationPreview } from './backlog-curation-preview';

const entry: PlanningTaskWorkflowEntry = {
  taskId: 'task-backlog-curation-ready',
  originalRequest: '',
  derivedRequest: 'Analyze all backlog records for curation.',
  selection: {},
  requestedOutputSections: ['backlogCurationDraft', 'recommendations'],
  purpose: 'backlog-curation',
  sourceFingerprint: mockBacklogCurationDraft.sourceFingerprint,
  createdAt: '2026-06-07T00:30:00.000Z',
};

function renderPreview(input: Partial<React.ComponentProps<typeof BacklogCurationPreview>> = {}) {
  return render(
    <BacklogCurationPreview
      taskId="task-backlog-curation-ready"
      entry={entry}
      draft={mockBacklogCurationDraft}
      recommendations={mockRecommendations}
      busy={false}
      onApply={vi.fn(async () => undefined)}
      onRedraft={vi.fn(async () => undefined)}
      {...input}
    />,
  );
}

describe('BacklogCurationPreview', () => {
  it('renders curation groups and generated recommendations', () => {
    renderPreview();

    expect(screen.getByText('Backlog curation preview')).toBeTruthy();
    expect(screen.getByText('Item changes')).toBeTruthy();
    expect(screen.getByText('Epic changes')).toBeTruthy();
    expect(screen.getByText('No-op rechecks')).toBeTruthy();
    expect(screen.getByText('Skipped cases')).toBeTruthy();
    expect(screen.getByText('Needs-input cases')).toBeTruthy();
    expect(screen.getByText('Generated recommendations (read-only)')).toBeTruthy();
    expect(screen.getAllByText(/auto-mode/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/planning/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/traceability/).length).toBeGreaterThan(0);
  });

  it('requires two explicit apply actions', () => {
    const onApply = vi.fn(async () => undefined);
    renderPreview({ onApply });

    fireEvent.click(screen.getByRole('button', { name: 'I reviewed this curation preview' }));
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm apply curation' }));

    expect(onApply).toHaveBeenCalledWith('task-backlog-curation-ready', {
      applyBacklogCurationDraft: { previewAcknowledged: true, confirmApply: true },
    });
  });

  it('redrafts only after non-empty steering', () => {
    const onRedraft = vi.fn(async () => undefined);
    renderPreview({ onRedraft });

    expect(screen.getByRole('button', { name: 'Redraft curation' })).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByPlaceholderText('Optional steering for a curation redraft'), { target: { value: 'Keep status changes conservative.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Redraft curation' }));

    expect(onRedraft).toHaveBeenCalledWith('task-backlog-curation-ready', { steering: 'Keep status changes conservative.' });
  });

  it('renders applied state without apply controls', () => {
    renderPreview({ entry: { ...entry, appliedAt: '2026-06-07T00:40:00.000Z' } });

    expect(screen.getByText(/Curation applied/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'I reviewed this curation preview' })).toBeNull();
  });
});
