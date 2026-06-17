import * as React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/toast';
import { getMockRoadmapState } from '@/fixtures/mock-roadmap';
import { mockActiveRecommendationRefreshTask, mockRecommendationStatusStale } from '@/fixtures/mock-data';
import type { RoadmapStateResponse, UpdateRoadmapStateRequest } from '@/types';
import { RoadmapPanel } from './roadmap-panel';

function renderPanel(overrides: Partial<React.ComponentProps<typeof RoadmapPanel>> = {}) {
  const state = getMockRoadmapState();
  const props: React.ComponentProps<typeof RoadmapPanel> = {
    state,
    loading: false,
    recommendationStatus: mockRecommendationStatusStale,
    activeRecommendationRefreshTask: null,
    onSaveLocalFocus: vi.fn(async () => state),
    onRefreshRecommendations: vi.fn(async () => ({ task: mockActiveRecommendationRefreshTask, entry: { taskId: mockActiveRecommendationRefreshTask.taskId, originalRequest: '', derivedRequest: '', selection: {}, requestedOutputSections: ['recommendations'], createdAt: mockActiveRecommendationRefreshTask.createdAt }, sourceFingerprint: 'fingerprint' })),
    onReloadRoadmap: vi.fn(async () => undefined),
    ...overrides,
  };
  return { ...render(<ToastProvider><RoadmapPanel {...props} /></ToastProvider>), props };
}

