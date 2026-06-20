import * as React from 'react';
import { useRouter } from '@/router';
import type { Board as BoardData } from '@/types';
import { Board } from './backlog/board';
import { ItemDrawer } from './backlog/item-drawer';
import { EpicDrawer } from './backlog/epic-drawer';
import type { GroupMode, StatusFilter } from './backlog/board-model';
import type { BacklogSelection } from '@/hooks/use-backlog-selection';
import { usePlanNavigation, type PlanLink } from '@/lib/plan-links';

const GROUP_MODES: GroupMode[] = ['lane', 'epic', 'recommended'];
const STATUS_FILTERS: StatusFilter[] = ['all', 'open', 'ready', 'blocked', 'review', 'closed'];

interface BoardFocusProps {
  board: BoardData;
  selection: BacklogSelection;
  itemPlanIndex: Map<string, PlanLink[]>;
  onRefresh: () => Promise<void>;
  onLoadMoreBoard?: () => Promise<void>;
  onLoadClosedLane?: (lane: string) => Promise<void>;
}

/**
 * The candidate work surface: just the kanban board, its toolbar, and detail
 * drawers. Selection (the "Build plan" staging card) and planning controls live
 * in the rail, so the board is the clear focal point here.
 */
export function BoardFocus({ board, selection, itemPlanIndex, onRefresh, onLoadMoreBoard, onLoadClosedLane }: BoardFocusProps) {
  const router = useRouter();
  const nav = usePlanNavigation();
  // The item drawer is URL-driven (`?item=`) so a plan's source chip can deep
  // link straight to a backlog card. The epic drawer stays local - it has no
  // cross-link entry point yet.
  const detailItemId = router.query.get('item');
  const setDetailItem = React.useCallback((id: string | null) => {
    router.setQuery((params) => { if (id) params.set('item', id); else params.delete('item'); });
  }, [router]);
  const [detailEpicId, setDetailEpicId] = React.useState<string | null>(null);
  const detailItem = React.useMemo(
    () => (detailItemId ? (board.items ?? []).find((item) => item.id === detailItemId) ?? null : null),
    [board.items, detailItemId],
  );

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

  return (
    <div className="grid gap-4">
      <Board
        board={board}
        itemPlanIndex={itemPlanIndex}
        onOpenPlan={nav.openPlan}
        query={query}
        onQuery={(value) => setParam('q', value, '')}
        filter={filter}
        onFilter={(value) => setParam('filter', value, 'all')}
        group={group}
        onGroup={(value) => setParam('group', value, 'lane')}
        epicFilter={epicFilter}
        onEpicFilter={(value) => setParam('epic', value, '')}
        selected={selection.selected}
        onToggle={selection.toggleItem}
        onOpenDetail={(item) => { setDetailEpicId(null); setDetailItem(item.id); }}
        onOpenEpic={(epicId) => { setDetailItem(null); setDetailEpicId(epicId); }}
        onLoadMoreBoard={onLoadMoreBoard}
        onLoadClosedLane={onLoadClosedLane}
      />
      {detailItem && (
        <ItemDrawer
          item={detailItem}
          epics={board.epics ?? []}
          plans={itemPlanIndex.get(detailItem.id) ?? []}
          onOpenPlan={nav.openPlan}
          onClose={() => setDetailItem(null)}
          onRefresh={onRefresh}
          selectedItemIds={selection.selectedIds}
        />
      )}
      {detailEpicId && <EpicDrawer epicId={detailEpicId} onClose={() => setDetailEpicId(null)} />}
    </div>
  );
}

function readEnum<T extends string>(value: string | null, allowed: T[], fallback: T): T {
  return value && (allowed as string[]).includes(value) ? (value as T) : fallback;
}
