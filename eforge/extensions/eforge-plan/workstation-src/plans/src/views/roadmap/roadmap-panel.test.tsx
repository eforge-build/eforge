import * as React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/toast';
import { getMockRoadmapState } from '@/fixtures/mock-roadmap';
import { mockActiveRecommendationRefreshTask, mockRecommendationFreshnessFresh, mockRecommendationFreshnessMissing, mockRecommendationFreshnessStale, mockRecommendationStatusStale } from '@/fixtures/mock-data';
import type { RoadmapStateResponse, UpdateRoadmapStateRequest } from '@/types';
import { RoadmapContextRail, RoadmapFocus } from './roadmap-panel';

function mockRefresh() {
  return { task: mockActiveRecommendationRefreshTask, entry: { taskId: mockActiveRecommendationRefreshTask.taskId, originalRequest: '', derivedRequest: '', selection: {}, requestedOutputSections: ['recommendations'], createdAt: mockActiveRecommendationRefreshTask.createdAt }, sourceFingerprint: 'fingerprint' };
}

function renderFocus(overrides: Partial<React.ComponentProps<typeof RoadmapFocus>> = {}) {
  const state = getMockRoadmapState();
  const props: React.ComponentProps<typeof RoadmapFocus> = {
    state,
    recommendationStatus: mockRecommendationStatusStale,
    recommendationFreshness: mockRecommendationFreshnessStale,
    activeRecommendationRefreshTask: null,
    onSaveLocalFocus: vi.fn(async () => state),
    onRefreshRecommendations: vi.fn(async () => mockRefresh()),
    ...overrides,
  };
  return { ...render(<ToastProvider><RoadmapFocus {...props} /></ToastProvider>), props };
}

function enterRoadmapEdit() {
  fireEvent.click(screen.getByRole('button', { name: /Edit/i }));
  return screen.getByLabelText('Local focus roadmap') as HTMLTextAreaElement;
}

function renderRail(overrides: Partial<React.ComponentProps<typeof RoadmapContextRail>> = {}) {
  const state = getMockRoadmapState();
  const props: React.ComponentProps<typeof RoadmapContextRail> = {
    state,
    loading: false,
    recommendationStatus: mockRecommendationStatusStale,
    recommendationFreshness: mockRecommendationFreshnessStale,
    activeRecommendationRefreshTask: null,
    onReloadRoadmap: vi.fn(async () => undefined),
    ...overrides,
  };
  return { ...render(<RoadmapContextRail {...props} />), props };
}

