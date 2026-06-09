import * as React from 'react';
import { Button } from '@/components/ui/button';
import { useRouter } from '@/router';
import type { Board as BoardData, BoardItem, PlanningAgentTaskRecord, RecommendationModel, RecommendationStatus } from '@/types';
import { Board } from './backlog/board';
import { RecommendationsPanel } from './backlog/recommendations-panel';
import type { GroupMode, StatusFilter } from './backlog/board-model';
import { PlanWithAiPanel } from './backlog/plan-with-ai-panel';
import { usePlanningTaskWorkflows } from './backlog/use-planning-task-workflows';

const GROUP_MODES: GroupMode[] = ['lane', 'epic', 'recommended'];
const STATUS_FILTERS: StatusFilter[] = ['all', 'ready', 'blocked', 'review', 'closed'];

interface BacklogViewProps {
  board: BoardData;
  recommendations: RecommendationModel | null;
  recommendationStatus: RecommendationStatus | null;
  activeRecommendationRefreshTask: PlanningAgentTaskRecord | null;
  onRefresh: () => Promise<void>;
}

export function BacklogView({ board, recommendations, recommendationStatus, activeRecommendationRefreshTask, onRefresh }: BacklogViewProps) {
  const router = useRouter();
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const workflows = usePlanningTaskWorkflows(onRefresh);

  const group = readEnum(router.query.get('group'), GROUP_MODES, 'lane');
  const filter = readEnum(router.query.get('filter'), STATUS_FILTERS, 'all');
  const query = router.query.get('q') ?? '';
  const epicFilter = router.query.get('epic') ?? '';

  const setParam = React.useCallback((key: string, value: string, fallback: string) => {
    router.setQuery((params) => {
      if (!value || value === fallback) params.delete(key);
      else params.set(key, value);
    });
  }, [router]);

  const toggleSelection = React.useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggle = React.useCallback((item: BoardItem) => toggleSelection(item.id), [toggleSelection]);

  // Scroll a backlog card into view in the kanban board. No-op when the item is
  // filtered out of the current view.
  const focusItem = React.useCallback((id: string) => {
    if (typeof document === 'undefined') return;
    document.getElementById(`board-item-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  // Clicking a recommendation toggles it into the current selection (like a
  // kanban card) and scrolls it into view - it does not start a plan. Planning
  // starts from the selection via "Promote to a build plan".
  const pickRecommendationItem = React.useCallback((id: string) => {
    toggleSelection(id);
    focusItem(id);
  }, [toggleSelection, focusItem]);

  // Clicking a recommendation group adds all of its items to the selection and
  // focuses the first one.
  const pickRecommendationItems = React.useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
    focusItem(ids[0]);
  }, [focusItem]);

  const titles = React.useMemo(() => new Map((board.items ?? []).map((item) => [item.id, item.title])), [board.items]);
  const readyById = React.useMemo(() => new Map((board.items ?? []).map((item) => [item.id, item.ready])), [board.items]);
  const selectedIds = Array.from(selected);
  // AI promotion only uses the ready subset of the selection; blocked/closed/non-ready
  // items are excluded and the action is disabled when no ready items remain.
  const selectedReadyIds = React.useMemo(() => Array.from(selected).filter((id) => readyById.get(id) === true), [selected, readyById]);

  const refreshRecommendations = React.useCallback(async () => {
    await workflows.refreshRecommendations();
  }, [workflows]);

  const promoteSelectedReady = async () => {
    if (selectedReadyIds.length === 0) return;
    const task = await workflows.start({ itemIds: selectedReadyIds });
    if (task) setSelected(new Set());
  };

  return (
    <div className="grid gap-4">
      <PlanWithAiPanel workflows={workflows} />
      <RecommendationsPanel
        recommendations={recommendations}
        status={recommendationStatus}
        activeRefreshTask={activeRecommendationRefreshTask}
        titles={titles}
        selected={selected}
        onPickItem={pickRecommendationItem}
        onPickItems={pickRecommendationItems}
        onRefreshRecommendations={refreshRecommendations}
        busy={workflows.busy}
      />
      <Board
        board={board}
        query={query}
        onQuery={(value) => setParam('q', value, '')}
        filter={filter}
        onFilter={(value) => setParam('filter', value, 'all')}
        group={group}
        onGroup={(value) => setParam('group', value, 'lane')}
        epicFilter={epicFilter}
        onEpicFilter={(value) => setParam('epic', value, '')}
        selected={selected}
        onToggle={toggle}
      />
      {selectedIds.length > 0 && (
        <div className="sticky bottom-4 z-20 mx-auto flex items-center gap-3 rounded-full border border-border bg-card px-4 py-2 shadow-lg">
          <span className="text-sm text-muted-foreground">{selectedIds.length} selected{selectedReadyIds.length !== selectedIds.length ? ` · ${selectedReadyIds.length} ready` : ''}</span>
          <Button size="sm" disabled={workflows.busy || selectedReadyIds.length === 0} onClick={() => void promoteSelectedReady()}>Promote to a build plan</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}
    </div>
  );
}

function readEnum<T extends string>(value: string | null, allowed: T[], fallback: T): T {
  return value && (allowed as string[]).includes(value) ? (value as T) : fallback;
}
