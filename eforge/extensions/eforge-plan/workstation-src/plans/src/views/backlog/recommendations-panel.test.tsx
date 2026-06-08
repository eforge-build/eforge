import * as React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  mockActiveRecommendationRefreshTask,
  mockPlanningTask,
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
      titles={titles}
      onStartPlan={vi.fn(async () => undefined)}
      onRefreshRecommendations={vi.fn(async () => undefined)}
      {...input}
    />,
  );
}

describe('RecommendationsPanel freshness states', () => {
  it('renders the missing recommendation state and shows a refresh control', () => {
    const onRefreshRecommendations = vi.fn(async () => undefined);
    renderPanel({ recommendations: null, status: mockRecommendationStatusMissing, onRefreshRecommendations });

    expect(screen.getByText('missing')).toBeTruthy();
    expect(screen.getByText(/No current recommendations are stored/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Refresh recommendations/i }));

    expect(onRefreshRecommendations).toHaveBeenCalledTimes(1);
  });

  it('renders fresh recommendations without stale reasons', () => {
    renderPanel();

    expect(screen.getByText('fresh')).toBeTruthy();
    expect(screen.getByText(/Stored recommendations are fresh/i)).toBeTruthy();
    expect(screen.getByText('Recommended next sequence')).toBeTruthy();
    expect(screen.queryByText('Stale reasons')).toBeNull();
    expect(screen.queryByRole('button', { name: /Refresh recommendations/i })).toBeNull();
  });

  it('renders stale recommendations with structured reason metadata and a refresh control', () => {
    const onRefreshRecommendations = vi.fn(async () => undefined);
    renderPanel({ status: mockRecommendationStatusStale, onRefreshRecommendations });

    expect(screen.getByText('stale')).toBeTruthy();
    expect(screen.getByText('source-fingerprint-drift')).toBeTruthy();
    expect(screen.getByText(/Recommendation source fingerprint drifted/i)).toBeTruthy();
    expect(screen.getByText('lifecycle:session:end')).toBeTruthy();
    expect(screen.getByText(/Recommendations are stale after single lifecycle update session:end/i)).toBeTruthy();
    expect(screen.getByText(/event\s+session:end/i)).toBeTruthy();
    expect(screen.getByText('single')).toBeTruthy();
    expect(screen.getByText('2026-06-07T00:05:00.000Z')).toBeTruthy();
    expect(screen.getAllByText('Add import preview').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /Refresh recommendations/i }));

    expect(onRefreshRecommendations).toHaveBeenCalledTimes(1);
  });

  it('shows active recommendation refresh task status', () => {
    renderPanel({ status: mockRecommendationStatusStale, activeRefreshTask: mockActiveRecommendationRefreshTask });

    expect(screen.getByText('Active refresh task')).toBeTruthy();
    expect(screen.getByText(mockActiveRecommendationRefreshTask.taskId)).toBeTruthy();
    expect(screen.getByText('running')).toBeTruthy();
    expect(screen.getByText(/Refreshing recommendations/i)).toBeTruthy();
  });

  it('treats safe parallelizable groups as planning guidance, not queue actions', () => {
    const onStartPlan = vi.fn(async () => undefined);
    renderPanel({ onStartPlan });

    fireEvent.click(screen.getByRole('button', { name: 'Planning foundations' }));

    expect(onStartPlan).toHaveBeenCalledWith({ recommendationRef: 'planning-foundations' }, 'Planning foundations');
    expect(screen.queryByRole('button', { name: /enqueue/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /queue/i })).toBeNull();
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