describe('RoadmapPanel', () => {
  it('renders separate source status sections, metadata, and docs/roadmap.md only in a discovered row', () => {
    const state = getMockRoadmapState();
    const projectedLocalFocusPath = 'projected://local-focus-roadmap.md';
    state.storagePaths.localFocus = projectedLocalFocusPath;
    state.context.localSteering = { ...state.context.localSteering, path: projectedLocalFocusPath };
    renderPanel({ state });

    expect(screen.getAllByText('Local focus').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Configured shared context').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Discovered context').length).toBeGreaterThan(0);
    expect(screen.getAllByText(projectedLocalFocusPath).length).toBeGreaterThan(0);
    expect(screen.getByText('Shared platform roadmap')).toBeTruthy();
    expect(screen.getByText('docs/shared-roadmap.md')).toBeTruthy();
    const sourceGroups = screen.getByText('Discovered context', { selector: 'h4' }).closest('section')!;
    const sourceGroupByTitle = (title: string) => {
      const group = Array.from(sourceGroups.querySelectorAll(':scope > div')).find((candidate) => within(candidate as HTMLElement).queryByText(title, { selector: 'h4' }));
      expect(group).toBeTruthy();
      return group as HTMLElement;
    };
    const localGroup = sourceGroupByTitle('Local focus');
    const configuredGroup = sourceGroupByTitle('Configured shared context');
    const discoveredGroup = sourceGroupByTitle('Discovered context');
    const discoveredRoadmapRows = within(discoveredGroup).getAllByText('docs/roadmap.md').map((element) => element.closest('article'));
    expect(new Set(discoveredRoadmapRows).size).toBe(1);
    const discoveredRoadmapRow = discoveredRoadmapRows[0]!;
    expect(within(discoveredRoadmapRow).getAllByText('docs/roadmap.md').length).toBeGreaterThan(0);
    expect(within(discoveredRoadmapRow).getByText('discovered')).toBeTruthy();
    expect(within(discoveredGroup).queryByText('docs/roadmap.md', { selector: 'h4,h3' })).toBeNull();
    expect(within(localGroup).queryByText('docs/roadmap.md')).toBeNull();
    expect(within(configuredGroup).queryByText('docs/roadmap.md')).toBeNull();
    expect(screen.getByText(/Optional configured roadmap is missing/i)).toBeTruthy();
    expect(screen.getByText(/Local focus is private extension storage/i)).toBeTruthy();
    expect(screen.getByText(/Truncation: 0 source content fields and 1 source excerpts/i)).toBeTruthy();
  });

  it('saves local focus content with the current expected hash and no sharedSources key', async () => {
    const state = getMockRoadmapState();
    const onSaveLocalFocus = vi.fn(async (input: UpdateRoadmapStateRequest): Promise<RoadmapStateResponse> => ({ ...state, context: { ...state.context, localSteering: { ...state.context.localSteering, content: input.localFocusContent ?? '' } } }));
    renderPanel({ state, onSaveLocalFocus });

    fireEvent.change(screen.getByLabelText('Local focus roadmap'), { target: { value: '# Local focus\n\nChanged.\n' } });
    fireEvent.click(screen.getByRole('button', { name: /Save local focus/i }));

    await waitFor(() => expect(onSaveLocalFocus).toHaveBeenCalledTimes(1));
    expect(onSaveLocalFocus.mock.calls[0]![0]).toMatchObject({ localFocusContent: '# Local focus\n\nChanged.\n', expectedLocalFocusSha256: state.context.localSteering.sha256 });
    expect(onSaveLocalFocus.mock.calls[0]![0]).not.toHaveProperty('sharedSources');
  });

  it('disables save for over-limit local focus content and displays byte feedback', () => {
    const state = getMockRoadmapState();
    state.context.localSteering = { ...state.context.localSteering, maxContentBytes: 3 };
    renderPanel({ state });

    fireEvent.change(screen.getByLabelText('Local focus roadmap'), { target: { value: 'abcd' } });

    expect((screen.getByRole('button', { name: /Save local focus/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/4 bytes \/ 3 bytes/i)).toBeTruthy();
  });

  it('disables save when local focus content was truncated by the backend', () => {
    const state = getMockRoadmapState();
    state.context.localSteering = { ...state.context.localSteering, contentTruncated: true };
    const onSaveLocalFocus = vi.fn(async () => state);
    renderPanel({ state, onSaveLocalFocus });

    fireEvent.change(screen.getByLabelText('Local focus roadmap'), { target: { value: 'dirty truncated content' } });

    expect((screen.getByRole('button', { name: /Save local focus/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Saving is disabled to avoid overwriting unsent content/i)).toBeTruthy();
    expect(onSaveLocalFocus).not.toHaveBeenCalled();
  });

  it('resets the draft to saved content and disables save', () => {
    const state = getMockRoadmapState();
    renderPanel({ state });
    const textarea = screen.getByLabelText('Local focus roadmap') as HTMLTextAreaElement;

    fireEvent.change(textarea, { target: { value: 'dirty' } });
    expect((screen.getByRole('button', { name: /Save local focus/i }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /Reset/i }));

    expect(textarea.value).toBe(state.context.localSteering.content);
    expect((screen.getByRole('button', { name: /Save local focus/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('disables recommendation refresh while dirty and only invokes after saved content matches', async () => {
    const state = getMockRoadmapState();
    const onRefreshRecommendations = vi.fn(async () => ({ task: mockActiveRecommendationRefreshTask, entry: { taskId: mockActiveRecommendationRefreshTask.taskId, originalRequest: '', derivedRequest: '', selection: {}, requestedOutputSections: ['recommendations'], createdAt: mockActiveRecommendationRefreshTask.createdAt }, sourceFingerprint: 'fingerprint' }));
    const onSaveLocalFocus = vi.fn(async (input: UpdateRoadmapStateRequest) => ({ ...state, context: { ...state.context, localSteering: { ...state.context.localSteering, content: input.localFocusContent ?? '' } } }));
    const { rerender } = render(<ToastProvider><RoadmapPanel state={state} loading={false} recommendationStatus={mockRecommendationStatusStale} activeRecommendationRefreshTask={null} onSaveLocalFocus={onSaveLocalFocus} onRefreshRecommendations={onRefreshRecommendations} onReloadRoadmap={vi.fn()} /></ToastProvider>);

    fireEvent.change(screen.getByLabelText('Local focus roadmap'), { target: { value: 'dirty' } });
    expect((screen.getByRole('button', { name: /Refresh recommendations from roadmap/i }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Refresh recommendations from roadmap/i }));
    expect(onRefreshRecommendations).not.toHaveBeenCalled();

    const savedState = { ...state, context: { ...state.context, localSteering: { ...state.context.localSteering, content: 'dirty' } } };
    rerender(<ToastProvider><RoadmapPanel state={savedState} loading={false} recommendationStatus={mockRecommendationStatusStale} activeRecommendationRefreshTask={null} onSaveLocalFocus={onSaveLocalFocus} onRefreshRecommendations={onRefreshRecommendations} onReloadRoadmap={vi.fn()} /></ToastProvider>);
    fireEvent.click(screen.getByRole('button', { name: /Refresh recommendations from roadmap/i }));

    await waitFor(() => expect(onRefreshRecommendations).toHaveBeenCalledTimes(1));
  });

  it('keeps recommendation refresh disabled while a local focus save is in flight', async () => {
    const state = getMockRoadmapState();
    let resolveSave!: (value: RoadmapStateResponse) => void;
    const onSaveLocalFocus = vi.fn(() => new Promise<RoadmapStateResponse>((resolve) => { resolveSave = resolve; }));
    const onRefreshRecommendations = vi.fn(async () => ({ task: mockActiveRecommendationRefreshTask, entry: { taskId: mockActiveRecommendationRefreshTask.taskId, originalRequest: '', derivedRequest: '', selection: {}, requestedOutputSections: ['recommendations'], createdAt: mockActiveRecommendationRefreshTask.createdAt }, sourceFingerprint: 'fingerprint' }));
    renderPanel({ state, onSaveLocalFocus, onRefreshRecommendations });

    fireEvent.change(screen.getByLabelText('Local focus roadmap'), { target: { value: '# Local focus\n\nSaving.\n' } });
    fireEvent.click(screen.getByRole('button', { name: /Save local focus/i }));

    await waitFor(() => expect(onSaveLocalFocus).toHaveBeenCalledTimes(1));
    expect((screen.getByRole('button', { name: /Refresh recommendations from roadmap/i }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Refresh recommendations from roadmap/i }));
    expect(onRefreshRecommendations).not.toHaveBeenCalled();

    resolveSave(state);
  });

  it('surfaces source read errors in source rows without treating them as editable shared files', () => {
    const state = getMockRoadmapState();
    state.context.sharedContextSources = [{
      ...state.context.sharedContextSources[0]!,
      exists: true,
      readError: 'Failed to read roadmap source "docs/shared-roadmap.md": permission denied',
      headings: [],
      excerpts: [],
    }];

    renderPanel({ state });

    expect(screen.getByText('read error')).toBeTruthy();
    expect(screen.getByText(/permission denied/i)).toBeTruthy();
    expect(screen.getAllByText('read-only').length).toBeGreaterThan(0);
  });

  it('disables recommendation refresh while an active task is queued or running and displays progress', () => {
    renderPanel({ activeRecommendationRefreshTask: mockActiveRecommendationRefreshTask });

    expect((screen.getByRole('button', { name: /Refresh recommendations from roadmap/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Refreshing recommendations/i)).toBeTruthy();
  });

  it('invokes refresh action and shows a success toast containing the task id', async () => {
    const onRefreshRecommendations = vi.fn(async () => ({ task: mockActiveRecommendationRefreshTask, entry: { taskId: mockActiveRecommendationRefreshTask.taskId, originalRequest: '', derivedRequest: '', selection: {}, requestedOutputSections: ['recommendations'], createdAt: mockActiveRecommendationRefreshTask.createdAt }, sourceFingerprint: 'fingerprint', reused: true }));
    renderPanel({ onRefreshRecommendations });

    fireEvent.click(screen.getByRole('button', { name: /Refresh recommendations from roadmap/i }));

    await waitFor(() => expect(onRefreshRecommendations).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(new RegExp(mockActiveRecommendationRefreshTask.taskId))).toBeTruthy();
  });
});
