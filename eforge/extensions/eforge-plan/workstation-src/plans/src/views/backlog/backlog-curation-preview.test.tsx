import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { mockBacklogCurationDraft, mockBacklogCurationPreview, mockRecommendations } from '@/fixtures/mock-data';
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
    expect(screen.getByText('0 active work items · 1 ready candidates · 0 next-sequence items · 0 safe-parallel groups · 1 blocked chains')).toBeTruthy();
    expect(screen.getByText('Shipped evidence: lifecycle trace')).toBeTruthy();
    expect(screen.getByText('Shipped evidence: inferred from git/PR history')).toBeTruthy();
    expect(screen.getByText(/PR identifiers: #191/)).toBeTruthy();
    expect(screen.getByText(/Commit identifiers: abcdef1234567890/)).toBeTruthy();
    expect(screen.getByText('recommend-next-work has git and PR evidence from the merged recommendation workflow.')).toBeTruthy();
    expect(screen.getByText('Ambiguous shipped candidate: needs input')).toBeTruthy();
    expect(screen.getAllByText('Proposed shipped metadata evidence in this draft:').length).toBeGreaterThan(0);
    expect(screen.queryByText(/Applied shipped metadata evidence/)).toBeNull();
    expect(screen.getByText('Removed proposed-shipped recommendation targets from this draft preview: add-import-preview, recommend-next-work')).toBeTruthy();
    expect(screen.getAllByText(/auto-mode/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/planning/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/traceability/).length).toBeGreaterThan(0);
  });

  it('counts generated recommendations from all recommendation categories', () => {
    renderPreview({
      recommendations: {
        schemaVersion: 1,
        activeWork: [{ itemId: 'active-item', rationale: 'Already active.' }],
        readyCandidates: [{ itemId: 'ready-item', rationale: 'Ready now.' }],
        recommendedNextSequence: [],
        safeParallelizableGroups: [],
        blockedChains: [],
      },
    });

    expect(screen.getByText('2 generated recommendations')).toBeTruthy();
    expect(screen.getByText('1 active work items · 1 ready candidates · 0 next-sequence items · 0 safe-parallel groups · 0 blocked chains')).toBeTruthy();
  });

  it('renders invalid generated recommendation references and disables normal confirm', () => {
    renderPreview({ curationPreview: mockBacklogCurationPreview });

    expect(screen.getByText('Invalid generated recommendation references')).toBeTruthy();
    expect(screen.getByText(/blockedChains\.closed-chain\.blockedBy: Item closed-dep/)).toBeTruthy();
    expect(screen.getByText(/Generated recommendation references closed item closed-dep/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'I reviewed this curation preview' }));
    expect(screen.getByRole('button', { name: 'Confirm apply curation' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Apply curation only / discard generated recommendations' })).toBeTruthy();
  });

  it('sends curation-only apply input when invalid recommendations are acknowledged for discard', () => {
    const onApply = vi.fn(async () => undefined);
    renderPreview({ curationPreview: mockBacklogCurationPreview, onApply });

    fireEvent.click(screen.getByRole('button', { name: 'I reviewed this curation preview' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply curation only / discard generated recommendations' }));

    expect(onApply).toHaveBeenCalledWith('task-backlog-curation-ready', {
      applyBacklogCurationDraft: { previewAcknowledged: true, confirmApply: true, applyCurationOnly: true },
    });
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

  it('keeps normal confirmation enabled when validation is valid', () => {
    const onApply = vi.fn(async () => undefined);
    renderPreview({ curationPreview: { valid: true, generatedRecommendationValidation: { valid: true, issues: [] } }, onApply });

    fireEvent.click(screen.getByRole('button', { name: 'I reviewed this curation preview' }));
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
