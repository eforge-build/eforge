import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { mockBacklogCurationDraft, mockBacklogCurationPreview, mockEffectiveCurationRecommendations, mockFullAuditBacklogCurationPreview, mockRecommendations } from '@/fixtures/mock-data';
import type { BacklogCurationPreviewDetails, PlanningTaskWorkflowEntry } from '@/types';
import { BacklogCurationPreview } from './backlog-curation-preview';

const entry: PlanningTaskWorkflowEntry = {
  taskId: 'task-backlog-curation-ready',
  originalRequest: '',
  derivedRequest: 'Analyze all backlog records for curation.',
  selection: {},
  requestedOutputSections: ['backlogCurationDraft', 'recommendations'],
  purpose: 'backlog-curation',
  scanMode: 'delta',
  sourceFingerprint: mockBacklogCurationDraft.sourceFingerprint,
  createdAt: '2026-06-07T00:30:00.000Z',
};

const validProjectionPreview: BacklogCurationPreviewDetails = {
  ...mockBacklogCurationPreview,
  valid: true,
  recommendationProjection: {
    ...mockBacklogCurationPreview.recommendationProjection,
    validation: { valid: true, issues: [] },
  },
  generatedRecommendationValidation: { valid: true, issues: [] },
};

function renderPreview(input: Partial<React.ComponentProps<typeof BacklogCurationPreview>> = {}) {
  return render(
    <BacklogCurationPreview
      taskId="task-backlog-curation-ready"
      entry={entry}
      draft={mockBacklogCurationDraft}
      recommendations={mockRecommendations}
      curationPreview={validProjectionPreview}
      busy={false}
      onApply={vi.fn(async () => undefined)}
      onRedraft={vi.fn(async () => undefined)}
      {...input}
    />,
  );
}

