import * as React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Board as BoardData, BoardItem } from '@/types';
import { Board } from './board';

function item(overrides: Partial<BoardItem>): BoardItem {
  return {
    id: 'item-1',
    title: 'Item',
    status: 'open',
    priority: 'medium',
    tags: [],
    lane: 'ready',
    reasons: [],
    unresolvedDependsOn: [],
    activeTraceReasons: [],
    blocked: false,
    ready: true,
    reviewDue: false,
    closed: false,
    dependencies: [],
    dependents: [],
    notes: { claim: '', evidence: '', recheck: '', promotionPaths: '' },
    recLanes: [],
    ...overrides,
  };
}

function renderBoard(board: BoardData, props: Partial<React.ComponentProps<typeof Board>> = {}) {
  const defaults: React.ComponentProps<typeof Board> = {
    board,
    query: '',
    onQuery: () => {},
    filter: 'all',
    onFilter: () => {},
    group: 'lane',
    onGroup: () => {},
    epicFilter: '',
    onEpicFilter: () => {},
    selected: new Set(),
    onToggle: () => {},
    onOpenDetail: () => {},
    onOpenEpic: () => {},
  };

  return render(<Board {...defaults} {...props} />);
}

describe('Board compact closed-lane loading', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('renders closed lane count rails and requests explicit compact lane loads from closed UI actions', () => {
    const open = item({ id: 'open-work', title: 'Open work' });
    const board: BoardData = {
      items: [open],
      lanes: [
        { lane: 'ready', title: 'Ready', items: [open], count: 1, openCount: 1, closedCount: 0 },
        { lane: 'done', title: 'Done', items: [], count: 3, openCount: 0, closedCount: 3 },
        { lane: 'archive', title: 'Archive', items: [], count: 2, openCount: 0, closedCount: 2 },
      ],
      counts: { total: 6, open: 1, closed: 5 },
    };
    const onFilter = vi.fn();
    const onLoadClosedLane = vi.fn().mockResolvedValue(undefined);

    renderBoard(board, { onFilter, onLoadClosedLane });

    expect(screen.getByTitle('Expand Done (3)')).toBeTruthy();
    expect(screen.getByTitle('Expand Archive (2)')).toBeTruthy();
    expect(onLoadClosedLane).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Closed'));
    expect(onLoadClosedLane).toHaveBeenCalledWith('done');
    expect(onLoadClosedLane).toHaveBeenCalledWith('archive');
    expect(onLoadClosedLane).toHaveBeenCalledTimes(2);
    expect(onFilter).toHaveBeenCalledWith('closed');

    fireEvent.click(screen.getByTitle('Expand Done (3)'));
    expect(onLoadClosedLane).toHaveBeenCalledWith('done');
    expect(onLoadClosedLane).toHaveBeenCalledTimes(3);
  });

  it('requests closed lanes when mounted with the closed filter from query state', async () => {
    const board: BoardData = {
      items: [],
      lanes: [
        { lane: 'done', title: 'Done', items: [], count: 3, openCount: 0, closedCount: 3 },
        { lane: 'archive', title: 'Archive', items: [], count: 2, openCount: 0, closedCount: 2 },
      ],
      counts: { total: 5, open: 0, closed: 5 },
    };
    const onLoadClosedLane = vi.fn().mockResolvedValue(undefined);

    renderBoard(board, { filter: 'closed', onLoadClosedLane });

    await waitFor(() => expect(onLoadClosedLane).toHaveBeenCalledTimes(2));
    expect(onLoadClosedLane).toHaveBeenCalledWith('done');
    expect(onLoadClosedLane).toHaveBeenCalledWith('archive');
    expect(screen.getByTitle('Expand Done (3)')).toBeTruthy();
  });

  it('loads one missing page for persisted expanded closed lanes without draining pagination', async () => {
    window.localStorage.setItem('eforge-plan:board:expanded-closed', JSON.stringify(['done']));
    const board: BoardData = {
      items: [],
      lanes: [
        { lane: 'done', title: 'Done', items: [], count: 10, openCount: 0, closedCount: 10, pagination: { limit: 5, offset: 0, returned: 0, hasMore: true, nextOffset: 0 } },
      ],
      counts: { total: 10, open: 0, closed: 10 },
    };
    const onLoadClosedLane = vi.fn().mockResolvedValue(undefined);

    const { rerender } = renderBoard(board, { onLoadClosedLane });

    await waitFor(() => expect(onLoadClosedLane).toHaveBeenCalledTimes(1));
    expect(onLoadClosedLane).toHaveBeenCalledWith('done');

    rerender(<Board
      board={{ ...board, lanes: [{ ...board.lanes[0]!, pagination: { limit: 5, offset: 0, returned: 5, hasMore: true, nextOffset: 5 } }] }}
      query=""
      onQuery={() => {}}
      filter="all"
      onFilter={() => {}}
      group="lane"
      onGroup={() => {}}
      epicFilter=""
      onEpicFilter={() => {}}
      selected={new Set()}
      onToggle={() => {}}
      onOpenDetail={() => {}}
      onOpenEpic={() => {}}
      onLoadClosedLane={onLoadClosedLane}
    />);
    expect(onLoadClosedLane).toHaveBeenCalledTimes(1);
  });

  it('surfaces continuation text when an expanded closed lane page is partial', () => {
    window.localStorage.setItem('eforge-plan:board:expanded-closed', JSON.stringify(['done']));
    const board: BoardData = {
      items: [],
      lanes: [
        {
          lane: 'done',
          title: 'Done',
          items: [],
          count: 10,
          openCount: 0,
          closedCount: 10,
          pagination: { limit: 5, offset: 0, returned: 5, hasMore: true, nextOffset: 5 },
        },
      ],
      counts: { total: 10, open: 0, closed: 10 },
    };

    renderBoard(board);

    expect(screen.getByText('More items available. Expand again or refresh to load the next page.')).toBeTruthy();
    expect(screen.getByText('Cards not loaded yet')).toBeTruthy();
  });
});
