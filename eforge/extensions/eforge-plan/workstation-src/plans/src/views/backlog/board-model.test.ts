import { describe, expect, it } from 'vitest';
import type { Board, BoardItem } from '@/types';
import { buildColumns, matchesFilter, standaloneEpics } from './board-model';

function item(overrides: Partial<BoardItem>): BoardItem {
  return {
    id: 'item-1',
    title: 'Item',
    status: 'open',
    priority: 'medium',
    tags: [],
    lane: 'inbox',
    reasons: [],
    unresolvedDependsOn: [],
    activeTraceReasons: [],
    blocked: false,
    ready: false,
    reviewDue: false,
    closed: false,
    dependencies: [],
    dependents: [],
    notes: {},
    recLanes: [],
    ...overrides,
  } as BoardItem;
}

describe('matchesFilter', () => {
  it('treats open as not-closed', () => {
    expect(matchesFilter(item({ closed: false }), 'open')).toBe(true);
    expect(matchesFilter(item({ closed: true }), 'open')).toBe(false);
  });

  it('excludes closed items from the blocked filter so results match the open-only count pill', () => {
    expect(matchesFilter(item({ blocked: true, closed: false }), 'blocked')).toBe(true);
    // Closed items keep their blocked flag, but the filter means actionable blocked work.
    expect(matchesFilter(item({ blocked: true, closed: true }), 'blocked')).toBe(false);
  });
});

describe('standaloneEpics', () => {
  it('keeps only item-less epics that carry body content, sorted by title', () => {
    const epics = [
      { id: 'has-items', title: 'Has items', itemCount: 2, openItemCount: 1, hasBody: true },
      { id: 'empty-shell', title: 'Empty shell', itemCount: 0, openItemCount: 0, hasBody: false },
      { id: 'zeta-horizon', title: 'Zeta horizon', itemCount: 0, openItemCount: 0, hasBody: true },
      { id: 'alpha-horizon', title: 'Alpha horizon', itemCount: 0, openItemCount: 0, hasBody: true },
    ];
    expect(standaloneEpics(epics).map((epic) => epic.id)).toEqual(['alpha-horizon', 'zeta-horizon']);
  });

  it('treats closed-only epics with body as standalone when no items remain open', () => {
    const epics = [{ id: 'closed-out', title: 'Closed out', itemCount: 3, openItemCount: 0, hasBody: true }];
    // openItemCount wins over itemCount: a fully-closed epic with notes still reads as horizon.
    expect(standaloneEpics(epics).map((epic) => epic.id)).toEqual(['closed-out']);
  });
});

describe('compact board columns', () => {
  it('keeps count-only done and archive lanes as collapsed rail candidates', () => {
    const board: Board = {
      items: [],
      lanes: [
        { lane: 'done', title: 'Done', items: [], count: 3, closedCount: 3, openCount: 0 },
        { lane: 'archive', title: 'Archive', items: [], count: 2, closedCount: 2, openCount: 0 },
      ],
      counts: { total: 5, open: 0, closed: 5 },
    };

    expect(buildColumns(board, [], 'lane')).toEqual([
      expect.objectContaining({ key: 'done', count: 3, items: [] }),
      expect.objectContaining({ key: 'archive', count: 2, items: [] }),
    ]);
  });

  it('groups compact cards by lane, epic, and recommendation', () => {
    const ready = item({ id: 'ready', title: 'Ready', lane: 'ready', epic: 'epic-one', epicRef: { id: 'epic-one', title: 'Epic One', missing: false }, recRank: 1 });
    const blocked = item({ id: 'blocked', title: 'Blocked', lane: 'blocked', blocked: true });
    const board: Board = { items: [ready, blocked], lanes: [{ lane: 'ready', title: 'Ready', items: [ready], count: 1 }, { lane: 'blocked', title: 'Blocked', items: [blocked], count: 1 }], epics: [] };

    expect(buildColumns(board, board.items, 'lane').map((column) => column.key)).toEqual(['ready', 'blocked']);
    expect(buildColumns(board, board.items, 'epic')[0]).toMatchObject({ key: 'epic-one', items: [ready] });
    expect(buildColumns(board, board.items, 'recommended')[0]).toMatchObject({ key: 'next', items: [ready] });
  });
});
