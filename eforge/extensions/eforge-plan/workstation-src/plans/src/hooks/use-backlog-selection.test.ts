import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Board, BoardItem } from '@/types';
import type { PlanningTaskWorkflowsApi } from '@/views/backlog/use-planning-task-workflows';
import { useBacklogSelection } from './use-backlog-selection';

function item(id: string, fallbackPlanEligible: boolean, backendPlanEligible?: boolean): BoardItem {
  return {
    id, title: `Title ${id}`, status: fallbackPlanEligible ? 'candidate' : 'planned', priority: 'medium', tags: [], lane: fallbackPlanEligible ? 'inbox' : 'ready',
    reasons: [fallbackPlanEligible ? 'candidate-no-evidence' : 'planned-session-plan'], reasonCodes: [fallbackPlanEligible ? 'candidate-no-evidence' : 'planned-session-plan'],
    unresolvedDependsOn: [], activeTraceReasons: [], blocked: false,
    ready: !fallbackPlanEligible, reviewDue: false, closed: false, dependencies: [], dependents: [],
    notes: { claim: '', evidence: '', recheck: '', promotionPaths: '' }, recLanes: [],
    ...(backendPlanEligible !== undefined ? { planEligible: backendPlanEligible } : {}),
  };
}

function board(items: BoardItem[]): Board {
  return { lanes: [], items };
}

// Stub the one workflow method the hook touches (start). The rest of the API is
// never invoked by useBacklogSelection, so we cast a partial through unknown.
function stubWorkflows(startResult: unknown = { id: 'task-1' }) {
  const start = vi.fn(async () => startResult);
  const api = { start } as unknown as PlanningTaskWorkflowsApi;
  return { api, start };
}

describe('useBacklogSelection', () => {
  it('toggles a single item in and out of the selection', () => {
    const { api } = stubWorkflows();
    const { result } = renderHook(() => useBacklogSelection(board([item('a', true)]), api));
    act(() => result.current.toggle('a'));
    expect(result.current.selectedIds).toEqual(['a']);
    act(() => result.current.toggle('a'));
    expect(result.current.selectedIds).toEqual([]);
  });

  it('pickItems toggles a whole group on, then off when all are already selected', () => {
    const { api } = stubWorkflows();
    const { result } = renderHook(() => useBacklogSelection(board([item('a', true), item('b', true)]), api));
    act(() => result.current.pickItems(['a', 'b']));
    expect([...result.current.selected].sort()).toEqual(['a', 'b']);
    act(() => result.current.pickItems(['a', 'b']));
    expect(result.current.selected.size).toBe(0);
  });

  it('pickItems stays correct across rapid double-invocation before a re-render', () => {
    const { api } = stubWorkflows();
    const { result } = renderHook(() => useBacklogSelection(board([item('a', true)]), api));
    // Both calls run inside one act() flush; the second must observe the first's
    // effect (allSelected derived from prev), ending selected rather than empty.
    act(() => {
      result.current.pickItems(['a']);
      result.current.pickItems(['a']);
    });
    expect(result.current.selectedIds).toEqual([]);
  });

  it('exposes only the backend plan-eligible subset of the selection when present', () => {
    const { api } = stubWorkflows();
    const backendEligibleDespiteFallback = item('a', false, true);
    const backendIneligibleDespiteFallback = item('b', true, false);
    const { result } = renderHook(() => useBacklogSelection(board([backendEligibleDespiteFallback, backendIneligibleDespiteFallback]), api));
    act(() => { result.current.toggle('a'); result.current.toggle('b'); });
    expect([...result.current.selectedPlanEligibleIds].sort()).toEqual(['a']);
    expect([...result.current.planEligibleIds].sort()).toEqual(['a']);
  });

  it('promote starts a task on the plan-eligible subset and clears the selection on success', async () => {
    const { api, start } = stubWorkflows({ id: 'task-1' });
    const { result } = renderHook(() => useBacklogSelection(board([item('a', true), item('b', false)]), api));
    act(() => { result.current.toggle('a'); result.current.toggle('b'); });
    await act(async () => { await result.current.promote(); });
    expect(start).toHaveBeenCalledWith({ itemIds: ['a'] });
    expect(result.current.selected.size).toBe(0);
  });

  it('promote keeps the selection when no eligible items are selected', async () => {
    const { api, start } = stubWorkflows();
    const { result } = renderHook(() => useBacklogSelection(board([item('b', false)]), api));
    act(() => result.current.toggle('b'));
    await act(async () => { await result.current.promote(); });
    expect(start).not.toHaveBeenCalled();
    expect(result.current.selectedIds).toEqual(['b']);
  });

  it('planLane carries the recommendation ref and only backend-eligible items', async () => {
    const { api, start } = stubWorkflows();
    const { result } = renderHook(() => useBacklogSelection(board([item('a', false, true), item('b', true, false)]), api));
    await act(async () => { await result.current.planLane(['a', 'b'], 'rec-1'); });
    expect(start).toHaveBeenCalledWith({ itemIds: ['a'], sourceRecommendationRef: 'rec-1' });
  });
});
