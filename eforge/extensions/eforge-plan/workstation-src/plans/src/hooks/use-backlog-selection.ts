import * as React from 'react';
import { focusBoardItem } from '@/lib/focus-board-item';
import type { Board, BoardItem } from '@/types';
import type { PlanningTaskWorkflowsApi } from '@/views/backlog/use-planning-task-workflows';

export interface BacklogSelection {
  selected: Set<string>;
  selectedIds: string[];
  selectedReadyIds: string[];
  titles: Map<string, string>;
  readyIds: Set<string>;
  toggle: (id: string) => void;
  toggleItem: (item: BoardItem) => void;
  clear: () => void;
  /** Add/remove a single item and scroll it into view on the board. */
  pickItem: (id: string) => void;
  /** Toggle a whole recommendation group into the selection. */
  pickItems: (ids: string[]) => void;
  /** One-click plan a lane from its ready items, carrying the recommendation ref. */
  planLane: (itemIds: string[], recommendationRef?: string) => Promise<void>;
  /** Promote the ready subset of the current selection into a planning task. */
  promote: () => Promise<void>;
}

/**
 * Backlog selection state, lifted out of the board so the board (work pane) and
 * the recommendations digest (context rail) can share one selection even though
 * they no longer render together. AI promotion always works on the ready subset;
 * blocked/closed items are excluded.
 */
export function useBacklogSelection(board: Board, workflows: PlanningTaskWorkflowsApi): BacklogSelection {
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const items = board.items ?? [];
  const titles = React.useMemo(() => new Map(items.map((item) => [item.id, item.title])), [items]);
  const readyById = React.useMemo(() => new Map(items.map((item) => [item.id, item.ready])), [items]);
  const readyIds = React.useMemo(() => new Set(items.filter((item) => item.ready).map((item) => item.id)), [items]);

  const toggle = React.useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);
  const toggleItem = React.useCallback((item: BoardItem) => toggle(item.id), [toggle]);
  const clear = React.useCallback(() => setSelected(new Set()), []);

  const pickItem = React.useCallback((id: string) => {
    toggle(id);
    focusBoardItem(id);
  }, [toggle]);

  const pickItems = React.useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    setSelected((prev) => {
      // Derive allSelected from prev (not a render-time snapshot of selected) so
      // rapid double-invocations before a re-render still toggle correctly.
      const allSelected = ids.every((id) => prev.has(id));
      const next = new Set(prev);
      for (const id of ids) {
        if (allSelected) next.delete(id); else next.add(id);
      }
      // Focus the first item only when we just added the group.
      if (!allSelected) focusBoardItem(ids[0]);
      return next;
    });
  }, []);

  const selectedIds = React.useMemo(() => Array.from(selected), [selected]);
  const selectedReadyIds = React.useMemo(() => Array.from(selected).filter((id) => readyById.get(id) === true), [selected, readyById]);

  const planLane = React.useCallback(async (itemIds: string[], recommendationRef?: string) => {
    const readyItemIds = itemIds.filter((id) => readyById.get(id) === true);
    if (readyItemIds.length === 0) return;
    await workflows.start({ itemIds: readyItemIds, ...(recommendationRef ? { sourceRecommendationRef: recommendationRef } : {}) });
  }, [readyById, workflows]);

  const promote = React.useCallback(async () => {
    if (selectedReadyIds.length === 0) return;
    const task = await workflows.start({ itemIds: selectedReadyIds });
    if (task) clear();
  }, [selectedReadyIds, workflows, clear]);

  return { selected, selectedIds, selectedReadyIds, titles, readyIds, toggle, toggleItem, clear, pickItem, pickItems, planLane, promote };
}