describe('BacklogCurationPreview', () => {
  it('renders curation groups, freshness, git-delta diagnostics, and effective generated recommendations', () => {
    renderPreview();

    expect(screen.getByText('Backlog curation preview')).toBeTruthy();
    expect(screen.getByText('Item changes')).toBeTruthy();
    expect(screen.getByText('Epic changes')).toBeTruthy();
    expect(screen.getByText('No-op rechecks')).toBeTruthy();
    expect(screen.getByText('Skipped cases')).toBeTruthy();
    expect(screen.getByText('Needs-input cases')).toBeTruthy();
    expect(screen.getByText('recommendations stale')).toBeTruthy();
    expect(screen.getByText(/Recommendation source fingerprint drifted/i)).toBeTruthy();
    expect(screen.getByText('Delta git diagnostics')).toBeTruthy();
    expect(screen.getByText('baseline-missing')).toBeTruthy();
    expect(screen.getByText('baseline-unreachable')).toBeTruthy();
    expect(screen.getByText(/coverage fallback/i)).toBeTruthy();
    expect(screen.getByText(/Scanned commits: 42/)).toBeTruthy();
    expect(screen.getByText(/Affected candidates: 3/)).toBeTruthy();
    expect(screen.getByText('Effective generated recommendations (read-only)')).toBeTruthy();
    expect(screen.getByText('0 active work items · 1 ready candidates · 1 next-sequence items · 1 safe-parallel groups · 1 blocked chains')).toBeTruthy();
    expect(screen.queryByText('0 active work items · 2 ready candidates · 2 next-sequence items · 1 safe-parallel groups · 1 blocked chains')).toBeNull();
    expect(screen.getByText('Removed item ids: add-import-preview')).toBeTruthy();
    expect(screen.getByText('Removed epic ids: planning')).toBeTruthy();
    expect(screen.getByText('Repositioned item ids: recommend-next-work: readyCandidates → recommendedNextSequence')).toBeTruthy();
    expect(screen.getAllByText('Shipped evidence: current source').length).toBeGreaterThan(0);
    expect(screen.queryByText('Shipped evidence: inferred from git/PR history')).toBeNull();
    expect(screen.queryByText(/PR identifiers: #191/)).toBeNull();
    expect(screen.queryByText(/Commit identifiers: abcdef1234567890/)).toBeNull();
    expect(screen.getByText('recommend-next-work has current-source implementation and product-surface citations; PR history remains a navigation hint.')).toBeTruthy();
    expect(screen.getByText('Ambiguous shipped candidate: needs input')).toBeTruthy();
    expect(screen.getByText('Ambiguous superseded candidate: needs input')).toBeTruthy();
    expect(screen.getAllByText('Proposed closure metadata evidence in this draft:').length).toBeGreaterThan(0);
    expect(screen.queryByText(/Applied closure metadata evidence/)).toBeNull();
    expect(screen.getAllByText(/auto-mode/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/planning/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/traceability/).length).toBeGreaterThan(0);
  });

  it('renders source-first mode labels, warning, coverage, caps, diagnostics, and evidence chips', () => {
    renderPreview({ entry: { ...entry, scanMode: 'full-implementation-audit' }, curationPreview: mockFullAuditBacklogCurationPreview });

    expect(screen.getAllByText('Source-first implementation audit').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/current source is the only closure authority/i).length).toBeGreaterThan(0);
    expect(screen.getByText('Source-first audit metadata')).toBeTruthy();
    expect(screen.getByText('Audited items')).toBeTruthy();
    expect(screen.getByText('6')).toBeTruthy();
    expect(screen.getByText('Item audit concurrency')).toBeTruthy();
    expect(screen.getByText('File scan cap')).toBeTruthy();
    expect(screen.getByText('250')).toBeTruthy();
    expect(screen.getByText('pr-history-unavailable')).toBeTruthy();
    expect(screen.getByText(/Some pull request metadata was unavailable/)).toBeTruthy();
    expect(screen.getAllByText(/Current Source · strong/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Historical navigation hints (not closure evidence)').length).toBeGreaterThan(0);
  });

  it('counts generated recommendations from the server projection instead of raw recommendations', () => {
    renderPreview({
      recommendations: {
        schemaVersion: 1,
        activeWork: [{ itemId: 'active-item', rationale: 'Already active.' }],
        readyCandidates: [{ itemId: 'ready-item', rationale: 'Ready now.' }],
        recommendedNextSequence: [],
        safeParallelizableGroups: [],
        blockedChains: [],
      },
      curationPreview: {
        ...validProjectionPreview,
        recommendationProjection: {
          ...validProjectionPreview.recommendationProjection!,
          effectiveRecommendations: mockEffectiveCurationRecommendations,
        },
      },
    });

    expect(screen.getByText('4 generated recommendations')).toBeTruthy();
    expect(screen.getByText('0 active work items · 1 ready candidates · 1 next-sequence items · 1 safe-parallel groups · 1 blocked chains')).toBeTruthy();
    expect(screen.queryByText('2 generated recommendations')).toBeNull();
  });

  it('renders invalid generated recommendation references and disables normal confirm', () => {
    renderPreview({ curationPreview: mockBacklogCurationPreview });

    expect(screen.getByText('Invalid generated recommendation references')).toBeTruthy();
    expect(screen.getByText(/safeParallelizableGroups\.planning-foundations\.itemIds\[0\]: Item recommend-next-work/)).toBeTruthy();
    expect(screen.getByText(/wrong-lane/)).toBeTruthy();
    expect(screen.getByText(/Generated recommendation references an item in the wrong lane/)).toBeTruthy();

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
    renderPreview({ curationPreview: validProjectionPreview, onApply });

    fireEvent.click(screen.getByRole('button', { name: 'I reviewed this curation preview' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm apply curation' }));

    expect(onApply).toHaveBeenCalledWith('task-backlog-curation-ready', {
      applyBacklogCurationDraft: { previewAcknowledged: true, confirmApply: true },
    });
  });

  it('keeps normal confirmation enabled for a valid curation draft without generated recommendations', () => {
    const onApply = vi.fn(async () => undefined);
    renderPreview({ curationPreview: { valid: true, itemChanges: 1, epicChanges: 0, noOpRechecks: 0 }, recommendations: undefined, onApply });

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