describe('RoadmapContextRail', () => {
  it('renders recommendation summary chips from server freshness states', () => {
    const { rerender } = renderRail({ recommendationFreshness: mockRecommendationFreshnessMissing });
    expect(screen.getByText('recommendations missing')).toBeTruthy();

    rerender(<RoadmapContextRail state={getMockRoadmapState()} loading={false} recommendationStatus={mockRecommendationStatusStale} recommendationFreshness={mockRecommendationFreshnessFresh} activeRecommendationRefreshTask={null} onReloadRoadmap={vi.fn()} />);
    expect(screen.getByText('recommendations fresh')).toBeTruthy();

    rerender(<RoadmapContextRail state={getMockRoadmapState()} loading={false} recommendationStatus={mockRecommendationStatusStale} recommendationFreshness={mockRecommendationFreshnessStale} activeRecommendationRefreshTask={null} onReloadRoadmap={vi.fn()} />);
    expect(screen.getByText('recommendations stale')).toBeTruthy();
  });

  it('renders separate source status sections, metadata, and docs/roadmap.md only in a discovered row', () => {
    const state = getMockRoadmapState();
    const projectedLocalFocusPath = 'projected://local-focus-roadmap.md';
    state.storagePaths.localFocus = projectedLocalFocusPath;
    state.context.localSteering = { ...state.context.localSteering, path: projectedLocalFocusPath };
    renderRail({ state });

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

  it('surfaces source read errors in source rows without treating them as editable shared files', () => {
    const state = getMockRoadmapState();
    state.context.sharedContextSources = [{
      ...state.context.sharedContextSources[0]!,
      exists: true,
      readError: 'Failed to read roadmap source "docs/shared-roadmap.md": permission denied',
      headings: [],
      excerpts: [],
    }];

    renderRail({ state });

    expect(screen.getByText('read error')).toBeTruthy();
    expect(screen.getByText(/permission denied/i)).toBeTruthy();
    expect(screen.getAllByText('read-only').length).toBeGreaterThan(0);
  });

  it('renders read-only source Markdown without edit controls', () => {
    renderRail();

    expect(screen.getByRole('heading', { name: 'Shared priorities' })).toBeTruthy();
    expect(screen.getByText('source', { selector: 'code' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Roadmap' })).toBeTruthy();
    expect(screen.getByText('read-only', { selector: 'strong' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Edit/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Save/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Cancel$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Reset/i })).toBeNull();
  });

  it('disables reload while loading and invokes it otherwise', () => {
    const onReloadRoadmap = vi.fn(async () => undefined);
    renderRail({ onReloadRoadmap });
    fireEvent.click(screen.getByRole('button', { name: /Reload/i }));
    expect(onReloadRoadmap).toHaveBeenCalledTimes(1);
  });
});

describe('RoadmapFocus', () => {
  it('renders local focus Markdown read mode by default and hides edit controls', () => {
    const state = getMockRoadmapState();
    renderFocus({ state });
    expect(screen.getByRole('heading', { name: 'Local focus' })).toBeTruthy();
    expect(screen.getByRole('list')).toBeTruthy();
    expect(screen.getByText('roadmap', { selector: 'code' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'docs' }).getAttribute('href')).toBe('https://example.test/docs');
    expect(screen.queryByLabelText('Local focus roadmap')).toBeNull();
    expect(screen.queryByRole('button', { name: /Save local focus/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Cancel$/i })).toBeNull();
  });

  it('requires explicit discard before dirty cancel leaves edit mode', () => {
    renderFocus();
    const textarea = enterRoadmapEdit();
    fireEvent.change(textarea, { target: { value: 'dirty' } });
    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));
    expect(screen.getByLabelText('Local focus roadmap')).toBeTruthy();
    expect((screen.getByLabelText('Local focus roadmap') as HTMLTextAreaElement).value).toBe('dirty');
    fireEvent.click(screen.getByRole('button', { name: /Discard edits/i }));
    expect(screen.queryByLabelText('Local focus roadmap')).toBeNull();
    expect(screen.queryByText('dirty')).toBeNull();
  });

  it('hides edit controls for read-only local focus projections', () => {
    const state = getMockRoadmapState();
    state.context.localSteering = { ...state.context.localSteering, editable: false };
    renderFocus({ state });
    expect(screen.queryByRole('button', { name: /Edit/i })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Local focus' })).toBeTruthy();
  });

  it('saves local focus content with the current expected hash and no sharedSources key', async () => {
    const initialState = getMockRoadmapState();
    const onSaveLocalFocus = vi.fn(async (input: UpdateRoadmapStateRequest): Promise<RoadmapStateResponse> => ({ ...initialState, context: { ...initialState.context, localSteering: { ...initialState.context.localSteering, content: input.localFocusContent ?? '' } } }));
    function StatefulFocus() {
      const [state, setState] = React.useState(initialState);
      return <RoadmapFocus state={state} recommendationStatus={mockRecommendationStatusStale} recommendationFreshness={mockRecommendationFreshnessStale} activeRecommendationRefreshTask={null} onSaveLocalFocus={async (input) => { const next = await onSaveLocalFocus(input); setState(next); return next; }} onRefreshRecommendations={vi.fn(async () => mockRefresh())} />;
    }
    render(<ToastProvider><StatefulFocus /></ToastProvider>);

    fireEvent.change(enterRoadmapEdit(), { target: { value: '# Local focus\n\nChanged.\n' } });
    fireEvent.click(screen.getByRole('button', { name: /Save local focus/i }));

    await waitFor(() => expect(onSaveLocalFocus).toHaveBeenCalledTimes(1));
    expect(onSaveLocalFocus.mock.calls[0]![0]).toMatchObject({ localFocusContent: '# Local focus\n\nChanged.\n', expectedLocalFocusSha256: initialState.context.localSteering.sha256 });
    expect(onSaveLocalFocus.mock.calls[0]![0]).not.toHaveProperty('sharedSources');
    await waitFor(() => expect(screen.queryByLabelText('Local focus roadmap')).toBeNull());
    expect(screen.queryByRole('button', { name: /Save local focus/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Cancel$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Reset/i })).toBeNull();
    expect(screen.getByRole('button', { name: /Edit/i })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Local focus' })).toBeTruthy();
    expect(screen.getByText(/Changed\./i)).toBeTruthy();
  });

  it('exits edit mode when the local focus projection becomes read-only', async () => {
    const state = getMockRoadmapState();
    const { rerender } = render(<ToastProvider><RoadmapFocus state={state} recommendationStatus={mockRecommendationStatusStale} recommendationFreshness={mockRecommendationFreshnessStale} activeRecommendationRefreshTask={null} onSaveLocalFocus={vi.fn()} onRefreshRecommendations={vi.fn()} /></ToastProvider>);
    fireEvent.change(enterRoadmapEdit(), { target: { value: 'dirty' } });
    const readonlyState = { ...state, context: { ...state.context, localSteering: { ...state.context.localSteering, editable: false } } };
    rerender(<ToastProvider><RoadmapFocus state={readonlyState} recommendationStatus={mockRecommendationStatusStale} recommendationFreshness={mockRecommendationFreshnessStale} activeRecommendationRefreshTask={null} onSaveLocalFocus={vi.fn()} onRefreshRecommendations={vi.fn()} /></ToastProvider>);

    await waitFor(() => expect(screen.queryByLabelText('Local focus roadmap')).toBeNull());
    expect(screen.queryByRole('button', { name: /Save local focus/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Edit/i })).toBeNull();
  });

  it('disables save for over-limit local focus content and displays byte feedback', () => {
    const state = getMockRoadmapState();
    state.context.localSteering = { ...state.context.localSteering, maxContentBytes: 3 };
    renderFocus({ state });

    fireEvent.change(enterRoadmapEdit(), { target: { value: 'abcd' } });

    expect((screen.getByRole('button', { name: /Save local focus/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/4 bytes \/ 3 bytes/i)).toBeTruthy();
  });

  it('disables save when local focus content was truncated by the backend', () => {
    const state = getMockRoadmapState();
    state.context.localSteering = { ...state.context.localSteering, contentTruncated: true };
    const onSaveLocalFocus = vi.fn(async () => state);
    renderFocus({ state, onSaveLocalFocus });

    fireEvent.change(enterRoadmapEdit(), { target: { value: 'dirty truncated content' } });

    expect((screen.getByRole('button', { name: /Save local focus/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Saving is disabled to avoid overwriting unsent content/i)).toBeTruthy();
    expect(onSaveLocalFocus).not.toHaveBeenCalled();
  });

  it('resets the draft to saved content and disables save', () => {
    const state = getMockRoadmapState();
    renderFocus({ state });
    const textarea = enterRoadmapEdit();

    fireEvent.change(textarea, { target: { value: 'dirty' } });
    expect((screen.getByRole('button', { name: /Save local focus/i }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /Reset/i }));

    expect(textarea.value).toBe(state.context.localSteering.content);
    expect((screen.getByRole('button', { name: /Save local focus/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('disables recommendation refresh while dirty and only invokes after saved content matches', async () => {
    const state = getMockRoadmapState();
    const onRefreshRecommendations = vi.fn(async () => mockRefresh());
    const onSaveLocalFocus = vi.fn(async (input: UpdateRoadmapStateRequest) => ({ ...state, context: { ...state.context, localSteering: { ...state.context.localSteering, content: input.localFocusContent ?? '' } } }));
    const { rerender } = render(<ToastProvider><RoadmapFocus state={state} recommendationStatus={mockRecommendationStatusStale} recommendationFreshness={mockRecommendationFreshnessStale} activeRecommendationRefreshTask={null} onSaveLocalFocus={onSaveLocalFocus} onRefreshRecommendations={onRefreshRecommendations} /></ToastProvider>);

    fireEvent.change(enterRoadmapEdit(), { target: { value: 'dirty' } });
    expect((screen.getByRole('button', { name: /Refresh recommendations from roadmap/i }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Refresh recommendations from roadmap/i }));
    expect(onRefreshRecommendations).not.toHaveBeenCalled();

    const savedState = { ...state, context: { ...state.context, localSteering: { ...state.context.localSteering, content: 'dirty' } } };
    rerender(<ToastProvider><RoadmapFocus state={savedState} recommendationStatus={mockRecommendationStatusStale} recommendationFreshness={mockRecommendationFreshnessStale} activeRecommendationRefreshTask={null} onSaveLocalFocus={onSaveLocalFocus} onRefreshRecommendations={onRefreshRecommendations} /></ToastProvider>);
    fireEvent.click(screen.getByRole('button', { name: /Refresh recommendations from roadmap/i }));

    await waitFor(() => expect(onRefreshRecommendations).toHaveBeenCalledTimes(1));
  });

  it('keeps recommendation refresh disabled while a local focus save is in flight', async () => {
    const state = getMockRoadmapState();
    let resolveSave!: (value: RoadmapStateResponse) => void;
    const onSaveLocalFocus = vi.fn(() => new Promise<RoadmapStateResponse>((resolve) => { resolveSave = resolve; }));
    const onRefreshRecommendations = vi.fn(async () => mockRefresh());
    renderFocus({ state, onSaveLocalFocus, onRefreshRecommendations });

    fireEvent.change(enterRoadmapEdit(), { target: { value: '# Local focus\n\nSaving.\n' } });
    fireEvent.click(screen.getByRole('button', { name: /Save local focus/i }));

    await waitFor(() => expect(onSaveLocalFocus).toHaveBeenCalledTimes(1));
    expect((screen.getByRole('button', { name: /Refresh recommendations from roadmap/i }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Refresh recommendations from roadmap/i }));
    expect(onRefreshRecommendations).not.toHaveBeenCalled();

    resolveSave(state);
  });

  it('disables recommendation refresh while an active task is queued or running and displays progress', () => {
    renderFocus({ activeRecommendationRefreshTask: mockActiveRecommendationRefreshTask });

    expect((screen.getByRole('button', { name: /Refresh recommendations from roadmap/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Refreshing recommendations/i)).toBeTruthy();
  });

  it('invokes refresh action and shows a success toast containing the task id', async () => {
    const onRefreshRecommendations = vi.fn(async () => ({ ...mockRefresh(), reused: true }));
    renderFocus({ onRefreshRecommendations });

    fireEvent.click(screen.getByRole('button', { name: /Refresh recommendations from roadmap/i }));

    await waitFor(() => expect(onRefreshRecommendations).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(new RegExp(mockActiveRecommendationRefreshTask.taskId))).toBeTruthy();
  });
});
