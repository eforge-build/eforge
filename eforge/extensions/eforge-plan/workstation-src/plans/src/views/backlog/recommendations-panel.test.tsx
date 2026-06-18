import * as React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  mockActiveRecommendationRefreshTask,
  mockPlanningTask,
  mockRecommendationFreshnessFresh,
  mockRecommendationFreshnessMissing,
  mockRecommendationFreshnessStale,
  mockRecommendationStatusFresh,
  mockRecommendationStatusMissing,
  mockRecommendationStatusStale,
  mockRecommendations,
} from '@/fixtures/mock-data';
import type { PlanningAgentTaskListItem } from '@/types';
import { PlanningTaskResultPreview } from './planning-task-result-preview';
import { RecommendationsPanel } from './recommendations-panel';

const titles = new Map([
  ['recommend-next-work', 'Maintain next-work recommendations'],
  ['add-import-preview', 'Add import preview'],
  ['auto-mode', 'Explore auto-mode draining'],
  ['traceability', 'Trace sidecars'],
]);

function renderPanel(input: Partial<React.ComponentProps<typeof RecommendationsPanel>> = {}) {
  return render(
    <RecommendationsPanel
      recommendations={mockRecommendations}
      status={mockRecommendationStatusFresh}
      freshness={mockRecommendationFreshnessFresh}
      titles={titles}
      selected={new Set<string>()}
      readyIds={new Set(['add-import-preview', 'recommend-next-work'])}
      onPickItem={vi.fn()}
      onPickItems={vi.fn()}
      onPlanItems={vi.fn(async () => undefined)}
      {...input}
    />,
  );
}

