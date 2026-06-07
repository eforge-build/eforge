import * as React from 'react';
import { getBridge } from '@/bridge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/toast';
import { useRouter } from '@/router';
import type { Board as BoardData, BoardItem, RecommendationModel } from '@/types';
import { Board } from './backlog/board';
import { RecommendationsPanel } from './backlog/recommendations-panel';
import type { GroupMode, StatusFilter } from './backlog/board-model';

const bridge = getBridge();
const GROUP_MODES: GroupMode[] = ['lane', 'epic', 'recommended'];
const STATUS_FILTERS: StatusFilter[] = ['all', 'ready', 'blocked', 'review', 'closed'];

interface BacklogViewProps {
  board: BoardData;
  recommendations: RecommendationModel | null;
  onRefresh: () => Promise<void>;
}

export function BacklogView({ board, recommendations, onRefresh }: BacklogViewProps) {
  const toast = useToast();
  const router = useRouter();
  const [selected, setSelected] = React.useState<Set<string>>(new Set());

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

  const toggle = (item: BoardItem) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
      return next;
    });
  };

  const promote = async (selection: Record<string, unknown>, label: string) => {
    try {
      const result = await bridge.invokeAction<{ session?: string; sessionPlanPath?: string }>('promote-selection', { status: 'active', ...selection });
      toast.push(`Promoted ${label} → ${result.sessionPlanPath ?? result.session ?? 'a session plan'}.`, 'success');
      setSelected(new Set());
      await onRefresh();
    } catch (caught) {
      toast.push(caught instanceof Error ? caught.message : String(caught), 'error');
    }
  };

  const titles = React.useMemo(() => new Map((board.items ?? []).map((item) => [item.id, item.title])), [board.items]);
  const selectedIds = Array.from(selected);

  return (
    <div className="grid gap-4">
      <RecommendationsPanel recommendations={recommendations} titles={titles} onPromote={promote} />
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
          <span className="text-sm text-muted-foreground">{selectedIds.length} selected</span>
          <Button size="sm" onClick={() => void promote({ itemIds: selectedIds }, `${selectedIds.length} items`)}>Promote as one plan</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}
    </div>
  );
}

function readEnum<T extends string>(value: string | null, allowed: T[], fallback: T): T {
  return value && (allowed as string[]).includes(value) ? (value as T) : fallback;
}
