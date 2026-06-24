import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { mockSearchResults } from '@/fixtures/mock-storage';
import type { EforgeBridge, SearchPlanningRecordsResponse } from '@/types';
import { PlanningSearchPanel } from './planning-search-panel';

function setBridge(bridge: EforgeBridge) { (window as Window & { eforge?: EforgeBridge }).eforge = bridge; }

describe('PlanningSearchPanel', () => {
  it('invokes bounded planning search and navigates item/plan results', async () => {
    const calls: unknown[] = [];
    const openItem = vi.fn(); const openPlan = vi.fn();
    setBridge({ async invokeAction<TOutput>(actionId: string, input?: unknown): Promise<TOutput> { calls.push({ actionId, input }); return mockSearchResults as TOutput; } });
    render(<PlanningSearchPanel openItem={openItem} openPlan={openPlan} />);
    fireEvent.click(screen.getByText('Search'));
    expect(calls).toEqual([]);
    fireEvent.change(screen.getByLabelText('Search planning records'), { target: { value: 'import' } });
    fireEvent.click(screen.getByText('Search'));
    await waitFor(() => expect(screen.getByText('Add import preview')).toBeTruthy());
    expect(calls).toContainEqual({ actionId: 'search-planning-records', input: expect.objectContaining({ query: 'import', limit: 20 }) });
    expect(calls).toContainEqual({ actionId: 'search-planning-records', input: expect.objectContaining({ fields: ['rank', 'snippet', 'refs', 'updatedAt'], types: ['backlog_item', 'epic', 'session_plan', 'recommendation'] }) });
    expect(screen.getByText(/Search index dirty/)).toBeTruthy();
    expect(screen.getByText(/3 documents need rebuild/)).toBeTruthy();
    expect(screen.getByText('backlog item: 1')).toBeTruthy();
    expect(screen.getByText('epic: 1')).toBeTruthy();
    expect(screen.getByText('session plan: 1')).toBeTruthy();
    expect(screen.getByText('recommendation: 1')).toBeTruthy();
    expect(screen.getByText('Planning workstation')).toBeTruthy();
    expect(screen.getByText('Recommend import preview')).toBeTruthy();
    fireEvent.click(screen.getByText('Add import preview'));
    expect(openItem).toHaveBeenCalledWith('add-import-preview');
    fireEvent.click(screen.getByText('Import preview plan'));
    expect(openPlan).toHaveBeenCalledWith('plan:2026-06-07-import-preview');
  });

  it('sends selected type filters and paginates using bounded offsets', async () => {
    const calls: Array<{ actionId: string; input?: unknown }> = [];
    const firstPage: SearchPlanningRecordsResponse = { ...mockSearchResults, results: mockSearchResults.results.slice(0, 2), total: 4, page: { limit: 20, offset: 0, returned: 2, hasMore: true, nextOffset: 2 } };
    const secondPage: SearchPlanningRecordsResponse = { ...mockSearchResults, results: mockSearchResults.results.slice(2), total: 4, page: { limit: 20, offset: 2, returned: 2, hasMore: false } };
    setBridge({ async invokeAction<TOutput>(actionId: string, input?: unknown): Promise<TOutput> { calls.push({ actionId, input }); return (calls.length === 1 ? firstPage : secondPage) as TOutput; } });
    render(<PlanningSearchPanel openItem={vi.fn()} openPlan={vi.fn()} />);

    fireEvent.click(screen.getByLabelText('epic'));
    fireEvent.change(screen.getByLabelText('Search planning records'), { target: { value: 'preview' } });
    fireEvent.click(screen.getByText('Search'));
    await waitFor(() => expect(screen.getByText('2 of 4 results · offset 0')).toBeTruthy());
    expect(calls[0]).toEqual({ actionId: 'search-planning-records', input: expect.objectContaining({ query: 'preview', limit: 20, offset: 0, types: ['backlog_item', 'session_plan', 'recommendation'] }) });

    fireEvent.click(screen.getByText('Next'));
    await waitFor(() => expect(screen.getByText('2 of 4 results · offset 2')).toBeTruthy());
    expect(calls[1]).toEqual({ actionId: 'search-planning-records', input: expect.objectContaining({ query: 'preview', limit: 20, offset: 2 }) });
  });
});