describe('RecommendationsPanel freshness states', () => {
  it('renders the missing recommendation state without a recommendation-only refresh control', () => {
    renderPanel({ recommendations: null, status: mockRecommendationStatusMissing, freshness: mockRecommendationFreshnessMissing });

    expect(screen.getByText('missing')).toBeTruthy();
    expect(screen.getByText(/No recommendation model has been generated/i)).toBeTruthy();
    expect(screen.getByText(/run Analyze all backlog/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Refresh recommendations/i })).toBeNull();
  });

  it('renders fresh recommendations without stale reasons', () => {
    renderPanel();

    expect(screen.getByText('fresh')).toBeTruthy();
    expect(screen.getByText(/Recommendation model matches the current source fingerprint/i)).toBeTruthy();
    expect(screen.getAllByTitle('fresh-source-fingerprint').length).toBeGreaterThan(0);
    expect(screen.getByText(/Recommendations are up to date/i)).toBeTruthy();
    expect(screen.getByText('Recommended next sequence')).toBeTruthy();
    expect(screen.queryByText('What changed')).toBeNull();
    expect(screen.queryByRole('button', { name: /Refresh recommendations/i })).toBeNull();
  });

  it('renders stale recommendations with humanized reason metadata and analyze-all guidance', () => {
    renderPanel({ status: mockRecommendationStatusStale, freshness: mockRecommendationFreshnessStale });

    expect(screen.getByText('stale')).toBeTruthy();
    expect(screen.getByText(/Recommendation source fingerprint drifted since the model was last applied/i)).toBeTruthy();
    expect(screen.getAllByTitle('old-source-fingerprint').length).toBeGreaterThan(0);
    expect(screen.getAllByTitle('current-source-fingerprint').length).toBeGreaterThan(0);
    expect(screen.getByText(/run Analyze all backlog before planning/i)).toBeTruthy();
    // Machine codes stay visible but demoted to chips; the lead text is plain language.
    expect(screen.getByText('source-fingerprint-drift')).toBeTruthy();
    expect(screen.getByText(/The backlog changed since recommendations were last applied/i)).toBeTruthy();
    expect(screen.getByText('lifecycle:session:end')).toBeTruthy();
    expect(screen.getByText(/Recommendations are stale after single lifecycle update session:end/i)).toBeTruthy();
    expect(screen.getByText(/event\s+session:end/i)).toBeTruthy();
    expect(screen.getByText('single')).toBeTruthy();
    // Timestamps render as relative time with the precise ISO value in the tooltip.
    expect(screen.getAllByTitle('2026-06-07T00:05:00.000Z').length).toBeGreaterThan(0);
    expect(screen.queryByText('2026-06-07T00:05:00.000Z')).toBeNull();
    expect(screen.getAllByText('Add import preview').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /Refresh recommendations/i })).toBeNull();
  });

  it('shows compact refresh progress instead of a duplicate task block while a refresh runs', () => {
    renderPanel({ status: mockRecommendationStatusStale, freshness: mockRecommendationFreshnessStale, activeRefreshTask: mockActiveRecommendationRefreshTask });

    // The full task record lives in the Plan with AI panel; here only progress shows.
    expect(screen.queryByText('Active refresh task')).toBeNull();
    expect(screen.queryByText(mockActiveRecommendationRefreshTask.taskId)).toBeNull();
    expect(screen.getByText('refreshing')).toBeTruthy();
    expect(screen.getByText(/Refreshing recommendations/i)).toBeTruthy();
    expect(screen.getByText(/A refresh is running now/i)).toBeTruthy();
    // No contradictory "refresh before planning" guidance or manual refresh control.
    expect(screen.queryByText('What changed')).toBeNull();
    expect(screen.queryByRole('button', { name: /Refresh recommendations/i })).toBeNull();
  });

  it('does not infer a fresh badge from recommendations when server freshness and status are absent', () => {
    renderPanel({ status: null, freshness: null });

    expect(screen.queryByText('fresh')).toBeNull();
    expect(screen.getByText(/freshness status has not been provided by the server/i)).toBeTruthy();
  });

  it('adds a recommended next item to the selection instead of starting a plan', () => {
    const onPickItem = vi.fn();
    renderPanel({ onPickItem });

    // The item renders as both a lane-card chip and a next-sequence chip;
    // either one toggles it into the selection.
    for (const button of screen.getAllByRole('button', { name: /Maintain next-work recommendations/i })) {
      fireEvent.click(button);
    }

    expect(onPickItem).toHaveBeenCalledWith('recommend-next-work');
    expect(screen.queryByRole('button', { name: /enqueue/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /queue/i })).toBeNull();
  });

  it('selects every item in a planning lane from the prominent lane card, not a queue action', () => {
    const onPickItems = vi.fn();
    renderPanel({ onPickItems });

    expect(screen.getByText(/Planning lanes/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Select group Planning foundations' }));

    expect(onPickItems).toHaveBeenCalledWith(['add-import-preview', 'recommend-next-work']);
    expect(screen.queryByRole('button', { name: /enqueue/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /queue/i })).toBeNull();
  });

  it('starts a planning task for a lane in one click, scoped by the lane ref', () => {
    const onPlanItems = vi.fn(async () => undefined);
    renderPanel({ onPlanItems });

    fireEvent.click(screen.getByRole('button', { name: 'Plan lane Planning foundations' }));

    expect(onPlanItems).toHaveBeenCalledWith(['add-import-preview', 'recommend-next-work'], 'planning-foundations');
  });

  it('disables one-click lane planning when no items in the lane are ready', () => {
    const onPlanItems = vi.fn(async () => undefined);
    renderPanel({ onPlanItems, readyIds: new Set<string>() });

    const button = screen.getByRole('button', { name: 'Plan lane Planning foundations' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);

    expect(onPlanItems).not.toHaveBeenCalled();
  });

  it('offers to clear a planning lane once every item in it is selected', () => {
    const onPickItems = vi.fn();
    renderPanel({ onPickItems, selected: new Set(['add-import-preview', 'recommend-next-work']) });

    fireEvent.click(screen.getByRole('button', { name: 'Clear group Planning foundations' }));

    expect(onPickItems).toHaveBeenCalledWith(['add-import-preview', 'recommend-next-work']);
  });

  it('requires two-step confirmation before applying generated recommendations', async () => {
    const onApply = vi.fn(async () => undefined);
    const item: PlanningAgentTaskListItem = {
      entry: {
        taskId: mockPlanningTask.taskId,
        originalRequest: '',
        derivedRequest: 'Refresh recommendations.',
        selection: {},
        requestedOutputSections: ['recommendations'],
        createdAt: mockPlanningTask.createdAt,
      },
      available: true,
      status: 'completed',
      task: mockPlanningTask,
    };

    render(<PlanningTaskResultPreview item={item} busy={false} onRedraft={vi.fn(async () => undefined)} onApply={onApply} />);

    fireEvent.click(screen.getByRole('button', { name: 'Apply recommendations' }));
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm apply recommendations' }));

    await waitFor(() => expect(onApply).toHaveBeenCalledWith(mockPlanningTask.taskId, { applyRecommendations: true }));
  });
});
